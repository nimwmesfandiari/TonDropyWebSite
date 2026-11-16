import { Router } from './router.js';
import { errorResponse, fail, clientIp } from './lib/http.js';
import { authenticate, requireAdmin } from './lib/auth.js';
import { rateLimit } from './lib/ratelimit.js';
import { HttpError } from './lib/errors.js';
import { register as authRoutes } from './routes/auth.js';
import { register as marketRoutes } from './routes/market.js';
import { register as walletRoutes } from './routes/wallet.js';
import { register as orderRoutes } from './routes/orders.js';
import { register as verificationRoutes } from './routes/verification.js';
import { register as referralRoutes } from './routes/referral.js';
import { register as notificationRoutes } from './routes/notifications.js';
import { register as telegramRoutes } from './routes/telegram.js';
import { register as adminRoutes } from './routes/admin.js';
import { refreshPrices } from './jobs/prices.js';
import { watchDeposits } from './jobs/deposits.js';
import { cleanup, reconcile, stuckWithdrawals } from './jobs/housekeeping.js';

const API_PREFIX = '/api/v1';

const router = new Router();
[
  authRoutes, marketRoutes, walletRoutes, orderRoutes, verificationRoutes,
  referralRoutes, notificationRoutes, telegramRoutes, adminRoutes,
].forEach((register) => register(router));

async function handleApi(request, env, ectx) {
  const url = new URL(request.url);
  const pathname = url.pathname.slice(API_PREFIX.length) || '/';

  if (request.method === 'OPTIONS') return new Response(null, { status: 204 });

  const { route, params, pathMatched } = router.match(request.method, pathname);
  if (!route) {
    return pathMatched
      ? fail(405, 'method_not_allowed', 'Method not allowed')
      : fail(404, 'not_found', 'Not found');
  }

  // Global per-IP brake (best effort).
  await rateLimit(env, 'ip', clientIp(request), 300, 60);

  const c = { request, env, ectx, url, params, user: null };
  if (route.opts.auth) {
    c.user = await authenticate(request, env);
    if (route.opts.auth === 'admin') requireAdmin(c.user);
  }
  return route.handler(c);
}

export default {
  async fetch(request, env, ectx) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith(`${API_PREFIX}/`) && url.pathname !== API_PREFIX) {
      // Everything else is a static asset (see [assets] in wrangler.toml).
      return env.ASSETS ? env.ASSETS.fetch(request) : fail(404, 'not_found', 'Not found');
    }
    try {
      return await handleApi(request, env, ectx);
    } catch (err) {
      if (err instanceof HttpError) return errorResponse(err);
      return errorResponse(err);
    }
  },

  async scheduled(event, env, ectx) {
    if (event.cron === '*/10 * * * *') {
      ectx.waitUntil(Promise.all([cleanup(env), reconcile(env), stuckWithdrawals(env)]));
    } else {
      ectx.waitUntil(Promise.all([refreshPrices(env), watchDeposits(env)]));
    }
  },
};
