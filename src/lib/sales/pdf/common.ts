// Shared layout primitives for the Phase 1B sales PDFs. The spec
// (`docs/superpowers/specs/2026-06-18-sales-pdf-layout-design.md`) is the
// authoritative source for colors, fonts, and section structure. Every
// generator (`salesOrderPdf.ts` and the five PDFs added in PR B/2) calls into
// these helpers so the visual identity stays consistent.
//
// Unit convention: jsPDF is initialised with `unit: 'mm'` by the callers, so
// all geometry constants here are millimetres. Font sizes are always in
// points (jsPDF accepts pt regardless of doc unit), which is what the spec
// uses.
//
// Hex colors are passed directly — jsPDF v2.5 accepts strings.

import type { jsPDF } from 'jspdf';
import type { StoreSettings, BankAccount } from '../../pengaturan/types';

// ---------- Page geometry ----------

export const PAGE_WIDTH_MM = 210; // A4 portrait
export const PAGE_HEIGHT_MM = 297;
export const MARGIN_MM = 14;

// ---------- Brand palette ----------

const COLOR_NAVY = '#012749';
const COLOR_GREEN = '#2d8a4e';
const COLOR_GRAY_MUTED = '#555555';
const COLOR_GRAY_FOOTER = '#888888';
const COLOR_CALLOUT_BG = '#eff4ff';
const COLOR_BANK_BORDER = '#c7d7f5';
const COLOR_BANK_BG = '#fafbff';
const COLOR_WHITE = '#ffffff';
const COLOR_HAIRLINE = '#d0d7e2';

// ---------- Formatters ----------

const MONTHS_ID = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
];

/** Helper — Indonesian long-form date string from ISO/Date (`19 Juni 2026`). */
export function formatTanggal(d: Date | string): string {
  const date = typeof d === 'string' ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return '—';
  return `${date.getDate()} ${MONTHS_ID[date.getMonth()]} ${date.getFullYear()}`;
}

/** Helper — Rupiah formatted with thousand separators; optional `Rp` prefix. */
export function formatRupiah(n: number, withPrefix: boolean = false): string {
  const safe = Number.isFinite(n) ? Math.round(n) : 0;
  const formatted = safe.toLocaleString('id-ID');
  return withPrefix ? `Rp ${formatted}` : formatted;
}

// ---------- Header ----------

const LOGO_SIZE_MM = 21;          // ~60pt rounded square
const HEADER_TOP_MM = MARGIN_MM;
const DIVIDER_GAP_MM = 4;         // space between text block and underline
const DIVIDER_WEIGHT_MM = 0.7;    // ~2pt — jsPDF setLineWidth uses doc unit

/**
 * Render the header band: logo (or 2-letter initial fallback) + company
 * info on the left, doc number + issue date (+ optional order short ID) on
 * the right. Closes with a navy underline. Returns the y-coordinate just
 * below the divider where body content should start.
 *
 * `settings.logo_url` rendering is deferred to Phase 1C (needs data-URL
 * fetch from Supabase Storage). Until then we always fall back to the
 * initial box, which keeps the generator synchronous and dependency-free.
 */
