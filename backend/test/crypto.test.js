import test from 'node:test';
import assert from 'node:assert/strict';
import { signJwt, verifyJwt, timingSafeEqual, hmacSha256, bytesToHex, b64Encode } from '../src/lib/crypto.js';
import { encryptField, decryptField, blindIndex } from '../src/lib/fieldcrypto.js';
import { verifyWebAppInitData, verifyLoginWidget } from '../src/lib/telegram-auth.js';

const SECRET = 'unit-test-secret-unit-test-secret';

test('JWT round trip, tamper and expiry', async () => {
  const now = 1_700_000_000;
  const token = await signJwt({ sub: 7 }, SECRET, 60, now);
  assert.equal((await verifyJwt(token, SECRET, now + 10)).sub, 7);
  assert.equal(await verifyJwt(token, SECRET, now + 61), null);
  assert.equal(await verifyJwt(token, 'other-secret', now + 10), null);
  const [h, p, s] = token.split('.');
  const forged = [h, Buffer.from(JSON.stringify({ sub: 1, exp: now + 999 })).toString('base64url'), s].join('.');
  assert.equal(await verifyJwt(forged, SECRET, now + 10), null);
  assert.equal(await verifyJwt('garbage', SECRET), null);
});

test('JWT with alg none is rejected', async () => {
  const h = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const p = Buffer.from(JSON.stringify({ sub: 1, exp: 9_999_999_999 })).toString('base64url');
  assert.equal(await verifyJwt(`${h}.${p}.`, SECRET), null);
});

test('timingSafeEqual', () => {
  assert.equal(timingSafeEqual('abc', 'abc'), true);
  assert.equal(timingSafeEqual('abc', 'abd'), false);
  assert.equal(timingSafeEqual('abc', 'abcd'), false);
});

test('field encryption round trip and blind index', async () => {
  const key = b64Encode(crypto.getRandomValues(new Uint8Array(32)));
  const blob = await encryptField('0012345678', key);
  assert.match(blob, /^v1\./);
  assert.equal(await decryptField(blob, key), '0012345678');
  assert.notEqual(blob, await encryptField('0012345678', key)); // random IV
  await assert.rejects(() => decryptField(blob, b64Encode(crypto.getRandomValues(new Uint8Array(32)))));
  assert.equal(await blindIndex('1', 'k'), await blindIndex('1', 'k'));
  assert.notEqual(await blindIndex('1', 'k'), await blindIndex('2', 'k'));
});

async function signInitData(fields, botToken) {
  const dcs = Object.entries(fields).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => `${k}=${v}`).join('\n');
  const secret = await hmacSha256('WebAppData', botToken);
  const hash = bytesToHex(await hmacSha256(secret, dcs));
  return new URLSearchParams({ ...fields, hash }).toString();
}

test('Telegram initData verification', async () => {
  const bot = '123456:TEST-TOKEN';
  const now = 1_700_000_000;
  const fields = { auth_date: String(now - 30), query_id: 'AAH', user: JSON.stringify({ id: 42, first_name: 'Ali', username: 'ali' }) };
  const good = await signInitData(fields, bot);
  const res = await verifyWebAppInitData(good, bot, { now });
  assert.equal(res.user.id, 42);

  await assert.rejects(() => verifyWebAppInitData(good, 'wrong:token', { now }));
  await assert.rejects(() => verifyWebAppInitData(good.replace('Ali', 'Eve'), bot, { now }));
  await assert.rejects(() => verifyWebAppInitData(good, bot, { now: now + 90_000 }), /expired/);
});

test('Telegram login widget verification', async () => {
  const bot = '123456:TEST-TOKEN';
  const now = 1_700_000_000;
  const data = { id: 99, first_name: 'Sara', username: 'sara', auth_date: now - 10 };
  const dcs = Object.entries(data).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => `${k}=${v}`).join('\n');
  const secret = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(bot)));
  const hash = bytesToHex(await hmacSha256(secret, dcs));
  const res = await verifyLoginWidget({ ...data, hash }, bot, { now });
  assert.equal(res.user.id, 99);
  await assert.rejects(() => verifyLoginWidget({ ...data, id: 100, hash }, bot, { now }));
});
