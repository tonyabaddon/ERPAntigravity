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
  drawNavyIcon,
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
    docLabel: 'QUOTATION',
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

  // Signature block reserves ~40mm (Hormat Kami + 3 blank lines + line + name + title).
  // If T&C pushed us too close to the footer band (footer starts at pageHeight-14),
  // force new page + repeat header so signature doesn't overlap footer or draw off-page.
  const SIGNATURE_MIN_HEIGHT_MM = 40;
  const FOOTER_BAND_HEIGHT_MM = 14;  // renderRunningFooter reserves ~14mm at bottom
  const availableSpace = PAGE_BOTTOM_THRESHOLD_MM - y + (297 - PAGE_BOTTOM_THRESHOLD_MM - FOOTER_BAND_HEIGHT_MM);
  if (availableSpace < SIGNATURE_MIN_HEIGHT_MM) {
    y = addPageWithHeader(doc, ctx);
  }
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
  // Match renderPageHeader banner geometry: bannerW=75, right-aligned to page edge
  const bannerX = pageWidth - MARGIN_MM - 75;
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

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(11);
  doc.setTextColor(p.navy);
  doc.text('Kepada Yth,', MARGIN_MM, cursorY);
  cursorY += lineHeight;

  // Salutation + contact person as BOLD NAVY UPPERCASE (matches reference GJP style).
  // Strip leading salutation from contact_person if already prefixed (data-safety).
  if (so.customer_salutation || so.customer_contact_person) {
    let contact = so.customer_contact_person ?? '';
    const salPrefix = so.customer_salutation ? `${so.customer_salutation} ` : '';
    if (salPrefix && contact.toLowerCase().startsWith(salPrefix.toLowerCase())) {
      contact = contact.slice(salPrefix.length);
    }
    const line = [so.customer_salutation, contact].filter(Boolean).join(' ').toUpperCase();
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(p.navy);
    doc.text(line, MARGIN_MM, cursorY);
    cursorY += lineHeight;
  }

  // Company name — only render if it differs from what we already showed above.
  // If no contact-person block was drawn, this becomes the primary bold name.
  const primaryShown = so.customer_salutation || so.customer_contact_person;
  const companyLine = so.customer_company || so.customer_name;
  if (companyLine && (!primaryShown || companyLine !== so.customer_name)) {
    doc.setFont('helvetica', primaryShown ? 'normal' : 'bold');
    doc.setFontSize(11);
    doc.setTextColor(primaryShown ? p.grayMuted : p.navy);
    doc.text(companyLine, MARGIN_MM, cursorY);
    cursorY += lineHeight;
  }

  // WA / phone
  if (so.customer_phone) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(11);
    doc.setTextColor(p.grayMuted);
    doc.text(so.customer_phone, MARGIN_MM, cursorY);
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
  doc.text('NO', colNoX + 1, headerY);
  doc.text('DESCRIPTION', colDescX + 1, headerY);
  if (showManufacture) doc.text('MANUFACTURE', colMerekX + 1, headerY);
  doc.text('QTY', colQtyX + COL_QTY_W / 2, headerY, { align: 'center' });
  doc.text('UNIT PRICE', colUnitPriceX + COL_UNIT_PRICE_W - 1, headerY, { align: 'right' });
  doc.text('TOTAL PRICE', colSubtotalX + COL_SUBTOTAL_W - 1, headerY, { align: 'right' });

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
      doc.text('NO', colNoX + 1, hY);
      doc.text('DESCRIPTION', colDescX + 1, hY);
      if (showManufacture) doc.text('MANUFACTURE', colMerekX + 1, hY);
      doc.text('QTY', colQtyX + COL_QTY_W / 2, hY, { align: 'center' });
      doc.text('UNIT PRICE', colUnitPriceX + COL_UNIT_PRICE_W - 1, hY, { align: 'right' });
      doc.text('TOTAL PRICE', colSubtotalX + COL_SUBTOTAL_W - 1, hY, { align: 'right' });
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

    // Description — item title in bold navy uppercase (matches reference GJP)
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(p.navy);
    doc.text(item.name.toUpperCase(), colDescX + 1, textY);

    // Merek — UPPERCASE brand name (SCHNEIDER, CHINT, etc.)
    if (showManufacture) {
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(p.navy);
      doc.text((item.brand_name ?? '').toUpperCase(), colMerekX + 1, textY);
    }

    // Qty
    doc.setFont('helvetica', 'normal');
    doc.setTextColor('#222222');
    doc.text(String(item.qty), colQtyX + COL_QTY_W / 2, textY, { align: 'center' });

    // Unit price
    const unitPrice = item.unit_price ?? (item.qty > 0 ? item.subtotal / item.qty : item.subtotal);
    doc.text(
      `Rp ${formatRupiah(unitPrice)}`,
      colUnitPriceX + COL_UNIT_PRICE_W - 1,
      textY,
      { align: 'right' },
    );

    // Subtotal — bold navy per reference (emphasized total for the row)
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(p.navy);
    doc.text(`Rp ${formatRupiah(item.subtotal)}`, colSubtotalX + COL_SUBTOTAL_W - 1, textY, {
      align: 'right',
    });

    // Sub-parts — dashed list (matches reference "- Box Panel Indoor Plat 1.2 mm")
    if (item.sub_parts && item.sub_parts.length > 0) {
      let subY = textY + 3.5;
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
        const partLine = qtyUnit ? `-  ${part.name} (${qtyUnit})` : `-  ${part.name}`;
        doc.text(partLine, colDescX + 3, subY);
        subY += 4;
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
  // Full-width bar matching table width (matches reference GJP pale-blue GRAND TOTAL strip)
  const barX = MARGIN_MM;
  const barW = PAGE_WIDTH_MM - MARGIN_MM * 2;
  const valueX = PAGE_WIDTH_MM - MARGIN_MM;

  // Highlighted pale-blue fill spanning full table width
  doc.setFillColor(TOTAL_ROW_BG);
  doc.rect(barX, y, barW, rowH, 'F');

  const textY = y + rowH / 2 + 2;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(p.navy);
  // "GRAND TOTAL" right-aligned near the right edge (matches reference — value follows)
  doc.text('GRAND TOTAL', valueX - 55, textY, { align: 'right' });
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
  const gap = 6;
  const blockW = PAGE_WIDTH_MM - MARGIN_MM * 2;
  const leftW = (blockW - gap) * 0.6;   // T&C box gets 60% (has more content)
  const rightW = blockW - gap - leftW;   // Catatan gets 40%

  // ---- Left: SYARAT & KONDISI PENAWARAN — bordered box with navy header bar + icons ----
  interface Row { icon: 'wallet' | 'clock' | 'calendar' | 'doc'; label: string; text: string[]; }
  const rows: Row[] = [];
  if (paymentTerms) rows.push({ icon: 'wallet', label: 'Cara Pembayaran', text: paymentTerms.split('\n') });
  if (leadTime) rows.push({ icon: 'clock', label: 'Waktu Pengadaan', text: leadTime.split('\n') });
  if (validityDays > 0) rows.push({ icon: 'calendar', label: 'Masa Berlaku Penawaran', text: [`${validityDays} Hari`] });

  const activeAccounts = bankAccounts.filter((b) => b.is_active);
  if (activeAccounts.length > 0) {
    const shown = activeAccounts.slice(0, 3);
    const overflow = activeAccounts.length - shown.length;
    const rekLines: string[] = ['Dapat di transfer ke'];
    for (const acct of shown) {
      rekLines.push(`${acct.bank_name} : ${acct.account_number}`);
      rekLines.push(`a.n. ${acct.account_holder}`);
    }
    if (overflow > 0) rekLines.push(`... dan ${overflow} rekening lainnya`);
    rows.push({ icon: 'doc', label: 'Keterangan', text: rekLines });
  }

  // Left column geometry
  const iconColW = 8;   // navy icon + gap
  const labelColW = 40;  // label + colon column
  const valueColX = MARGIN_MM + iconColW + labelColW + 3;
  const valueColW = leftW - iconColW - labelColW - 6;

  // Header bar height + row layout
  const headerBarH = 6;
  const rowGap = 3;
  const lineH = 4;

  // Pre-measure rows for accurate box height
  const wrappedRows = rows.map((r) => ({
    ...r,
    wrapped: r.text.flatMap((t) => doc.splitTextToSize(t, valueColW) as string[]),
  }));
  const leftContentH = wrappedRows.reduce((sum, r) => sum + Math.max(r.wrapped.length * lineH, 5) + rowGap, 4);
  const leftBoxH = headerBarH + leftContentH + 4;

  // Right column height (Catatan bullets)
  const noteLines = soNotes ? soNotes.split('\n').filter((l) => l.trim()) : [];
  const rightContentH = noteLines.reduce((sum, note) => {
    const wrapped = doc.splitTextToSize(note, rightW - 6) as string[];
    return sum + wrapped.length * lineH + 1;
  }, 6);
  const rightBoxH = Math.max(rightContentH, leftBoxH);

  // ---- Draw LEFT box: SYARAT & KONDISI ----
  const leftX = MARGIN_MM;
  const boxH = Math.max(leftBoxH, rightBoxH);

  // Box border
  doc.setDrawColor(p.hairline);
  doc.setLineWidth(0.4);
  doc.rect(leftX, y, leftW, boxH, 'S');

  // Navy header bar (spans top of the box)
  doc.setFillColor(p.navy);
  doc.rect(leftX, y, leftW, headerBarH, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(255, 255, 255);
  doc.text('SYARAT & KONDISI PENAWARAN', leftX + 3, y + headerBarH / 2 + 1.6);

  // Rows with icons
  let rowY = y + headerBarH + 5;
  for (const r of wrappedRows) {
    const rowMidY = rowY + Math.max(r.wrapped.length * lineH, 5) / 2 - 1;
    // Icon (navy filled circle with white line-art)
    drawNavyIcon(doc, r.icon, leftX + 4.5, rowMidY, 2);
    // Label
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(p.navy);
    doc.text(r.label, leftX + iconColW + 2, rowMidY + 1);
    doc.text(':', leftX + iconColW + labelColW - 2, rowMidY + 1);
    // Value (may span multiple lines)
    doc.setTextColor('#222222');
    r.wrapped.forEach((line, i) => {
      doc.text(line, valueColX, rowY + i * lineH + 1);
    });
    rowY += Math.max(r.wrapped.length * lineH, 5) + rowGap;
  }

  // ---- Draw RIGHT: CATATAN (no border, per reference) ----
  const rightX = leftX + leftW + gap;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(p.navy);
  doc.text('CATATAN :', rightX, y + 4);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor('#222222');
  let noteY = y + 10;
  for (const note of noteLines) {
    const wrapped = doc.splitTextToSize(note, rightW - 6) as string[];
    // Bullet char
    doc.text('•', rightX, noteY);
    wrapped.forEach((line, i) => {
      doc.text(line, rightX + 4, noteY + i * lineH);
    });
    noteY += wrapped.length * lineH + 1;
  }

  return y + boxH + 6;
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
  doc.setTextColor(p.navy);
  doc.text('Hormat Kami,', rightX, cursorY, { align: 'right' });
  cursorY += lineH * 3; // 2 blank lines for signature area

  // Signature placeholder in parens-with-dots style (matches reference GJP)
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(11);
  doc.setTextColor(p.grayMuted);
  doc.text('( ......................................... )', rightX, cursorY, { align: 'right' });
  cursorY += lineH;

  if (name) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(p.navy);
    doc.text(name.toUpperCase(), rightX, cursorY, { align: 'right' });
    cursorY += lineH;
  }
  if (title) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(p.navy);
    doc.text(title.toUpperCase(), rightX, cursorY, { align: 'right' });
    cursorY += lineH;
  }

  return cursorY;
}
