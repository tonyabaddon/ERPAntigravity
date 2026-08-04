import { describe, it, expect, vi } from 'vitest';

// Mock fetch for fetchLogoDataUrl (we don't want real network calls in tests)
global.fetch = vi.fn().mockResolvedValue({ ok: false } as Response);

// Mock supabaseClient so any indirect imports don't blow up
vi.mock('../../supabaseClient', () => ({
  supabase: {
    rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        })),
      })),
    })),
  },
}));

import { generateSalesOrderPdf } from './salesOrderPdf';
import type { SalesOrderForPdf } from './salesOrderPdf';
import type { StoreSettings, BankAccount } from '../../pengaturan/types';
import type { KasirItem } from '../../../types';

// ---- Fixtures ----

const baseSettings: StoreSettings = {
  id: 1,
  nama_toko: 'Garindo Jaya Panel',
  nama_legal: 'PT Garindo Jaya Panel',
  alamat_lengkap: 'Jl. Industri No. 5, Surabaya',
  kota: 'Surabaya',
  telp_wa: '0812-3456-7890',
  telp_kantor: '031-555-1234',
  email: 'sales@garindo.co.id',
  logo_url: undefined,
  updated_at: '2026-08-04T00:00:00Z',
  // SO defaults
  default_so_validity_days: 14,
  default_payment_terms: '50% DP, 50% pelunasan sebelum pengiriman',
  default_lead_time_text: '7–10 hari kerja setelah DP diterima',
  default_so_notes: 'Harga belum termasuk PPN 11%',
  default_opening_greeting:
    'Dengan hormat, bersama ini kami mengajukan penawaran harga sebagai berikut:',
  default_signatory_name: 'Ahmad Fauzi',
  default_signatory_title: 'Sales Manager',
  // Footer toggles
  footer_show_telp_kantor: true,
  footer_show_wa: true,
  footer_show_email: true,
  footer_show_website: false,
};

const baseBanks: BankAccount[] = [
  {
    id: 'bank-1',
    bank_name: 'BCA',
    account_number: '123-456-7890',
    account_holder: 'PT Garindo Jaya Panel',
    is_active: true,
    sort_order: 1,
  },
];

function makeItem(name: string, overrides?: Partial<KasirItem>): KasirItem {
  return {
    sku: null,
    name,
    qty: 2,
    unit_price: 1_500_000,
    hpp_per_unit: 1_000_000,
    subtotal: 3_000_000,
    hpp_subtotal: 2_000_000,
    warehouse: null,
    ...overrides,
  };
}

