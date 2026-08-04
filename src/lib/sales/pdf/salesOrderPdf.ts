// Sales Order (Penawaran Harga) PDF — full layout rewrite matching design spec
// docs/superpowers/specs/2026-08-04-cetak-sales-order-gjp-design.md §5.
// Multi-page with full header repeat on every page. Auto-hides MANUFACTURE column
// when all items have empty brand_name. Backward-compat fallbacks for NULL new fields.

import { jsPDF } from 'jspdf';
import type { DbSalesOrder, KasirItem } from '../../../types';
import type { StoreSettings, BankAccount } from '../../pengaturan/types';
import {
  renderPageHeader,
  addPageWithHeader,
  measureItemRowHeight,
  renderRunningFooter,
  formatTanggal,
  formatRupiah,
  fetchLogoDataUrl,
  paletteFor,
  MARGIN_MM,
  PAGE_WIDTH_MM,
  PAGE_INFO_HALAMAN_Y_OFFSET,
  PAGE_INFO_HALAMAN_X_OFFSET,
  type PageHeaderContext,
} from './common';
import { terbilangRupiah } from '../../terbilang';
import { extractErrorMessage } from '../../extractErrorMessage';

// ============================================================================
// Types
// ============================================================================

/**
 * Extends DbSalesOrder with new Penawaran snapshot + override columns
 * (added in migration 570). All optional so existing usages with the
 * plain DbSalesOrder shape still compile.
 */
export interface SalesOrderForPdf extends DbSalesOrder {
  customer_salutation?: string | null;
  customer_contact_person?: string | null;
  created_by_name?: string | null;
  opening_greeting_override?: string | null;
  payment_terms_override?: string | null;
  lead_time_override?: string | null;
  so_notes_override?: string | null;
  valid_until_override?: string | null; // ISO date YYYY-MM-DD
}

// ============================================================================
// Constants
// ============================================================================

/** Page bottom threshold — leave 30mm for footer + grand total area */
const PAGE_BOTTOM_THRESHOLD_MM = 267;

/** Table column widths (total must be ≤ printable width = 210 − 28 = 182mm) */
const COL_NO_W = 8;
const COL_MEREK_W = 25;
const COL_QTY_W = 16;
const COL_UNIT_PRICE_W = 35;
const COL_SUBTOTAL_W = 35;
// Description column: remaining width (computed dynamically based on showManufacture)

/** Colors */
const TOTAL_ROW_BG = '#eff9f0';    // pale green highlight for grand total row
const SUBPART_COLOR = '#4a5568';   // mid-grey for sub-parts bullets
const TABLE_HEADER_BG = '#012749'; // navy (PALETTE.navy)
const TABLE_BORDER = '#d0d7e2';

// ============================================================================
// Public API
// ============================================================================

/**
 * Generate the Sales Order (Penawaran Harga) PDF.
 * Returns a Blob (application/pdf) directly — the caller decides on filename.
 *
 * @param so            Hydrated SO row including new Penawaran snapshot fields.
 * @param storeSettings Tenant settings (SO defaults + footer config).
 * @param bankAccounts  Active bank accounts for payment instructions.
 * @param options       Optional pre-fetched logoDataUrl (skips fetch if provided).
 */
export async function generateSalesOrderPdf(
  so: SalesOrderForPdf,
  storeSettings: StoreSettings,
  bankAccounts: BankAccount[],
  options: { logoDataUrl?: string } = {},
): Promise<Blob> {
  // Entry log (observability requirement)
  console.info('[sales_order_print]', {
    feature: 'sales_order_print',
    action: 'generate',
    so_number: so.so_number,
    timestamp: new Date().toISOString(),
  });

  try {
    return await _render(so, storeSettings, bankAccounts, options);
  } catch (e) {
    console.error('[sales_order_print:error]', {
      feature: 'sales_order_print',
      error_code: 'render_failed',
      error_message: extractErrorMessage(e),
      so_number: so?.so_number,
    });
    throw e;
  }
}

