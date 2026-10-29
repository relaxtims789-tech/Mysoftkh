/**
 * Phone numbers for log-in: "012 345 678", "+855 12 345 678", "(855) 12-345-678" and "85512345678" all become
 * "85512345678". A leading 0 means a national number and gets the default country code (PHONE_COUNTRY_CODE,
 * 855 = Cambodia).
 */
export const DEFAULT_COUNTRY_CODE = (process.env.PHONE_COUNTRY_CODE || '855').replace(/\D/g, '') || '855';

export function normalizePhone(input: string | null | undefined, countryCode = DEFAULT_COUNTRY_CODE): string | null {
  if (!input) return null;
  const raw = String(input).trim();
  // Only digits, spaces, + ( ) - . are allowed in a phone number.
  if (!/^[+\d\s().-]+$/.test(raw) || (raw.match(/\+/g) ?? []).length > 1) return null;
  let d = raw.replace(/\D/g, '');
  if (raw.replace(/[\s(]/g, '').startsWith('+')) {
    // already international
  } else if (d.startsWith('00')) d = d.slice(2);
  else if (d.startsWith('0')) d = countryCode + d.slice(1);
  return d.length >= 8 && d.length <= 15 ? d : null;
}

/** True when what was typed in the log-in box is a phone number rather than an email or an ID. */
export function looksLikePhone(input: string): boolean {
  return /^[+\d\s().-]{8,22}$/.test(input.trim()) && input.replace(/\D/g, '').length >= 8;
}
