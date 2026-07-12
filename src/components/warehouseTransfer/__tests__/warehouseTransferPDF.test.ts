import { describe, it, expect } from 'vitest';
import { renderTransferSuratJalan } from '../../../lib/pdf/warehouseTransferPDF';

describe('renderTransferSuratJalan', () => {
  it('produces a non-empty PDF blob for minimal input', async () => {
    const blob = await renderTransferSuratJalan({
      header: {
        id: 1, doc_no: 'TR-2026-07-001', status: 'IN_TRANSIT',
        from_warehouse_id: 'wa', to_warehouse_id: 'wb',
        sender_user_id: 'u1', receiver_user_id: 'u2',
        total_qty_sent: 3, total_qty_received: null, total_loss_qty: null,
        initiated_at: '2026-07-12T10:23:00Z', received_at: null, cancelled_at: null,
        n_items: 1, notes: 'test',
      } as any,
      items: [{ transfer_id: 1, line_no: 1, sku: 'S1', qty_sent: 3, qty_received: null, loss_qty: null, loss_movement_id: null }],
    }, {
      tenantName: 'PT Toko Uji', tenantAddress: 'Jl. Test 1',
      fromWarehouseName: 'Gudang Atas', toWarehouseName: 'Gudang Bawah',
      senderName: 'Rudi', receiverName: 'Sari',
      skuNames: { S1: 'Cat Biru' },
      logoUrl: null,
    });
    expect(blob.type).toBe('application/pdf');
    expect(blob.size).toBeGreaterThan(500);
  });
});
