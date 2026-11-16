import test from 'node:test';
import assert from 'node:assert/strict';
import { isValidTonAddress, crc16 } from '../src/lib/ton.js';
import { isValidIranIban } from '../src/lib/iban.js';
import { isValidNationalId, isValidIsoDate, ageInYears, sniffImageType } from '../src/lib/validate.js';
import { b64urlEncode } from '../src/lib/crypto.js';

function makeFriendly(tag, hashByte) {
  const body = new Uint8Array(34);
  body[0] = tag;
  body[1] = 0;
  body.fill(hashByte, 2);
  const crc = crc16(body);
  const full = new Uint8Array(36);
  full.set(body);
  full[34] = crc >> 8;
  full[35] = crc & 0xff;
  return b64urlEncode(full);
}

test('TON address validation', () => {
  const ok = makeFriendly(0x11, 7);
  assert.equal(ok.length, 48);
  assert.equal(isValidTonAddress(ok), true);
  assert.equal(isValidTonAddress(makeFriendly(0x51, 9)), true);
  const broken = (ok[0] === 'A' ? 'B' : 'A') + ok.slice(1);
  assert.equal(isValidTonAddress(broken), false);
  assert.equal(isValidTonAddress('0:' + 'a'.repeat(64)), true);
  assert.equal(isValidTonAddress('0:' + 'g'.repeat(64)), false);
  assert.equal(isValidTonAddress('hello'), false);
  assert.equal(isValidTonAddress(null), false);
});

test('Iranian IBAN validation', () => {
  // Build a valid IBAN: IR + 2 check digits + 22 digits
  const bban = '0170000000123456789012';
  const rearranged = bban + '1827' + '00'; // I=18, R=27
  let rem = 0;
  for (const d of rearranged) rem = (rem * 10 + Number(d)) % 97;
  const check = String(98 - rem).padStart(2, '0');
  const iban = `IR${check}${bban}`;
  assert.equal(isValidIranIban(iban), true);
  assert.equal(isValidIranIban(iban.toLowerCase().replace(/(.{4})/g, '$1 ')), true);
  assert.equal(isValidIranIban(iban.slice(0, -1) + (iban.endsWith('0') ? '1' : '0')), false);
  assert.equal(isValidIranIban('GB82WEST12345698765432'), false);
});

test('Iranian national ID checksum', () => {
  assert.equal(isValidNationalId('0499370899'), true);
  assert.equal(isValidNationalId('0499370898'), false);
  assert.equal(isValidNationalId('1111111111'), false);
  assert.equal(isValidNationalId('123'), false);
});

test('dates and age', () => {
  assert.equal(isValidIsoDate('2000-02-29'), true);
  assert.equal(isValidIsoDate('2001-02-29'), false);
  assert.equal(isValidIsoDate('2000-13-01'), false);
  assert.equal(ageInYears('2000-06-15', new Date('2026-06-14T00:00:00Z')), 25);
  assert.equal(ageInYears('2000-06-15', new Date('2026-06-15T00:00:00Z')), 26);
});

test('image sniffing', () => {
  assert.equal(sniffImageType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0])), 'image/jpeg');
  assert.equal(sniffImageType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), 'image/png');
  assert.equal(sniffImageType(new Uint8Array([0x3c, 0x73, 0x76, 0x67])), null);
});