export function renderHeader(
  doc: jsPDF,
  settings: StoreSettings,
  docNumber: string,
  isoDate: string,
  orderShortId?: string,
): number {
  // --- Logo box (always initial fallback for now) ---
  const logoX = MARGIN_MM;
  const logoY = HEADER_TOP_MM;
  doc.setDrawColor(COLOR_NAVY);
  doc.setFillColor(COLOR_NAVY);
  doc.roundedRect(logoX, logoY, LOGO_SIZE_MM, LOGO_SIZE_MM, 2.2, 2.2, 'F');

  const initial = (settings.nama_toko || '??').slice(0, 2).toUpperCase();
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.setTextColor(COLOR_WHITE);
  // approximate vertical centre (Helvetica baseline sits ~70% down the box)
  doc.text(initial, logoX + LOGO_SIZE_MM / 2, logoY + LOGO_SIZE_MM / 2 + 2.6, {
    align: 'center',
  });

  // --- Company info (right of logo) ---
  const infoX = logoX + LOGO_SIZE_MM + 4;
  let infoY = logoY + 5;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(COLOR_NAVY);
  doc.text(settings.nama_toko || '—', infoX, infoY);
  infoY += 5;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(COLOR_GRAY_MUTED);

  // Address: wrap to remaining width before the right column starts
  const rightColumnStart = PAGE_WIDTH_MM - MARGIN_MM - 60;
  const addressMaxWidth = Math.max(50, rightColumnStart - infoX - 4);
  const addressParts: string[] = [];
  if (settings.alamat_lengkap) addressParts.push(settings.alamat_lengkap);
  if (settings.kota) addressParts.push(settings.kota);
  const addressLine = addressParts.join(', ');
  if (addressLine) {
    const wrapped = doc.splitTextToSize(addressLine, addressMaxWidth);
    doc.text(wrapped, infoX, infoY);
    infoY += wrapped.length * 4;
  }
  if (settings.telp_wa) {
    doc.text(`Telp/WA: ${settings.telp_wa}`, infoX, infoY);
    infoY += 4;
  }

  // --- Right column: doc number + date + optional order ID ---
  const rightX = PAGE_WIDTH_MM - MARGIN_MM;
  let rightY = logoY + 5;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(COLOR_NAVY);
  doc.text(docNumber, rightX, rightY, { align: 'right' });
  rightY += 5;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(COLOR_GRAY_MUTED);
  doc.text(formatTanggal(isoDate), rightX, rightY, { align: 'right' });
  rightY += 4;

  if (orderShortId) {
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(8.5);
    doc.setTextColor(COLOR_GRAY_FOOTER);
    doc.text(`Order #${orderShortId}`, rightX, rightY, { align: 'right' });
    rightY += 4;
  }

  // --- Divider just below whichever side is taller ---
  const stackBottom = Math.max(infoY, rightY, logoY + LOGO_SIZE_MM);
  const dividerY = stackBottom + DIVIDER_GAP_MM;
  doc.setDrawColor(COLOR_NAVY);
  doc.setLineWidth(DIVIDER_WEIGHT_MM);
  doc.line(MARGIN_MM, dividerY, PAGE_WIDTH_MM - MARGIN_MM, dividerY);

  return dividerY + 5;
}

// ---------- Doc title ----------

/**
 * Render the centered doc title (e.g. "PESANAN PENJUALAN") in 14pt navy
 * bold. Returns the y-coordinate to continue body content from.
 */
export function renderDocTitle(doc: jsPDF, title: string, y: number): number {
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.setTextColor(COLOR_NAVY);
  doc.text(title, PAGE_WIDTH_MM / 2, y + 5, { align: 'center' });
  return y + 11;
}

// ---------- Customer + Pengiriman block ----------

/**
 * Render the two-column callout — "Kepada:" on the left, "Pengiriman:" on
 * the right — with the spec's pale blue fill and rounded corners.
 */
export function renderCustomerBlock(
  doc: jsPDF,
  customer: { name: string; phone?: string; address?: string },
  delivery: { method: string; destination?: string },
  y: number,
): number {
  const blockX = MARGIN_MM;
  const blockWidth = PAGE_WIDTH_MM - MARGIN_MM * 2;
  const padding = 3; // ~8pt
  const colGap = 6;
  const colWidth = (blockWidth - padding * 2 - colGap) / 2;

  // Pre-compute content height (max of two columns)
  const labelHeight = 4.5;
  const lineHeight = 4.2;

  const leftLines: string[] = [];
  leftLines.push(customer.name || '—');
  if (customer.phone) leftLines.push(customer.phone);
  if (customer.address) {
    const wrapped = doc.splitTextToSize(customer.address, colWidth);
    leftLines.push(...wrapped);
  }

  const rightLines: string[] = [];
  rightLines.push(delivery.method || '—');
  if (delivery.destination) {
    const wrapped = doc.splitTextToSize(delivery.destination, colWidth);
    rightLines.push(...wrapped);
  }

  const contentLines = Math.max(leftLines.length, rightLines.length);
  const blockHeight = padding * 2 + labelHeight + contentLines * lineHeight + 1;

  // Background
  doc.setFillColor(COLOR_CALLOUT_BG);
  doc.roundedRect(blockX, y, blockWidth, blockHeight, 2.2, 2.2, 'F');

  // Labels
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(COLOR_NAVY);
  doc.text('Kepada:', blockX + padding, y + padding + 3);
  doc.text('Pengiriman:', blockX + padding + colWidth + colGap, y + padding + 3);

  // Left column content
  doc.setFontSize(9.5);
  doc.setTextColor(COLOR_GRAY_MUTED);
  let leftY = y + padding + 3 + labelHeight;
  leftLines.forEach((line, i) => {
    if (i === 0) {
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(COLOR_NAVY);
    } else {
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(COLOR_GRAY_MUTED);
    }
    doc.text(line, blockX + padding, leftY);
    leftY += lineHeight;
  });

  // Right column content
  let rightY = y + padding + 3 + labelHeight;
  rightLines.forEach((line, i) => {
    if (i === 0) {
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(COLOR_NAVY);
    } else {
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(COLOR_GRAY_MUTED);
    }
    doc.text(line, blockX + padding + colWidth + colGap, rightY);
    rightY += lineHeight;
  });

  return y + blockHeight + 4;
}

