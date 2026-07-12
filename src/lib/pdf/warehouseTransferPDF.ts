import { jsPDF } from 'jspdf';
import type { WarehouseTransferDetail } from '../warehouseTransferService';

export interface TransferPDFContext {
  tenantName: string;
  tenantAddress: string | null;
  fromWarehouseName: string;
  toWarehouseName: string;
  senderName: string;
  receiverName: string;
  skuNames: Record<string, string>;
  logoUrl: string | null;
}

export async function renderTransferSuratJalan(
  detail: WarehouseTransferDetail,
  ctx: TransferPDFContext,
): Promise<Blob> {
  const doc = new jsPDF({ format: 'a5', orientation: 'portrait', unit: 'mm' });
  let y = 12;

  if (ctx.logoUrl) {
    try {
      doc.addImage(ctx.logoUrl, 'PNG', 10, y, 20, 12);
    } catch { /* ignore malformed logo */ }
  }
  doc.setFontSize(11).setFont('helvetica', 'bold');
  doc.text(ctx.tenantName.toUpperCase(), 34, y + 4);
  doc.setFontSize(8).setFont('helvetica', 'normal');
  if (ctx.tenantAddress) doc.text(ctx.tenantAddress, 34, y + 9);
  y += 18;

  doc.setDrawColor(180).line(10, y, 138, y);
  y += 5;
  doc.setFontSize(13).setFont('helvetica', 'bold');
  doc.text('SURAT JALAN TRANSFER GUDANG', 10, y);
  y += 6;
  doc.setFontSize(9).setFont('helvetica', 'normal');
  doc.text(`No. ${detail.header.doc_no}`, 10, y);
  doc.text(`Tgl. ${new Date(detail.header.initiated_at).toLocaleString('id-ID')}`, 80, y);
  y += 6;

  doc.text(`Dari:   ${ctx.fromWarehouseName}`, 10, y); y += 5;
  doc.text(`Ke:     ${ctx.toWarehouseName}`,  10, y); y += 5;
  doc.text(`Dikirim oleh:   ${ctx.senderName}`,  10, y); y += 5;
  doc.text(`Diterima oleh:  ${ctx.receiverName}`, 10, y); y += 8;

  // Items table (manual layout — no autoTable dependency)
  doc.setFont('helvetica', 'bold').setFontSize(9);
  doc.text('No.', 10, y); doc.text('SKU', 20, y); doc.text('Nama', 55, y);
  doc.text('Qty', 115, y, { align: 'right' }); doc.text('Sat', 130, y, { align: 'right' });
  y += 3; doc.line(10, y, 138, y); y += 4;
  doc.setFont('helvetica', 'normal');
  detail.items.forEach((it, i) => {
    doc.text(String(i + 1), 10, y);
    doc.text(it.sku.slice(0, 15), 20, y);
    doc.text((ctx.skuNames[it.sku] ?? '').slice(0, 30), 55, y);
    doc.text(String(it.qty_sent), 115, y, { align: 'right' });
    doc.text('pcs', 130, y, { align: 'right' });
    y += 5;
  });
  y += 2; doc.line(10, y, 138, y); y += 5;
  doc.setFont('helvetica', 'bold');
  doc.text(`Total: ${detail.items.length} SKU · ${detail.header.total_qty_sent} pcs`, 138, y, { align: 'right' });
  y += 10;

  if (detail.header.notes) {
    doc.setFont('helvetica', 'italic').setFontSize(8);
    doc.text(`Catatan: ${detail.header.notes.slice(0, 200)}`, 10, y);
    y += 8;
  }

  // Signatures
  doc.setFont('helvetica', 'normal').setFontSize(9);
  const sigY = Math.max(y, 175);
  const cols = [12, 52, 92];
  ['Sopir', 'Pengirim', 'Penerima'].forEach((label, i) => {
    doc.text(label, cols[i], sigY);
    doc.text('_______________', cols[i], sigY + 15);
  });
  const names = ['(              )', `(${ctx.senderName})`, `(${ctx.receiverName})`];
  names.forEach((n, i) => doc.text(n, cols[i], sigY + 20));

  return doc.output('blob');
}
