import { ok, readJson } from '../lib/http.js';
import { unauthorized } from '../lib/errors.js';
import { timingSafeEqual } from '../lib/crypto.js';
import { sendMessage } from '../services/telegram.js';
import { referralFromStartParam } from '../services/users.js';

export function register(r) {
  // Telegram sends the secret configured in setWebhook(secret_token) in this header.
  r.post('/telegram/webhook', async (c) => {
    const secret = c.env.TELEGRAM_WEBHOOK_SECRET;
    const got = c.request.headers.get('x-telegram-bot-api-secret-token') || '';
    if (!secret || !timingSafeEqual(got, secret)) throw unauthorized('Bad webhook secret');

    const update = await readJson(c.request);
    const msg = update.message;
    if (msg && typeof msg.text === 'string' && msg.chat && msg.from) {
      const m = /^\/start(?:@\w+)?(?:\s+(\S+))?$/.exec(msg.text.trim());
      if (m) {
        const code = referralFromStartParam(m[1]);
        // Remember the inviter until this person logs in for the first time.
        if (code) await c.env.KV.put(`ref:${msg.from.id}`, code, { expirationTtl: 7 * 24 * 3600 });
        c.ectx.waitUntil(
          sendMessage(
            c.env,
            msg.chat.id,
            'به صرافی تن‌دراپی خوش آمدید 👋\nخرید و فروش TON و USDT با تومان، سریع و امن.',
            // APP_URL is optional: on the free workers.dev domain the Worker's own origin is used.
            { reply_markup: { inline_keyboard: [[{ text: 'ورود به صرافی', web_app: { url: c.env.APP_URL || c.url.origin } }]] } },
          ),
        );
      }
    }
    return ok({ received: true });
  });
}
