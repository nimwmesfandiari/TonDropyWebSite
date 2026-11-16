import { ok } from '../lib/http.js';
import { formatAmount } from '../lib/money.js';

export function register(r) {
  r.get('/referral', async (c) => {
    const [count, rewards, recent] = await c.env.DB.batch([
      c.env.DB.prepare('SELECT COUNT(*) AS n FROM users WHERE referred_by = ?1').bind(c.user.id),
      c.env.DB.prepare('SELECT asset, SUM(amount) AS total FROM referral_rewards WHERE referrer_id = ?1 GROUP BY asset').bind(c.user.id),
      c.env.DB.prepare('SELECT first_name, created_at FROM users WHERE referred_by = ?1 ORDER BY created_at DESC LIMIT 20').bind(c.user.id),
    ]);
    const bot = c.env.TELEGRAM_BOT_USERNAME;
    return ok({
      code: c.user.referral_code,
      link: bot ? `https://t.me/${bot}?start=ref_${c.user.referral_code}` : null,
      invited: count.results[0].n,
      rewards: rewards.results.map((x) => ({ asset: x.asset, total: formatAmount(x.total, x.asset) })),
      // Names are shortened for privacy.
      recent: recent.results.map((u) => ({
        name: u.first_name ? `${[...u.first_name][0]}***` : '***',
        joinedAt: u.created_at,
      })),
    });
  }, { auth: true });
}
