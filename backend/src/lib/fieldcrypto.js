// AES-256-GCM field encryption for KYC personal data stored in D1.
// Format: "v1.<iv b64url>.<ciphertext b64url>". Key: base64 of 32 random bytes.

import { b64Decode, b64urlEncode, b64urlDecode, hmacSha256, bytesToHex } from './crypto.js';

const enc = new TextEncoder();
const dec = new TextDecoder();

async function importKey(keyB64) {
  const raw = b64Decode(keyB64);
  if (raw.length !== 32) throw new Error('KYC_ENCRYPTION_KEY must be 32 bytes (base64)');
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export async function encryptField(plain, keyB64) {
  const key = await importKey(keyB64);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(plain)),
  );
  return `v1.${b64urlEncode(iv)}.${b64urlEncode(ct)}`;
}

export async function decryptField(blob, keyB64) {
  const [v, iv, ct] = String(blob).split('.');
  if (v !== 'v1' || !iv || !ct) throw new Error('Bad ciphertext');
  const key = await importKey(keyB64);
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: b64urlDecode(iv) },
    key,
    b64urlDecode(ct),
  );
  return dec.decode(plain);
}

/** Deterministic blind index so duplicates can be found without decrypting. */
export async function blindIndex(value, hashKey) {
  return bytesToHex(await hmacSha256(hashKey, `nid:${value}`));
}