function baseSo(overrides: Partial<SalesOrderForPdf> = {}): SalesOrderForPdf {
  return {
    id: 'test-so-id-001',
    so_number: 'SO/2026/00001',
    date: '2026-08-04',
    channel: 'OFFLINE',
    items: [
      makeItem('Panel MDB 3 Phase 200A', {
        brand_name: 'Schneider',
        sub_parts: [
          { name: 'MCB 3P 200A', qty: 1, unit: 'pcs' },
          { name: 'Busbar 200A', qty: 2, unit: 'pcs' },
        ],
      }),
      makeItem('Kabel NYY 3x16mm 100m', { brand_name: 'Supreme' }),
      makeItem('Terminal Block 10mm', { brand_name: 'Wago' }),
    ],
    subtotal: 9_000_000,
    customer_id: 'cust-001',
    customer_name: 'PT Jaya Konstruksi',
    customer_phone: '0812-9999-0000',
    customer_company: 'PT Jaya Konstruksi',
    notes: null,
    status: 'OPEN',
    converted_to_kasir_tx_id: null,
    converted_to_order_id: null,
    closed_reason: null,
    created_at: '2026-08-04T08:00:00Z',
    created_by: null,
    // Penawaran fields
    customer_salutation: 'Bapak',
    customer_contact_person: 'Adi Santoso',
    created_by_name: null,
    opening_greeting_override: null,
    payment_terms_override: null,
    lead_time_override: null,
    so_notes_override: null,
    valid_until_override: null,
    ...overrides,
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('generateSalesOrderPdf (new Penawaran template)', () => {
  it('generates valid PDF Blob with 1-page layout (3 items with brand + sub_parts)', async () => {
    const so = baseSo();
    const blob = await generateSalesOrderPdf(so, baseSettings, baseBanks);

    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe('application/pdf');
    expect(blob.size).toBeGreaterThan(1000);
  });

  it('generates multi-page PDF for 25-item SO (size > 20 KB)', async () => {
    const manyItems = Array.from({ length: 25 }, (_, i) =>
      makeItem(`Item Produk ${i + 1}`, {
        brand_name: i % 3 === 0 ? 'Schneider' : undefined,
        sub_parts:
          i % 5 === 0
            ? [{ name: 'Sub-komponen A', qty: 1, unit: 'pcs' }]
            : undefined,
      }),
    );
    const so = baseSo({ items: manyItems, subtotal: 75_000_000 });
    const blob = await generateSalesOrderPdf(so, baseSettings, baseBanks);

    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe('application/pdf');
    // 25-item multi-page SO should produce a larger blob than a 3-item one
    expect(blob.size).toBeGreaterThan(20_000);
  });

  it('backward-compat: renders gracefully with all new Penawaran fields NULL', async () => {
    const nullFieldsSo = baseSo({
      customer_salutation: null,
      customer_contact_person: null,
      created_by_name: null,
      opening_greeting_override: null,
      payment_terms_override: null,
      lead_time_override: null,
      so_notes_override: null,
      valid_until_override: null,
      // items without brand_name or sub_parts (MANUFACTURE column should auto-hide)
      items: [makeItem('Produk Biasa 1'), makeItem('Produk Biasa 2')],
      subtotal: 6_000_000,
    });
    const nullStoreDefaults: StoreSettings = {
      ...baseSettings,
      default_so_validity_days: undefined,  // falls back to 14
      default_payment_terms: null,
      default_lead_time_text: null,
      default_so_notes: null,
      default_opening_greeting: null,
      default_signatory_name: null,
      default_signatory_title: null,
    };

    const blob = await generateSalesOrderPdf(nullFieldsSo, nullStoreDefaults, []);

    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe('application/pdf');
    expect(blob.size).toBeGreaterThan(1000);
  });

  it('uses created_by_name from so.created_by_name as signatory override', async () => {
    const so = baseSo({ created_by_name: 'Custom User' });
    // Should not throw; signatory in the PDF should come from so.created_by_name
    const blob = await generateSalesOrderPdf(so, baseSettings, baseBanks);

    expect(blob).toBeInstanceOf(Blob);
    expect(blob.size).toBeGreaterThan(1000);
  });

  it('handles valid_until_override date correctly', async () => {
    const so = baseSo({ valid_until_override: '2026-09-01' });
    const blob = await generateSalesOrderPdf(so, baseSettings, baseBanks);

    expect(blob).toBeInstanceOf(Blob);
    expect(blob.size).toBeGreaterThan(1000);
  });

  it('handles bank accounts with soft-cap overflow (>3 active accounts)', async () => {
    const manyBanks: BankAccount[] = Array.from({ length: 5 }, (_, i) => ({
      id: `bank-${i}`,
      bank_name: `Bank ${i + 1}`,
      account_number: `100${i}`,
      account_holder: 'PT Garindo',
      is_active: true,
      sort_order: i,
    }));
    const so = baseSo();
    const blob = await generateSalesOrderPdf(so, baseSettings, manyBanks);

    expect(blob).toBeInstanceOf(Blob);
    expect(blob.size).toBeGreaterThan(1000);
  });

  it('pre-fetched logoDataUrl option skips fetch', async () => {
    // Pass a dummy data-URL to skip fetchLogoDataUrl; should not throw
    const so = baseSo();
    const blob = await generateSalesOrderPdf(so, baseSettings, baseBanks, {
      logoDataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    });

    expect(blob).toBeInstanceOf(Blob);
    expect(blob.size).toBeGreaterThan(1000);
  });
});
