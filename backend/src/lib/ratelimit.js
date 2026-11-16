import { tooMany } from './errors.js';

/**
 * Fixed-window limiter on Workers KV. KV is eventually consistent, so this is
 * a best-effort brake against abuse, NOT a security boundary. Money safety
 * never relies on it (see ledger CHECK constraints and unique indexes).
 */
export async function rateLimit(env, name, id, limit, windowSec) {
  if (!env.KV) return;
  const bucket = Math.floor(Date.now() / 1000 / windowSec);
  const key = `rl:${name}:${id}:${bucket}`;
  const current = Number((await env.KV.get(key)) || 0);
  if (current >= limit) throw tooMany();
  // KV needs expirationTtl >= 60.
  await env.KV.put(key, String(current + 1), { expirationTtl: Math.max(60, windowSec * 2) });
}
