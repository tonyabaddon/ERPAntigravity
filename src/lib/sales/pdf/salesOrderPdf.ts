// Sales Order PDF — first of the six Phase 1B generators. Issues a fresh
// SO/YYYY/NNNNN doc number via `next_invoice_number` and lays out the
// document per `docs/superpowers/specs/2026-06-18-sales-pdf-layout-design.md`
// § 1 Sales Order. The remaining five PDFs reuse the same primitives in
// `common.ts` so visual identity stays consistent.

import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { Order, DeliveryMethod } from '../types';
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
import type { ItemRow, PdfResult } from './types';

export type SalesOrderPdfItem = ItemRow;

export interface SalesOrderPdfOrder extends Order {
  items?: SalesOrderPdfItem[];
  ongkir_amount?: number;
  customer_phone?: string;
  customer_address?: string;
}

const DELIVERY_LABEL: Record<DeliveryMethod, string> = {
  PICKUP: 'Pickup',
  DELIVERY: 'Delivery',
  MARKETPLACE_COURIER: 'Marketplace Courier',
};

const NAVY_RGB: [number, number, number] = [1, 39, 73];
const BLACK_RGB: [number, number, number] = [0, 0, 0];
const GREEN_HEX = '#2d8a4e';
const BLACK_HEX = '#000000';

/**
 * Generate the Sales Order PDF. Returns a Blob (application/pdf), the freshly
 * minted doc number, and the conventional filename so callers can hand both
 * to PdfPreviewModal or to `pdf.save()`.
 */
export async function generateSalesOrderPdf(
  order: SalesOrderPdfOrder,
  settings: StoreSettings,
  banks: BankAccount[],
  printMode: PdfPrintMode = 'normal',
): Promise<PdfResult> {
  const docNumber = await nextInvoiceNumber('SO');
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
  const dm = printMode === 'dot_matrix';
  const headerFill = dm ? BLACK_RGB : NAVY_RGB;
  const headerTextColor = dm ? '#ffffff' : '#ffffff';
  const totalAccent = dm ? BLACK_HEX : GREEN_HEX;
  const dividerColor = dm ? '#000000' : 'var(--color-caleo-primary)';

  // ----- 1. Header -----
  const issueDate = new Date().toISOString();
  const logoDataUrl = await fetchLogoDataUrl(settings);
  let cursorY = renderHeader(doc, settings, docNumber, issueDate, order.id?.slice(0, 8), printMode, logoDataUrl);

  // ----- 2. Doc title -----
  cursorY = renderDocTitle(doc, 'PESANAN PENJUALAN', cursorY, printMode);

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
  const items = order.items ?? [];
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
      lineColor: dm ? '#000000' : '#d0d7e2',
      lineWidth: 0.15,
    },
    headStyles: {
      fillColor: headerFill,
      textColor: headerTextColor,
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

  // ----- 5. Totals block (right-aligned) -----
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

  // Divider above TOTAL line
  doc.setDrawColor(dividerColor);
  doc.setLineWidth(0.4);
  doc.line(totalsLabelX, cursorY - 2, totalsValueX, cursorY - 2);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(totalAccent);
  doc.text('TOTAL', totalsLabelX, cursorY + 3);
  doc.text(formatRupiah(grandTotal, true), totalsValueX, cursorY + 3, { align: 'right' });
  cursorY += 10;

  // ----- 6. Bank instruction block -----
  cursorY = renderBankBlock(doc, banks, cursorY, printMode);

  // ----- 7. Footer T&C -----
  renderFooter(doc, 'SYARAT & KETENTUAN', [
    'Barang yang telah dibeli tidak dapat dikembalikan',
    'Pembayaran dianggap sah setelah dana masuk ke rekening kami',
    'Komplain barang rusak/kurang harap disampaikan saat barang diterima',
  ], printMode);

  const blob = doc.output('blob');
  const filename = `Sales_Order_${sanitizeDocNumber(docNumber)}_${customerInitial(order.customer)}.pdf`;

  return { blob, docNumber, filename };
}