// ============================================================================
// Internal render (separated so try/catch wraps everything cleanly)
// ============================================================================

async function _render(
  so: SalesOrderForPdf,
  storeSettings: StoreSettings,
  bankAccounts: BankAccount[],
  options: { logoDataUrl?: string },
): Promise<Blob> {
  const doc = new jsPDF({ format: 'a4', unit: 'mm', orientation: 'portrait' });
  const logo = options.logoDataUrl !== undefined
    ? options.logoDataUrl
    : await fetchLogoDataUrl(storeSettings);

  // ---- Resolve text fields (override → default → fallback) ----
  const validityDays = storeSettings.default_so_validity_days ?? 14;
  const soDate = new Date(so.date);
  const defaultValidUntil = new Date(soDate.getTime() + validityDays * 86_400_000);
  const validUntil = so.valid_until_override
    ? new Date(so.valid_until_override)
    : defaultValidUntil;

  const openingGreeting =
    so.opening_greeting_override ?? storeSettings.default_opening_greeting ?? '';
  const paymentTerms =
    so.payment_terms_override ?? storeSettings.default_payment_terms ?? '';
  const leadTime =
    so.lead_time_override ?? storeSettings.default_lead_time_text ?? '';
  const soNotes = so.so_notes_override ?? storeSettings.default_so_notes ?? '';
  const signatoryName =
    so.created_by_name ?? storeSettings.default_signatory_name ?? '';
  const signatoryTitle = storeSettings.default_signatory_title ?? '';

  // ---- MANUFACTURE column: auto-hide when all items have empty brand_name ----
  const items: KasirItem[] = Array.isArray(so.items) ? so.items : [];
  const showManufacture = items.some(
    (i) => typeof i.brand_name === 'string' && i.brand_name.trim().length > 0,
  );

  // ---- Page header context (totalPages placeholder → overlaid post-render) ----
  const ctx: PageHeaderContext = {
    store: storeSettings,
    logoDataUrl: logo,
    docLabel: 'PENAWARAN HARGA',
    docNumber: so.so_number,
    docDate: formatTanggal(so.date),
    validUntil: formatTanggal(validUntil.toISOString()),
    pageNumber: 1,
    totalPages: 0, // placeholder — overlaid after all pages are rendered
  };

  // ---- Single-pass render ----
  let y = renderPageHeader(doc, ctx);

  y = renderRecipient(doc, y, so);
  y = renderOpeningGreeting(doc, y, openingGreeting);
  y = renderItemsTable(doc, y, items, showManufacture, ctx);
  y = renderGrandTotalRow(doc, y, so.subtotal);
  y = renderTerbilang(doc, y, so.subtotal);
  y = renderTermsAndNotes(
    doc, y, paymentTerms, leadTime, validityDays, bankAccounts, soNotes,
  );
  renderSignature(doc, y, signatoryName, signatoryTitle);

  // ---- Overlay true page numbers + running footer on ALL pages ----
  const totalPages = doc.getNumberOfPages();
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p);
    overlayPageNumber(doc, p, totalPages);
    renderRunningFooter(doc, storeSettings);
  }

  return doc.output('blob');
}

// ============================================================================
// Helper: overlayPageNumber
// ============================================================================

/**
 * Draw "N dari M" over the Halaman placeholder left by renderPageHeader.
 * Absolute X = bannerX + PAGE_INFO_HALAMAN_X_OFFSET
 *            = (pageWidth - 65) + PAGE_INFO_HALAMAN_X_OFFSET
 */
function overlayPageNumber(doc: jsPDF, page: number, total: number): void {
  const pageWidth = doc.internal.pageSize.getWidth();
  const bannerX = pageWidth - 65;
  const y = PAGE_INFO_HALAMAN_Y_OFFSET;
  doc.setFontSize(11);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(0, 0, 0);
  doc.text(`${page} dari ${total}`, bannerX + PAGE_INFO_HALAMAN_X_OFFSET, y);
}

