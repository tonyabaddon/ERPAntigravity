// Invoice Lunas / Kwitansi PDF — third generator. Issued when an order is
// paid in full from the start (Bayar Penuh flow, Stage 3 → 4). Layout per
// § Invoice Lunas in `docs/superpowers/specs/2026-06-18-sales-pdf-layout-design.md`:
// Header → Customer/Pengiriman → Items table → Totals → LUNAS banner → footer.
//
// Difference vs Sales Order: no bank instruction block (already paid); a green
// LUNAS banner replaces it with the payment method + receipt date.

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
  formatRupiah,
  formatTanggal,
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
const NAVY_HEX = 'var(--color-caleo-primary)';
const GREEN_HEX = '#2d8a4e';
// 10% opacity green over white ≈ #e7f3ec — jsPDF doesn't support alpha
// natively for fills, so we use a pre-mixed pastel.
const GREEN_BANNER_BG = '#e7f3ec';
const HAIRLINE_HEX = '#d0d7e2';

/**
 * Generate the Invoice Lunas / Kwitansi PDF. The order is expected to carry
 * `payment_method` (e.g. "Transfer BCA", "Tunai") which surfaces inside the
 * LUNAS banner.
 */
export async function generateInvoiceLunasPdf(
  order: OrderForPdf,
  settings: StoreSettings,
  _banks: BankAccount[],
  printMode: PdfPrintMode = 'normal',
): Promise<PdfResult> {
  // `_banks` accepted for signature parity with the other generators even
  // though this PDF doesn't render bank instructions.
  void _banks;

  const docNumber = await nextInvoiceNumber('INV');
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
  const dm = printMode === 'dot_matrix';
  const headerFill = dm ? BLACK_RGB : NAVY_RGB;
  const totalAccent = dm ? BLACK_HEX : GREEN_HEX;
  const dividerColor = dm ? '#000000' : 'var(--color-caleo-primary)';

  // ----- 1. Header -----
  const issueDate = new Date().toISOString();
  const logoDataUrl = await fetchLogoDataUrl(settings);
  let cursorY = renderHeader(doc, settings, docNumber, issueDate, order.id?.slice(0, 8), printMode, logoDataUrl);

  // ----- 2. Doc title -----
  cursorY = renderDocTitle(doc, 'INVOICE / KWITANSI', cursorY, printMode);

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

  // ----- 5. Totals block -----
  const totalsValueX = PAGE_WIDTH_MM - MARGIN_MM;
  const totalsLabelX = PAGE_WIDTH_MM - MARGIN_MM - 60;

  const ongkir = order.ongkir_amount ?? 0;
  const subtotal = items.reduce((acc, it) => acc + (it.subtotal || 0), 0);
  const grandTotal = order.total ?? subtotal + ongkir;

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

  doc.setDrawColor(dividerColor);
  doc.setLineWidth(0.4);
  doc.line(totalsLabelX, cursorY - 2, totalsValueX, cursorY - 2);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(totalAccent);
  doc.text('TOTAL', totalsLabelX, cursorY + 3);
  doc.text(formatRupiah(grandTotal, true), totalsValueX, cursorY + 3, { align: 'right' });
  cursorY += 10;

  // ----- 6. LUNAS banner REMOVED (founder request 2026-07-24) -----
  // Payment method + receipt date sudah tercantum di totals block dan doc header;
  // banner terpisah dianggap redundant. Kept the constants imported above for
  // future re-enable if design changes.

  // ----- 7. Footer T&C -----
  renderFooter(doc, 'SYARAT & KETENTUAN', [
    'Invoice ini berlaku sebagai kwitansi sah setelah pembayaran diterima',
    'Barang yang telah dibeli tidak dapat dikembalikan',
    'Klaim garansi mengikuti ketentuan supplier masing-masing',
  ], printMode);

  const blob = doc.output('blob');
  const filename = `Invoice_Lunas_${sanitizeDocNumber(docNumber)}_${customerInitial(order.customer)}.pdf`;

  return { blob, docNumber, filename };
}
