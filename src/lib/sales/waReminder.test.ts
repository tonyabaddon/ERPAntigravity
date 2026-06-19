import { describe, test, expect } from 'vitest';
import { buildWhatsAppReminderUrl } from './waReminder';
import type { Order } from './types';
import type { StoreSettings, BankAccount } from '../pengaturan/types';

const baseSettings: StoreSettings = {
  id: 1,
  nama_toko: 'Sinar Elektrik',
  alamat_lengkap: 'Jl. X',
  kota: 'Surabaya',
  telp_wa: '0812',
  updated_at: '',
};

const baseBanks: BankAccount[] = [
  { id: 'u1', bank_name: 'BCA', account_number: '1234567890', account_holder: 'Sinar Elektrik', is_active: true, sort_order: 0 },
];

function baseOrder(overrides: Partial<Order>): Order {
  return {
    id: '11111111-2222-3333-4444-555555555555',
    customer: 'Tony',
    channel: 'WhatsApp',
    funnel_stage: 2,
    funnel_sub_stage: '2c',
    order_type: 'KOMPONEN',
    payment_type: 'FULL',
    total: 380000,
    version: 0,
    status_label: '',
    time_ago: '',
    stuck: false,
    ...overrides,
  } as unknown as Order;
}

describe('buildWhatsAppReminderUrl', () => {
  test('returns url with wa.me when customer_phone present (62-normalized)', () => {
    const order = baseOrder({ customer_phone: '08123456789' });
    const { url, message } = buildWhatsAppReminderUrl(order, baseSettings, baseBanks);
    expect(url).not.toBeNull();
    expect(url!).toMatch(/^https:\/\/wa\.me\/628123456789\?text=/);
    expect(message).toContain('Tony');
    expect(message).toContain('BCA');
  });

  test('preserves 62 prefix without doubling', () => {
    const order = baseOrder({ customer_phone: '+62-812-3456-789' });
    const { url } = buildWhatsAppReminderUrl(order, baseSettings, baseBanks);
    expect(url).toMatch(/wa\.me\/628123456789\?/);
  });

  test('returns null url + message when phone missing', () => {
    const order = baseOrder({ customer_phone: undefined });
    const { url, message } = buildWhatsAppReminderUrl(order, baseSettings, baseBanks);
    expect(url).toBeNull();
    expect(message.length).toBeGreaterThan(20);
  });

  test('DP payment_type at 2c mentions DP amount', () => {
    const order = baseOrder({ payment_type: 'DP', dp_amount: 100000, customer_phone: '08123' });
    const { message } = buildWhatsAppReminderUrl(order, baseSettings, baseBanks);
    expect(message).toContain('100.000');
    expect(message.toLowerCase()).toContain('dp');
  });

  test('3d (sisa pelunasan) uses total - dp_amount', () => {
    const order = baseOrder({ funnel_sub_stage: '3d', payment_type: 'DP', dp_amount: 100000, total: 380000, customer_phone: '08123' });
    const { message } = buildWhatsAppReminderUrl(order, baseSettings, baseBanks);
    expect(message).toContain('280.000');
    expect(message.toLowerCase()).toContain('pelunasan');
  });

  test('3h (after biaya final) likewise uses sisa', () => {
    const order = baseOrder({ funnel_sub_stage: '3h', payment_type: 'DP', dp_amount: 150000, total: 500000, customer_phone: '08123' });
    const { message } = buildWhatsAppReminderUrl(order, baseSettings, baseBanks);
    expect(message).toContain('350.000');
    expect(message.toLowerCase()).toContain('final');
  });

  test('DP order without dp_amount produces a "belum di-set" warning, not full total', () => {
    const order = baseOrder({ payment_type: 'DP', dp_amount: undefined, total: 380000, customer_phone: '08123' });
    const { message } = buildWhatsAppReminderUrl(order, baseSettings, baseBanks);
    expect(message.toLowerCase()).toContain('belum di-set');
    expect(message).not.toContain('380.000');
  });

  test('falls back to generic message when no active bank rows', () => {
    const order = baseOrder({ customer_phone: '08123' });
    const inactive: BankAccount[] = [
      { ...baseBanks[0], is_active: false },
    ];
    const { message } = buildWhatsAppReminderUrl(order, baseSettings, inactive);
    expect(message).toContain('rekening lihat lampiran');
  });
});
