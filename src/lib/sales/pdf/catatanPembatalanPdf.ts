// Catatan Pembatalan PDF — sixth and final Phase 1B generator. Archive
// document for audit when an order moves into Stage 6 (Batal/Refund).
// Layout per § Catatan Pembatalan in
// `docs/superpowers/specs/2026-06-18-sales-pdf-layout-design.md`:
// Header → customer block (no Pengiriman) → original items table →
// Pembatalan summary box (light red) → optional refund block → footer.
//
// Because the spec calls for a single-column customer block here (vs the
// two-column callout used by every other PDF), this generator renders that
// block inline instead of going through `renderCustomerBlock`.

import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { StoreSettings, BankAccount } from '../../pengaturan/types';
import {
  renderHeader,
  renderDocTitle,
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

const NAVY_RGB: [number, number, number] = [1, 39, 73];
const BLACK_RGB: [number, number, number] = [0, 0, 0];
const BLACK_HEX = '#000000';
const NAVY_HEX = 'var(--color-caleo-primary)';
const HAIRLINE_HEX = '#d0d7e2';
const GRAY_MUTED_HEX = '#555555';
const CALLOUT_BG_HEX = 'var(--color-caleo-cloud)';
const CANCEL_BG_HEX = '#fef2f2';
const CANCEL_BORDER_HEX = '#fca5a5';
const CANCEL_TEXT_HEX = '#7f1d1d';

/**
 * Single-column customer callout used only by Catatan Pembatalan. Mirrors the
 * pale-blue fill of `renderCustomerBlock` but drops the right "Pengiriman:"
 * column — the cancel record doesn't need delivery context.
 */
function renderCustomerOnlyBlock(
  doc: jsPDF,
  customer: { name: string; phone?: string; address?: string },
  y: number,
): number {
  const blockX = MARGIN_MM;
  const blockWidth = PAGE_WIDTH_MM - MARGIN_MM * 2;
  const padding = 3;
  const labelHeight = 4.5;
  const lineHeight = 4.2;

  const lines: string[] = [customer.name || '—'];
  if (customer.phone) lines.push(customer.phone);
  if (customer.address) {
    const wrapped = doc.splitTextToSize(customer.address, blockWidth - padding * 2);
    lines.push(...wrapped);
  }

  const blockHeight = padding * 2 + labelHeight + lines.length * lineHeight + 1;

  doc.setFillColor(CALLOUT_BG_HEX);
  doc.roundedRect(blockX, y, blockWidth, blockHeight, 2.2, 2.2, 'F');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(NAVY_HEX);
  doc.text('Kepada:', blockX + padding, y + padding + 3);

  let cursorY = y + padding + 3 + labelHeight;
  lines.forEach((line, i) => {
    if (i === 0) {
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(NAVY_HEX);
    } else {
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(GRAY_MUTED_HEX);
    }
    doc.text(line, blockX + padding, cursorY);
    cursorY += lineHeight;
  });

  return y + blockHeight + 4;
}

/**
 * Generate the Catatan Pembatalan PDF. Refund block is rendered only when
 * `refund_amount > 0`.
 */
export async function generateCatatanPembatalanPdf(
  order: OrderForPdf,
  settings: StoreSettings,
  _banks: BankAccount[],
  printMode: PdfPrintMode = 'normal',
): Promise<PdfResult> {
  // `_banks` accepted for signature parity; cancellation record never shows
  // bank instructions.
  void _banks;

  const docNumber = await nextInvoiceNumber('CAN');
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
  const dm = printMode === 'dot_matrix';
  const headerFill = dm ? BLACK_RGB : NAVY_RGB;
  const dividerColor = dm ? '#000000' : 'var(--color-caleo-primary)';

  // ----- 1. Header -----
  const issueDate = new Date().toISOString();
  const logoDataUrl = await fetchLogoDataUrl(settings);
  let cursorY = renderHeader(doc, settings, docNumber, issueDate, order.id?.slice(0, 8), printMode, logoDataUrl);

  // ----- 2. Doc title -----
  cursorY = renderDocTitle(doc, 'CATATAN PEMBATALAN', cursorY, printMode);

  // ----- 3. Customer block only -----
  cursorY = renderCustomerOnlyBlock(
    doc,
    {
      name: order.customer,
      phone: order.customer_phone,
      address: order.customer_address,
    },
    cursorY,
  );

  // ----- 4. Original items table -----
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

  cursorY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 5;

  // ----- 5. Pembatalan summary box (light red) -----
  const boxX = MARGIN_MM;
  const boxWidth = PAGE_WIDTH_MM - MARGIN_MM * 2;
  const padding = 3;
  const labelX = boxX + padding;
  const valueX = boxX + padding + 42;
  const valueMaxWidth = boxWidth - padding * 2 - 42;

  const cancelDate = order.cancel_date || '-';
  const cancelledBy = order.cancelled_by || '-';
  const cancelReason = order.cancel_reason || '-';

  // Pre-wrap the reason paragraph so the box auto-sizes.
  doc.setFontSize(9.5);
  const reasonWrapped = doc.splitTextToSize(cancelReason, valueMaxWidth);

  const lineHeight = 5;
  const reasonHeight = Math.max(1, reasonWrapped.length) * lineHeight;
  const summaryHeight = padding * 2 + lineHeight * 2 + reasonHeight + 1;

  doc.setFillColor(CANCEL_BG_HEX);
  doc.setDrawColor(CANCEL_BORDER_HEX);
  doc.setLineWidth(0.3);
  doc.roundedRect(boxX, cursorY, boxWidth, summaryHeight, 2.2, 2.2, 'FD');

  let rowY = cursorY + padding + 3.5;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.setTextColor(CANCEL_TEXT_HEX);
  doc.text('Tanggal Pembatalan:', labelX, rowY);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor('#222222');
  doc.text(cancelDate, valueX, rowY);
  rowY += lineHeight;

  doc.setFont('helvetica', 'bold');
  doc.setTextColor(CANCEL_TEXT_HEX);
  doc.text('Diminta oleh:', labelX, rowY);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor('#222222');
  doc.text(cancelledBy, valueX, rowY);
  rowY += lineHeight;

  doc.setFont('helvetica', 'bold');
  doc.setTextColor(CANCEL_TEXT_HEX);
  doc.text('Alasan:', labelX, rowY);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor('#222222');
  doc.text(reasonWrapped, valueX, rowY);
  rowY += reasonHeight;

  cursorY += summaryHeight + 4;

  // ----- 6. Refund block (only if refund_amount > 0) -----
  const refundAmount = order.refund_amount ?? 0;
  if (refundAmount > 0) {
    const refundMethod = order.refund_method || '-';
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.setTextColor(NAVY_HEX);
    doc.text('Refund Diberikan:', labelX, cursorY);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor('#222222');
    doc.text(formatRupiah(refundAmount, true), valueX, cursorY);
    cursorY += lineHeight;

    doc.setFont('helvetica', 'bold');
    doc.setTextColor(NAVY_HEX);
    doc.text('Metode Refund:', labelX, cursorY);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor('#222222');
    doc.text(refundMethod, valueX, cursorY);
    cursorY += lineHeight;

    doc.setFont('helvetica', 'bold');
    doc.setTextColor(NAVY_HEX);
    doc.text('Bukti Refund:', labelX, cursorY);
    doc.setFont('helvetica', 'italic');
    doc.setTextColor(GRAY_MUTED_HEX);
    doc.text('(terlampir di sistem)', valueX, cursorY);
    cursorY += lineHeight + 2;
  }

  // ----- 7. Footer T&C -----
  renderFooter(doc, 'SYARAT & KETENTUAN', [
    'Catatan ini sebagai bukti audit pembatalan order',
    'Sengketa pembatalan harap diselesaikan secara baik-baik',
    'Refund (jika ada) sudah ditransfer per metode di atas',
  ], printMode);

  const blob = doc.output('blob');
  const filename = `Catatan_Pembatalan_${sanitizeDocNumber(docNumber)}_${customerInitial(order.customer)}.pdf`;

  return { blob, docNumber, filename };
}
