/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import jsPDF from 'jspdf';
import autoTable, { type CellHookData } from 'jspdf-autotable';

// ---------------------------------------------------------------------------
// Extend jsPDF types to expose lastAutoTable from jspdf-autotable
// ---------------------------------------------------------------------------
declare module 'jspdf' {
  interface jsPDF {
    lastAutoTable: { finalY: number };
  }
}

// ---------------------------------------------------------------------------
// Public interfaces
// ---------------------------------------------------------------------------

export interface PDFCompanyInfo {
  companyName: string;
  npwp: string | null;
  address: string | null;
}

export interface PDFGenerationOptions {
  company: PDFCompanyInfo;
  generatedAt: Date;
  fileName?: string;
}

export interface LabaRugiData {
  periodLabel: string;  // "Periode 1-30 Juni 2026"
  startDate: string;
  endDate: string;
  pendapatan: Array<{ code: string; name: string; amount: number }>;
  diskonPenjualan: number;
  pendapatanBersih: number;
  hpp: Array<{ code: string; name: string; amount: number }>;
  labaKotor: number;
  bebanOperasional: Array<{ code: string; name: string; amount: number }>;
  totalBebanOp: number;
  labaOperasional: number;
  pendapatanLainLain: Array<{ code: string; name: string; amount: number }>;
  bebanLainLain: Array<{ code: string; name: string; amount: number }>;
  labaSebelumPajak: number;
  bebanPajak: number;
  labaNeto: number;
}

export interface NeracaData {
  asOfDate: string;
  asOfLabel: string;  // "Per 30 Juni 2026"
  asetLancar: Array<{ code: string; name: string; amount: number }>;
  totalAsetLancar: number;
  asetTetap: Array<{ code: string; name: string; amount: number }>;
  akumulasiPenyusutan: number;
  totalAsetTetap: number;
  totalAset: number;
  liabilitasLancar: Array<{ code: string; name: string; amount: number }>;
  totalLiabLancar: number;
  liabilitasJkPanjang: Array<{ code: string; name: string; amount: number }>;
  totalLiabJkPanjang: number;
  totalLiabilitas: number;
  ekuitas: Array<{ code: string; name: string; amount: number }>;
  totalEkuitas: number;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function formatRp(n: number): string {
  if (n === 0) return '—';
  const formatted = new Intl.NumberFormat('id-ID').format(Math.abs(n));
  return n < 0 ? `(${formatted})` : formatted;
}

/** Format a Date object to WIB locale string (UTC+7). */
function formatWIB(date: Date): string {
  return date.toLocaleString('id-ID', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }) + ' WIB';
}

type RowKind =
  | 'section'
  | 'detail'
  | 'subtotal'
  | 'emphasis'
  | 'emphasis-final'
  | 'blank';

interface BodyRow {
  label: string;
  value: number | null;
  kind: RowKind;
  indent?: boolean;
}

/** RGB color tuples for autoTable fillColor. */
const COLORS = {
  emerald50: [236, 253, 245] as [number, number, number],
  orange50:  [255, 247, 237] as [number, number, number],
  gray50:    [249, 250, 251] as [number, number, number],
  blue50:    [239, 246, 255] as [number, number, number],
  emerald100:[209, 250, 229] as [number, number, number],
  white:     [255, 255, 255] as [number, number, number],
  gray200:   [229, 231, 235] as [number, number, number],
};

/** Emit centered header lines (companyName, NPWP, address) and return the Y position after. */
function drawHeader(doc: jsPDF, options: PDFGenerationOptions, margin: number): number {
  const pageWidth = doc.internal.pageSize.getWidth();
  const cx = pageWidth / 2;
  let y = margin;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text(options.company.companyName, cx, y, { align: 'center' });
  y += 7;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);

  if (options.company.npwp) {
    doc.text(`NPWP: ${options.company.npwp}`, cx, y, { align: 'center' });
    y += 5;
  }

  if (options.company.address) {
    doc.text(options.company.address, cx, y, { align: 'center' });
    y += 5;
  }

  return y;
}

