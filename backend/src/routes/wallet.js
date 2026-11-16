import { ok, readJson, nowSec } from '../lib/http.js';
import { badRequest, notFound, conflict } from '../lib/errors.js';
import { str, oneOf } from '../lib/validate.js';
import { requireKyc } from '../lib/auth.js';
import { rateLimit } from '../lib/ratelimit.js';
import { randomId } from '../lib/crypto.js';
import { move, audit, constraintReason } from '../lib/ledger.js';
import { ASSETS, MoneyError, parseAmount, formatAmount, wholeToMinor } from '../lib/money.js';
import { isValidTonAddress } from '../lib/ton.js';
import { isValidIranIban, normalizeIban } from '../lib/iban.js';
import { WITHDRAW, FIAT_DEPOSIT } from '../config.js';

const ASSET_LIST = Object.keys(ASSETS);

const depositView = (d) => ({
  id: d.id, asset: d.asset, amount: formatAmount(d.amount, d.asset), method: d.method,
  status: d.status, reference: d.reference, txHash: d.tx_hash, createdAt: d.created_at,
});

const withdrawalView = (w) => ({
  id: w.id, asset: w.asset, amount: formatAmount(w.amount, w.asset), fee: formatAmount(w.fee, w.asset),
  destination: w.destination, memo: w.memo, status: w.status, txHash: w.tx_hash,
  rejectReason: w.reject_reason, createdAt: w.created_at,
});

function money(fn) {
  try {
    return fn();
  } catch (e) {
    if (e instanceof MoneyError) throw badRequest(e.code, e.message);
    throw e;
  }
}

