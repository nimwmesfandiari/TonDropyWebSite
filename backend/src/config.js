// Business limits. Whole units (not minor units). Level = users.kyc_level.
// Tune these before launch; they are also published to the UI by GET /market/config.

export const TRADE_LIMITS = {
  // Per order, measured in the quote asset.
  IRT: { min: 100_000, max: { 1: 100_000_000, 2: 1_000_000_000 } },
  USDT: { min: 1, max: { 1: 2_000, 2: 20_000 } },
};

export const WITHDRAW = {
  TON: { min: 1, fee: '0.05', daily: { 1: 5_000, 2: 50_000 } },
  USDT: { min: 5, fee: '1', daily: { 1: 10_000, 2: 100_000 } },
  IRT: { min: 100_000, fee: '5000', daily: { 1: 200_000_000, 2: 2_000_000_000 } },
};

export const FIAT_DEPOSIT = { min: 100_000, max: 500_000_000, maxPending: 5 };

export const JWT_TTL_SECONDS = 12 * 60 * 60;
export const INIT_DATA_MAX_AGE_SECONDS = 24 * 60 * 60;

// A quote source older than this is considered stale and trading is paused.
export const TON_PRICE_MAX_AGE_SECONDS = 5 * 60;
export const USDT_IRT_MAX_AGE_SECONDS = 6 * 60 * 60;

export const KYC = {
  maxFileBytes: 5 * 1024 * 1024,
  allowedTypes: ['image/jpeg', 'image/png', 'image/webp'],
};

export function envInt(env, name, fallback) {
  const n = Number.parseInt(env[name], 10);
  return Number.isFinite(n) ? n : fallback;
}
