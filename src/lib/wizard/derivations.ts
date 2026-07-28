// Wizard derived-value helpers. Pure functions extracted from
// CatatPenjualanWizard for isolated testing without wizard-scale mocks.

interface AutoWaPhoneInput {
  channel: string;
  customer: { wa_number?: string | null } | undefined;
  currentWaPhone: string;
}

/**
 * Decide whether to auto-populate the WhatsApp phone field from the selected
 * customer's saved wa_number. Returns the number to set, or null if the field
 * should be left alone (user-typed value preserved, non-whatsapp channel,
 * missing customer, missing wa_number).
 */
export function shouldAutoFillWaPhone(input: AutoWaPhoneInput): string | null {
  if (input.channel !== 'whatsapp') return null;
  if (input.currentWaPhone) return null;
  const raw = input.customer?.wa_number;
  if (!raw || !raw.trim()) return null;
  return raw;
}