// ============================================================================
// Helper: renderRecipient
// ============================================================================

/**
 * Draw the "Kepada Yth." block — salutation + company + WA.
 * Handles NULL salutation / contact_person gracefully.
 */
function renderRecipient(doc: jsPDF, y: number, so: SalesOrderForPdf): number {
  const p = paletteFor('normal');
  const lineHeight = 5;
  let cursorY = y + 2;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(p.navy);
  doc.text('Kepada Yth.', MARGIN_MM, cursorY);
  cursorY += lineHeight;

  // Salutation + contact person (if available)
  if (so.customer_salutation || so.customer_contact_person) {
    const line = [so.customer_salutation, so.customer_contact_person]
      .filter(Boolean)
      .join(' ');
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(11);
    doc.setTextColor(p.grayMuted);
    doc.text(line, MARGIN_MM, cursorY);
    cursorY += lineHeight;
  }

  // Company name (customer_company or customer_name)
  const companyLine = so.customer_company || so.customer_name;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(p.navy);
  doc.text(companyLine, MARGIN_MM, cursorY);
  cursorY += lineHeight;

  // WA / phone
  if (so.customer_phone) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(11);
    doc.setTextColor(p.grayMuted);
    doc.text(`WA: ${so.customer_phone}`, MARGIN_MM, cursorY);
    cursorY += lineHeight;
  }

  return cursorY + 3;
}

// ============================================================================
// Helper: renderOpeningGreeting
// ============================================================================

/**
 * Draw the opening greeting text with word-wrap. Skipped when greeting is empty.
 */
function renderOpeningGreeting(doc: jsPDF, y: number, greeting: string): number {
  if (!greeting || greeting.trim().length === 0) return y;

  const p = paletteFor('normal');
  const maxWidth = PAGE_WIDTH_MM - MARGIN_MM * 2;
  const lines = doc.splitTextToSize(greeting, maxWidth) as string[];

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(11);
  doc.setTextColor(p.grayMuted);
  doc.text(lines, MARGIN_MM, y + 3);

  return y + 3 + lines.length * 5 + 4;
}

// ============================================================================
// Helper: renderItemsTable
// ============================================================================

/**
 * Draw the items table with optional MANUFACTURE column.
 * Paginates via addPageWithHeader when content would overflow the page.
 * Items are never split across pages — forced to next page as a unit.
 * Sub-parts rendered as 9pt mid-grey bullets under the item description.
 */
