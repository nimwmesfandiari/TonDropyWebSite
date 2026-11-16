import { ok, readJson, nowSec, clientIp, pageParams } from '../lib/http.js';
import { badRequest, notFound, conflict, forbidden } from '../lib/errors.js';
import { str, oneOf, intInRange } from '../lib/validate.js';
import { move, notify, audit, constraintReason, HOUSE_ID } from '../lib/ledger.js';
import { decryptField } from '../lib/fieldcrypto.js';
import { formatAmount, priceToE8 } from '../lib/money.js';
import { loadRates, publicPrices } from '../lib/pricing.js';
import { depositView, withdrawalView } from './wallet.js';
import { sendMessage } from '../services/telegram.js';

const STATUS = {
  deposits: ['pending', 'credited', 'rejected'],
  withdrawals: ['pending', 'approved', 'completed', 'rejected'],
  kyc: ['pending', 'approved', 'rejected'],
};

async function telegramIdOf(env, userId) {
  const u = await env.DB.prepare('SELECT telegram_id FROM users WHERE id = ?1').bind(userId).first();
  return u ? u.telegram_id : null;
}

function pushMessage(c, userId, text) {
  c.ectx.waitUntil(
    telegramIdOf(c.env, userId).then((tg) => (tg && tg > 0 ? sendMessage(c.env, tg, text) : null)),
  );
}

