import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import BulkUpdateGrosirSection from './BulkUpdateGrosirSection';
import * as supabase from '../../lib/supabaseClient';

vi.mock('../../lib/supabaseClient', () => ({
  productService: { bulkUpdateGrosirPrice: vi.fn() },
}));

const stockList = [
  { sku: 'A-1', name: 'Produk A', price: 100000, price_grosir: 80000 } as any,
  { sku: 'A-2', name: 'Produk B', price: 50000, price_grosir: null } as any,
];

describe('BulkUpdateGrosirSection', () => {
  beforeEach(() => vi.clearAllMocks());

  it('parses CSV row marked OK', async () => {
    const showToast = vi.fn();
    render(<BulkUpdateGrosirSection stockList={stockList} showToast={showToast} onApplied={vi.fn()} />);
    const csv = 'sku,nama,price_eceran,price_grosir_lama,price_grosir_baru\nA-1,"Produk A",100000,80000,75000\n';
    const file = new File([csv], 'x.csv', { type: 'text/csv' });
    const input = screen.getByRole('button', { name: /Upload CSV/i }).parentElement!.querySelector('input[type=file]') as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: [file] });
    fireEvent.change(input);
    await waitFor(() => expect(screen.getByText(/OK/)).toBeInTheDocument());
    expect(screen.getByText(/1 akan diupdate/)).toBeInTheDocument();
  });

  it('flags SKU not found', async () => {
    render(<BulkUpdateGrosirSection stockList={stockList} showToast={vi.fn()} onApplied={vi.fn()} />);
    const csv = 'sku,nama,price_eceran,price_grosir_lama,price_grosir_baru\nX-999,?,?,?,50000\n';
    const file = new File([csv], 'x.csv', { type: 'text/csv' });
    const input = screen.getByRole('button', { name: /Upload CSV/i }).parentElement!.querySelector('input[type=file]') as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: [file] });
    fireEvent.change(input);
    await waitFor(() => expect(screen.getByText(/SKU tidak ada/i)).toBeInTheDocument());
  });

  it('flags grosir > eceran as WARNING and requires checkbox to apply', async () => {
    render(<BulkUpdateGrosirSection stockList={stockList} showToast={vi.fn()} onApplied={vi.fn()} />);
    const csv = 'sku,nama,price_eceran,price_grosir_lama,price_grosir_baru\nA-1,"Produk A",100000,80000,150000\n';
    const file = new File([csv], 'x.csv', { type: 'text/csv' });
    const input = screen.getByRole('button', { name: /Upload CSV/i }).parentElement!.querySelector('input[type=file]') as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: [file] });
    fireEvent.change(input);
    await waitFor(() => expect(screen.getAllByText(/Di atas eceran/i).length).toBeGreaterThan(0));
    const applyBtn = screen.getByRole('button', { name: /Apply/i }) as HTMLButtonElement;
    expect(applyBtn.disabled).toBe(true);
    fireEvent.click(screen.getByLabelText(/konfirmasi/i));
    expect(applyBtn.disabled).toBe(false);
  });

  it('calls RPC and shows success toast on apply', async () => {
    (supabase as any).productService.bulkUpdateGrosirPrice.mockResolvedValue({ applied: 1, skipped: [] });
    const showToast = vi.fn();
    const onApplied = vi.fn();
    render(<BulkUpdateGrosirSection stockList={stockList} showToast={showToast} onApplied={onApplied} />);
    const csv = 'sku,nama,price_eceran,price_grosir_lama,price_grosir_baru\nA-1,"Produk A",100000,80000,75000\n';
    const file = new File([csv], 'x.csv', { type: 'text/csv' });
    const input = screen.getByRole('button', { name: /Upload CSV/i }).parentElement!.querySelector('input[type=file]') as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: [file] });
    fireEvent.change(input);
    await screen.findByText(/1 akan diupdate/);
    fireEvent.click(screen.getByRole('button', { name: /Apply/i }));
    await waitFor(() => expect(showToast).toHaveBeenCalledWith(expect.stringMatching(/1 produk diupdate/), 'success'));
    expect(onApplied).toHaveBeenCalled();
  });
});
