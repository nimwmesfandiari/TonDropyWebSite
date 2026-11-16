// Verification of Telegram identity payloads.
// - Mini App:      https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
// - Login Widget:  https://core.telegram.org/widgets/login#checking-authorization

import { hmacSha256, sha256, bytesToHex, timingSafeEqual } from './crypto.js';
import { unauthorized } from './errors.js';

const byKey = ([a], [b]) => (a < b ? -1 : a > b ? 1 : 0);

export async function verifyWebAppInitData(
  initData,
  botToken,
  { maxAgeSec = 86400, now = Math.floor(Date.now() / 1000) } = {},
) {
  if (typeof initData !== 'string' || initData.length > 4096 || !botToken) {
    throw unauthorized('Invalid Telegram data');
  }
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) throw unauthorized('Invalid Telegram data');
  params.delete('hash');

  const dataCheckString = [...params.entries()]
    .sort(byKey)
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
  const secret = await hmacSha256('WebAppData', botToken);
  const calculated = bytesToHex(await hmacSha256(secret, dataCheckString));
  if (!timingSafeEqual(calculated, hash)) throw unauthorized('Invalid Telegram signature');

  const authDate = Number(params.get('auth_date'));
  if (!Number.isFinite(authDate) || now - authDate > maxAgeSec || authDate - now > 300) {
    throw unauthorized('Telegram data expired');
  }
  let user;
  try {
    user = JSON.parse(params.get('user') || 'null');
  } catch {
    user = null;
  }
  if (!user || !Number.isSafeInteger(user.id)) throw unauthorized('Invalid Telegram user');
  return { user, startParam: params.get('start_param') || null };
}

export async function verifyLoginWidget(
  data,
  botToken,
  { maxAgeSec = 86400, now = Math.floor(Date.now() / 1000) } = {},
) {
  if (!data || typeof data !== 'object' || !data.hash || !botToken) {
    throw unauthorized('Invalid Telegram data');
  }
  const entries = Object.entries(data)
    .filter(([k, v]) => k !== 'hash' && v !== undefined && v !== null)
    .map(([k, v]) => [k, String(v)])
    .sort(byKey);
  const dataCheckString = entries.map(([k, v]) => `${k}=${v}`).join('\n');
  const secret = await sha256(botToken);
  const calculated = bytesToHex(await hmacSha256(secret, dataCheckString));
  if (!timingSafeEqual(calculated, String(data.hash))) throw unauthorized('Invalid Telegram signature');

  const authDate = Number(data.auth_date);
  if (!Number.isFinite(authDate) || now - authDate > maxAgeSec) throw unauthorized('Telegram data expired');
  const id = Number(data.id);
  if (!Number.isSafeInteger(id)) throw unauthorized('Invalid Telegram user');
  return { user: { id, first_name: data.first_name, username: data.username } };
}
