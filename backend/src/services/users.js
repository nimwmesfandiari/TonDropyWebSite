import { randomCode } from '../lib/crypto.js';
import { audit } from '../lib/ledger.js';

const ASSET_LIST = ['TON', 'USDT', 'IRT'];

function adminIds(env) {
  return new Set(
    String(env.ADMIN_TELEGRAM_IDS || '')
      .split(',')
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isSafeInteger(n) && n > 0),
  );
}

/** Extracts "ref_<CODE>" from a Telegram start parameter. */
export function referralFromStartParam(param) {
  const m = /^ref_([A-Z0-9]{8})$/.exec(String(param || ''));
  return m ? m[1] : null;
}

/**
 * Creates the user on first login, otherwise refreshes profile fields.
 * ADMIN_TELEGRAM_IDS is the single source of truth for the admin role.
 */
export async function upsertTelegramUser(env, tgUser, refCode, now) {
  const wantAdmin = adminIds(env).has(tgUser.id);
  const existing = await env.DB.prepare('SELECT * FROM users WHERE telegram_id = ?1').bind(tgUser.id).first();

  if (existing) {
    const role = existing.role === 'system' ? 'system' : wantAdmin ? 'admin' : 'user';
    await env.DB.prepare(
      'UPDATE users SET username = ?1, first_name = ?2, role = ?3, last_login_at = ?4 WHERE id = ?5',
    )
      .bind(tgUser.username || null, tgUser.first_name || null, role, now, existing.id)
      .run();
    return { ...existing, role, username: tgUser.username || null, first_name: tgUser.first_name || null };
  }

  let referredBy = null;
  if (refCode) {
    const ref = await env.DB.prepare("SELECT id FROM users WHERE referral_code = ?1 AND role != 'system'")
      .bind(refCode)
      .first();
    if (ref) referredBy = ref.id;
  }

  for (let attempt = 0; attempt < 5; attempt++) {
    const referralCode = randomCode(8);
    const depositTag = `TD${randomCode(8)}`;
    try {
      const res = await env.DB.prepare(
        `INSERT INTO users (telegram_id, username, first_name, role, referral_code, referred_by, deposit_tag, created_at, last_login_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)`,
      )
        .bind(tgUser.id, tgUser.username || null, tgUser.first_name || null, wantAdmin ? 'admin' : 'user', referralCode, referredBy, depositTag, now)
        .run();
      const id = res.meta.last_row_id;
      await env.DB.batch([
        ...ASSET_LIST.map((a) => env.DB.prepare('INSERT INTO balances (user_id, asset) VALUES (?1, ?2)').bind(id, a)),
        audit(env.DB, { actorId: id, action: 'user.signup', target: String(id), meta: { referredBy }, now }),
      ]);
      return env.DB.prepare('SELECT * FROM users WHERE id = ?1').bind(id).first();
    } catch (err) {
      const msg = String((err && err.message) || err);
      // A concurrent first login for the same Telegram user: read the winner.
      if (/UNIQUE constraint failed: users.telegram_id/.test(msg)) {
        return env.DB.prepare('SELECT * FROM users WHERE telegram_id = ?1').bind(tgUser.id).first();
      }
      if (!/UNIQUE constraint failed/.test(msg)) throw err; // code collision -> retry
    }
  }
  throw new Error('Could not allocate unique user codes');
}