function renderItemsTable(
  doc: jsPDF,
  y: number,
  items: KasirItem[],
  showManufacture: boolean,
  ctx: PageHeaderContext,
): number {
  const p = paletteFor('normal');

  // ---- Column layout ----
  const printableWidth = PAGE_WIDTH_MM - MARGIN_MM * 2;
  const fixedWidth = COL_NO_W + COL_QTY_W + COL_UNIT_PRICE_W + COL_SUBTOTAL_W
    + (showManufacture ? COL_MEREK_W : 0);
  const descW = printableWidth - fixedWidth;

  const colNoX = MARGIN_MM;
  const colDescX = colNoX + COL_NO_W;
  const colMerekX = colDescX + descW;
  const colQtyX = colMerekX + (showManufacture ? COL_MEREK_W : 0);
  const colUnitPriceX = colQtyX + COL_QTY_W;
  const colSubtotalX = colUnitPriceX + COL_UNIT_PRICE_W;
  const tableRightX = colSubtotalX + COL_SUBTOTAL_W;

  // ---- Draw header row ----
  const headerH = 7;
  doc.setFillColor(TABLE_HEADER_BG);
  doc.rect(MARGIN_MM, y, printableWidth, headerH, 'F');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(255, 255, 255);

  const headerY = y + headerH / 2 + 1.8;
  doc.text('No', colNoX + 1, headerY);
  doc.text('Deskripsi Produk', colDescX + 1, headerY);
  if (showManufacture) doc.text('Merek', colMerekX + 1, headerY);
  doc.text('Qty', colQtyX + COL_QTY_W / 2, headerY, { align: 'center' });
  doc.text('Harga Satuan', colUnitPriceX + COL_UNIT_PRICE_W - 1, headerY, { align: 'right' });
  doc.text('Total', colSubtotalX + COL_SUBTOTAL_W - 1, headerY, { align: 'right' });

  y += headerH;

  // ---- Draw rows ----
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const rowH = measureItemRowHeight(doc, item, {
      rowFontSize: 10,
      subPartFontSize: 9,
      lineHeight: 4.5,
      padVertical: 2,
    });

    // Check if item fits; if not, start new page + re-draw header
    if (y + rowH > PAGE_BOTTOM_THRESHOLD_MM) {
      y = addPageWithHeader(doc, ctx);
      // Re-draw table header on new page
      doc.setFillColor(TABLE_HEADER_BG);
      doc.rect(MARGIN_MM, y, printableWidth, headerH, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10);
      doc.setTextColor(255, 255, 255);
      const hY = y + headerH / 2 + 1.8;
      doc.text('No', colNoX + 1, hY);
      doc.text('Deskripsi Produk', colDescX + 1, hY);
      if (showManufacture) doc.text('Merek', colMerekX + 1, hY);
      doc.text('Qty', colQtyX + COL_QTY_W / 2, hY, { align: 'center' });
      doc.text('Harga Satuan', colUnitPriceX + COL_UNIT_PRICE_W - 1, hY, { align: 'right' });
      doc.text('Total', colSubtotalX + COL_SUBTOTAL_W - 1, hY, { align: 'right' });
      y += headerH;
    }

    // Row background (alternating stripe)
    if (i % 2 === 0) {
      doc.setFillColor('#f8faff');
      doc.rect(MARGIN_MM, y, printableWidth, rowH, 'F');
    }

    // Row border
    doc.setDrawColor(TABLE_BORDER);
    doc.setLineWidth(0.15);
    doc.rect(MARGIN_MM, y, printableWidth, rowH, 'S');

    // Row text
    const textY = y + 2 + 3.5; // padVertical(2) + line baseline
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(p.navy);

    // No.
    doc.text(String(i + 1), colNoX + 1, textY);

    // Description
    doc.setTextColor('#222222');
    doc.text(item.name, colDescX + 1, textY);

    // Merek
    if (showManufacture) {
      doc.setTextColor(p.grayMuted);
      doc.text(item.brand_name ?? '', colMerekX + 1, textY);
    }

    // Qty
    doc.setTextColor('#222222');
    doc.text(String(item.qty), colQtyX + COL_QTY_W / 2, textY, { align: 'center' });

    // Unit price
    const unitPrice = item.unit_price ?? (item.qty > 0 ? item.subtotal / item.qty : item.subtotal);
    doc.text(
      formatRupiah(unitPrice),
      colUnitPriceX + COL_UNIT_PRICE_W - 1,
      textY,
      { align: 'right' },
    );

    // Subtotal
    doc.text(formatRupiah(item.subtotal), colSubtotalX + COL_SUBTOTAL_W - 1, textY, {
      align: 'right',
    });

    // Sub-parts bullets (9pt mid-grey)
    if (item.sub_parts && item.sub_parts.length > 0) {
      let subY = textY + 4.5;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.setTextColor(SUBPART_COLOR);
      for (const part of item.sub_parts) {
        const qtyUnit = [
          part.qty !== undefined ? String(part.qty) : null,
          part.unit ?? null,
        ]
          .filter(Boolean)
          .join(' ');
        const partLine = qtyUnit ? `• ${part.name} (${qtyUnit})` : `• ${part.name}`;
        doc.text(partLine, colDescX + 3, subY);
        subY += 9 * 1.15;
      }
    }

    y += rowH;
  }

  // Bottom border on entire table
  doc.setDrawColor(TABLE_BORDER);
  doc.setLineWidth(0.3);
  doc.line(MARGIN_MM, y, tableRightX, y);

  return y + 2;
}