export function register(r) {
  r.get('/wallet', async (c) => {
    const rows = await c.env.DB.prepare('SELECT asset, available, locked FROM balances WHERE user_id = ?1')
      .bind(c.user.id)
      .all();
    const byAsset = Object.fromEntries(rows.results.map((b) => [b.asset, b]));
    return ok({
      balances: ASSET_LIST.map((asset) => ({
        asset,
        available: formatAmount(byAsset[asset]?.available ?? 0, asset),
        locked: formatAmount(byAsset[asset]?.locked ?? 0, asset),
      })),
    });
  }, { auth: true });

  r.get('/wallet/deposit-info', async (c) => {
    const e = c.env;
    return ok({
      TON: { address: e.TON_DEPOSIT_ADDRESS || null, memo: c.user.deposit_tag, network: e.TON_NETWORK || 'mainnet' },
      USDT: {
        address: e.TON_DEPOSIT_ADDRESS || null,
        memo: c.user.deposit_tag,
        network: `TON (${e.TON_NETWORK || 'mainnet'}) jetton`,
        jettonMaster: e.USDT_JETTON_MASTER || null,
      },
      IRT: { card: e.FIAT_DEPOSIT_CARD || null, holder: e.FIAT_DEPOSIT_HOLDER || null, iban: e.FIAT_DEPOSIT_IBAN || null },
      warning: 'The memo/comment is mandatory for TON and USDT deposits. Deposits without it need manual recovery.',
    });
  }, { auth: true });

  r.get('/wallet/history', async (c) => {
    const [d, w] = await c.env.DB.batch([
      c.env.DB.prepare('SELECT * FROM deposits WHERE user_id = ?1 ORDER BY created_at DESC LIMIT 30').bind(c.user.id),
      c.env.DB.prepare('SELECT * FROM withdrawals WHERE user_id = ?1 ORDER BY created_at DESC LIMIT 30').bind(c.user.id),
    ]);
    return ok({ deposits: d.results.map(depositView), withdrawals: w.results.map(withdrawalView) });
  }, { auth: true });

  // Toman top-up by card transfer; credited after an admin checks the receipt.
  r.post('/wallet/deposits/fiat', async (c) => {
    await rateLimit(c.env, 'fiat-deposit', c.user.id, 10, 3600);
    const body = await readJson(c.request);
    const amount = money(() => parseAmount(body.amount, 'IRT'));
    if (amount < FIAT_DEPOSIT.min || amount > FIAT_DEPOSIT.max) {
      throw badRequest('invalid_amount', `Amount must be ${FIAT_DEPOSIT.min}-${FIAT_DEPOSIT.max} toman`);
    }
    const reference = str(body.reference, 'reference', { min: 4, max: 40, pattern: /^[0-9A-Za-z\-_ ]+$/ });

    const pending = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM deposits WHERE user_id = ?1 AND status = 'pending'")
      .bind(c.user.id)
      .first();
    if (pending.n >= FIAT_DEPOSIT.maxPending) throw conflict('too_many_pending', 'Too many pending deposits');

    const id = randomId('dep');
    const now = nowSec();
    await c.env.DB.prepare(
      `INSERT INTO deposits (id, user_id, asset, amount, method, status, reference, created_at)
       VALUES (?1, ?2, 'IRT', ?3, 'fiat_receipt', 'pending', ?4, ?5)`,
    )
      .bind(id, c.user.id, amount, reference, now)
      .run();
    return ok({ id, status: 'pending' }, 201);
  }, { auth: true });

  r.post('/wallet/withdrawals', async (c) => {
    requireKyc(c.user, 1);
    await rateLimit(c.env, 'withdraw', c.user.id, 5, 3600);
    const body = await readJson(c.request);
    const asset = oneOf(body.asset, 'asset', ASSET_LIST);
    const rule = WITHDRAW[asset];
    const amount = money(() => parseAmount(body.amount, asset));
    const fee = money(() => parseAmount(rule.fee, asset));
    if (amount < wholeToMinor(rule.min, asset)) {
      throw badRequest('below_minimum', `Minimum withdrawal is ${rule.min} ${asset}`);
    }

    let destination;
    let memo = null;
    if (asset === 'IRT') {
      destination = normalizeIban(body.destination);
      if (!isValidIranIban(destination)) throw badRequest('invalid_destination', 'Invalid IBAN (Sheba)');
    } else {
      destination = str(body.destination, 'destination', { max: 70 });
      if (!isValidTonAddress(destination)) throw badRequest('invalid_destination', 'Invalid TON address');
      if (body.memo) memo = str(body.memo, 'memo', { max: 120 });
    }

    // Rolling 24h limit (excluding rejected requests).
    const now = nowSec();
    const used = await c.env.DB.prepare(
      "SELECT COALESCE(SUM(amount), 0) AS s FROM withdrawals WHERE user_id = ?1 AND asset = ?2 AND status != 'rejected' AND created_at > ?3",
    )
      .bind(c.user.id, asset, now - 86400)
      .first();
    const daily = wholeToMinor(rule.daily[c.user.kyc_level] ?? rule.daily[1], asset);
    if (used.s + amount > daily) throw badRequest('daily_limit', 'Daily withdrawal limit exceeded');

    const id = randomId('wd');
    const db = c.env.DB;
    try {
      await db.batch([
        db
          .prepare(
            `INSERT INTO withdrawals (id, user_id, asset, amount, fee, destination, memo, status, created_at)
             VALUES (?1,?2,?3,?4,?5,?6,?7,'pending',?8)`,
          )
          .bind(id, c.user.id, asset, amount, fee, destination, memo, now),
        // Funds move from available to locked; overdraft aborts the batch.
        ...move(db, { userId: c.user.id, asset, available: -(amount + fee), locked: amount + fee, kind: 'withdraw_lock', refType: 'withdrawal', refId: id, now }),
        audit(db, { actorId: c.user.id, action: 'withdraw.request', target: id, meta: { asset, amount }, now }),
      ]);
    } catch (err) {
      if (constraintReason(err) === 'insufficient_funds') throw conflict('insufficient_funds', 'Insufficient balance');
      throw err;
    }
    return ok({ id, status: 'pending' }, 201);
  }, { auth: true });

  r.post('/wallet/withdrawals/:id/cancel', async (c) => {
    const w = await c.env.DB.prepare('SELECT * FROM withdrawals WHERE id = ?1 AND user_id = ?2')
      .bind(c.params.id, c.user.id)
      .first();
    if (!w) throw notFound('Withdrawal not found');
    if (w.status !== 'pending') throw conflict('not_cancellable', 'Only pending withdrawals can be cancelled');
    const now = nowSec();
    const db = c.env.DB;
    try {
      await db.batch([
        db
          .prepare("UPDATE withdrawals SET status = 'rejected', reject_reason = 'cancelled_by_user', reviewed_at = ?1 WHERE id = ?2 AND status = 'pending'")
          .bind(now, w.id),
        // ux_ledger_withdraw_final guarantees the unlock happens at most once.
        ...move(db, { userId: w.user_id, asset: w.asset, available: w.amount + w.fee, locked: -(w.amount + w.fee), kind: 'withdraw_unlock', refType: 'withdrawal', refId: w.id, now }),
      ]);
    } catch (err) {
      if (constraintReason(err) === 'duplicate') throw conflict('not_cancellable', 'Withdrawal already processed');
      throw err;
    }
    return ok({ id: w.id, status: 'rejected' });
  }, { auth: true });
}

export { depositView, withdrawalView };