export function register(r) {
  // ---- overview ----
  r.get('/admin/stats', async (c) => {
    const db = c.env.DB;
    const [users, pend, house, vol] = await db.batch([
      db.prepare("SELECT COUNT(*) AS n FROM users WHERE role != 'system'"),
      db.prepare(
        `SELECT
           (SELECT COUNT(*) FROM deposits WHERE status = 'pending') AS deposits,
           (SELECT COUNT(*) FROM withdrawals WHERE status IN ('pending','approved')) AS withdrawals,
           (SELECT COUNT(*) FROM kyc_submissions WHERE status = 'pending') AS kyc`,
      ),
      db.prepare('SELECT asset, available FROM balances WHERE user_id = ?1').bind(HOUSE_ID),
      db.prepare(
        "SELECT quote_asset AS asset, COUNT(*) AS orders, SUM(quote_amount) AS volume, SUM(fee) AS fees FROM orders WHERE created_at > ?1 AND status = 'filled' GROUP BY quote_asset",
      ).bind(nowSec() - 86400),
    ]);
    const rates = await loadRates(c.env);
    return ok({
      users: users.results[0].n,
      pending: pend.results[0],
      houseBalances: house.results.map((b) => ({ asset: b.asset, available: formatAmount(b.available, b.asset) })),
      last24h: vol.results.map((v) => ({
        asset: v.asset, orders: v.orders, volume: formatAmount(v.volume, v.asset), fees: formatAmount(v.fees, v.asset),
      })),
      prices: publicPrices(c.env, rates),
    });
  }, { auth: 'admin' });

  // ---- USDT/IRT rate (manual source) ----
  r.put('/admin/rates', async (c) => {
    const body = await readJson(c.request);
    const value = str(String(body.usdtIrt), 'usdtIrt', { max: 14, pattern: /^\d+(\.\d{1,2})?$/ });
    const n = Number(value);
    if (n < 1000 || n > 10_000_000) throw badRequest('invalid_rate', 'Rate is outside the sane range');
    const prev = await c.env.KV.get('rates:usdt_irt', 'json');
    if (prev && Math.abs(n - Number(prev.value)) / Number(prev.value) > 0.2 && body.force !== true) {
      throw badRequest('rate_jump', 'Change is larger than 20%; resend with force: true to confirm');
    }
    priceToE8(value); // validates format
    await c.env.KV.put('rates:usdt_irt', JSON.stringify({ value, updatedAt: nowSec(), setBy: c.user.id }));
    await c.env.DB.batch([audit(c.env.DB, { actorId: c.user.id, action: 'rate.set', meta: { usdtIrt: value }, ip: clientIp(c.request), now: nowSec() })]);
    return ok({ usdtIrt: value });
  }, { auth: 'admin' });

  // ---- fiat deposits ----
  r.get('/admin/deposits', async (c) => {
    const status = oneOf(c.url.searchParams.get('status') || 'pending', 'status', STATUS.deposits);
    const { limit } = pageParams(c.url);
    const rows = await c.env.DB.prepare(
      `SELECT d.*, u.username, u.first_name FROM deposits d JOIN users u ON u.id = d.user_id
       WHERE d.status = ?1 ORDER BY d.created_at ASC LIMIT ?2`,
    ).bind(status, limit).all();
    return ok({ deposits: rows.results.map((d) => ({ ...depositView(d), userId: d.user_id, username: d.username, firstName: d.first_name })) });
  }, { auth: 'admin' });

  r.post('/admin/deposits/:id/approve', async (c) => {
    const d = await c.env.DB.prepare('SELECT * FROM deposits WHERE id = ?1').bind(c.params.id).first();
    if (!d) throw notFound('Deposit not found');
    if (d.status !== 'pending' || d.method !== 'fiat_receipt') throw conflict('invalid_state', 'Deposit is not pending');
    const now = nowSec();
    const db = c.env.DB;
    try {
      await db.batch([
        db.prepare("UPDATE deposits SET status = 'credited', reviewed_by = ?1, reviewed_at = ?2 WHERE id = ?3 AND status = 'pending'").bind(c.user.id, now, d.id),
        // ux_ledger_deposit_credit makes a double credit impossible.
        ...move(db, { userId: d.user_id, asset: d.asset, available: d.amount, kind: 'deposit_credit', refType: 'deposit', refId: d.id, now }),
        notify(db, d.user_id, 'واریز تایید شد', `${formatAmount(d.amount, d.asset)} تومان به کیف پول شما اضافه شد.`, now),
        audit(db, { actorId: c.user.id, action: 'deposit.approve', target: d.id, meta: { amount: d.amount }, ip: clientIp(c.request), now }),
      ]);
    } catch (err) {
      if (constraintReason(err) === 'duplicate') throw conflict('already_credited', 'Deposit was already credited');
      throw err;
    }
    pushMessage(c, d.user_id, `✅ واریز ${formatAmount(d.amount, d.asset)} تومان تایید شد.`);
    return ok({ id: d.id, status: 'credited' });
  }, { auth: 'admin' });

  r.post('/admin/deposits/:id/reject', async (c) => {
    const body = await readJson(c.request);
    const reason = str(body.reason, 'reason', { min: 3, max: 200 });
    const d = await c.env.DB.prepare('SELECT * FROM deposits WHERE id = ?1').bind(c.params.id).first();
    if (!d) throw notFound('Deposit not found');
    if (d.status !== 'pending') throw conflict('invalid_state', 'Deposit is not pending');
    const now = nowSec();
    await c.env.DB.batch([
      c.env.DB.prepare("UPDATE deposits SET status = 'rejected', note = ?1, reviewed_by = ?2, reviewed_at = ?3 WHERE id = ?4 AND status = 'pending'").bind(reason, c.user.id, now, d.id),
      notify(c.env.DB, d.user_id, 'واریز رد شد', reason, now),
      audit(c.env.DB, { actorId: c.user.id, action: 'deposit.reject', target: d.id, meta: { reason }, ip: clientIp(c.request), now }),
    ]);
    return ok({ id: d.id, status: 'rejected' });
  }, { auth: 'admin' });

  // ---- withdrawals ----
  r.get('/admin/withdrawals', async (c) => {
    const status = oneOf(c.url.searchParams.get('status') || 'pending', 'status', STATUS.withdrawals);
    const { limit } = pageParams(c.url);
    const rows = await c.env.DB.prepare(
      `SELECT w.*, u.username, u.first_name, u.kyc_level FROM withdrawals w JOIN users u ON u.id = w.user_id
       WHERE w.status = ?1 ORDER BY w.created_at ASC LIMIT ?2`,
    ).bind(status, limit).all();
    return ok({ withdrawals: rows.results.map((w) => ({ ...withdrawalView(w), userId: w.user_id, username: w.username, kycLevel: w.kyc_level })) });
  }, { auth: 'admin' });

  async function loadWithdrawal(c) {
    const w = await c.env.DB.prepare('SELECT * FROM withdrawals WHERE id = ?1').bind(c.params.id).first();
    if (!w) throw notFound('Withdrawal not found');
    // Four-eyes rule: an admin can never process their own withdrawal.
    if (w.user_id === c.user.id) throw forbidden('You cannot process your own withdrawal', 'self_review');
    return w;
  }

  r.post('/admin/withdrawals/:id/approve', async (c) => {
    const w = await loadWithdrawal(c);
    if (w.status !== 'pending') throw conflict('invalid_state', 'Withdrawal is not pending');
    const now = nowSec();
    await c.env.DB.batch([
      c.env.DB.prepare("UPDATE withdrawals SET status = 'approved', reviewed_by = ?1, reviewed_at = ?2 WHERE id = ?3 AND status = 'pending'").bind(c.user.id, now, w.id),
      audit(c.env.DB, { actorId: c.user.id, action: 'withdraw.approve', target: w.id, ip: clientIp(c.request), now }),
    ]);
    return ok({ id: w.id, status: 'approved' });
  }, { auth: 'admin' });

  r.post('/admin/withdrawals/:id/reject', async (c) => {
    const body = await readJson(c.request);
    const reason = str(body.reason, 'reason', { min: 3, max: 200 });
    const w = await loadWithdrawal(c);
    if (!['pending', 'approved'].includes(w.status)) throw conflict('invalid_state', 'Withdrawal already finalised');
    const now = nowSec();
    const db = c.env.DB;
    try {
      await db.batch([
        db.prepare("UPDATE withdrawals SET status = 'rejected', reject_reason = ?1, reviewed_by = ?2, reviewed_at = ?3 WHERE id = ?4 AND status IN ('pending','approved')").bind(reason, c.user.id, now, w.id),
        ...move(db, { userId: w.user_id, asset: w.asset, available: w.amount + w.fee, locked: -(w.amount + w.fee), kind: 'withdraw_unlock', refType: 'withdrawal', refId: w.id, now }),
        notify(db, w.user_id, 'برداشت رد شد', reason, now),
        audit(db, { actorId: c.user.id, action: 'withdraw.reject', target: w.id, meta: { reason }, ip: clientIp(c.request), now }),
      ]);
    } catch (err) {
      if (constraintReason(err) === 'duplicate') throw conflict('invalid_state', 'Withdrawal already finalised');
      throw err;
    }
    pushMessage(c, w.user_id, '❌ درخواست برداشت شما رد شد و مبلغ به کیف پول برگشت.');
    return ok({ id: w.id, status: 'rejected' });
  }, { auth: 'admin' });

  // Called AFTER the transfer has been signed and sent from the cold/hot wallet, off-platform.
  r.post('/admin/withdrawals/:id/complete', async (c) => {
    const body = await readJson(c.request);
    const txHash = str(body.txHash, 'txHash', { min: 4, max: 90, pattern: /^[0-9A-Za-z+/=_\-]+$/ });
    const w = await loadWithdrawal(c);
    if (w.status !== 'approved') throw conflict('invalid_state', 'Withdrawal must be approved first');
    const now = nowSec();
    const db = c.env.DB;
    try {
      await db.batch([
        db.prepare("UPDATE withdrawals SET status = 'completed', tx_hash = ?1, reviewed_by = ?2, reviewed_at = ?3 WHERE id = ?4 AND status = 'approved'").bind(txHash, c.user.id, now, w.id),
        // The user's locked funds leave the platform; the fee stays with the house.
        ...move(db, { userId: w.user_id, asset: w.asset, locked: -(w.amount + w.fee), kind: 'withdraw_settle', refType: 'withdrawal', refId: w.id, now }),
        ...move(db, { userId: HOUSE_ID, asset: w.asset, available: w.fee, kind: 'withdraw_fee', refType: 'withdrawal', refId: w.id, now }),
        notify(db, w.user_id, 'برداشت انجام شد', `${formatAmount(w.amount, w.asset)} ${w.asset} ارسال شد.`, now),
        audit(db, { actorId: c.user.id, action: 'withdraw.complete', target: w.id, meta: { txHash }, ip: clientIp(c.request), now }),
      ]);
    } catch (err) {
      if (constraintReason(err) === 'duplicate') throw conflict('invalid_state', 'Withdrawal already finalised');
      throw err;
    }
    pushMessage(c, w.user_id, `✅ برداشت ${formatAmount(w.amount, w.asset)} ${w.asset} انجام شد.`);
    return ok({ id: w.id, status: 'completed' });
  }, { auth: 'admin' });

  // ---- KYC ----
  r.get('/admin/kyc', async (c) => {
    const status = oneOf(c.url.searchParams.get('status') || 'pending', 'status', STATUS.kyc);
    const { limit } = pageParams(c.url);
    const rows = await c.env.DB.prepare(
      `SELECT k.id, k.user_id, k.status, k.created_at, u.username, u.first_name
       FROM kyc_submissions k JOIN users u ON u.id = k.user_id
       WHERE k.status = ?1 ORDER BY k.created_at ASC LIMIT ?2`,
    ).bind(status, limit).all();
    return ok({ submissions: rows.results });
  }, { auth: 'admin' });

  r.get('/admin/kyc/:id', async (c) => {
    const k = await c.env.DB.prepare('SELECT * FROM kyc_submissions WHERE id = ?1').bind(c.params.id).first();
    if (!k) throw notFound('Submission not found');
    const key = c.env.KYC_ENCRYPTION_KEY;
    const now = nowSec();
    // Reading PII is itself an audited action.
    await c.env.DB.batch([audit(c.env.DB, { actorId: c.user.id, action: 'kyc.view', target: k.id, ip: clientIp(c.request), now })]);
    return ok({
      id: k.id, userId: k.user_id, status: k.status, createdAt: k.created_at,
      fullName: await decryptField(k.full_name, key),
      nationalId: await decryptField(k.national_id, key),
      birthDate: await decryptField(k.birth_date, key),
    });
  }, { auth: 'admin' });

  r.get('/admin/kyc/:id/image', async (c) => {
    const which = oneOf(c.url.searchParams.get('which') || 'idCard', 'which', ['idCard', 'selfie']);
    const k = await c.env.DB.prepare('SELECT * FROM kyc_submissions WHERE id = ?1').bind(c.params.id).first();
    if (!k) throw notFound('Submission not found');
    const obj = await c.env.KYC_BUCKET.get(which === 'idCard' ? k.doc_front_key : k.doc_selfie_key);
    if (!obj) throw notFound('File not found');
    return new Response(obj.body, {
      headers: {
        'Content-Type': obj.httpMetadata?.contentType || 'application/octet-stream',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'Content-Disposition': 'inline',
      },
    });
  }, { auth: 'admin' });

  r.post('/admin/kyc/:id/approve', async (c) => {
    const body = await readJson(c.request);
    const level = intInRange(body.level ?? 1, 'level', 1, 2);
    const k = await c.env.DB.prepare('SELECT * FROM kyc_submissions WHERE id = ?1').bind(c.params.id).first();
    if (!k) throw notFound('Submission not found');
    if (k.status !== 'pending') throw conflict('invalid_state', 'Submission is not pending');
    if (k.user_id === c.user.id) throw forbidden('You cannot verify yourself', 'self_review');
    const dup = await c.env.DB.prepare("SELECT id FROM kyc_submissions WHERE national_id_hash = ?1 AND status = 'approved' AND user_id != ?2")
      .bind(k.national_id_hash, k.user_id).first();
    if (dup) throw conflict('national_id_in_use', 'National ID already verified on another account');
    const now = nowSec();
    await c.env.DB.batch([
      c.env.DB.prepare("UPDATE kyc_submissions SET status = 'approved', reviewed_by = ?1, reviewed_at = ?2 WHERE id = ?3 AND status = 'pending'").bind(c.user.id, now, k.id),
      c.env.DB.prepare('UPDATE users SET kyc_level = MAX(kyc_level, ?1) WHERE id = ?2').bind(level, k.user_id),
      notify(c.env.DB, k.user_id, 'احراز هویت تایید شد', 'حساب شما تایید شد و می‌توانید معامله و برداشت کنید.', now),
      audit(c.env.DB, { actorId: c.user.id, action: 'kyc.approve', target: k.id, meta: { level }, ip: clientIp(c.request), now }),
    ]);
    pushMessage(c, k.user_id, '✅ احراز هویت شما تایید شد.');
    return ok({ id: k.id, status: 'approved', level });
  }, { auth: 'admin' });

  r.post('/admin/kyc/:id/reject', async (c) => {
    const body = await readJson(c.request);
    const reason = str(body.reason, 'reason', { min: 3, max: 200 });
    const k = await c.env.DB.prepare('SELECT * FROM kyc_submissions WHERE id = ?1').bind(c.params.id).first();
    if (!k) throw notFound('Submission not found');
    if (k.status !== 'pending') throw conflict('invalid_state', 'Submission is not pending');
    const now = nowSec();
    await c.env.DB.batch([
      c.env.DB.prepare("UPDATE kyc_submissions SET status = 'rejected', reject_reason = ?1, reviewed_by = ?2, reviewed_at = ?3 WHERE id = ?4 AND status = 'pending'").bind(reason, c.user.id, now, k.id),
      notify(c.env.DB, k.user_id, 'احراز هویت رد شد', reason, now),
      audit(c.env.DB, { actorId: c.user.id, action: 'kyc.reject', target: k.id, meta: { reason }, ip: clientIp(c.request), now }),
    ]);
    pushMessage(c, k.user_id, `❌ احراز هویت رد شد: ${reason}`);
    return ok({ id: k.id, status: 'rejected' });
  }, { auth: 'admin' });

  // ---- users ----
  r.get('/admin/users', async (c) => {
    const q = (c.url.searchParams.get('q') || '').trim().slice(0, 40);
    const { limit } = pageParams(c.url, { defaultLimit: 25 });
    const like = `%${q.replace(/[%_\\]/g, '')}%`;
    const rows = await c.env.DB.prepare(
      `SELECT id, telegram_id, username, first_name, role, status, kyc_level, created_at FROM users
       WHERE role != 'system' AND (?1 = '' OR username LIKE ?2 OR CAST(telegram_id AS TEXT) = ?1 OR CAST(id AS TEXT) = ?1)
       ORDER BY id DESC LIMIT ?3`,
    ).bind(q, like, limit).all();
    return ok({ users: rows.results });
  }, { auth: 'admin' });

  r.post('/admin/users/:id/status', async (c) => {
    const body = await readJson(c.request);
    const status = oneOf(body.status, 'status', ['active', 'frozen']);
    const id = intInRange(c.params.id, 'id', 2, Number.MAX_SAFE_INTEGER);
    if (id === c.user.id) throw forbidden('You cannot change your own status');
    const res = await c.env.DB.prepare("UPDATE users SET status = ?1 WHERE id = ?2 AND role != 'system'").bind(status, id).run();
    if (!res.meta.changes) throw notFound('User not found');
    await c.env.DB.batch([audit(c.env.DB, { actorId: c.user.id, action: `user.${status}`, target: String(id), ip: clientIp(c.request), now: nowSec() })]);
    return ok({ id, status });
  }, { auth: 'admin' });

  r.get('/admin/audit', async (c) => {
    const { limit, before } = pageParams(c.url, { defaultLimit: 50 });
    const rows = await c.env.DB.prepare(
      'SELECT * FROM audit_log WHERE (?1 IS NULL OR id < ?1) ORDER BY id DESC LIMIT ?2',
    ).bind(before, limit).all();
    return ok({ entries: rows.results });
  }, { auth: 'admin' });
}

