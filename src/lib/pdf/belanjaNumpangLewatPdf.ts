// A6 PDF "Tanda Terima" for Belanja Numpang Lewat — printable receipt that
// the operator can give to the customer or archive. Mirrors purchaseOrderPdf.ts
// pattern but stripped down for the smaller, faster pass-through use case.
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { DbPurchaseInvoice } from '../../types';
import { shortOrderRef } from '../purchaseInvoiceService';

const TEXT_DARK = '#111827';
const TEXT_MUTED = '#6b7280';
const BRAND_VIOLET = '#7c3aed';

function fmtRp(n: number): string { return 'Rp ' + Math.round(n).toLocaleString('id-ID'); }
function fmtDate(s?: string | null): string {
  if (!s) return '—';
  const d = new Date(s);
  const months = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];
  return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
}

export function generateBelanjaNumpangLewatPdf(args: { pi: DbPurchaseInvoice }): Blob {
  const { pi } = args;
  const doc = new jsPDF({ unit: 'mm', format: 'a6', orientation: 'portrait' });

  doc.setFontSize(11); doc.setTextColor(TEXT_DARK); doc.setFont('helvetica', 'bold');
  doc.text('BELANJA NUMPANG LEWAT', 8, 10);
  doc.setFontSize(9); doc.setTextColor(BRAND_VIOLET);
  doc.text(pi.pi_number, 8, 15);
  doc.setTextColor(TEXT_MUTED); doc.setFont('helvetica', 'normal'); doc.setFontSize(7);
  doc.text(`Tanggal: ${fmtDate(pi.purchase_date)}`, 8, 19);
  doc.text(`Status: ${pi.status === 'LUNAS' ? '✓ LUNAS' : '○ BELUM LUNAS'}`, 60, 19);

  doc.setDrawColor(220); doc.line(8, 22, 100, 22);

  doc.setFontSize(7); doc.setTextColor(TEXT_DARK);
  doc.text(`Supplier (Grosir): ${pi.supplier?.name ?? '—'}`, 8, 27);
  if (pi.supplier_invoice_number) doc.text(`Faktur Supplier: ${pi.supplier_invoice_number}`, 8, 30);
  doc.text(`Untuk Order: ${shortOrderRef(pi.order_id)}`, 8, pi.supplier_invoice_number ? 33 : 30);

  autoTable(doc, {
    startY: pi.supplier_invoice_number ? 38 : 35,
    head: [['Item', 'Qty', 'Beli', 'Subtotal']],
    body: (pi.items ?? []).map(it => [
      it.product_name, it.qty.toString(), fmtRp(it.unit_cost), fmtRp(it.subtotal),
    ]),
    theme: 'plain',
    styles: { fontSize: 7, cellPadding: 1.2 },
    headStyles: { fontStyle: 'bold', textColor: TEXT_MUTED, fillColor: '#f3f4f6' },
    columnStyles: { 1: { halign: 'center' }, 2: { halign: 'right' }, 3: { halign: 'right' } },
  });

  const endY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY ?? 80;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(8);
  doc.text('TOTAL', 60, endY + 5);
  doc.text(fmtRp(pi.total), 95, endY + 5, { align: 'right' });

  doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(TEXT_MUTED);
  doc.text(`Pembayaran: ${pi.payment_method}${pi.status === 'LUNAS' ? ` — Lunas ${fmtDate(pi.paid_at)}` : ''}`, 8, endY + 12);

  return doc.output('blob');
}