// ---------- Bank instruction block ----------

/**
 * Render the "Cara Pembayaran:" block — header line plus one boxed row per
 * active bank account. Falls back to a single gray italic line when the
 * caller passes an empty list.
 */
export function renderBankBlock(doc: jsPDF, banks: BankAccount[], y: number): number {
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.setTextColor(COLOR_NAVY);
  doc.text('Cara Pembayaran:', MARGIN_MM, y + 3);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(COLOR_GRAY_MUTED);
  doc.text('Transfer ke salah satu rekening berikut:', MARGIN_MM + 32, y + 3);

  let cursorY = y + 6;

  if (!banks || banks.length === 0) {
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(9);
    doc.setTextColor(COLOR_GRAY_FOOTER);
    doc.text('Hubungi admin untuk info rekening.', MARGIN_MM, cursorY + 3);
    return cursorY + 7;
  }

  const rowHeight = 7;
  const rowWidth = PAGE_WIDTH_MM - MARGIN_MM * 2;
  const padding = 2.2;

  for (const bank of banks) {
    doc.setFillColor(COLOR_BANK_BG);
    doc.setDrawColor(COLOR_BANK_BORDER);
    doc.setLineWidth(0.3);
    doc.roundedRect(MARGIN_MM, cursorY, rowWidth, rowHeight, 1.4, 1.4, 'FD');

    const textY = cursorY + rowHeight / 2 + 1.4;

    // Bold bank name
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.setTextColor(COLOR_NAVY);
    doc.text(bank.bank_name, MARGIN_MM + padding + 1, textY);
    const bankNameWidth = doc.getTextWidth(bank.bank_name);

    // Separator dot + "No. " label
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(COLOR_GRAY_MUTED);
    let xCursor = MARGIN_MM + padding + 1 + bankNameWidth + 2;
    doc.text(' · No. ', xCursor, textY);
    xCursor += doc.getTextWidth(' · No. ');

    // Bold account number
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(COLOR_NAVY);
    doc.text(bank.account_number, xCursor, textY);
    xCursor += doc.getTextWidth(bank.account_number);

    // "a.n. <holder>"
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(COLOR_GRAY_MUTED);
    doc.text(` · a.n. ${bank.account_holder}`, xCursor, textY);

    cursorY += rowHeight + 1.5;
  }

  return cursorY + 2;
}

// ---------- Footer ----------

const FOOTER_BAND_OFFSET_MM = 28; // distance from page bottom to start of footer

/**
 * Render the footer band pinned to the bottom of the page: heading + the
 * supplied T&C bullets + an auto-print tagline on the right. Always called
 * last so it ignores the running body cursor.
 */
export function renderFooter(
  doc: jsPDF,
  heading: string,
  tcLines: string[],
): void {
  const startY = PAGE_HEIGHT_MM - FOOTER_BAND_OFFSET_MM;

  // Hairline divider above footer band
  doc.setDrawColor(COLOR_HAIRLINE);
  doc.setLineWidth(0.2);
  doc.line(MARGIN_MM, startY, PAGE_WIDTH_MM - MARGIN_MM, startY);

  // Heading
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(COLOR_NAVY);
  doc.text(heading, MARGIN_MM, startY + 4.5);

  // Bullets
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(COLOR_GRAY_MUTED);
  let bulletY = startY + 9;
  for (const line of tcLines) {
    doc.text(`•  ${line}`, MARGIN_MM + 2, bulletY);
    bulletY += 4;
  }

  // Tagline (right-aligned)
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(COLOR_GRAY_FOOTER);
  const tagline = `Dicetak otomatis · ${formatTanggal(new Date())}`;
  doc.text(tagline, PAGE_WIDTH_MM - MARGIN_MM, PAGE_HEIGHT_MM - MARGIN_MM, {
    align: 'right',
  });
}
