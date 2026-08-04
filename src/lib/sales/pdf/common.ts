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

// ---------- Print mode ----------

/**
 * Toggle between the brand-colored A4 layout ('normal') and a monochrome
 * variant tuned for Epson LX-310 / LX-2190 impact printers ('dot_matrix').
 * Dot-matrix mode drops all color fills (they waste ribbon and render as
 * raster smudges on impact printers) and forces every stroke/text to pure
 * black, keeping the same page geometry so operators can swap paper without
 * re-teaching the layout.
 */
export type PdfPrintMode = 'normal' | 'dot_matrix';

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

// Mono palette for dot-matrix: pure black text + strokes, no fills.
const DM_BLACK = '#000000';
const DM_WHITE = '#ffffff';

interface Palette {
  navy: string;
  green: string;
  grayMuted: string;
  grayFooter: string;
  calloutBg: string;
  bankBorder: string;
  bankBg: string;
  white: string;
  hairline: string;
  /** Whether callers should skip fill on rectangles (dot-matrix rides on ribbon-saving mono). */
  noFill: boolean;
}

export function paletteFor(mode: PdfPrintMode = 'normal'): Palette {
  if (mode === 'dot_matrix') {
    return {
      navy: DM_BLACK,
      green: DM_BLACK,
      grayMuted: DM_BLACK,
      grayFooter: DM_BLACK,
      calloutBg: DM_WHITE,
      bankBorder: DM_BLACK,
      bankBg: DM_WHITE,
      white: DM_WHITE,
      hairline: DM_BLACK,
      noFill: true,
    };
  }
  return {
    navy: COLOR_NAVY,
    green: COLOR_GREEN,
    grayMuted: COLOR_GRAY_MUTED,
    grayFooter: COLOR_GRAY_FOOTER,
    calloutBg: COLOR_CALLOUT_BG,
    bankBorder: COLOR_BANK_BORDER,
    bankBg: COLOR_BANK_BG,
    white: COLOR_WHITE,
    hairline: COLOR_HAIRLINE,
    noFill: false,
  };
}

// ---------- Logo fetch ----------

/**
 * Fetch `settings.logo_url` and convert to a base64 data-URL for jsPDF.addImage.
 * jsPDF cannot pull a remote URL directly (no XHR path in its addImage), and we
 * don't want to embed a `<img>` node in a background PDF generator, so we do
 * the fetch + FileReader dance here. Returns null on any error (missing URL,
 * CORS failure, non-image response, oversized asset). Callers fall back to the
 * initial box, so a bad logo url never blocks doc generation.
 *
 * Called once per PDF (not per page), so overhead is acceptable even for
 * multi-MB PNG logos — but recommend keeping logos ≤ 200×200 px @ ≤ 200 KB
 * to keep the resulting PDFs slim enough to email.
 */
export async function fetchLogoDataUrl(settings: StoreSettings): Promise<string | null> {
  if (!settings.logo_url) return null;
  try {
    const res = await fetch(settings.logo_url);
    if (!res.ok) return null;
    const blob = await res.blob();
    // Guard: refuse to embed anything huge — jsPDF crawls on very large images.
    if (blob.size > 2 * 1024 * 1024) {
      console.warn('logo_url exceeds 2MB, skipping — upload a smaller image');
      return null;
    }
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  } catch (err) {
    console.warn('logo fetch failed, using initial fallback', err);
    return null;
  }
}

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

