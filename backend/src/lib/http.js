import { HttpError, badRequest } from './errors.js';

const SECURITY_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Resource-Policy': 'same-origin',
};

export function ok(data, status = 200, headers = {}) {
  return new Response(JSON.stringify({ ok: true, data }), {
    status,
    headers: { ...SECURITY_HEADERS, ...headers },
  });
}

export function fail(status, code, message, extra) {
  return new Response(JSON.stringify({ ok: false, error: { code, message, ...(extra || {}) } }), {
    status,
    headers: SECURITY_HEADERS,
  });
}

export function errorResponse(err) {
  if (err instanceof HttpError) return fail(err.status, err.code, err.message, err.extra);
  console.error('unhandled', err && err.stack ? err.stack : err);
  return fail(500, 'internal_error', 'Internal error');
}

const MAX_JSON_BYTES = 64 * 1024;

export async function readJson(request) {
  const len = Number(request.headers.get('content-length') || 0);
  if (len > MAX_JSON_BYTES) throw new HttpError(413, 'payload_too_large', 'Payload too large');
  const text = await request.text();
  if (text.length > MAX_JSON_BYTES) throw new HttpError(413, 'payload_too_large', 'Payload too large');
  if (!text) return {};
  try {
    const v = JSON.parse(text);
    if (v === null || typeof v !== 'object' || Array.isArray(v)) throw new Error('not object');
    return v;
  } catch {
    throw badRequest('invalid_json', 'Body must be a JSON object');
  }
}

export function clientIp(request) {
  return request.headers.get('cf-connecting-ip') || 'unknown';
}

export const nowSec = () => Math.floor(Date.now() / 1000);

export function pageParams(url, { defaultLimit = 20, maxLimit = 100 } = {}) {
  const limit = Math.min(maxLimit, Math.max(1, Number.parseInt(url.searchParams.get('limit'), 10) || defaultLimit));
  const before = Number.parseInt(url.searchParams.get('before'), 10);
  return { limit, before: Number.isFinite(before) ? before : null };
}
