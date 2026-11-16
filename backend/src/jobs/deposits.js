// On-chain deposit watcher (TON + USDT jetton) using the Toncenter v3 API.
//
// IMPORTANT: the field mapping below follows the Toncenter v3 response shape as
// documented, but it MUST be verified against real testnet transfers before
// DEPOSIT_WATCHER_ENABLED is switched on in production (see docs/checklist.md).
// Nothing is credited unless the transfer carries a memo that matches a user's deposit_tag.
//
// Crediting is idempotent: deposits.tx_hash is UNIQUE, so replaying a transfer
// fails the whole D1 batch and credits nothing twice.

import { move, notify, audit, constraintReason } from '../lib/ledger.js';
import { randomId } from '../lib/crypto.js';
import { alertAdmins } from '../services/telegram.js';

const MIN_TON_NANO = 100_000_000; // 0.1 TON dust threshold
const MIN_USDT_MINOR = 1_000_000; // 1 USDT

async function toncenter(env, path) {
  const res = await fetch(`${env.TONCENTER_URL || 'https://toncenter.com'}${path}`, {
    headers: env.TONCENTER_API_KEY ? { 'X-API-Key': env.TONCENTER_API_KEY } : {},
  });
  if (!res.ok) throw new Error(`toncenter ${res.status}`);
  return res.json();
}

/** Normalises a Toncenter v3 transaction into { hash, lt, amount, memo } or null. */
export function parseTonTransaction(tx) {
  const msg = tx && tx.in_msg;
  if (!msg || !msg.source) return null; // external or malformed
  if (tx.description && tx.description.aborted) return null;
  const amount = Number(msg.value);
  if (!Number.isSafeInteger(amount) || amount <= 0) return null;
  const decoded = msg.message_content && msg.message_content.decoded;
  const memo = decoded && decoded.type === 'text_comment' ? String(decoded.comment || '').trim() : '';
  return { hash: tx.hash, lt: Number(tx.lt), amount, memo };
}

/** Normalises a Toncenter v3 jetton transfer into { hash, lt, amount, memo } or null. */
export function parseJettonTransfer(t, jettonMaster) {
  if (!t || (jettonMaster && t.jetton_master && t.jetton_master !== jettonMaster)) return null;
  if (t.transaction_aborted) return null;
  const amount = Number(t.amount);
  if (!Number.isSafeInteger(amount) || amount <= 0) return null;
  const memo = String(t.comment || t.decoded_forward_payload?.comment || '').trim();
  return { hash: t.transaction_hash, lt: Number(t.transaction_lt), amount, memo };
}

async function credit(env, asset, item, now) {
  if (!/^TD[A-Z2-9]{8}$/.test(item.memo)) {
    await env.DB.batch([audit(env.DB, { action: 'deposit.unmatched', target: item.hash, meta: { asset, amount: item.amount, memo: item.memo.slice(0, 40) }, now })]);
    return 'unmatched';
  }
  const user = await env.DB.prepare("SELECT id, status FROM users WHERE deposit_tag = ?1 AND role = 'user'").bind(item.memo).first();
  if (!user) {
    await env.DB.batch([audit(env.DB, { action: 'deposit.unmatched', target: item.hash, meta: { asset, amount: item.amount }, now })]);
    return 'unmatched';
  }
  const id = randomId('dep');
  const db = env.DB;
  try {
    await db.batch([
      db
        .prepare(
          `INSERT INTO deposits (id, user_id, asset, amount, method, status, tx_hash, reviewed_at, created_at)
           VALUES (?1,?2,?3,?4,'chain','credited',?5,?6,?6)`,
        )
        .bind(id, user.id, asset, item.amount, item.hash, now),
      ...move(db, { userId: user.id, asset, available: item.amount, kind: 'deposit_credit', refType: 'deposit', refId: id, now }),
      notify(db, user.id, 'واریز دریافت شد', `واریز ${asset} به کیف پول شما اضافه شد.`, now),
    ]);
    return 'credited';
  } catch (err) {
    if (constraintReason(err) === 'duplicate') return 'duplicate';
    throw err;
  }
}

async function getCursor(env, key) {
  const row = await env.DB.prepare('SELECT value FROM kv_state WHERE key = ?1').bind(key).first();
  return row ? Number(row.value) : 0;
}

async function setCursor(env, key, value, now) {
  await env.DB.prepare(
    'INSERT INTO kv_state (key, value, updated_at) VALUES (?1, ?2, ?3) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at',
  ).bind(key, String(value), now).run();
}

async function scan(env, { cursorKey, fetchItems, asset, minAmount }) {
  const now = Math.floor(Date.now() / 1000);
  const cursor = await getCursor(env, cursorKey);
  const items = (await fetchItems()).filter((i) => i && i.lt > cursor).sort((a, b) => a.lt - b.lt);
  let max = cursor;
  let credited = 0;
  for (const item of items) {
    if (item.amount >= minAmount) {
      const result = await credit(env, asset, item, now);
      if (result === 'credited') credited++;
    }
    max = Math.max(max, item.lt);
  }
  if (max > cursor) await setCursor(env, cursorKey, max, now);
  return credited;
}

export async function watchDeposits(env) {
  if (env.DEPOSIT_WATCHER_ENABLED !== 'true' || !env.TON_DEPOSIT_ADDRESS) return;
  const addr = encodeURIComponent(env.TON_DEPOSIT_ADDRESS);
  try {
    await scan(env, {
      cursorKey: 'cursor:ton',
      asset: 'TON',
      minAmount: MIN_TON_NANO,
      fetchItems: async () => {
        const data = await toncenter(env, `/api/v3/transactions?account=${addr}&limit=50&sort=desc`);
        return (data.transactions || []).map(parseTonTransaction).filter(Boolean);
      },
    });
    if (env.USDT_JETTON_MASTER) {
      await scan(env, {
        cursorKey: 'cursor:usdt',
        asset: 'USDT',
        minAmount: MIN_USDT_MINOR,
        fetchItems: async () => {
          const data = await toncenter(env, `/api/v3/jetton/transfers?owner_address=${addr}&direction=in&limit=50&sort=desc`);
          return (data.jetton_transfers || []).map((t) => parseJettonTransfer(t, null)).filter(Boolean);
        },
      });
    }
  } catch (err) {
    console.error('deposit watcher failed', err && err.message);
    await alertAdmins(env, `⚠️ Deposit watcher error: ${String(err && err.message).slice(0, 200)}`);
  }
}