/** Replace `/` with `-` so the doc number is safe to drop into a filename. */
export function sanitizeDocNumber(docNumber: string): string {
  return docNumber.replace(/\//g, '-');
}

/** Two-letter uppercase initial from the customer name (`Jenny` → `JE`). */
export function customerInitial(name: string): string {
  return (name || 'XX').slice(0, 2).toUpperCase();
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
  mode: PdfPrintMode = 'normal',
  logoDataUrl?: string | null,
): number {
  const p = paletteFor(mode);
  // --- Logo ---
  const logoX = MARGIN_MM;
  const logoY = HEADER_TOP_MM;

  // Use the fetched logo image only in normal (color) mode. Dot-matrix always
  // falls back to the outlined initial box: a raster color logo prints as an
  // ugly grey smudge on impact printers and wastes ribbon on a large solid
  // block. The 2-letter initial in monospace stays crisp on 9-pin ribbons.
  const shouldRenderLogo = !!logoDataUrl && mode === 'normal';
  let logoRendered = false;
  if (shouldRenderLogo && logoDataUrl) {
    try {
      const format = logoDataUrl.startsWith('data:image/png') ? 'PNG'
        : logoDataUrl.startsWith('data:image/jpeg') || logoDataUrl.startsWith('data:image/jpg') ? 'JPEG'
        : 'PNG';
      doc.addImage(logoDataUrl, format, logoX, logoY, LOGO_SIZE_MM, LOGO_SIZE_MM);
      logoRendered = true;
    } catch (err) {
      console.warn('logo addImage failed, falling back to initial box', err);
    }
  }

  if (!logoRendered) {
    doc.setDrawColor(p.navy);
    doc.setFillColor(p.navy);
    // Dot-matrix skips the black fill (would print as a solid ribbon-eating
    // rectangle); render an outlined box + black initial instead.
    doc.roundedRect(logoX, logoY, LOGO_SIZE_MM, LOGO_SIZE_MM, 2.2, 2.2, p.noFill ? 'S' : 'F');

    const initial = (settings.nama_toko || '??').slice(0, 2).toUpperCase();
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(18);
    // In dot-matrix the box is white with black outline, so the initial has to
    // be black too (white-on-white would vanish).
    doc.setTextColor(p.noFill ? p.navy : p.white);
    // approximate vertical centre (Helvetica baseline sits ~70% down the box)
    doc.text(initial, logoX + LOGO_SIZE_MM / 2, logoY + LOGO_SIZE_MM / 2 + 2.6, {
      align: 'center',
    });
  }

  // --- Company info (right of logo) ---
  const infoX = logoX + LOGO_SIZE_MM + 4;
  let infoY = logoY + 5;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(p.navy);
  doc.text(settings.nama_toko || '—', infoX, infoY);
  infoY += 5;

  // Tagline (italic, subtle) — only shows if tenant has set one; other PDFs
  // unaffected when null.
  if (settings.tagline) {
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(9);
    doc.setTextColor(p.grayMuted);
    doc.text(settings.tagline, infoX, infoY);
    infoY += 4;
  }

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(p.grayMuted);

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
    doc.text(`WA: ${settings.telp_wa}`, infoX, infoY);
    infoY += 4;
  }
  if (settings.email) {
    doc.text(settings.email, infoX, infoY);
    infoY += 4;
  }

  // --- Right column: doc number + date + optional order ID ---
  const rightX = PAGE_WIDTH_MM - MARGIN_MM;
  let rightY = logoY + 5;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(p.navy);
  doc.text(docNumber, rightX, rightY, { align: 'right' });
  rightY += 5;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(p.grayMuted);
  doc.text(formatTanggal(isoDate), rightX, rightY, { align: 'right' });
  rightY += 4;

  if (orderShortId) {
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(8.5);
    doc.setTextColor(p.grayFooter);
    doc.text(`Order #${orderShortId}`, rightX, rightY, { align: 'right' });
    rightY += 4;
  }

  // --- Divider just below whichever side is taller ---
  const stackBottom = Math.max(infoY, rightY, logoY + LOGO_SIZE_MM);
  const dividerY = stackBottom + DIVIDER_GAP_MM;
  doc.setDrawColor(p.navy);
  doc.setLineWidth(DIVIDER_WEIGHT_MM);
  doc.line(MARGIN_MM, dividerY, PAGE_WIDTH_MM - MARGIN_MM, dividerY);

  return dividerY + 5;
}

// ---------- Doc title ----------

