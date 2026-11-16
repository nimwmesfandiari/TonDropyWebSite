import { ok } from '../lib/http.js';
import { loadRates, publicPrices } from '../lib/pricing.js';
import { ASSETS, PAIRS } from '../lib/money.js';
import { TRADE_LIMITS, WITHDRAW, FIAT_DEPOSIT, envInt } from '../config.js';

export function register(r) {
  r.get('/market/prices', async (c) => {
    const rates = await loadRates(c.env);
    return ok(publicPrices(c.env, rates), 200, { 'Cache-Control': 'public, max-age=5' });
  });

  r.get('/market/config', async (c) =>
    ok(
      {
        assets: ASSETS,
        pairs: PAIRS,
        feeBps: envInt(c.env, 'FEE_BPS', 50),
        quoteTtlSeconds: envInt(c.env, 'QUOTE_TTL_SECONDS', 30),
        tradeLimits: TRADE_LIMITS,
        withdraw: WITHDRAW,
        fiatDeposit: FIAT_DEPOSIT,
        botUsername: c.env.TELEGRAM_BOT_USERNAME || null,
      },
      200,
      { 'Cache-Control': 'public, max-age=60' },
    ),
  );
}
