import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SalesOrderDefaultsPanel } from './SalesOrderDefaultsPanel';
import type { StoreSettings } from '../../lib/pengaturan/types';

const baseSettings: Partial<StoreSettings> = {
  default_so_validity_days: 14,
  default_payment_terms: '50% DP',
  default_lead_time_text: '7-10 hari',
  default_so_notes: 'Harga belum termasuk PPN 11%',
  default_opening_greeting: 'Dengan Hormat...',
  default_signatory_name: 'Budi Santoso',
  default_signatory_title: 'Sales Engineer',
  footer_show_telp_kantor: true,
  footer_show_wa: true,
  footer_show_email: true,
  footer_show_website: false,
};

describe('SalesOrderDefaultsPanel', () => {
  it('renders all fields prefilled from StoreSettings', () => {
    const onSave = vi.fn();
    render(<SalesOrderDefaultsPanel settings={baseSettings as StoreSettings} onSave={onSave} />);
    expect(screen.getByLabelText(/masa berlaku/i)).toHaveValue(14);
    expect(screen.getByLabelText(/nama penandatangan/i)).toHaveValue('Budi Santoso');
    expect(screen.getByLabelText(/jabatan/i)).toHaveValue('Sales Engineer');
    expect(screen.getByLabelText(/tampilkan website/i)).not.toBeChecked();
  });

  it('calls onSave with all fields when Simpan is clicked', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<SalesOrderDefaultsPanel settings={baseSettings as StoreSettings} onSave={onSave} />);
    fireEvent.change(screen.getByLabelText(/masa berlaku/i), { target: { value: '21' } });
    fireEvent.click(screen.getByRole('button', { name: /simpan/i }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      default_so_validity_days: 21,
      default_signatory_name: 'Budi Santoso',
      footer_show_website: false,
    }));
  });
});
