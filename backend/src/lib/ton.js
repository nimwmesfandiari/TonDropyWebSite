// TON address validation (format + CRC16 for user-friendly addresses).

import { b64Decode } from './crypto.js';

function crc16(bytes) {
  let crc = 0;
  for (const byte of bytes) {
    crc ^= byte << 8;
    for (let i = 0; i < 8; i++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc;
}

export function isValidTonAddress(address) {
  if (typeof address !== 'string') return false;
  const a = address.trim();
  // Raw form: workchain:hex64
  if (/^-?\d{1,3}:[0-9a-fA-F]{64}$/.test(a)) return true;
  // User-friendly form: 48 chars base64 / base64url, 36 bytes.
  if (!/^[A-Za-z0-9_\-+/]{48}$/.test(a)) return false;
  try {
    const bytes = b64Decode(a.replace(/-/g, '+').replace(/_/g, '/'));
    if (bytes.length !== 36) return false;
    const tag = bytes[0] & ~0x80; // strip the "testnet only" bit
    if (tag !== 0x11 && tag !== 0x51) return false; // bounceable / non-bounceable
    const crc = (bytes[34] << 8) | bytes[35];
    return crc16(bytes.slice(0, 34)) === crc;
  } catch {
    return false;
  }
}

export { crc16 };
