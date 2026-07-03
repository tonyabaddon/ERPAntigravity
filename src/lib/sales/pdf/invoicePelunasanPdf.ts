// Invoice Pelunasan PDF — fourth generator. Issued when the customer pays
// the sisa after a DP (Stage 3 sub-stage 3d/3h → 4). Layout per § Invoice
// Pelunasan in `docs/superpowers/specs/2026-06-18-sales-pdf-layout-design.md`:
// Header → Customer/Pengiriman → Items table → Pelunasan summary box
// (TOTAL ORDER / DP terbayar / Pelunasan amount) → LUNAS banner → footer.

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
const NAVY_HEX = '#012749';
const GREEN_HEX = '#2d8a4e';
const GREEN_BANNER_BG = '#e7f3ec';
const HAIRLINE_HEX = '#d0d7e2';
const GRAY_MUTED_HEX = '#555555';

/**
 * Generate the Invoice Pelunasan PDF. Reads `order.dp_amount` for the recap
 * line and computes the pelunasan amount as `total - dp_amount`.
 */
export async function generateInvoicePelunasanPdf(
  order: OrderForPdf,
  settings: StoreSettings,
  _banks: BankAccount[],
  printMode: PdfPrintMode = 'normal',
): Promise<PdfResult> {
  // `_banks` accepted for signature parity; no bank instruction block here.
  void _banks;

  const docNumber = await nextInvoiceNumber('INV-PEL');
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
  cursorY = renderDocTitle(doc, 'INVOICE PELUNASAN', cursorY, printMode);

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

  // ----- 5. Pelunasan summary box (right-aligned) -----
  const totalsValueX = PAGE_WIDTH_MM - MARGIN_MM;
  const totalsLabelX = PAGE_WIDTH_MM - MARGIN_MM - 70;

  const ongkir = order.ongkir_amount ?? 0;
  const subtotal = items.reduce((acc, it) => acc + (it.subtotal || 0), 0);
  const grandTotal = order.total ?? subtotal + ongkir;
  const dpAmount = order.dp_amount ?? 0;
  const pelunasan = Math.max(0, grandTotal - dpAmount);

  // TOTAL ORDER — navy bold 10pt
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(NAVY_HEX);
  doc.text('TOTAL ORDER', totalsLabelX, cursorY);
  doc.text(formatRupiah(grandTotal, true), totalsValueX, cursorY, { align: 'right' });
  cursorY += 5.5;

  // DP terbayar — muted gray italic 9pt
  doc.setFont('helvetica', 'italic');
  doc.setFontSize(9);
  doc.setTextColor(GRAY_MUTED_HEX);
  doc.text('DP terbayar sebelumnya', totalsLabelX, cursorY);
  doc.text(formatRupiah(dpAmount, true), totalsValueX, cursorY, { align: 'right' });
  cursorY += 5;

  // Hairline divider
  doc.setDrawColor(dm ? '#000000' : HAIRLINE_HEX);
  doc.setLineWidth(0.2);
  doc.line(totalsLabelX, cursorY - 1, totalsValueX, cursorY - 1);
  cursorY += 1;

  // Pelunasan amount — green bold 12pt
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(totalAccent);
  doc.text('Sisa terbayar lunas', totalsLabelX, cursorY + 3);
  doc.text(formatRupiah(pelunasan, true), totalsValueX, cursorY + 3, { align: 'right' });
  cursorY += 10;

  // ----- 6. LUNAS banner -----
  const bannerX = MARGIN_MM;
  const bannerWidth = PAGE_WIDTH_MM - MARGIN_MM * 2;
  const bannerHeight = 11;
  doc.setFillColor(GREEN_BANNER_BG);
  doc.roundedRect(bannerX, cursorY, bannerWidth, bannerHeight, 2.2, 2.2, 'F');

  const bannerText = `✓ LUNAS — sisa diterima ${formatTanggal(issueDate)}`;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10.5);
  doc.setTextColor(NAVY_HEX);
  doc.text(bannerText, bannerX + bannerWidth / 2, cursorY + bannerHeight / 2 + 1.4, {
    align: 'center',
  });
  cursorY += bannerHeight + 4;

  // ----- 7. Footer T&C -----
  renderFooter(doc, 'SYARAT & KETENTUAN', [
    'Invoice ini bersifat pelunasan; sudah memperhitungkan DP sebelumnya',
    'Surat Jalan terlampir / akan menyusul saat barang diserahkan',
    'Klaim garansi mengikuti ketentuan supplier masing-masing',
  ], printMode);

  const blob = doc.output('blob');
  const filename = `Invoice_Pelunasan_${sanitizeDocNumber(docNumber)}_${customerInitial(order.customer)}.pdf`;

  return { blob, docNumber, filename };
}
