// Invoice DP / Tanda Jadi PDF — second of the six Phase 1B generators.
// Issued when a customer has paid the down payment (Stage 3a komponen or
// 3c CP/RP). Layout follows § Invoice DP in
// `docs/superpowers/specs/2026-06-18-sales-pdf-layout-design.md`:
// Header → Customer/Pengiriman → Items table → payment breakdown box
// (Subtotal / Ongkir / TOTAL → hairline → DP diterima green / Sisa amber) →
// payment instruction → footer T&C.

import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { DeliveryMethod } from '../types';
import type { StoreSettings, BankAccount } from '../../pengaturan/types';
import {
  renderHeader,
  renderDocTitle,
  renderCustomerBlock,
  renderBankBlock,
  renderFooter,
  fetchLogoDataUrl,
  formatRupiah,
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
const BLACK_HEX = '#000000';
const NAVY_HEX = '#012749';
const GREEN_HEX = '#2d8a4e';
const AMBER_HEX = '#b45309';
const HAIRLINE_HEX = '#d0d7e2';

/**
 * Generate the Invoice DP / Tanda Jadi PDF. Returns `{ blob, docNumber,
 * filename }` matching the contract the SO generator already established.
 */
export async function generateInvoiceDpPdf(
  order: OrderForPdf,
  settings: StoreSettings,
  banks: BankAccount[],
  printMode: PdfPrintMode = 'normal',
): Promise<PdfResult> {
  const docNumber = await nextInvoiceNumber('INV-DP');
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
  const dm = printMode === 'dot_matrix';
  const headerFill = dm ? BLACK_RGB : NAVY_RGB;
  const totalAccent = dm ? BLACK_HEX : GREEN_HEX;
  const dividerColor = dm ? '#000000' : '#012749';

  // ----- 1. Header -----
  const issueDate = new Date().toISOString();
  const logoDataUrl = await fetchLogoDataUrl(settings);
  let cursorY = renderHeader(doc, settings, docNumber, issueDate, order.id?.slice(0, 8), printMode, logoDataUrl);

  // ----- 2. Doc title -----
  cursorY = renderDocTitle(doc, 'INVOICE DP / TANDA JADI', cursorY, printMode);

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

  // ----- 4. Items table -----
  const items: ItemRow[] = order.items ?? [];
  autoTable(doc, {
    startY: cursorY,
    head: [['No', 'Produk', 'Qty', 'Harga', 'Subtotal']],
    body: items.map((it, i) => [
      String(i + 1),
      it.name,
      String(it.qty),
      formatRupiah(it.unit_price ?? (it.qty > 0 ? it.subtotal / it.qty : it.subtotal)),
      formatRupiah(it.subtotal),
    ]),
    theme: 'grid',
    styles: {
      font: 'helvetica',
      fontSize: 9,
      cellPadding: 2,
      textColor: dm ? '#000000' : '#222222',
      lineColor: dm ? '#000000' : HAIRLINE_HEX,
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
      2: { halign: 'right', cellWidth: 18 },
      3: { halign: 'right', cellWidth: 32 },
      4: { halign: 'right', cellWidth: 32 },
    },
    margin: { left: MARGIN_MM, right: MARGIN_MM },
  });

  cursorY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 4;

  // ----- 5. Payment breakdown box (right-aligned) -----
  const totalsValueX = PAGE_WIDTH_MM - MARGIN_MM;
  const totalsLabelX = PAGE_WIDTH_MM - MARGIN_MM - 60;

  const ongkir = order.ongkir_amount ?? 0;
  const subtotal = items.reduce((acc, it) => acc + (it.subtotal || 0), 0);
  const grandTotal = order.total ?? subtotal + ongkir;
  const dpAmount = order.dp_amount ?? 0;
  const sisa = Math.max(0, grandTotal - dpAmount);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.setTextColor(dm ? '#000000' : '#222222');
  doc.text('Subtotal', totalsLabelX, cursorY);
  doc.text(formatRupiah(subtotal), totalsValueX, cursorY, { align: 'right' });
  cursorY += 5;

  if (ongkir > 0) {
    doc.text('Ongkir', totalsLabelX, cursorY);
    doc.text(formatRupiah(ongkir), totalsValueX, cursorY, { align: 'right' });
    cursorY += 5;
  }

  // Divider above TOTAL line
  doc.setDrawColor(dividerColor);
  doc.setLineWidth(0.4);
  doc.line(totalsLabelX, cursorY - 2, totalsValueX, cursorY - 2);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(totalAccent);
  doc.text('TOTAL', totalsLabelX, cursorY + 3);
  doc.text(formatRupiah(grandTotal, true), totalsValueX, cursorY + 3, { align: 'right' });
  cursorY += 9;

  // Hairline divider before DP / Sisa rows
  doc.setDrawColor(dm ? '#000000' : HAIRLINE_HEX);
  doc.setLineWidth(0.2);
  doc.line(totalsLabelX, cursorY - 1, totalsValueX, cursorY - 1);

  // DP diterima — green bold 10pt
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(totalAccent);
  doc.text('DP diterima', totalsLabelX, cursorY + 4);
  doc.text(formatRupiah(dpAmount, true), totalsValueX, cursorY + 4, { align: 'right' });
  cursorY += 6;

  // Sisa — amber bold 11pt
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(dm ? '#000000' : AMBER_HEX);
  doc.text('Sisa', totalsLabelX, cursorY + 4);
  doc.text(formatRupiah(sisa, true), totalsValueX, cursorY + 4, { align: 'right' });
  cursorY += 10;

  // ----- 6. Bank instruction block -----
  cursorY = renderBankBlock(doc, banks, cursorY, printMode);

  // ----- 7. Footer T&C -----
  renderFooter(doc, 'SYARAT & KETENTUAN', [
    'DP yang sudah dibayar tidak dapat dikembalikan (kecuali force majeure)',
    'Sisa pembayaran wajib dilunasi sebelum barang dikirim/diserahkan',
    'Estimasi pengerjaan: berlaku setelah DP dikonfirmasi',
  ], printMode);

  const blob = doc.output('blob');
  const filename = `Invoice_DP_${sanitizeDocNumber(docNumber)}_${customerInitial(order.customer)}.pdf`;

  return { blob, docNumber, filename };
}
