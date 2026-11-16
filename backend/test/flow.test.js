// End-to-end flow against the real Worker code and the real SQL migrations.
import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';
import { reconcile } from '../src/jobs/housekeeping.js';
import { createD1, createKV, createR2 } from './helpers/d1.js';
import { crc16 } from '../src/lib/ton.js';
import { b64urlEncode, b64Encode } from '../src/lib/crypto.js';

function friendlyAddress(seed) {
  const body = new Uint8Array(34);
  body[0] = 0x11;
  body.fill(seed, 2);
  const crc = crc16(body);
  const full = new Uint8Array(36);
  full.set(body);
  full[34] = crc >> 8;
  full[35] = crc & 0xff;
  return b64urlEncode(full);
}

function setup() {
  const pending = [];
  const env = {
    DB: createD1(),
    KV: createKV(),
    KYC_BUCKET: createR2(),
    ENVIRONMENT: 'development',
    JWT_SECRET: 'x'.repeat(40),
    ADMIN_TELEGRAM_IDS: '9001',
    FEE_BPS: '50',
    SPREAD_BPS: '30',
    REFERRAL_BPS: '2000',
    QUOTE_TTL_SECONDS: '30',
    KYC_ENCRYPTION_KEY: b64Encode(crypto.getRandomValues(new Uint8Array(32))),
    KYC_HASH_KEY: 'hash-key-for-tests',
  };
  const ectx = { waitUntil: (p) => pending.push(p) };
  const now = Math.floor(Date.now() / 1000);
  env.KV.put('rates:ton', JSON.stringify({ usd: 3.2, change24h: 1.5, updatedAt: now }));
  env.KV.put('rates:usdt_irt', JSON.stringify({ value: '60000', updatedAt: now }));

  async function call(method, path, { token, body, form } = {}) {
    const headers = {};
    if (token) headers.authorization = `Bearer ${token}`;
    let payload;
    if (form) payload = form;
    else if (body) {
      headers['content-type'] = 'application/json';
      payload = JSON.stringify(body);
    }
    const res = await worker.fetch(new Request(`https://t.test/api/v1${path}`, { method, headers, body: payload }), env, ectx);
    return { status: res.status, json: await res.json() };
  }

  async function login(telegramId, username) {
    const r = await call('POST', '/auth/dev-login', { body: { telegramId, username } });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    return { token: r.json.data.token, user: r.json.data.user };
  }

  async function verify(user, admin, nationalId) {
    const jpeg = new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0])], { type: 'image/jpeg' });
    const form = new FormData();
    form.set('fullName', 'Test User');
    form.set('nationalId', nationalId);
    form.set('birthDate', '1990-01-01');
    form.set('idCard', jpeg, 'id.jpg');
    form.set('selfie', jpeg, 'me.jpg');
    const s = await call('POST', '/verification', { token: user.token, form });
    assert.equal(s.status, 201, JSON.stringify(s.json));
    const a = await call('POST', `/admin/kyc/${s.json.data.id}/approve`, { token: admin.token, body: { level: 1 } });
    assert.equal(a.status, 200, JSON.stringify(a.json));
  }

  async function fund(user, admin, amount) {
    const d = await call('POST', '/wallet/deposits/fiat', { token: user.token, body: { amount: String(amount), reference: 'REF12345' } });
    assert.equal(d.status, 201, JSON.stringify(d.json));
    const a = await call('POST', `/admin/deposits/${d.json.data.id}/approve`, { token: admin.token });
    assert.equal(a.status, 200, JSON.stringify(a.json));
    return d.json.data.id;
  }

  async function balances(user) {
    const r = await call('GET', '/wallet', { token: user.token });
    return Object.fromEntries(r.json.data.balances.map((b) => [b.asset, b]));
  }

  return { env, call, login, verify, fund, balances, pending };
}

// Valid Iranian national IDs.
const NID_A = '0499370899';
const NID_B = '0084575948';

