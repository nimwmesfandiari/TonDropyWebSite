import { verifyJwt, signJwt } from './crypto.js';
import { unauthorized, forbidden } from './errors.js';
import { JWT_TTL_SECONDS } from '../config.js';

export async function issueToken(env, user) {
  return signJwt({ sub: user.id }, env.JWT_SECRET, JWT_TTL_SECONDS);
}

/** Loads the user for a Bearer token. Always re-reads the DB so freezes take effect immediately. */
export async function authenticate(request, env) {
  const header = request.headers.get('authorization') || '';
  const m = /^Bearer (.+)$/.exec(header);
  if (!m || !env.JWT_SECRET) throw unauthorized();
  const payload = await verifyJwt(m[1], env.JWT_SECRET);
  if (!payload) throw unauthorized('Invalid or expired token');
  const user = await env.DB.prepare('SELECT * FROM users WHERE id = ?1').bind(payload.sub).first();
  if (!user || user.role === 'system') throw unauthorized();
  if (user.status !== 'active') throw forbidden('Account is frozen', 'account_frozen');
  return user;
}

export function requireAdmin(user) {
  if (user.role !== 'admin') throw forbidden('Admin only');
}

export function requireKyc(user, level = 1) {
  if (user.kyc_level < level) throw forbidden('Identity verification required', 'kyc_required');
}

export function publicUser(u) {
  return {
    id: u.id,
    telegramId: u.telegram_id,
    username: u.username,
    firstName: u.first_name,
    role: u.role,
    kycLevel: u.kyc_level,
    status: u.status,
    referralCode: u.referral_code,
    createdAt: u.created_at,
  };
}