/** Draw footer: left = Dicetak timestamp, right = system name. */
function drawFooter(doc: jsPDF, options: PDFGenerationOptions, margin: number): void {
  const pageHeight = doc.internal.pageSize.getHeight();
  const pageWidth  = doc.internal.pageSize.getWidth();
  const footerY = pageHeight - 10;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.text(`Dicetak: ${formatWIB(options.generatedAt)}`, margin, footerY);
  doc.text('Sistem Akuntansi: Garindo ERP', pageWidth - margin, footerY, { align: 'right' });
}

// ---------------------------------------------------------------------------
// generateLabaRugiPDF
// ---------------------------------------------------------------------------

export function generateLabaRugiPDF(data: LabaRugiData, options: PDFGenerationOptions): Blob {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const margin = 15;
  const pageWidth = doc.internal.pageSize.getWidth();
  const cx = pageWidth / 2;

  // --- Header ---
  let y = drawHeader(doc, options, margin);
  y += 10; // spacer

  // --- Title ---
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.text('LAPORAN LABA RUGI', cx, y, { align: 'center' });
  y += 7;

  // --- Subtitle ---
  doc.setFont('helvetica', 'italic');
  doc.setFontSize(10);
  doc.text(`${data.periodLabel} (dalam Rupiah)`, cx, y, { align: 'center' });
  y += 5; // spacer before table

  // --- Build body rows ---
  const rows: BodyRow[] = [];

  // PENDAPATAN section
  rows.push({ label: 'PENDAPATAN', value: null, kind: 'section' });
  for (const item of data.pendapatan) {
    rows.push({ label: `    ${item.name}`, value: item.amount, kind: 'detail', indent: true });
  }
  if (data.diskonPenjualan !== 0) {
    rows.push({ label: '    Diskon Penjualan', value: -Math.abs(data.diskonPenjualan), kind: 'detail', indent: true });
  }
  rows.push({ label: 'Pendapatan Bersih', value: data.pendapatanBersih, kind: 'subtotal' });

  // HPP section
  rows.push({ label: 'HARGA POKOK PENJUALAN', value: null, kind: 'section' });
  for (const item of data.hpp) {
    rows.push({ label: `    ${item.name}`, value: item.amount, kind: 'detail', indent: true });
  }

  // LABA KOTOR
  rows.push({ label: 'LABA KOTOR', value: data.labaKotor, kind: 'emphasis' });

  // BEBAN OPERASIONAL section
  rows.push({ label: 'BEBAN OPERASIONAL', value: null, kind: 'section' });
  for (const item of data.bebanOperasional) {
    rows.push({ label: `    ${item.name}`, value: item.amount, kind: 'detail', indent: true });
  }
  rows.push({ label: 'Total Beban Operasional', value: data.totalBebanOp, kind: 'subtotal' });

  // LABA OPERASIONAL
  rows.push({ label: 'LABA OPERASIONAL', value: data.labaOperasional, kind: 'emphasis' });

  // PENDAPATAN/(BEBAN) LAIN-LAIN section
  const hasLainLain = data.pendapatanLainLain.length > 0 || data.bebanLainLain.length > 0;
  if (hasLainLain) {
    rows.push({ label: 'PENDAPATAN/(BEBAN) LAIN-LAIN', value: null, kind: 'section' });
    for (const item of data.pendapatanLainLain) {
      rows.push({ label: `    ${item.name}`, value: item.amount, kind: 'detail', indent: true });
    }
    for (const item of data.bebanLainLain) {
      rows.push({ label: `    ${item.name}`, value: -Math.abs(item.amount), kind: 'detail', indent: true });
    }
  }

  // LABA SEBELUM PAJAK
  rows.push({ label: 'LABA SEBELUM PAJAK', value: data.labaSebelumPajak, kind: 'emphasis' });

  // Beban pajak
  if (data.bebanPajak !== 0) {
    rows.push({ label: '    Beban Pajak', value: -Math.abs(data.bebanPajak), kind: 'detail', indent: true });
  }

  // LABA NETO — final emphasis row
  rows.push({ label: 'LABA NETO BULAN INI', value: data.labaNeto, kind: 'emphasis-final' });

  // Map rows to table data
  const tableBody = rows.map(r => [r.label, r.value !== null ? formatRp(r.value) : '']);

  // Section row indices for color lookup
  const sectionKinds: Record<string, [number, number, number]> = {};
  rows.forEach((r, i) => {
    if (r.kind === 'section') {
      const label = r.label;
      if (label === 'PENDAPATAN') sectionKinds[i] = COLORS.emerald50;
      else if (label === 'HARGA POKOK PENJUALAN') sectionKinds[i] = COLORS.orange50;
      else if (label === 'BEBAN OPERASIONAL') sectionKinds[i] = COLORS.orange50;
      else sectionKinds[i] = COLORS.gray50; // PENDAPATAN/(BEBAN) LAIN-LAIN
    }
  });

  autoTable(doc, {
    startY: y,
    margin: { left: margin, right: margin },
    head: [['Keterangan', 'Rupiah']],
    body: tableBody,
    theme: 'plain',
    styles: {
      fontSize: 9,
      cellPadding: { top: 1.5, bottom: 1.5, left: 2, right: 2 },
      lineColor: [200, 200, 200] as [number, number, number],
      lineWidth: 0,
      overflow: 'linebreak',
    },
    headStyles: {
      fillColor: [243, 244, 246] as [number, number, number],
      fontStyle: 'bold',
      fontSize: 9,
      textColor: [30, 30, 30] as [number, number, number],
    },
    columnStyles: {
      0: { halign: 'left',  cellWidth: 'auto' },
      1: { halign: 'right', cellWidth: 45 },
    },
    didParseCell: (hookData) => {
      const rowIndex = hookData.row.index;
      const row = rows[rowIndex];
      if (!row) return;

      const kind = row.kind;

      if (kind === 'section') {
        const bg = sectionKinds[rowIndex] ?? COLORS.gray50;
        hookData.cell.styles.fillColor = bg;
        hookData.cell.styles.fontStyle = 'bold';
        hookData.cell.styles.fontSize = 9;
        hookData.cell.styles.cellPadding = { top: 2.5, bottom: 2.5, left: 2, right: 2 };
      } else if (kind === 'subtotal') {
        hookData.cell.styles.fontStyle = 'bold';
        hookData.cell.styles.lineColor = [180, 180, 180] as [number, number, number];
        if (hookData.column.index === 1) {
          hookData.cell.styles.lineWidth = { top: 0.3, bottom: 0, left: 0, right: 0 };
        }
      } else if (kind === 'emphasis') {
        hookData.cell.styles.fillColor = COLORS.blue50;
        hookData.cell.styles.fontStyle = 'bold';
        hookData.cell.styles.fontSize = 9;
      } else if (kind === 'emphasis-final') {
        hookData.cell.styles.fillColor = COLORS.emerald100;
        hookData.cell.styles.fontStyle = 'bold';
        hookData.cell.styles.fontSize = 10;
        hookData.cell.styles.lineColor = [5, 150, 105] as [number, number, number];
        hookData.cell.styles.lineWidth = { top: 0.5, bottom: 0.5, left: 0, right: 0 };
      }
    },
  });

  // Footer
  drawFooter(doc, options, margin);

  return doc.output('blob');
}

