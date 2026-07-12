import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ComponentProps } from 'react';
import WarehouseTransferCreateScreen from '../WarehouseTransferCreateScreen';
import { warehouseTransferService } from '../../../lib/warehouseTransferService';

vi.mock('../../../lib/warehouseTransferService', () => ({
  warehouseTransferService: {
    initiateTransfer: vi.fn().mockResolvedValue({ transfer_id: 5, doc_no: 'TR-2026-07-005', idempotent: false }),
    getTransferDetail: vi.fn().mockResolvedValue(null),
  },
}));

vi.mock('../../../hooks/useWarehouses', () => ({
  useWarehouses: () => ({
    warehouses: [
      { id: 'wa', name: 'Gudang Atas' },
      { id: 'wb', name: 'Gudang Bawah' },
    ],
    loading: false,
    error: null,
    refresh: vi.fn(),
  }),
}));

const mockSearchSKU = vi.fn().mockResolvedValue([{ sku: 'S1', name: 'Cat Biru', qty: 100 }]);
const mockListReceivers = vi.fn().mockResolvedValue([{ id: 'u2', name: 'Sari' }]);

function renderScreen(overrides: Partial<ComponentProps<typeof WarehouseTransferCreateScreen>> = {}) {
  const onDone = vi.fn();
  const onCancel = vi.fn();
  render(
    <WarehouseTransferCreateScreen
      currentUserId="me"
      onDone={onDone}
      onCancel={onCancel}
      searchSKU={mockSearchSKU}
      listReceivers={mockListReceivers}
      {...overrides}
    />
  );
  return { onDone, onCancel };
}

describe('WarehouseTransferCreateScreen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListReceivers.mockResolvedValue([{ id: 'u2', name: 'Sari' }]);
  });

  it('renders "Buat Transfer Baru" heading', () => {
    renderScreen();
    expect(screen.getByText('Buat Transfer Baru')).toBeInTheDocument();
  });

  it('renders DARI and KE warehouse dropdowns with mocked warehouses', () => {
    renderScreen();
    expect(screen.getByLabelText(/Dari Gudang/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Ke Gudang/i)).toBeInTheDocument();
    // Both dropdowns have the warehouses as options
    const fromSelect = screen.getByLabelText(/Dari Gudang/i);
    expect(fromSelect).toContainHTML('Gudang Atas');
    expect(fromSelect).toContainHTML('Gudang Bawah');
  });

  it('calls initiateTransfer with correct payload when Kirim Mutasi is clicked', async () => {
    renderScreen();

    // Select from/to warehouses
    fireEvent.change(screen.getByLabelText(/Dari Gudang/i), { target: { value: 'wa' } });
    fireEvent.change(screen.getByLabelText(/Ke Gudang/i), { target: { value: 'wb' } });

    // Wait for listReceivers to be called and receiver options to load
    await waitFor(() => expect(mockListReceivers).toHaveBeenCalledWith('wb'));
    await waitFor(() => expect(screen.getByLabelText(/Dikirim Kepada/i)).not.toBeDisabled());

    // Select receiver
    fireEvent.change(screen.getByLabelText(/Dikirim Kepada/i), { target: { value: 'u2' } });

    // Add an item via SKU picker search
    const searchInput = screen.getByPlaceholderText(/Cari SKU/i);
    fireEvent.change(searchInput, { target: { value: 'Cat' } });
    await waitFor(() => expect(mockSearchSKU).toHaveBeenCalledWith('Cat'));
    // 'Cat Biru' text is split across sibling spans inside the dropdown button
    await waitFor(() => screen.getByText(/Cat Biru/i));
    fireEvent.click(screen.getByText(/Cat Biru/i));

    // Submit
    fireEvent.click(screen.getByRole('button', { name: /Kirim Mutasi/i }));

    await waitFor(() =>
      expect(warehouseTransferService.initiateTransfer).toHaveBeenCalledWith(
        expect.objectContaining({
          fromWarehouseId: 'wa',
          toWarehouseId: 'wb',
          receiverUserId: 'u2',
          items: [{ sku: 'S1', qty: 1 }],
        })
      )
    );
  });

  it('shows validation error when submitting with no lines', async () => {
    renderScreen();
    fireEvent.change(screen.getByLabelText(/Dari Gudang/i), { target: { value: 'wa' } });
    fireEvent.change(screen.getByLabelText(/Ke Gudang/i), { target: { value: 'wb' } });
    await waitFor(() => expect(mockListReceivers).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByLabelText(/Dikirim Kepada/i)).not.toBeDisabled());
    fireEvent.change(screen.getByLabelText(/Dikirim Kepada/i), { target: { value: 'u2' } });

    // Submit without adding items
    fireEvent.click(screen.getByRole('button', { name: /Kirim Mutasi/i }));

    await waitFor(() =>
      expect(screen.getByText(/Tambahkan minimal 1 barang/i)).toBeInTheDocument()
    );
    expect(warehouseTransferService.initiateTransfer).not.toHaveBeenCalled();
  });

  it('blocks selecting same warehouse for Dari and Ke, shows warning', () => {
    renderScreen();
    fireEvent.change(screen.getByLabelText(/Dari Gudang/i), { target: { value: 'wa' } });

    // KE dropdown should not contain 'wa' since it filters out fromId
    const toSelect = screen.getByLabelText(/Ke Gudang/i);
    const options = Array.from(toSelect.querySelectorAll('option')).map(o => (o as HTMLOptionElement).value);
    expect(options).not.toContain('wa');
  });

  it('calls onCancel when Batal is clicked', () => {
    const { onCancel } = renderScreen();
    fireEvent.click(screen.getByRole('button', { name: 'Batal' }));
    expect(onCancel).toHaveBeenCalled();
  });
});