// ============================================================================
// Helper: renderGrandTotalRow
// ============================================================================

/**
 * Draw the highlighted Grand Total row right-aligned on the current page.
 * Returns Y after the row.
 */
function renderGrandTotalRow(doc: jsPDF, y: number, subtotal: number): number {
  const p = paletteFor('normal');
  const rowH = 9;
  const labelX = PAGE_WIDTH_MM - MARGIN_MM - 100;
  const valueX = PAGE_WIDTH_MM - MARGIN_MM;
  const rowW = 100;

  // Highlighted fill
  doc.setFillColor(TOTAL_ROW_BG);
  doc.rect(labelX, y, rowW, rowH, 'F');

  // Border
  doc.setDrawColor(p.navy);
  doc.setLineWidth(0.4);
  doc.rect(labelX, y, rowW, rowH, 'S');

  const textY = y + rowH / 2 + 2;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(p.navy);
  doc.text('GRAND TOTAL', labelX + 3, textY);

  doc.setFontSize(11);
  doc.text(`Rp ${formatRupiah(subtotal)}`, valueX - 3, textY, { align: 'right' });

  return y + rowH + 3;
}

// ============================================================================
// Helper: renderTerbilang
// ============================================================================

/**
 * Draw "Terbilang: <words>" in italic below the Grand Total row.
 */
function renderTerbilang(doc: jsPDF, y: number, subtotal: number): number {
  const p = paletteFor('normal');
  const words = terbilangRupiah(subtotal < 0 ? 0 : subtotal);
  const maxWidth = PAGE_WIDTH_MM - MARGIN_MM * 2;
  const line = `Terbilang: ${words}`;
  const wrapped = doc.splitTextToSize(line, maxWidth) as string[];

  doc.setFont('helvetica', 'italic');
  doc.setFontSize(10);
  doc.setTextColor(p.grayMuted);
  doc.text(wrapped, MARGIN_MM, y + 2);

  return y + 2 + wrapped.length * 4.5 + 4;
}

// ============================================================================
// Helper: renderTermsAndNotes
// ============================================================================

/**
 * Draw two-column side-by-side box:
 * Left — T&C list (payment terms, lead time, validity, bank rekening — up to
 *   3 active accounts + "... dan N lainnya" overflow message).
 * Right — Catatan / SO notes text.
 *
 * Falls back gracefully when any field is empty/null.
 */
