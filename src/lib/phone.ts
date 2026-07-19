/**
 * Normalize an Indonesian phone number to the 62XXXXXXXXX format
 * required by the WA gateway.
 *
 * Accepted input variants:
 *   085123456789   → 6285123456789
 *   +628123456789  → 628123456789
 *   62 812 3456789 → 628123456789
 *   62-812-3456789 → 628123456789
 *   8123456789     → 628123456789
 */
export function normalizePhone(input: string): string {
  // Strip all non-digit characters (spaces, dashes, plus, parentheses, etc.)
  const digits = input.replace(/\D/g, '');
  if (digits.startsWith('62')) return digits;
  if (digits.startsWith('0')) return '62' + digits.slice(1);
  if (digits.startsWith('8')) return '62' + digits;
  return digits;
}
