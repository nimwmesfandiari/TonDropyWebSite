import { alertAdmins } from '../services/telegram.js';

/** Removes expired quotes and old rate-limit noise. */
export async function cleanup(env) {
  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare('DELETE FROM quotes WHERE expires_at < ?1 AND id NOT IN (SELECT quote_id FROM orders)')
    .bind(now - 3600)
    .run();
}

/**
 * Accounting invariants. Any mismatch means money is unaccounted for and admins
 * are alerted immediately.
 *  1. balances == sum of ledger deltas   (per asset)
 *  2. balances == credited deposits - completed withdrawal amounts (per asset)
 */
export async function reconcile(env) {
  const [bal, led, dep, wd] = await env.DB.batch([
    env.DB.prepare('SELECT asset, SUM(available + locked) AS total FROM balances GROUP BY asset'),
    env.DB.prepare('SELECT asset, SUM(delta + locked_delta) AS total FROM ledger_entries GROUP BY asset'),
    env.DB.prepare("SELECT asset, SUM(amount) AS total FROM deposits WHERE status = 'credited' GROUP BY asset"),
    env.DB.prepare("SELECT asset, SUM(amount) AS total FROM withdrawals WHERE status = 'completed' GROUP BY asset"),
  ]);
  const toMap = (res) => Object.fromEntries(res.results.map((r) => [r.asset, r.total || 0]));
  const b = toMap(bal), l = toMap(led), d = toMap(dep), w = toMap(wd);
  const problems = [];
  for (const asset of ['TON', 'USDT', 'IRT']) {
    const expected = (d[asset] || 0) - (w[asset] || 0);
    if ((b[asset] || 0) !== (l[asset] || 0)) {
      problems.push(`${asset}: balances ${b[asset] || 0} != ledger ${l[asset] || 0}`);
    }
    if ((b[asset] || 0) !== expected) {
      problems.push(`${asset}: balances ${b[asset] || 0} != deposits-withdrawals ${expected}`);
    }
  }
  if (problems.length) {
    console.error('RECONCILIATION MISMATCH', problems);
    // Throttle: at most one alert per hour.
    const last = await env.KV.get('alert:reconcile');
    if (!last) {
      await env.KV.put('alert:reconcile', '1', { expirationTtl: 3600 });
      await alertAdmins(env, `🚨 <b>Reconciliation mismatch</b>\n${problems.join('\n')}`);
    }
  }
  return problems;
}

/** Warns admins when withdrawals have been waiting too long. */
export async function stuckWithdrawals(env) {
  const now = Math.floor(Date.now() / 1000);
  const row = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM withdrawals WHERE status IN ('pending','approved') AND created_at < ?1",
  ).bind(now - 6 * 3600).first();
  if (row.n > 0 && !(await env.KV.get('alert:stuck-withdrawals'))) {
    await env.KV.put('alert:stuck-withdrawals', '1', { expirationTtl: 6 * 3600 });
    await alertAdmins(env, `⏰ ${row.n} withdrawal(s) have been waiting for more than 6 hours.`);
  }
}