// ---------------------------------------------------------------------------
// generateNeracaPDF
// ---------------------------------------------------------------------------

export function generateNeracaPDF(data: NeracaData, options: PDFGenerationOptions): Blob {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const margin = 15;
  const pageWidth  = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const cx = pageWidth / 2;

  // --- Header ---
  let y = drawHeader(doc, options, margin);
  y += 8;

  // --- Title ---
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.text('NERACA', cx, y, { align: 'center' });
  y += 7;

  // --- Subtitle ---
  doc.setFont('helvetica', 'italic');
  doc.setFontSize(10);
  doc.text(data.asOfLabel, cx, y, { align: 'center' });
  y += 6;

  // -------------------------------------------------------------------
  // Build LEFT table data (ASET)
  // -------------------------------------------------------------------
  const leftRows: BodyRow[] = [];

  leftRows.push({ label: 'ASET', value: null, kind: 'section' });
  leftRows.push({ label: 'Aset Lancar', value: null, kind: 'section' });
  for (const item of data.asetLancar) {
    leftRows.push({ label: `    ${item.name}`, value: item.amount, kind: 'detail', indent: true });
  }
  leftRows.push({ label: 'Total Aset Lancar', value: data.totalAsetLancar, kind: 'subtotal' });

  leftRows.push({ label: 'Aset Tetap', value: null, kind: 'section' });
  for (const item of data.asetTetap) {
    leftRows.push({ label: `    ${item.name}`, value: item.amount, kind: 'detail', indent: true });
  }
  if (data.akumulasiPenyusutan !== 0) {
    leftRows.push({ label: '    Akumulasi Penyusutan', value: -Math.abs(data.akumulasiPenyusutan), kind: 'detail', indent: true });
  }
  leftRows.push({ label: 'Total Aset Tetap', value: data.totalAsetTetap, kind: 'subtotal' });
  leftRows.push({ label: 'TOTAL ASET', value: data.totalAset, kind: 'emphasis-final' });

  // -------------------------------------------------------------------
  // Build RIGHT table data (LIABILITAS + EKUITAS)
  // -------------------------------------------------------------------
  const rightRows: BodyRow[] = [];

  rightRows.push({ label: 'LIABILITAS', value: null, kind: 'section' });
  rightRows.push({ label: 'Liabilitas Jangka Pendek', value: null, kind: 'section' });
  for (const item of data.liabilitasLancar) {
    rightRows.push({ label: `    ${item.name}`, value: item.amount, kind: 'detail', indent: true });
  }
  rightRows.push({ label: 'Total Liabilitas Jangka Pendek', value: data.totalLiabLancar, kind: 'subtotal' });

  if (data.liabilitasJkPanjang.length > 0) {
    rightRows.push({ label: 'Liabilitas Jangka Panjang', value: null, kind: 'section' });
    for (const item of data.liabilitasJkPanjang) {
      rightRows.push({ label: `    ${item.name}`, value: item.amount, kind: 'detail', indent: true });
    }
    rightRows.push({ label: 'Total Liabilitas Jangka Panjang', value: data.totalLiabJkPanjang, kind: 'subtotal' });
  }

  rightRows.push({ label: 'TOTAL LIABILITAS', value: data.totalLiabilitas, kind: 'emphasis' });

  rightRows.push({ label: 'EKUITAS', value: null, kind: 'section' });
  for (const item of data.ekuitas) {
    rightRows.push({ label: `    ${item.name}`, value: item.amount, kind: 'detail', indent: true });
  }
  rightRows.push({ label: 'TOTAL EKUITAS', value: data.totalEkuitas, kind: 'emphasis-final' });

  // -------------------------------------------------------------------
  // Compute layout widths for two side-by-side tables
  // -------------------------------------------------------------------
  const usableWidth = pageWidth - margin * 2;
  const gap = 8;
  const halfWidth = (usableWidth - gap) / 2;

  const leftTableLeft  = margin;
  const rightTableLeft = margin + halfWidth + gap;

  // -------------------------------------------------------------------
  // Helper to build autoTable options for a side panel
  // -------------------------------------------------------------------
  function makeSidePanelOptions(
    rows: BodyRow[],
    tableLeft: number,
    startY: number,
  ): Parameters<typeof autoTable>[1] {
    const tableBody = rows.map(r => [r.label, r.value !== null ? formatRp(r.value) : '']);

    const sectionMap: Record<number, [number, number, number]> = {};
    rows.forEach((r, i) => {
      if (r.kind === 'section') {
        const label = r.label;
        if (label === 'ASET' || label === 'Aset Lancar' || label === 'Aset Tetap') {
          sectionMap[i] = COLORS.emerald50;
        } else if (label === 'LIABILITAS' || label.includes('Liabilitas')) {
          sectionMap[i] = COLORS.orange50;
        } else if (label === 'EKUITAS') {
          sectionMap[i] = COLORS.blue50;
        } else {
          sectionMap[i] = COLORS.gray50;
        }
      }
    });

    return {
      startY,
      margin: { left: tableLeft, right: pageWidth - tableLeft - halfWidth },
      tableWidth: halfWidth,
      head: [['Keterangan', 'Rupiah']],
      body: tableBody,
      theme: 'plain',
      styles: {
        fontSize: 8,
        cellPadding: { top: 1.5, bottom: 1.5, left: 2, right: 2 },
        lineColor: [200, 200, 200] as [number, number, number],
        lineWidth: 0,
        overflow: 'linebreak',
      },
      headStyles: {
        fillColor: [243, 244, 246] as [number, number, number],
        fontStyle: 'bold',
        fontSize: 8,
        textColor: [30, 30, 30] as [number, number, number],
      },
      columnStyles: {
        0: { halign: 'left',  cellWidth: 'auto' },
        1: { halign: 'right', cellWidth: 38 },
      },
      didParseCell: (hookData: CellHookData) => {
        const rowIndex = hookData.row.index;
        const row = rows[rowIndex];
        if (!row) return;

        const kind = row.kind;

        if (kind === 'section') {
          const bg = sectionMap[rowIndex] ?? COLORS.gray50;
          hookData.cell.styles.fillColor = bg;
          hookData.cell.styles.fontStyle = 'bold';
        } else if (kind === 'subtotal') {
          hookData.cell.styles.fontStyle = 'bold';
          if (hookData.column.index === 1) {
            hookData.cell.styles.lineWidth = { top: 0.3, bottom: 0, left: 0, right: 0 };
            hookData.cell.styles.lineColor = [180, 180, 180];
          }
        } else if (kind === 'emphasis') {
          hookData.cell.styles.fillColor = COLORS.blue50;
          hookData.cell.styles.fontStyle = 'bold';
        } else if (kind === 'emphasis-final') {
          hookData.cell.styles.fillColor = COLORS.emerald100;
          hookData.cell.styles.fontStyle = 'bold';
          hookData.cell.styles.lineColor = [5, 150, 105];
          hookData.cell.styles.lineWidth = { top: 0.5, bottom: 0.5, left: 0, right: 0 };
        }
      },
    };
  }

  // Draw LEFT table (ASET)
  autoTable(doc, makeSidePanelOptions(leftRows, leftTableLeft, y));
  const leftFinalY = doc.lastAutoTable.finalY;

  // Draw RIGHT table (LIABILITAS + EKUITAS), same startY to align tops
  autoTable(doc, makeSidePanelOptions(rightRows, rightTableLeft, y));
  const rightFinalY = doc.lastAutoTable.finalY;

  // -------------------------------------------------------------------
  // Totals confirmation line
  // -------------------------------------------------------------------
  const totalY = Math.max(leftFinalY, rightFinalY) + 8;

  // Double-rule above
  doc.setDrawColor(30, 30, 30);
  doc.setLineWidth(0.5);
  doc.line(margin, totalY - 2, pageWidth - margin, totalY - 2);
  doc.line(margin, totalY - 0.5, pageWidth - margin, totalY - 0.5);

  const totalLabel = `TOTAL ASET = TOTAL LIABILITAS + EKUITAS   Rp ${new Intl.NumberFormat('id-ID').format(Math.abs(data.totalAset))}`;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text(totalLabel, cx, totalY + 4, { align: 'center' });

  // -------------------------------------------------------------------
  // Footer
  // -------------------------------------------------------------------
  drawFooter(doc, options, margin);

  // Suppress unused variable warning — pageHeight used to ensure pageHeight is known
  void pageHeight;

  return doc.output('blob');
}
