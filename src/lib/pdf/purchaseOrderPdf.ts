import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { DbPurchaseOrder, DbPurchaseOrderItem, DbSupplier } from '../../types';
import type { StoreSettings } from '../pengaturan/types';

interface GeneratePoPdfArgs {
  po: DbPurchaseOrder;
  supplier: DbSupplier;
  items: DbPurchaseOrderItem[];
  storeSettings: StoreSettings | null;
  createdByName: string;
}

const BRAND_EMERALD = '#2d8a4e';
const TEXT_DARK = '#111827';
const TEXT_MUTED = '#6b7280';
const AMBER_BG = '#fef3c7';
const AMBER_TEXT = '#92400e';

function formatRupiah(n: number): string {
  return 'Rp ' + Math.round(n).toLocaleString('id-ID');
}

function formatDateID(iso?: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  const months = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];
  return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
}

export function generatePoPdf(args: GeneratePoPdfArgs): Blob {
  const { po, supplier, items, storeSettings, createdByName } = args;
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 40;

  // ====== HEADER ======
  // Brand emerald box with Zap-like lightning bolt (drawn manually with lines)
  doc.setFillColor(BRAND_EMERALD);
  doc.roundedRect(margin, margin, 36, 36, 6, 6, 'F');
  doc.setDrawColor(255, 255, 255);
  doc.setFillColor(255, 255, 255);
  // Lightning bolt shape: simplified polygon
  const cx = margin + 18;
  const cy = margin + 18;
  doc.triangle(cx - 4, cy - 10, cx + 6, cy - 2, cx - 2, cy - 2, 'F');
  doc.triangle(cx + 2, cy + 2, cx - 6, cy + 10, cx + 4, cy + 2, 'F');

  // Company name + tagline
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.setTextColor(TEXT_DARK);
  const companyName = storeSettings?.nama_toko ?? 'Toko Anda';
  doc.text(companyName, margin + 48, margin + 16);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  doc.setTextColor(BRAND_EMERALD);
  doc.text('MSME ERP SUITE', margin + 48, margin + 28);

  // Address + phone + email (3 lines)
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(TEXT_MUTED);
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
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.setTextColor(TEXT_DARK);
  doc.text('PURCHASE ORDER', pageWidth - margin, margin + 18, { align: 'right' });
  doc.setFont('courier', 'bold');
  doc.setFontSize(11);
  doc.text(po.po_number, pageWidth - margin, margin + 34, { align: 'right' });

  // Divider line under header
  doc.setDrawColor(TEXT_DARK);
  doc.setLineWidth(1.5);
  doc.line(margin, margin + 76, pageWidth - margin, margin + 76);

  // ====== TWO-COLUMN INFO ======
  const blockY = margin + 92;
  const colWidth = (pageWidth - margin * 2 - 20) / 2;

  // Left: Kepada
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(TEXT_MUTED);
  doc.text('KEPADA', margin, blockY);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(TEXT_DARK);
  doc.text(supplier.name, margin, blockY + 14);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(TEXT_MUTED);
  const supplierLines: string[] = [];
  if (supplier.contact_name) supplierLines.push(`Kontak: ${supplier.contact_name}`);
  if (supplier.phone) supplierLines.push(`HP/WA: ${supplier.phone}`);
  supplierLines.push(`Term: ${supplier.payment_term_days === 0 ? 'Cash' : `Net ${supplier.payment_term_days} hari`}`);
  supplierLines.forEach((line, i) => {
    doc.text(line, margin, blockY + 26 + i * 11);
  });

  // Right: Detail PO
  const rightX = margin + colWidth + 20;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(TEXT_MUTED);
  doc.text('DETAIL PO', rightX, blockY);

  // Table rows manually
  const detailRows = [
    { label: 'Tgl Pesan', value: formatDateID(po.ordered_at ?? po.created_at), highlight: false },
    { label: 'Diterima paling lambat', value: formatDateID(po.expected_receive_date), highlight: !!po.expected_receive_date },
    { label: 'Dibuat oleh', value: createdByName, highlight: false },
  ];
  let detailY = blockY + 14;
  detailRows.forEach((r) => {
    if (r.highlight) {
      doc.setFillColor(AMBER_BG);
      doc.rect(rightX - 4, detailY - 9, colWidth + 8, 14, 'F');
      doc.setTextColor(AMBER_TEXT);
      doc.setFont('helvetica', 'bold');
    } else {
      doc.setTextColor(TEXT_MUTED);
      doc.setFont('helvetica', 'normal');
    }
    doc.setFontSize(9);
    doc.text(r.label, rightX, detailY);
    doc.setFont('helvetica', 'bold');
    if (!r.highlight) doc.setTextColor(TEXT_DARK);
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
    styles: { fontSize: 10, cellPadding: 6, textColor: TEXT_DARK, lineColor: '#e5e7eb', lineWidth: 0.5 },
    headStyles: { fillColor: '#f3f4f6', textColor: TEXT_MUTED, fontStyle: 'bold', fontSize: 8 },
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

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(TEXT_MUTED);
  doc.text('Subtotal', totalsLabelX, yAfterTable);
  doc.setTextColor(TEXT_DARK);
  doc.text(formatRupiah(po.subtotal), totalsValueX, yAfterTable, { align: 'right' });
  yAfterTable += 14;

  if (po.tax_rate > 0) {
    doc.setTextColor(TEXT_MUTED);
    doc.text(`PPN ${(po.tax_rate * 100).toFixed(0)}%`, totalsLabelX, yAfterTable);
    doc.setTextColor(TEXT_DARK);
    doc.text(formatRupiah(po.tax_amount), totalsValueX, yAfterTable, { align: 'right' });
    yAfterTable += 14;
  }

  // Total line (bold border-top)
  doc.setDrawColor(TEXT_DARK);
  doc.setLineWidth(1.5);
  doc.line(totalsLabelX, yAfterTable - 5, totalsValueX, yAfterTable - 5);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text('TOTAL', totalsLabelX, yAfterTable + 8);
  doc.setFontSize(13);
  doc.text(formatRupiah(po.total), totalsValueX, yAfterTable + 8, { align: 'right' });
  yAfterTable += 24;

  // ====== NOTES ======
  if (po.notes) {
    yAfterTable += 12;
    doc.setDrawColor('#e5e7eb');
    doc.setLineWidth(0.5);
    doc.line(margin, yAfterTable, pageWidth - margin, yAfterTable);
    yAfterTable += 12;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(TEXT_MUTED);
    doc.text('CATATAN', margin, yAfterTable);
    yAfterTable += 12;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(TEXT_DARK);
    const noteLines = doc.splitTextToSize(po.notes, pageWidth - margin * 2);
    doc.text(noteLines, margin, yAfterTable);
    yAfterTable += noteLines.length * 12;
  }

  // ====== FOOTER T&C ======
  const footerY = doc.internal.pageSize.getHeight() - margin;
  doc.setDrawColor('#d1d5db');
  doc.setLineWidth(0.5);
  doc.line(margin, footerY - 14, pageWidth - margin, footerY - 14);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(TEXT_MUTED);
  doc.text(
    'Barang yang dikirim wajib sesuai spesifikasi PO. Konfirmasi penerimaan via WA dalam 1×24 jam.',
    pageWidth / 2,
    footerY - 2,
    { align: 'center' }
  );

  return doc.output('blob');
}