function renderTermsAndNotes(
  doc: jsPDF,
  y: number,
  paymentTerms: string,
  leadTime: string,
  validityDays: number,
  bankAccounts: BankAccount[],
  soNotes: string,
): number {
  const p = paletteFor('normal');
  const padding = 3;
  const colGap = 4;
  const blockW = PAGE_WIDTH_MM - MARGIN_MM * 2;
  const colW = (blockW - colGap) / 2;
  const lineH = 4.5;
  const labelH = 5.5;

  // ---- Build left column lines ----
  const leftLines: string[] = [];

  if (paymentTerms) {
    leftLines.push('Syarat Pembayaran:');
    const wrapped = doc.splitTextToSize(paymentTerms, colW - padding * 2) as string[];
    leftLines.push(...wrapped.map((l: string) => `  ${l}`));
  }
  if (leadTime) {
    if (leftLines.length) leftLines.push('');
    leftLines.push('Waktu Pengerjaan:');
    const wrapped = doc.splitTextToSize(leadTime, colW - padding * 2) as string[];
    leftLines.push(...wrapped.map((l: string) => `  ${l}`));
  }
  if (validityDays > 0) {
    if (leftLines.length) leftLines.push('');
    leftLines.push(`Berlaku: ${validityDays} hari`);
  }

  // Bank accounts (soft-cap at 3)
  const activeAccounts = bankAccounts.filter((b) => b.is_active);
  if (activeAccounts.length > 0) {
    if (leftLines.length) leftLines.push('');
    leftLines.push('Rekening Pembayaran:');
    const shown = activeAccounts.slice(0, 3);
    const overflow = activeAccounts.length - shown.length;
    for (const acct of shown) {
      leftLines.push(`  ${acct.bank_name} · ${acct.account_number}`);
      leftLines.push(`  a.n. ${acct.account_holder}`);
    }
    if (overflow > 0) {
      leftLines.push(`  ... dan ${overflow} rekening lainnya`);
    }
  }

  // ---- Build right column lines ----
  const rightLines: string[] = [];
  if (soNotes) {
    rightLines.push('Catatan:');
    const noteLines = soNotes.split('\n');
    for (const noteLine of noteLines) {
      const wrapped = doc.splitTextToSize(noteLine, colW - padding * 2) as string[];
      rightLines.push(...wrapped.map((l: string) => `  ${l}`));
    }
  }

  // ---- Box height ----
  const contentLines = Math.max(leftLines.length, rightLines.length, 1);
  const boxH = padding * 2 + labelH + contentLines * lineH;

  // Box border
  doc.setDrawColor(p.hairline);
  doc.setLineWidth(0.3);
  doc.rect(MARGIN_MM, y, blockW, boxH, 'S');

  // Vertical divider between left and right columns
  const divX = MARGIN_MM + colW;
  doc.line(divX, y, divX, y + boxH);

  // Draw left column
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(p.grayMuted);
  let leftY = y + padding + lineH;
  for (const line of leftLines) {
    if (line === '') { leftY += lineH / 2; continue; }
    const isBold = !line.startsWith(' ');
    doc.setFont('helvetica', isBold ? 'bold' : 'normal');
    doc.setTextColor(isBold ? p.navy : p.grayMuted);
    doc.text(line.trimStart(), MARGIN_MM + padding, leftY);
    leftY += lineH;
  }

  // Draw right column
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  let rightY = y + padding + lineH;
  for (const line of rightLines) {
    if (line === '') { rightY += lineH / 2; continue; }
    const isBold = !line.startsWith(' ');
    doc.setFont('helvetica', isBold ? 'bold' : 'normal');
    doc.setTextColor(isBold ? p.navy : p.grayMuted);
    doc.text(line.trimStart(), divX + padding, rightY);
    rightY += lineH;
  }

  return y + boxH + 4;
}

// ============================================================================
// Helper: renderSignature
// ============================================================================

/**
 * Draw the signature block right-aligned at the bottom:
 *   "Hormat Kami,"
 *   [3 blank lines — space for handwritten signature]
 *   ________________
 *   name
 *   title
 *
 * Returns Y after the block (though callers typically don't continue after).
 */
function renderSignature(
  doc: jsPDF,
  y: number,
  name: string,
  title: string,
): number {
  const p = paletteFor('normal');
  const rightX = PAGE_WIDTH_MM - MARGIN_MM;
  const lineH = 5;
  let cursorY = y + 4;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(11);
  doc.setTextColor(p.grayMuted);
  doc.text('Hormat Kami,', rightX, cursorY, { align: 'right' });
  cursorY += lineH * 4; // 3 blank lines for signature area

  // Signature underline
  const lineWidth = 60;
  const lineX = rightX - lineWidth;
  doc.setDrawColor(p.navy);
  doc.setLineWidth(0.5);
  doc.line(lineX, cursorY, rightX, cursorY);
  cursorY += lineH;

  if (name) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(p.navy);
    doc.text(name, rightX, cursorY, { align: 'right' });
    cursorY += lineH;
  }
  if (title) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(p.grayMuted);
    doc.text(title, rightX, cursorY, { align: 'right' });
    cursorY += lineH;
  }

  return cursorY;
}
