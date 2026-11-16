// Price sources and cross rates.
//  - TON/USD: refreshed every minute by jobs/prices.js (CoinGecko), stored in KV "rates:ton".
//  - USDT/IRT: set by an admin (PUT /admin/rates) and stored in KV "rates:usdt_irt".
// USDT is treated as 1 USD. Trading on a pair is paused when its source is stale.

import { HttpError } from './errors.js';
import { applySpread, mulE8, priceToE8, formatPriceE8, PAIRS } from './money.js';
import { TON_PRICE_MAX_AGE_SECONDS, USDT_IRT_MAX_AGE_SECONDS, envInt } from '../config.js';

const now = () => Math.floor(Date.now() / 1000);

async function readJson(env, key) {
  const raw = await env.KV.get(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function loadRates(env) {
  const [ton, irt] = await Promise.all([readJson(env, 'rates:ton'), readJson(env, 'rates:usdt_irt')]);
  const t = now();
  return {
    ton: ton && t - ton.updatedAt <= TON_PRICE_MAX_AGE_SECONDS ? ton : null,
    usdtIrt: irt && t - irt.updatedAt <= USDT_IRT_MAX_AGE_SECONDS ? irt : null,
    raw: { ton, irt },
  };
}

/** Mid price (E8 bigint) for a pair, or null if the needed sources are stale. */
export function midPriceE8(rates, pair) {
  const tonUsdt = rates.ton ? priceToE8(rates.ton.usd) : null;
  const usdtIrt = rates.usdtIrt ? priceToE8(rates.usdtIrt.value) : null;
  switch (pair) {
    case 'TON/USDT':
      return tonUsdt;
    case 'USDT/IRT':
      return usdtIrt;
    case 'TON/IRT':
      return tonUsdt && usdtIrt ? mulE8(tonUsdt, usdtIrt) : null;
    default:
      return null;
  }
}

export function tradePriceE8(env, rates, pair, side) {
  if (!PAIRS[pair]) throw new HttpError(400, 'unknown_pair', 'Unknown pair');
  const mid = midPriceE8(rates, pair);
  if (mid === null) throw new HttpError(503, 'price_unavailable', 'Price temporarily unavailable');
  return applySpread(mid, side, envInt(env, 'SPREAD_BPS', 30));
}

export function publicPrices(env, rates) {
  const out = [];
  for (const pair of Object.keys(PAIRS)) {
    const mid = midPriceE8(rates, pair);
    if (mid === null) {
      out.push({ pair, available: false });
      continue;
    }
    const spread = envInt(env, 'SPREAD_BPS', 30);
    out.push({
      pair,
      available: true,
      mid: formatPriceE8(mid),
      buy: formatPriceE8(applySpread(mid, 'buy', spread)),
      sell: formatPriceE8(applySpread(mid, 'sell', spread)),
      change24h: pair.startsWith('TON/') && rates.ton ? rates.ton.change24h ?? null : null,
    });
  }
  return { updatedAt: rates.raw.ton?.updatedAt ?? null, prices: out };
}
