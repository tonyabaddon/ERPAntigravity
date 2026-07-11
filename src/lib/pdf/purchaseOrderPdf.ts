import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { DbPurchaseOrder, DbPurchaseOrderItem, DbSupplier } from '../../types';
import type { StoreSettings } from '../pengaturan/types';
import { fetchLogoDataUrl, type PdfPrintMode } from '../sales/pdf/common';

interface GeneratePoPdfArgs {
  po: DbPurchaseOrder;
  supplier: DbSupplier;
  items: DbPurchaseOrderItem[];
  storeSettings: StoreSettings | null;
  createdByName: string;
  /**
   * 'normal' (default) = full-color A4 layout for laser/inkjet.
   * 'dot_matrix' = pure-black mono, no fills, courier body, hairline strokes.
   * Tuned for Epson LX-310 / LX-2190 continuous-form printers where solid
   * color blocks waste ribbon and raster logos print as grey smudges.
   */
  printMode?: PdfPrintMode;
}

// Full-color palette
const BRAND_EMERALD = '#2d8a4e';
const TEXT_DARK = '#111827';
const TEXT_MUTED = '#6b7280';
const AMBER_BG = '#fef3c7';
const AMBER_TEXT = '#92400e';

// Dot-matrix mono palette — pure black, no fills.
const DM_BLACK = '#000000';
const DM_WHITE = '#ffffff';

interface PoPalette {
  brand: string;
  textDark: string;
  textMuted: string;
  amberBg: string;
  amberText: string;
  tableHeadFill: string;
  tableLine: string;
  bodyFont: 'helvetica' | 'courier';
  noFill: boolean;
}

function paletteFor(mode: PdfPrintMode = 'normal'): PoPalette {
  if (mode === 'dot_matrix') {
    return {
      brand:         DM_BLACK,
      textDark:      DM_BLACK,
      textMuted:     DM_BLACK,
      amberBg:       DM_WHITE,
      amberText:     DM_BLACK,
      tableHeadFill: DM_WHITE,
      tableLine:     DM_BLACK,
      bodyFont:      'courier',
      noFill:        true,
    };
  }
  return {
    brand:         BRAND_EMERALD,
    textDark:      TEXT_DARK,
    textMuted:     TEXT_MUTED,
    amberBg:       AMBER_BG,
    amberText:     AMBER_TEXT,
    tableHeadFill: '#f3f4f6',
    tableLine:     '#e5e7eb',
    bodyFont:      'helvetica',
    noFill:        false,
  };
}

function formatRupiah(n: number): string {
  return 'Rp ' + Math.round(n).toLocaleString('id-ID');
}

function formatDateID(iso?: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  const months = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];
  return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
}

