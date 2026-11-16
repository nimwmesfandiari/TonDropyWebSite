// WebCrypto helpers (work in Cloudflare Workers and Node >= 20).

const enc = new TextEncoder();
const dec = new TextDecoder();

export function toBytes(v) {
  if (typeof v === 'string') return enc.encode(v);
  if (v instanceof ArrayBuffer) return new Uint8Array(v);
  return v;
}

export function bytesToHex(bytes) {
  const b = toBytes(bytes);
  let out = '';
  for (let i = 0; i < b.length; i++) out += b[i].toString(16).padStart(2, '0');
  return out;
}

export function b64Encode(bytes) {
  const b = toBytes(bytes);
  let s = '';
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s);
}

export function b64Decode(str) {
  const bin = atob(str);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function b64urlEncode(bytes) {
  return b64Encode(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function b64urlDecode(str) {
  let s = str.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  return b64Decode(s);
}

async function hmacKey(key) {
  return crypto.subtle.importKey('raw', toBytes(key), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
  ]);
}

export async function hmacSha256(key, data) {
  const k = await hmacKey(key);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, toBytes(data)));
}

export async function sha256(data) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', toBytes(data)));
}

/** Constant-time string comparison. */
export function timingSafeEqual(a, b) {
  const x = toBytes(String(a));
  const y = toBytes(String(b));
  let diff = x.length ^ y.length;
  const n = Math.max(x.length, y.length);
  for (let i = 0; i < n; i++) diff |= (x[i] || 0) ^ (y[i] || 0);
  return diff === 0;
}

export function randomHex(byteLength = 16) {
  const b = new Uint8Array(byteLength);
  crypto.getRandomValues(b);
  return bytesToHex(b);
}

export function randomId(prefix) {
  return `${prefix}_${randomHex(12)}`;
}

// 32 characters, no ambiguous glyphs. 256 % 32 === 0, so no modulo bias.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function randomCode(length) {
  const b = new Uint8Array(length);
  crypto.getRandomValues(b);
  let out = '';
  for (let i = 0; i < length; i++) out += ALPHABET[b[i] % 32];
  return out;
}

// ---- JWT (HS256) ----

export async function signJwt(payload, secret, ttlSeconds, now = Math.floor(Date.now() / 1000)) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const body = { ...payload, iat: now, exp: now + ttlSeconds };
  const h = b64urlEncode(JSON.stringify(header));
  const p = b64urlEncode(JSON.stringify(body));
  const sig = b64urlEncode(await hmacSha256(secret, `${h}.${p}`));
  return `${h}.${p}.${sig}`;
}

/** Returns the payload, or null if the token is invalid or expired. */
export async function verifyJwt(token, secret, now = Math.floor(Date.now() / 1000)) {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [h, p, s] = parts;
  try {
    const header = JSON.parse(dec.decode(b64urlDecode(h)));
    if (header.alg !== 'HS256') return null;
    const expected = b64urlEncode(await hmacSha256(secret, `${h}.${p}`));
    if (!timingSafeEqual(expected, s)) return null;
    const payload = JSON.parse(dec.decode(b64urlDecode(p)));
    if (typeof payload.exp !== 'number' || payload.exp <= now) return null;
    return payload;
  } catch {
    return null;
  }
}
