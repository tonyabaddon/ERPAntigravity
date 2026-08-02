// Surat Jalan PDF — fifth generator. Printed for customer signature on
// delivery (Stage 4a Pickup ready / 4b Sedang Dikirim). Layout per § Surat
// Jalan in `docs/superpowers/specs/2026-06-18-sales-pdf-layout-design.md`:
// Header → Customer/Pengiriman → Items table (No/Produk/Qty only — no
// prices) → Delivery meta block (Resi / Kurir / Catatan) → 2-column
// signature block (Diserahkan / Diterima) → footer T&C.

import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { DeliveryMethod } from '../types';
import type { StoreSettings, BankAccount } from '../../pengaturan/types';
import {
  renderHeader,
  renderDocTitle,
  renderCustomerBlock,
  renderFooter,
  fetchLogoDataUrl,
  sanitizeDocNumber,
  customerInitial,
  MARGIN_MM,
  PAGE_WIDTH_MM,
  type PdfPrintMode,
} from './common';
import { nextInvoiceNumber } from './invoiceNumber';
import type { ItemRow, OrderForPdf, PdfResult } from './types';

const DELIVERY_LABEL: Record<DeliveryMethod, string> = {
  PICKUP: 'Pickup',
  DELIVERY: 'Delivery',
  MARKETPLACE_COURIER: 'Marketplace Courier',
};

const NAVY_RGB: [number, number, number] = [1, 39, 73];
const BLACK_RGB: [number, number, number] = [0, 0, 0];
const NAVY_HEX = '#012749';
const BLACK_HEX = '#000000';
const HAIRLINE_HEX = '#d0d7e2';
const GRAY_MUTED_HEX = '#555555';

/**
 * Generate the Surat Jalan PDF. Reads `order.resi_number` and
 * `order.delivery_notes` for the delivery meta block; falls back to `"-"`
 * when missing.
 */
export async function generateSuratJalanPdf(
  order: OrderForPdf,
  settings: StoreSettings,
  _banks: BankAccount[],
  printMode: PdfPrintMode = 'normal',
): Promise<PdfResult> {
  // `_banks` accepted for signature parity; SJ does not show bank instructions.
  void _banks;

  const docNumber = await nextInvoiceNumber('SJ');
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
  const dm = printMode === 'dot_matrix';
  const headerFill = dm ? BLACK_RGB : NAVY_RGB;
  const primary = dm ? BLACK_HEX : NAVY_HEX;
  const hairline = dm ? BLACK_HEX : HAIRLINE_HEX;
  const muted = dm ? BLACK_HEX : GRAY_MUTED_HEX;
  const bodyText = dm ? '#000000' : '#222222';

  // ----- 1. Header -----
  const issueDate = new Date().toISOString();
  const logoDataUrl = await fetchLogoDataUrl(settings);
  let cursorY = renderHeader(doc, settings, docNumber, issueDate, order.id?.slice(0, 8), printMode, logoDataUrl);

  // ----- 2. Doc title -----
  cursorY = renderDocTitle(doc, 'SURAT JALAN', cursorY, printMode);

  // ----- 3. Customer + Pengiriman -----
  const deliveryLabel = order.delivery_method
    ? DELIVERY_LABEL[order.delivery_method] ?? String(order.delivery_method)
    : '—';
  cursorY = renderCustomerBlock(
    doc,
    {
      name: order.customer,
      phone: order.customer_phone,
      address: order.customer_address,
    },
    {
      method: deliveryLabel,
      destination: order.customer_address,
    },
    cursorY,
    printMode,
  );

  // ----- 4. Items table (No | Produk | Qty only) -----
  const items: ItemRow[] = order.items ?? [];
  autoTable(doc, {
    startY: cursorY,
    head: [['No', 'Produk', 'Qty']],
    body: items.map((it, i) => [String(i + 1), it.name, String(it.qty)]),
    theme: 'grid',
    styles: {
      font: 'helvetica',
      fontSize: 9,
      cellPadding: 2,
      textColor: bodyText,
      lineColor: hairline,
      lineWidth: 0.15,
    },
    headStyles: {
      fillColor: headerFill,
      textColor: '#ffffff',
      fontStyle: 'bold',
      fontSize: 9,
      halign: 'left',
    },
    columnStyles: {
      0: { halign: 'left', cellWidth: 10 },
      1: { halign: 'left' },
      2: { halign: 'right', cellWidth: 25 },
    },
    margin: { left: MARGIN_MM, right: MARGIN_MM },
  });

  cursorY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 5;

  // ----- 5. Delivery meta block -----
  const labelX = MARGIN_MM;
  const valueX = MARGIN_MM + 50;

  const metaRows: Array<[string, string]> = [
    ['Nomor Resi / Tracking:', order.resi_number || '-'],
    ['Kurir:', deliveryLabel],
    ['Catatan:', order.delivery_notes || '-'],
  ];

  doc.setFontSize(9.5);
  for (const [label, value] of metaRows) {
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(primary);
    doc.text(label, labelX, cursorY);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(muted);
    const wrapped = doc.splitTextToSize(value, PAGE_WIDTH_MM - MARGIN_MM - valueX);
    doc.text(wrapped, valueX, cursorY);
    cursorY += Math.max(5, wrapped.length * 4.6);
  }
  cursorY += 4;

  // ----- 6. Signature block (2-column) -----
  const colGap = 8;
  const colWidth = (PAGE_WIDTH_MM - MARGIN_MM * 2 - colGap) / 2;
  const boxHeight = 28; // ~80pt
  const leftBoxX = MARGIN_MM;
  const rightBoxX = MARGIN_MM + colWidth + colGap;

  doc.setDrawColor(hairline);
  doc.setLineWidth(0.3);
  doc.roundedRect(leftBoxX, cursorY, colWidth, boxHeight, 1.6, 1.6);
  doc.roundedRect(rightBoxX, cursorY, colWidth, boxHeight, 1.6, 1.6);

  // Box labels
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(primary);
  doc.text('Diserahkan oleh,', leftBoxX + 3, cursorY + 5);
  doc.text('Diterima oleh,', rightBoxX + 3, cursorY + 5);

  // Signature lines at ~70% box height
  const lineY = cursorY + boxHeight - 8;
  doc.setDrawColor(muted);
  doc.setLineWidth(0.2);
  doc.line(leftBoxX + 6, lineY, leftBoxX + colWidth - 6, lineY);
  doc.line(rightBoxX + 6, lineY, rightBoxX + colWidth - 6, lineY);

  // Name lines under signature line
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(muted);
  const leftName = settings.nama_toko || '—';
  const rightName = '(nama jelas + TTD)';
  doc.text(leftName, leftBoxX + colWidth / 2, lineY + 4, { align: 'center' });
  doc.text(rightName, rightBoxX + colWidth / 2, lineY + 4, { align: 'center' });

  cursorY += boxHeight + 4;

  // ----- 7. Footer T&C -----
  renderFooter(doc, 'SYARAT & KETENTUAN', [
    'Mohon periksa barang sebelum tanda tangan',
    'Komplain barang rusak/kurang setelah tanda tangan tidak dilayani',
    'Surat Jalan ini bukti sah penyerahan barang',
  ], printMode);

  const blob = doc.output('blob');
  const filename = `Surat_Jalan_${sanitizeDocNumber(docNumber)}_${customerInitial(order.customer)}.pdf`;

  return { blob, docNumber, filename };
}
