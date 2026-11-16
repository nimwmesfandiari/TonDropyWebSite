import { ok, readJson, clientIp, nowSec } from '../lib/http.js';
import { forbidden, notFound } from '../lib/errors.js';
import { str, intInRange } from '../lib/validate.js';
import { verifyWebAppInitData, verifyLoginWidget } from '../lib/telegram-auth.js';
import { issueToken, publicUser } from '../lib/auth.js';
import { rateLimit } from '../lib/ratelimit.js';
import { upsertTelegramUser, referralFromStartParam } from '../services/users.js';
import { INIT_DATA_MAX_AGE_SECONDS } from '../config.js';

async function pendingReferral(env, telegramId) {
  const v = await env.KV.get(`ref:${telegramId}`);
  return v && /^[A-Z0-9]{8}$/.test(v) ? v : null;
}

async function finishLogin(c, tgUser, startParam) {
  const now = nowSec();
  const refCode = referralFromStartParam(startParam) || (await pendingReferral(c.env, tgUser.id));
  const user = await upsertTelegramUser(c.env, tgUser, refCode, now);
  const token = await issueToken(c.env, user);
  return ok({ token, user: publicUser(user) });
}

export function register(r) {
  // Telegram Mini App login (preferred).
  r.post('/auth/telegram', async (c) => {
    await rateLimit(c.env, 'login', clientIp(c.request), 20, 60);
    const body = await readJson(c.request);
    const { user, startParam } = await verifyWebAppInitData(body.initData, c.env.TELEGRAM_BOT_TOKEN, {
      maxAgeSec: INIT_DATA_MAX_AGE_SECONDS,
    });
    return finishLogin(c, user, startParam);
  });

  // Telegram Login Widget (regular browser).
  r.post('/auth/telegram-widget', async (c) => {
    await rateLimit(c.env, 'login', clientIp(c.request), 20, 60);
    const body = await readJson(c.request);
    const { user } = await verifyLoginWidget(body.widget, c.env.TELEGRAM_BOT_TOKEN, {
      maxAgeSec: INIT_DATA_MAX_AGE_SECONDS,
    });
    return finishLogin(c, user, body.ref ? `ref_${String(body.ref).slice(0, 8)}` : null);
  });

  // Local development only. Disabled unless ENVIRONMENT === "development".
  r.post('/auth/dev-login', async (c) => {
    if (c.env.ENVIRONMENT !== 'development') throw notFound();
    const body = await readJson(c.request);
    const id = intInRange(body.telegramId, 'telegramId', 1, 9_000_000_000_000);
    const username = body.username ? str(body.username, 'username', { max: 32 }) : `dev${id}`;
    return finishLogin(c, { id, username, first_name: username }, null);
  });

  r.get('/auth/me', async (c) => ok({ user: publicUser(c.user) }), { auth: true });
}
