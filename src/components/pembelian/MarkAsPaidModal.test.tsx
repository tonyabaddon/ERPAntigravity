import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import MarkAsPaidModal from './MarkAsPaidModal';
import { kasirService } from '../../lib/supabaseClient';

vi.mock('../../lib/supabaseClient', () => ({
  supabase: {},
  kasirService: { insertExpense: vi.fn() },
  isSupabaseConfigured: true,
}));
vi.mock('../../lib/pembelianService', () => ({
  purchaseOrderService: {
    uploadDocument: vi.fn(),
    markPaid: vi.fn().mockResolvedValue(undefined),
  },
}));

const mockInsertExpense = kasirService.insertExpense as ReturnType<typeof vi.fn>;

describe('MarkAsPaidModal regression (post migration 524)', () => {
  beforeEach(() => {
    mockInsertExpense.mockReset();
  });

  it('still calls insertExpense with hardcoded "Pembelian Stok" category', async () => {
    mockInsertExpense.mockResolvedValue({ id: 'x' });
    const po = {
      id: 'po1',
      po_number: 'PO-001',
      total: 100000,
      supplier: { name: 'Supplier X' },
      payment_due_at: null,
    };
    const onClose = vi.fn();
    const onPaid = vi.fn();
    const showToast = vi.fn();

    render(
      <MarkAsPaidModal
        po={po as any}
        onClose={onClose}
        onPaid={onPaid}
        showToast={showToast}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /Konfirmasi Lunas/i }));
    await waitFor(() => expect(mockInsertExpense).toHaveBeenCalled());
    expect(mockInsertExpense).toHaveBeenCalledWith(expect.objectContaining({
      expense_category: 'Pembelian Stok',
    }));
  });
});