/**
 * Render the centered doc title (e.g. "PESANAN PENJUALAN") in 14pt navy
 * bold. Returns the y-coordinate to continue body content from.
 */
export function renderDocTitle(
  doc: jsPDF,
  title: string,
  y: number,
  mode: PdfPrintMode = 'normal',
): number {
  const p = paletteFor(mode);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.setTextColor(p.navy);
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
  mode: PdfPrintMode = 'normal',
): number {
  const p = paletteFor(mode);
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

  // Background — dot-matrix strokes a plain rectangle instead of the pale-blue
  // callout fill so we don't waste ribbon painting a large block. Border keeps
  // the visual grouping intact.
  if (p.noFill) {
    doc.setDrawColor(p.navy);
    doc.setLineWidth(0.3);
    doc.roundedRect(blockX, y, blockWidth, blockHeight, 2.2, 2.2, 'S');
  } else {
    doc.setFillColor(p.calloutBg);
    doc.roundedRect(blockX, y, blockWidth, blockHeight, 2.2, 2.2, 'F');
  }

  // Labels
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(p.navy);
  doc.text('Kepada:', blockX + padding, y + padding + 3);
  doc.text('Pengiriman:', blockX + padding + colWidth + colGap, y + padding + 3);

  // Left column content
  doc.setFontSize(9.5);
  doc.setTextColor(p.grayMuted);
  let leftY = y + padding + 3 + labelHeight;
  leftLines.forEach((line, i) => {
    if (i === 0) {
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(p.navy);
    } else {
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(p.grayMuted);
    }
    doc.text(line, blockX + padding, leftY);
    leftY += lineHeight;
  });

  // Right column content
  let rightY = y + padding + 3 + labelHeight;
  rightLines.forEach((line, i) => {
    if (i === 0) {
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(p.navy);
    } else {
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(p.grayMuted);
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
export function renderBankBlock(
  doc: jsPDF,
  banks: BankAccount[],
  y: number,
  mode: PdfPrintMode = 'normal',
): number {
  const p = paletteFor(mode);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.setTextColor(p.navy);
  doc.text('Cara Pembayaran:', MARGIN_MM, y + 3);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(p.grayMuted);
  doc.text('Transfer ke salah satu rekening berikut:', MARGIN_MM + 32, y + 3);

  let cursorY = y + 6;

  if (!banks || banks.length === 0) {
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(9);
    doc.setTextColor(p.grayFooter);
    doc.text('Hubungi admin untuk info rekening.', MARGIN_MM, cursorY + 3);
    return cursorY + 7;
  }

  const rowHeight = 7;
  const rowWidth = PAGE_WIDTH_MM - MARGIN_MM * 2;
  const padding = 2.2;

  for (const bank of banks) {
    if (!p.noFill) doc.setFillColor(p.bankBg);
    doc.setDrawColor(p.bankBorder);
    doc.setLineWidth(0.3);
    // Dot-matrix skips the fill mode ('S' vs 'FD') so the bank row is just an
    // outlined rectangle — ribbon-friendly and matches impact printer output.
    doc.roundedRect(MARGIN_MM, cursorY, rowWidth, rowHeight, 1.4, 1.4, p.noFill ? 'S' : 'FD');

    const textY = cursorY + rowHeight / 2 + 1.4;

    // Bold bank name
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.setTextColor(p.navy);
    doc.text(bank.bank_name, MARGIN_MM + padding + 1, textY);
    const bankNameWidth = doc.getTextWidth(bank.bank_name);

    // Separator dot + "No. " label
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(p.grayMuted);
    let xCursor = MARGIN_MM + padding + 1 + bankNameWidth + 2;
    doc.text(' · No. ', xCursor, textY);
    xCursor += doc.getTextWidth(' · No. ');

    // Bold account number
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(p.navy);
    doc.text(bank.account_number, xCursor, textY);
    xCursor += doc.getTextWidth(bank.account_number);

    // "a.n. <holder>"
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(p.grayMuted);
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
  mode: PdfPrintMode = 'normal',
): void {
  const p = paletteFor(mode);
  const startY = PAGE_HEIGHT_MM - FOOTER_BAND_OFFSET_MM;

  // Hairline divider above footer band
  doc.setDrawColor(p.hairline);
  doc.setLineWidth(0.2);
  doc.line(MARGIN_MM, startY, PAGE_WIDTH_MM - MARGIN_MM, startY);

  // Heading
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(p.navy);
  doc.text(heading, MARGIN_MM, startY + 4.5);

  // Bullets
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(p.grayMuted);
  let bulletY = startY + 9;
  for (const line of tcLines) {
    doc.text(`•  ${line}`, MARGIN_MM + 2, bulletY);
    bulletY += 4;
  }

  // Tagline (right-aligned)
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(p.grayFooter);
  const tagline = `Dicetak otomatis · ${formatTanggal(new Date())}`;
  doc.text(tagline, PAGE_WIDTH_MM - MARGIN_MM, PAGE_HEIGHT_MM - MARGIN_MM, {
    align: 'right',
  });
}

// ============================================================================
// Multi-page primitives for Penawaran template (task 11 of 2026-08-04 plan)
// ============================================================================

export interface PageHeaderContext {
  store: StoreSettings;
  logoDataUrl: string | null;
  docLabel: string;        // e.g., "PENAWARAN HARGA"
  docNumber: string;       // e.g., "SO/2026/00012"
  docDate: string;         // formatted "04 Agu 2026"
  validUntil: string;      // formatted "18 Agu 2026"
  pageNumber: number;      // 1-based
  totalPages: number;      // computed AFTER first pass; use placeholder then overlay
}

/**
 * Draw full header (logo, company block, banner, doc-info). Returns Y for next content.
 *
 * Reuses the existing `renderHeader` for the logo + company + divider band, then
 * overlays a navy banner (top-right) and a doc-info block below it. The "Halaman"
 * row is rendered with an EMPTY value — overlayPageNumber in Task 12 fills in the
 * actual "N dari M" text once all pages are rendered (single-pass pattern).
 */
export function renderPageHeader(doc: jsPDF, ctx: PageHeaderContext): number {
  // Delegate logo + company + divider to the existing helper.
  // renderHeader signature: (doc, settings, docNumber, isoDate, orderShortId?, mode?, logoDataUrl?)
  // We pass docNumber as empty string so the right-column of renderHeader is blank —
  // the Penawaran template uses its own banner+doc-info block for that region.
  const headerBottomY = renderHeader(
    doc,
    ctx.store,
    '',          // docNumber — suppressed; banner block below owns this area
    '',          // isoDate  — suppressed; doc-info block below owns this area
    undefined,   // orderShortId
    'normal',
    ctx.logoDataUrl,
  );

  // Doc banner (top-right, navy background, white text, 16pt bold)
  const p = paletteFor('normal');
  const pageWidth = doc.internal.pageSize.getWidth();
  const bannerX = pageWidth - 65;
  const bannerY = 15;
  doc.setFillColor(p.navy);
  doc.rect(bannerX, bannerY, 55, 12, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.text(ctx.docLabel, bannerX + 27.5, bannerY + 8.5, { align: 'center' });

  // Doc info (below banner, right-aligned).
  // NOTE: "Halaman" row is rendered as label-only placeholder; the actual
  // "N dari M" text is overlaid AFTER render pass (see salesOrderPdf.ts
  // overlayPageNumber helper) once doc.getNumberOfPages() returns the real
  // total. Placeholder pattern used because a single-pass render doesn't know
  // the final page count until after all content is drawn.
  doc.setTextColor(0, 0, 0);
  doc.setFontSize(11);
  doc.setFont('helvetica', 'normal');
  const infoStartY = bannerY + 20;
  const infoRows: [string, string][] = [
    ['Nomor', ctx.docNumber],
    ['Tanggal', ctx.docDate],
    ['Berlaku sampai', ctx.validUntil],
    ['Halaman', ''],  // placeholder — overlaid post-render
  ];
  infoRows.forEach(([label, value], i) => {
    doc.text(`${label}:`, bannerX, infoStartY + i * 6);
    if (value) doc.text(value, bannerX + 30, infoStartY + i * 6);
  });

  // Return Y of next content (whichever block is taller + spacing)
  return Math.max(headerBottomY, infoStartY + infoRows.length * 6) + 8;
}

/**
 * Y-coordinate constants for overlayPageNumber (must match renderPageHeader).
 * bannerY = 15, rowIndex(3) * 6 = 18 → infoStartY = bannerY + 20 = 35,
 * Halaman row Y = infoStartY + 3 * 6 = 53.
 */
export const PAGE_INFO_HALAMAN_Y_OFFSET = 15 + 20 + 3 * 6; // 53mm from page top
export const PAGE_INFO_HALAMAN_X_OFFSET = 30;               // bannerX + 30 (value column offset from bannerX)

/**
 * Add a new page and draw the page header. Returns Y for next content.
 * Uses jsPDF's automatic page-index; no manual pageNumber tracking needed
 * since overlayPageNumber fills in "N dari M" after all pages are rendered.
 */
export function addPageWithHeader(doc: jsPDF, ctx: PageHeaderContext): number {
  doc.addPage();
  return renderPageHeader(doc, ctx);
}

/** Compute height of one item row including optional sub-parts bullets. */
export function measureItemRowHeight(
  doc: jsPDF,
  item: { name: string; sub_parts?: Array<{ name: string }> },
  opts: { rowFontSize: number; subPartFontSize: number; lineHeight: number; padVertical: number },
): number {
  // doc parameter reserved for future use (e.g., splitTextToSize for wrapped names)
  void doc;
  // Item name occupies ~5.5mm (padVertical top + baseline offset in renderer).
  // For 0 bullets, add full line-height for balanced padding top+bottom.
  // For N bullets, add 3.5mm gap before first bullet + 4mm per bullet.
  const subCount = item.sub_parts?.length ?? 0;
  const nameRow = opts.padVertical + 4;  // ~6mm for name + top padding
  const bulletSpace = subCount > 0 ? 3.5 + subCount * 4 : 0;
  const bottomPad = opts.padVertical;
  const noSubExtra = subCount === 0 ? opts.rowFontSize * 0.4 : 0;  // extra bottom for tall single row
  return nameRow + bulletSpace + bottomPad + noSubExtra;
}

/** Draw running footer bar at the bottom of the current page. */
export function renderRunningFooter(
  doc: jsPDF,
  store: StoreSettings,
): void {
  const pageHeight = doc.internal.pageSize.getHeight();
  const pageWidth = doc.internal.pageSize.getWidth();
  const footerY = pageHeight - 12;

  // Divider lines top + bottom of footer band
  const p = paletteFor('normal');
  doc.setDrawColor(p.navy);
  doc.setLineWidth(0.5);
  doc.line(10, footerY - 2, pageWidth - 10, footerY - 2);
  doc.line(10, footerY + 6, pageWidth - 10, footerY + 6);

  // Contact items separated by " | "
  const parts: string[] = [];
  if ((store.footer_show_telp_kantor ?? true) && store.telp_kantor) parts.push(`Telp: ${store.telp_kantor}`);
  if ((store.footer_show_wa ?? true) && store.telp_wa) parts.push(`WA: ${store.telp_wa}`);
  if ((store.footer_show_email ?? true) && store.email) parts.push(store.email);
  if ((store.footer_show_website ?? false) && store.website_url) parts.push(store.website_url);

  doc.setFontSize(9);
  doc.setTextColor(0, 0, 0);
  doc.setFont('helvetica', 'normal');
  doc.text(parts.join(' | '), pageWidth / 2, footerY + 2, { align: 'center' });
}
