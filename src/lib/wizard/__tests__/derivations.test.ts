import { describe, it, expect } from 'vitest';
import { shouldAutoFillWaPhone } from '../derivations';

describe('shouldAutoFillWaPhone', () => {
  it('returns customer.wa_number when whatsapp channel + empty phone + customer has wa_number', () => {
    expect(
      shouldAutoFillWaPhone({
        channel: 'whatsapp',
        customer: { wa_number: '628123456789' },
        currentWaPhone: '',
      })
    ).toBe('628123456789');
  });

  it('returns null when channel is not whatsapp', () => {
    expect(
      shouldAutoFillWaPhone({
        channel: 'walkin',
        customer: { wa_number: '628123456789' },
        currentWaPhone: '',
      })
    ).toBeNull();
  });

  it('returns null when user has already typed a phone (preserves manual edit)', () => {
    expect(
      shouldAutoFillWaPhone({
        channel: 'whatsapp',
        customer: { wa_number: '628123456789' },
        currentWaPhone: '628999999999',
      })
    ).toBeNull();
  });

  it('returns null when customer has no wa_number', () => {
    expect(
      shouldAutoFillWaPhone({
        channel: 'whatsapp',
        customer: { wa_number: null },
        currentWaPhone: '',
      })
    ).toBeNull();
    expect(
      shouldAutoFillWaPhone({
        channel: 'whatsapp',
        customer: {},
        currentWaPhone: '',
      })
    ).toBeNull();
  });

  it('returns null when no customer selected yet', () => {
    expect(
      shouldAutoFillWaPhone({
        channel: 'whatsapp',
        customer: undefined,
        currentWaPhone: '',
      })
    ).toBeNull();
  });

  it('returns null when customer.wa_number is whitespace-only', () => {
    expect(
      shouldAutoFillWaPhone({
        channel: 'whatsapp',
        customer: { wa_number: '   ' },
        currentWaPhone: '',
      })
    ).toBeNull();
  });
});