test('full trading lifecycle keeps the books balanced', async () => {
  const t = setup();
  const admin = await t.login(9001, 'boss');
  assert.equal(admin.user.role, 'admin');
  const alice = await t.login(1001, 'alice');
  assert.equal(alice.user.role, 'user');

  // Trading is blocked until KYC.
  let q = await t.call('POST', '/orders/quote', { token: alice.token, body: { pair: 'TON/IRT', side: 'buy', amount: '1' } });
  assert.equal(q.status, 403);
  assert.equal(q.json.error.code, 'kyc_required');

  await t.verify(alice, admin, NID_A);
  const depositId = await t.fund(alice, admin, 10_000_000);

  // Approving the same deposit twice must not credit twice.
  const again = await t.call('POST', `/admin/deposits/${depositId}/approve`, { token: admin.token });
  assert.equal(again.status, 409);
  assert.equal((await t.balances(alice)).IRT.available, '10000000');

  // Buy 5 TON.
  q = await t.call('POST', '/orders/quote', { token: alice.token, body: { pair: 'TON/IRT', side: 'buy', amount: '5' } });
  assert.equal(q.status, 200, JSON.stringify(q.json));
  const quote = q.json.data.quote;
  const o = await t.call('POST', '/orders', { token: alice.token, body: { quoteId: quote.id } });
  assert.equal(o.status, 201, JSON.stringify(o.json));
  let b = await t.balances(alice);
  assert.equal(b.TON.available, '5');
  assert.equal(b.IRT.available, String(10_000_000 - Number(quote.total)));

  // A quote can only be used once.
  const replay = await t.call('POST', '/orders', { token: alice.token, body: { quoteId: quote.id } });
  assert.equal(replay.status, 409);
  assert.equal(replay.json.error.code, 'quote_used');
  assert.equal((await t.balances(alice)).TON.available, '5');

  // Sell 2 TON.
  q = await t.call('POST', '/orders/quote', { token: alice.token, body: { pair: 'TON/IRT', side: 'sell', amount: '2' } });
  const s = await t.call('POST', '/orders', { token: alice.token, body: { quoteId: q.json.data.quote.id } });
  assert.equal(s.status, 201);
  assert.equal((await t.balances(alice)).TON.available, '3');

  // Overdraft is rejected atomically (nothing changes).
  const before = await t.balances(alice);
  q = await t.call('POST', '/orders/quote', { token: alice.token, body: { pair: 'TON/IRT', side: 'buy', amount: '200' } });
  const od = await t.call('POST', '/orders', { token: alice.token, body: { quoteId: q.json.data.quote.id } });
  assert.equal(od.status, 409);
  assert.equal(od.json.error.code, 'insufficient_funds');
  assert.deepEqual(await t.balances(alice), before);

  // Withdrawal: lock -> cancel -> restore.
  const addr = friendlyAddress(5);
  let w = await t.call('POST', '/wallet/withdrawals', { token: alice.token, body: { asset: 'TON', amount: '1', destination: addr } });
  assert.equal(w.status, 201, JSON.stringify(w.json));
  b = await t.balances(alice);
  assert.equal(b.TON.available, '1.95');
  assert.equal(b.TON.locked, '1.05');
  let c1 = await t.call('POST', `/wallet/withdrawals/${w.json.data.id}/cancel`, { token: alice.token });
  assert.equal(c1.status, 200);
  c1 = await t.call('POST', `/wallet/withdrawals/${w.json.data.id}/cancel`, { token: alice.token });
  assert.equal(c1.status, 409);
  b = await t.balances(alice);
  assert.equal(b.TON.available, '3');
  assert.equal(b.TON.locked, '0');

  // Invalid destination is refused.
  const bad = await t.call('POST', '/wallet/withdrawals', { token: alice.token, body: { asset: 'TON', amount: '1', destination: 'not-an-address' } });
  assert.equal(bad.status, 400);

  // Withdrawal: lock -> approve -> complete.
  w = await t.call('POST', '/wallet/withdrawals', { token: alice.token, body: { asset: 'TON', amount: '1', destination: addr } });
  const ap = await t.call('POST', `/admin/withdrawals/${w.json.data.id}/approve`, { token: admin.token });
  assert.equal(ap.status, 200);
  const done = await t.call('POST', `/admin/withdrawals/${w.json.data.id}/complete`, { token: admin.token, body: { txHash: 'abcdef0123456789' } });
  assert.equal(done.status, 200, JSON.stringify(done.json));
  const done2 = await t.call('POST', `/admin/withdrawals/${w.json.data.id}/complete`, { token: admin.token, body: { txHash: 'abcdef0123456789' } });
  assert.equal(done2.status, 409);
  b = await t.balances(alice);
  assert.equal(b.TON.available, '1.95');
  assert.equal(b.TON.locked, '0');

  // Rejecting a completed withdrawal must not refund it.
  const rej = await t.call('POST', `/admin/withdrawals/${w.json.data.id}/reject`, { token: admin.token, body: { reason: 'too late' } });
  assert.equal(rej.status, 409);

  // Accounting invariants hold across everything above.
  assert.deepEqual(await reconcile(t.env), []);
});

