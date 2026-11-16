import { badRequest } from './errors.js';

export function str(value, field, { min = 1, max = 200, pattern } = {}) {
  if (typeof value !== 'string') throw badRequest('invalid_field', `${field} must be a string`, { field });
  const v = value.trim();
  if (v.length < min || v.length > max) {
    throw badRequest('invalid_field', `${field} length must be ${min}-${max}`, { field });
  }
  if (pattern && !pattern.test(v)) throw badRequest('invalid_field', `${field} is invalid`, { field });
  return v;
}

export function oneOf(value, field, allowed) {
  if (!allowed.includes(value)) {
    throw badRequest('invalid_field', `${field} must be one of ${allowed.join(', ')}`, { field });
  }
  return value;
}

export function intInRange(value, field, min, max) {
  const n = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
  if (!Number.isInteger(n) || n < min || n > max) {
    throw badRequest('invalid_field', `${field} must be an integer ${min}-${max}`, { field });
  }
  return n;
}

/** Iranian national ID (کد ملی) checksum. */
export function isValidNationalId(code) {
  if (!/^\d{10}$/.test(code)) return false;
  if (/^(\d)\1{9}$/.test(code)) return false;
  const d = code.split('').map(Number);
  const sum = d.slice(0, 9).reduce((acc, n, i) => acc + n * (10 - i), 0);
  const r = sum % 11;
  return d[9] === (r < 2 ? r : 11 - r);
}

export function isValidIsoDate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export function ageInYears(isoDate, now = new Date()) {
  const b = new Date(`${isoDate}T00:00:00Z`);
  let age = now.getUTCFullYear() - b.getUTCFullYear();
  const m = now.getUTCMonth() - b.getUTCMonth();
  if (m < 0 || (m === 0 && now.getUTCDate() < b.getUTCDate())) age--;
  return age;
}

/** Detect image type from magic bytes (never trust the client Content-Type). */
export function sniffImageType(bytes) {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
  ) return 'image/png';
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) return 'image/webp';
  return null;
}
