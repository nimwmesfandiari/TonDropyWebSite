// Fixed-point money. Amounts are integer minor units stored in D1 as INTEGER.
// All intermediate math uses BigInt; results are converted back to Number only
// after checking they are safe integers.

export const ASSETS = {
  TON: { scale: 9, label: 'TON' },
  USDT: { scale: 6, label: 'USDT' },
  IRT: { scale: 0, label: 'تومان' },
};

export const PAIRS = {
  'TON/IRT': { base: 'TON', quote: 'IRT' },
  'USDT/IRT': { base: 'USDT', quote: 'IRT' },
  'TON/USDT': { base: 'TON', quote: 'USDT' },
};

/** Hard cap for any single amount (minor units). Keeps Number math exact. */
export const MAX_MINOR = 4_000_000_000_000_000;

const PRICE_SCALE = 100_000_000n; // prices are stored as integer * 1e8

export class MoneyError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

export function assetScale(asset) {
  const a = ASSETS[asset];
  if (!a) throw new MoneyError('unknown_asset', `Unknown asset ${asset}`);
  return a.scale;
}

const pow10 = (n) => 10n ** BigInt(n);

export function toSafeNumber(big) {
  if (big < 0n || big > BigInt(MAX_MINOR)) throw new MoneyError('amount_out_of_range', 'Amount out of range');
  return Number(big);
}

/** Parse a user supplied decimal string ("1.5") into minor units. */
export function parseAmount(input, asset) {
  const scale = assetScale(asset);
  if (typeof input !== 'string' && typeof input !== 'number') {
    throw new MoneyError('invalid_amount', 'Invalid amount');
  }
  const s = String(input).trim();
  if (!/^\d+(\.\d+)?$/.test(s)) throw new MoneyError('invalid_amount', 'Invalid amount');
  const [whole, frac = ''] = s.split('.');
  if (frac.length > scale) throw new MoneyError('too_many_decimals', `Max ${scale} decimals`);
  if (whole.length > 16) throw new MoneyError('amount_out_of_range', 'Amount out of range');
  const big = BigInt(whole) * pow10(scale) + BigInt(frac.padEnd(scale, '0') || '0');
  return toSafeNumber(big);
}

/** Format minor units as a trimmed decimal string. */
export function formatAmount(minor, asset) {
  const scale = assetScale(asset);
  const neg = minor < 0;
  const big = BigInt(Math.abs(minor));
  const base = pow10(scale);
  const whole = big / base;
  const frac = (big % base).toString().padStart(scale, '0').replace(/0+$/, '');
  return `${neg ? '-' : ''}${whole}${frac ? '.' + frac : ''}`;
}

/** Decimal price (number or string) -> integer scaled by 1e8. */
export function priceToE8(price) {
  const s = typeof price === 'number' ? price.toFixed(8) : String(price);
  if (!/^\d+(\.\d+)?$/.test(s)) throw new MoneyError('invalid_price', 'Invalid price');
  const [w, f = ''] = s.split('.');
  return BigInt(w) * PRICE_SCALE + BigInt(f.slice(0, 8).padEnd(8, '0'));
}

export function formatPriceE8(e8) {
  const big = BigInt(e8);
  const whole = big / PRICE_SCALE;
  const frac = (big % PRICE_SCALE).toString().padStart(8, '0').replace(/0+$/, '');
  return `${whole}${frac ? '.' + frac : ''}`;
}

const ceilDiv = (a, b) => (a + b - 1n) / b;

/** Apply a spread (basis points) to a mid price. Buyers pay more, sellers get less. */
export function applySpread(midE8, side, spreadBps) {
  const mid = BigInt(midE8);
  const s = BigInt(spreadBps);
  return side === 'buy' ? ceilDiv(mid * (10000n + s), 10000n) : (mid * (10000n - s)) / 10000n;
}

/** Cross-rate: base/quote where both are expressed against a common unit. */
export function mulE8(aE8, bE8) {
  return (BigInt(aE8) * BigInt(bE8)) / PRICE_SCALE;
}

/**
 * Compute a quote.
 * - buy : user pays quoteAmount + fee, receives baseAmount. quoteAmount rounds UP.
 * - sell: user gives baseAmount, receives quoteAmount - fee. quoteAmount rounds DOWN.
 * The fee is always charged in the quote asset, rounded UP in the house's favour.
 */
export function computeQuote({ side, baseAmount, priceE8, baseAsset, quoteAsset, feeBps }) {
  if (side !== 'buy' && side !== 'sell') throw new MoneyError('invalid_side', 'Invalid side');
  const sb = assetScale(baseAsset);
  const sq = assetScale(quoteAsset);
  const num = BigInt(baseAmount) * BigInt(priceE8) * pow10(sq);
  const den = pow10(sb) * PRICE_SCALE;
  const quoteBig = side === 'buy' ? ceilDiv(num, den) : num / den;
  if (quoteBig <= 0n) throw new MoneyError('amount_too_small', 'Amount too small');
  const feeBig = ceilDiv(quoteBig * BigInt(feeBps), 10000n);
  const quoteAmount = toSafeNumber(quoteBig);
  const fee = toSafeNumber(feeBig);
  const total = side === 'buy' ? quoteAmount + fee : quoteAmount - fee;
  if (total <= 0) throw new MoneyError('amount_too_small', 'Amount too small');
  return { quoteAmount, fee, total, baseAmount };
}

/** Whole-unit limit (e.g. 100000 toman) -> minor units. */
export function wholeToMinor(whole, asset) {
  return toSafeNumber(BigInt(whole) * pow10(assetScale(asset)));
}