test('referral rewards are paid from the fee and recorded', async () => {
  const t = setup();
  const admin = await t.login(9001, 'boss');
  const alice = await t.login(2001, 'alice');
  await t.env.KV.put('ref:2002', alice.user.referralCode);
  const bob = await t.login(2002, 'bob');
  await t.verify(bob, admin, NID_B);
  await t.fund(bob, admin, 5_000_000);

  const q = await t.call('POST', '/orders/quote', { token: bob.token, body: { pair: 'USDT/IRT', side: 'buy', amount: '10' } });
  assert.equal(q.status, 200, JSON.stringify(q.json));
  const fee = Number(q.json.data.quote.fee);
  const o = await t.call('POST', '/orders', { token: bob.token, body: { quoteId: q.json.data.quote.id } });
  assert.equal(o.status, 201);

  const ref = await t.call('GET', '/referral', { token: alice.token });
  assert.equal(ref.json.data.invited, 1);
  assert.equal(ref.json.data.rewards[0].asset, 'IRT');
  assert.equal(Number(ref.json.data.rewards[0].total), Math.floor(fee * 0.2));
  assert.deepEqual(await reconcile(t.env), []);
});

test('authorization and input hardening', async () => {
  const t = setup();
  const alice = await t.login(3001, 'alice');
  assert.equal((await t.call('GET', '/wallet')).status, 401);
  assert.equal((await t.call('GET', '/admin/stats', { token: alice.token })).status, 403);
  assert.equal((await t.call('POST', '/auth/telegram', { body: { initData: 'hash=bad' } })).status, 401);
  assert.equal((await t.call('GET', '/nope')).status, 404);
  assert.equal((await t.call('DELETE', '/wallet', { token: alice.token })).status, 405);

  // Frozen users lose access immediately, even with a valid token.
  const admin = await t.login(9001, 'boss');
  const fr = await t.call('POST', `/admin/users/${alice.user.id}/status`, { token: admin.token, body: { status: 'frozen' } });
  assert.equal(fr.status, 200);
  const blocked = await t.call('GET', '/wallet', { token: alice.token });
  assert.equal(blocked.status, 403);
  assert.equal(blocked.json.error.code, 'account_frozen');

  // dev-login is unavailable outside development.
  t.env.ENVIRONMENT = 'production';
  assert.equal((await t.call('POST', '/auth/dev-login', { body: { telegramId: 5 } })).status, 404);
});

test('KYC rejects non-image uploads and duplicate national IDs', async () => {
  const t = setup();
  const admin = await t.login(9001, 'boss');
  const u1 = await t.login(4001, 'u1');
  const u2 = await t.login(4002, 'u2');

  const fake = new Blob([new TextEncoder().encode('<svg onload=alert(1)>')], { type: 'image/jpeg' });
  const form = new FormData();
  form.set('fullName', 'Test User'); form.set('nationalId', NID_A); form.set('birthDate', '1990-01-01');
  form.set('idCard', fake, 'a.jpg'); form.set('selfie', fake, 'b.jpg');
  const r = await t.call('POST', '/verification', { token: u1.token, form });
  assert.equal(r.status, 400);
  assert.equal(r.json.error.code, 'invalid_file_type');

  await t.verify(u1, admin, NID_A);
  const jpeg = new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], { type: 'image/jpeg' });
  const f2 = new FormData();
  f2.set('fullName', 'Other Person'); f2.set('nationalId', NID_A); f2.set('birthDate', '1991-02-02');
  f2.set('idCard', jpeg, 'a.jpg'); f2.set('selfie', jpeg, 'b.jpg');
  const dup = await t.call('POST', '/verification', { token: u2.token, form: f2 });
  assert.equal(dup.status, 409);
  assert.equal(dup.json.error.code, 'national_id_in_use');
});