export async function generatePoPdf(args: GeneratePoPdfArgs): Promise<Blob> {
  const { po, supplier, items, storeSettings, createdByName, printMode = 'normal' } = args;
  const p = paletteFor(printMode);
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 40;

  // Dot-matrix mode: skip logo fetch — raster logos print as grey ribbon-eating
  // smudges on impact printers, so the outlined initial box is the better default.
  const logoDataUrl = (printMode === 'normal' && storeSettings)
    ? await fetchLogoDataUrl(storeSettings)
    : null;

  // ====== HEADER ======
  let logoRendered = false;
  if (logoDataUrl) {
    try {
      const format = logoDataUrl.startsWith('data:image/png') ? 'PNG'
        : logoDataUrl.startsWith('data:image/jpeg') || logoDataUrl.startsWith('data:image/jpg') ? 'JPEG'
        : 'PNG';
      doc.addImage(logoDataUrl, format, margin, margin, 36, 36);
      logoRendered = true;
    } catch (err) {
      console.warn('PO logo addImage failed, falling back to outlined box', err);
    }
  }
  if (!logoRendered) {
    if (p.noFill) {
      // Dot-matrix: outlined box + 2-letter initial (matches sales-side renderHeader)
      doc.setDrawColor(p.brand);
      doc.setLineWidth(1);
      doc.roundedRect(margin, margin, 36, 36, 6, 6, 'S');
      const initial = (storeSettings?.nama_toko || 'PO').slice(0, 2).toUpperCase();
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(16);
      doc.setTextColor(p.textDark);
      doc.text(initial, margin + 18, margin + 24, { align: 'center' });
    } else {
      doc.setFillColor(BRAND_EMERALD);
      doc.roundedRect(margin, margin, 36, 36, 6, 6, 'F');
      doc.setDrawColor(255, 255, 255);
      doc.setFillColor(255, 255, 255);
      const cx = margin + 18;
      const cy = margin + 18;
      doc.triangle(cx - 4, cy - 10, cx + 6, cy - 2, cx - 2, cy - 2, 'F');
      doc.triangle(cx + 2, cy + 2, cx - 6, cy + 10, cx + 4, cy + 2, 'F');
    }
  }

  // Company name + tagline
  doc.setFont(p.bodyFont, 'bold');
  doc.setFontSize(16);
  doc.setTextColor(p.textDark);
  const companyName = storeSettings?.nama_toko ?? 'Toko Anda';
  doc.text(companyName, margin + 48, margin + 16);

  doc.setFont(p.bodyFont, 'bold');
  doc.setFontSize(7);
  doc.setTextColor(p.brand);
  doc.text('MSME ERP SUITE', margin + 48, margin + 28);

  // Address + phone + email (3 lines)
  doc.setFont(p.bodyFont, 'normal');
  doc.setFontSize(9);
  doc.setTextColor(p.textMuted);
  let infoY = margin + 42;
  if (storeSettings?.alamat_lengkap) {
    doc.text(storeSettings.alamat_lengkap, margin + 48, infoY);
    infoY += 11;
  }
  const contactParts: string[] = [];
  if (storeSettings?.telp_wa) contactParts.push(storeSettings.telp_wa);
  if (storeSettings?.email) contactParts.push(storeSettings.email);
  if (contactParts.length > 0) {
    doc.text(contactParts.join(' · '), margin + 48, infoY);
  }

  // Right side: PURCHASE ORDER + po_number
  doc.setFont(p.bodyFont, 'bold');
  doc.setFontSize(18);
  doc.setTextColor(p.textDark);
  doc.text('PURCHASE ORDER', pageWidth - margin, margin + 18, { align: 'right' });
  doc.setFont('courier', 'bold');
  doc.setFontSize(11);
  doc.text(po.po_number, pageWidth - margin, margin + 34, { align: 'right' });

  // Divider line under header
  doc.setDrawColor(p.textDark);
  doc.setLineWidth(p.noFill ? 0.5 : 1.5);
  doc.line(margin, margin + 76, pageWidth - margin, margin + 76);

  // ====== TWO-COLUMN INFO ======
  const blockY = margin + 92;
  const colWidth = (pageWidth - margin * 2 - 20) / 2;

  // Left: Kepada
  doc.setFont(p.bodyFont, 'bold');
  doc.setFontSize(8);
  doc.setTextColor(p.textMuted);
  doc.text('KEPADA', margin, blockY);

  doc.setFont(p.bodyFont, 'bold');
  doc.setFontSize(11);
  doc.setTextColor(p.textDark);
  doc.text(supplier.name, margin, blockY + 14);

  doc.setFont(p.bodyFont, 'normal');
  doc.setFontSize(9);
  doc.setTextColor(p.textMuted);
  const supplierLines: string[] = [];
  if (supplier.contact_name) supplierLines.push(`Kontak: ${supplier.contact_name}`);
  if (supplier.phone) supplierLines.push(`HP/WA: ${supplier.phone}`);
  supplierLines.push(`Term: ${supplier.payment_term_days === 0 ? 'Cash' : `Net ${supplier.payment_term_days} hari`}`);
  supplierLines.forEach((line, i) => {
    doc.text(line, margin, blockY + 26 + i * 11);
  });

  // Right: Detail PO
  const rightX = margin + colWidth + 20;
  doc.setFont(p.bodyFont, 'bold');
  doc.setFontSize(8);
  doc.setTextColor(p.textMuted);
  doc.text('DETAIL PO', rightX, blockY);

  const detailRows = [
    { label: 'Tgl Pesan', value: formatDateID(po.ordered_at ?? po.created_at), highlight: false },
    { label: 'Diterima paling lambat', value: formatDateID(po.expected_receive_date), highlight: !!po.expected_receive_date },
    { label: 'Dibuat oleh', value: createdByName, highlight: false },
  ];
  let detailY = blockY + 14;
  detailRows.forEach((r) => {
    if (r.highlight && !p.noFill) {
      // Dot-matrix skips the fill and uses bold text instead — ribbon-friendly.
      doc.setFillColor(p.amberBg);
      doc.rect(rightX - 4, detailY - 9, colWidth + 8, 14, 'F');
      doc.setTextColor(p.amberText);
      doc.setFont(p.bodyFont, 'bold');
    } else {
      doc.setTextColor(p.textMuted);
      doc.setFont(p.bodyFont, r.highlight ? 'bold' : 'normal');
    }
    doc.setFontSize(9);
    doc.text(r.label, rightX, detailY);
    doc.setFont(p.bodyFont, 'bold');
    if (!r.highlight || p.noFill) doc.setTextColor(p.textDark);
    doc.text(r.value, rightX + colWidth, detailY, { align: 'right' });
    detailY += 14;
  });

  // ====== ITEMS TABLE via autoTable ======
  const tableStartY = blockY + 90;
  autoTable(doc, {
    startY: tableStartY,
    head: [['No', 'SKU', 'Nama Produk', 'Qty', 'Harga', 'Subtotal']],
    body: items.map((item, i) => [
      String(i + 1),
      item.sku,
      item.product_name,
      String(item.qty),
      Math.round(item.unit_cost).toLocaleString('id-ID'),
      Math.round(item.subtotal).toLocaleString('id-ID'),
    ]),
    theme: 'plain',
    styles: {
      fontSize: 10, cellPadding: 6,
      textColor: p.textDark, lineColor: p.tableLine, lineWidth: p.noFill ? 0.3 : 0.5,
      font: p.bodyFont,
    },
    headStyles: {
      fillColor: p.tableHeadFill, textColor: p.textDark,
      fontStyle: 'bold', fontSize: 8, font: p.bodyFont,
    },
    columnStyles: {
      0: { halign: 'left', cellWidth: 26 },
      1: { halign: 'left', cellWidth: 80, font: 'courier' },
      2: { halign: 'left' },
      3: { halign: 'center', cellWidth: 40 },
      4: { halign: 'right', cellWidth: 70 },
      5: { halign: 'right', cellWidth: 80 },
    },
    margin: { left: margin, right: margin },
  });

  // ====== TOTALS ======
  let yAfterTable = (doc as any).lastAutoTable.finalY + 12;
  const totalsLabelX = pageWidth - margin - 160;
  const totalsValueX = pageWidth - margin;

  doc.setFont(p.bodyFont, 'normal');
  doc.setFontSize(10);
  doc.setTextColor(p.textMuted);
  doc.text('Subtotal', totalsLabelX, yAfterTable);
  doc.setTextColor(p.textDark);
  doc.text(formatRupiah(po.subtotal), totalsValueX, yAfterTable, { align: 'right' });
  yAfterTable += 14;

  if (po.tax_rate > 0) {
    doc.setTextColor(p.textMuted);
    doc.text(`PPN ${(po.tax_rate * 100).toFixed(0)}%`, totalsLabelX, yAfterTable);
    doc.setTextColor(p.textDark);
    doc.text(formatRupiah(po.tax_amount), totalsValueX, yAfterTable, { align: 'right' });
    yAfterTable += 14;
  }

  // Total line (bold border-top)
  doc.setDrawColor(p.textDark);
  doc.setLineWidth(p.noFill ? 0.5 : 1.5);
  doc.line(totalsLabelX, yAfterTable - 5, totalsValueX, yAfterTable - 5);
  doc.setFont(p.bodyFont, 'bold');
  doc.setFontSize(11);
  doc.text('TOTAL', totalsLabelX, yAfterTable + 8);
  doc.setFontSize(13);
  doc.text(formatRupiah(po.total), totalsValueX, yAfterTable + 8, { align: 'right' });
  yAfterTable += 24;

  // ====== NOTES ======
  if (po.notes) {
    yAfterTable += 12;
    doc.setDrawColor(p.tableLine);
    doc.setLineWidth(0.5);
    doc.line(margin, yAfterTable, pageWidth - margin, yAfterTable);
    yAfterTable += 12;
    doc.setFont(p.bodyFont, 'bold');
    doc.setFontSize(8);
    doc.setTextColor(p.textMuted);
    doc.text('CATATAN', margin, yAfterTable);
    yAfterTable += 12;
    doc.setFont(p.bodyFont, 'normal');
    doc.setFontSize(10);
    doc.setTextColor(p.textDark);
    const noteLines = doc.splitTextToSize(po.notes, pageWidth - margin * 2);
    doc.text(noteLines, margin, yAfterTable);
    yAfterTable += noteLines.length * 12;
  }

  // ====== FOOTER T&C ======
  const footerY = doc.internal.pageSize.getHeight() - margin;
  doc.setDrawColor(p.tableLine);
  doc.setLineWidth(0.5);
  doc.line(margin, footerY - 14, pageWidth - margin, footerY - 14);
  doc.setFont(p.bodyFont, 'normal');
  doc.setFontSize(8);
  doc.setTextColor(p.textMuted);
  doc.text(
    'Barang yang dikirim wajib sesuai spesifikasi PO. Konfirmasi penerimaan via WA dalam 1×24 jam.',
    pageWidth / 2,
    footerY - 2,
    { align: 'center' }
  );

  return doc.output('blob');
}
