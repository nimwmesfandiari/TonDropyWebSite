// Iranian IBAN (Sheba) validation: IR + 24 digits, ISO 13616 mod-97.

export function normalizeIban(input) {
  return String(input || '')
    .replace(/[\s-]/g, '')
    .toUpperCase();
}

export function isValidIranIban(input) {
  const iban = normalizeIban(input);
  if (!/^IR\d{24}$/.test(iban)) return false;
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  let remainder = 0;
  for (const ch of rearranged) {
    const code = ch.charCodeAt(0);
    const chunk = code >= 65 && code <= 90 ? String(code - 55) : ch;
    for (const digit of chunk) remainder = (remainder * 10 + Number(digit)) % 97;
  }
  return remainder === 1;
}
