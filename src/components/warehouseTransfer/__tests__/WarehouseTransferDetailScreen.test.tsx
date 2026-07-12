import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import WarehouseTransferDetailScreen from '../WarehouseTransferDetailScreen';
import { warehouseTransferService } from '../../../lib/warehouseTransferService';

vi.mock('../../../lib/warehouseTransferService', () => ({
  warehouseTransferService: {
    getTransferDetail: vi.fn(),
    receiveTransfer:   vi.fn(),
    cancelTransfer:    vi.fn(),
  },
}));
vi.mock('../../../hooks/useWarehouses', () => ({ useWarehouses: () => ({ warehouses: [
  { id: 'wa', name: 'Gudang Atas' }, { id: 'wb', name: 'Gudang Bawah' } ] }) }));

const IN_TRANSIT_DETAIL = {
  header: { id: 7, doc_no: 'TR-2026-07-007', status: 'IN_TRANSIT',
            from_warehouse_id: 'wa', to_warehouse_id: 'wb',
            sender_user_id: 'sender-u', receiver_user_id: 'me',
            total_qty_sent: 10, total_qty_received: null, total_loss_qty: null,
            total_loss_value_rp: null,
            initiated_at: '2026-07-12T10:00:00Z', received_at: null, cancelled_at: null,
            n_items: 1, notes: null },
  items: [{ transfer_id: 7, line_no: 1, sku: 'S1', qty_sent: 10, qty_received: null,
            loss_qty: null, loss_movement_id: null, harga_modal: 30000, loss_value_rp: null }],
};

describe('WarehouseTransferDetailScreen', () => {
  it('renders read-only summary when status=RECEIVED and no action buttons', async () => {
    (warehouseTransferService.getTransferDetail as any).mockResolvedValue({
      ...IN_TRANSIT_DETAIL,
      header: { ...IN_TRANSIT_DETAIL.header, status: 'RECEIVED', total_qty_received: 10, received_at: '2026-07-12T11:00:00Z' },
      items: [{ ...IN_TRANSIT_DETAIL.items[0], qty_received: 10 }],
    });
    render(<WarehouseTransferDetailScreen id={7} currentUserId="me" onBack={() => {}} />);
    await waitFor(() => expect(screen.getByText(/TR-2026-07-007/)).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /Konfirmasi Terima/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Batal Kirim/i })).not.toBeInTheDocument();
  });

  it('shows Konfirmasi Terima button when IN_TRANSIT and receiver=me', async () => {
    (warehouseTransferService.getTransferDetail as any).mockResolvedValue(IN_TRANSIT_DETAIL);
    render(<WarehouseTransferDetailScreen id={7} currentUserId="me" onBack={() => {}} />);
    await waitFor(() => expect(screen.getByRole('button', { name: /Konfirmasi Terima/i })).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /Batal Kirim/i })).not.toBeInTheDocument();
  });

  it('calls receiveTransfer with mapped qty_received on submit', async () => {
    (warehouseTransferService.getTransferDetail as any).mockResolvedValue(IN_TRANSIT_DETAIL);
    (warehouseTransferService.receiveTransfer as any).mockResolvedValue({ status: 'RECEIVED', total_loss_qty: 0 });
    render(<WarehouseTransferDetailScreen id={7} currentUserId="me" onBack={() => {}} />);
    await waitFor(() => screen.getByRole('button', { name: /Konfirmasi Terima/i }));
    fireEvent.click(screen.getByRole('button', { name: /Semua Sesuai/i }));
    fireEvent.click(screen.getByRole('button', { name: /Konfirmasi Terima/i }));
    await waitFor(() => expect(warehouseTransferService.receiveTransfer).toHaveBeenCalledWith(
      7, [{ sku: 'S1', qty_received: 10 }]));
  });

  it('shows Batal Kirim button when IN_TRANSIT and sender=me (not receiver)', async () => {
    (warehouseTransferService.getTransferDetail as any).mockResolvedValue({
      ...IN_TRANSIT_DETAIL,
      header: { ...IN_TRANSIT_DETAIL.header, sender_user_id: 'me', receiver_user_id: 'someone-else' },
    });
    render(<WarehouseTransferDetailScreen id={7} currentUserId="me" onBack={() => {}} />);
    await waitFor(() => expect(screen.getByRole('button', { name: /Batal Kirim/i })).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /Konfirmasi Terima/i })).not.toBeInTheDocument();
  });

  it('warns about PARTIAL with live loss value when qty_received < qty_sent', async () => {
    (warehouseTransferService.getTransferDetail as any).mockResolvedValue(IN_TRANSIT_DETAIL);
    render(<WarehouseTransferDetailScreen id={7} currentUserId="me" onBack={() => {}} />);
    await waitFor(() => screen.getByRole('button', { name: /Konfirmasi Terima/i }));
    const qtyInput = screen.getByLabelText(/Qty Diterima.*S1/i);
    fireEvent.change(qtyInput, { target: { value: '8' } });
    expect(screen.getByText(/Selisih -2/)).toBeInTheDocument();
    // Live loss value: 2 pcs × 30000 harga_modal = Rp 60.000
    expect(screen.getByText(/Rp 60\.000/)).toBeInTheDocument();
    // New copy replaces "Stock Adjustment TRANSFER_LOSS"
    expect(screen.getByText(/Catat kerugian ke pembukuan/)).toBeInTheDocument();
  });

  it('shows Nilai Kerugian chip on closed PARTIAL transfer', async () => {
    (warehouseTransferService.getTransferDetail as any).mockResolvedValue({
      ...IN_TRANSIT_DETAIL,
      header: {
        ...IN_TRANSIT_DETAIL.header,
        status: 'PARTIAL',
        total_qty_received: 7,
        total_loss_qty: 3,
        total_loss_value_rp: 90000,
        received_at: '2026-07-12T11:00:00Z',
      },
      items: [{ ...IN_TRANSIT_DETAIL.items[0], qty_received: 7, loss_qty: 3, loss_value_rp: 90000 }],
    });
    render(<WarehouseTransferDetailScreen id={7} currentUserId="other" onBack={() => {}} />);
    await waitFor(() => expect(screen.getByText(/Nilai Kerugian/i)).toBeInTheDocument());
    expect(screen.getByText(/Rp 90\.000/)).toBeInTheDocument();
    expect(screen.getByText(/3 pcs/)).toBeInTheDocument();
  });

  it('shows legacy fallback text for PARTIAL with null loss value', async () => {
    (warehouseTransferService.getTransferDetail as any).mockResolvedValue({
      ...IN_TRANSIT_DETAIL,
      header: {
        ...IN_TRANSIT_DETAIL.header,
        status: 'PARTIAL',
        total_qty_received: 7,
        total_loss_qty: 3,
        total_loss_value_rp: null,
        received_at: '2026-07-12T11:00:00Z',
      },
      items: [{ ...IN_TRANSIT_DETAIL.items[0], qty_received: 7, loss_qty: 3, loss_value_rp: null }],
    });
    render(<WarehouseTransferDetailScreen id={7} currentUserId="other" onBack={() => {}} />);
    await waitFor(() => expect(screen.getByText(/Nilai belum tercatat/i)).toBeInTheDocument());
  });
});
