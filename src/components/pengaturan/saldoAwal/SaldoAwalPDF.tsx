/**
 * SaldoAwalPDF — PDF export for Ringkasan Saldo Awal (Opening Balance Summary).
 *
 * Called by SaldoAwalWizard Step 4 preview:
 *   import { renderSaldoAwalPDF } from './SaldoAwalPDF';
 *   const blob = await renderSaldoAwalPDF(snapshot, tenantName);
 *
 * Downloads a single-page A4 PDF containing:
 *   - Header: tenant name + "Ringkasan Saldo Awal" + cutover date
 *   - Section Aktiva (Kas & Bank, Piutang, Persediaan, Aktiva Tetap, Lain-lain)
 *   - Section Kewajiban (Hutang Usaha, Lain-lain)
 *   - Section Ekuitas (Modal Owner, Prive, Laba Ditahan)
 *   - Total balance check row
 *   - Footer: signature lines for Owner + Akuntan
 *   - Dicetak timestamp
 */

import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { SaldoAwalSnapshot } from '../../../lib/saldoAwal/types';

// ---------------------------------------------------------------------------
// Extend jsPDF types to expose lastAutoTable from jspdf-autotable
// ---------------------------------------------------------------------------
declare module 'jspdf' {
  interface jsPDF {
    lastAutoTable: { finalY: number };
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function formatRpPDF(n: number): string {
  if (n === 0) return '—';
  const formatted = new Intl.NumberFormat('id-ID').format(Math.abs(n));
  return n < 0 ? `(${formatted})` : formatted;
}

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

function formatCutoverDate(iso: string): string {
  // "2026-06-30" → "30 Juni 2026"
  const ID_MONTHS = [
    'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
    'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
  ];
  const parts = iso.split('-');
  const year = parts[0] ?? '';
  const month = parseInt(parts[1] ?? '1', 10);
  const day = parseInt(parts[2] ?? '1', 10);
  return `${day} ${ID_MONTHS[month - 1] ?? ''} ${year}`;
}

// RGB tuples for jspdf-autotable fillColor
const COLOR_HEADER_BG: [number, number, number] = [243, 244, 246];  // gray-100
const COLOR_SECTION_AKTIVA: [number, number, number] = [209, 250, 229]; // emerald-100
const COLOR_SECTION_KEWAJIBAN: [number, number, number] = [254, 226, 226]; // rose-100
const COLOR_SECTION_EKUITAS: [number, number, number] = [219, 234, 254]; // blue-100
const COLOR_TOTAL_ROW: [number, number, number] = [17, 24, 39]; // gray-900 dark
const COLOR_WHITE: [number, number, number] = [255, 255, 255];
const COLOR_SUBTOTAL: [number, number, number] = [249, 250, 251]; // gray-50
const COLOR_BALANCE_OK: [number, number, number] = [236, 253, 245]; // emerald-50
const COLOR_BALANCE_NG: [number, number, number] = [255, 241, 242]; // rose-50

interface TableRow {
  label: string;
  amount: number | null;
  kind: 'section' | 'detail' | 'subtotal' | 'grand-total' | 'balance';
  sectionColor?: [number, number, number];
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generate and download Ringkasan Saldo Awal PDF.
 *
 * @param snapshot  - The SaldoAwalSnapshot from getSaldoAwalState() or wizard state
 * @param tenantName - Display name for the tenant (e.g. "Garindo Jaya Panel")
 * @returns Promise<Blob> with the PDF content (also triggers browser download)
 */
export async function renderSaldoAwalPDF(
  snapshot: SaldoAwalSnapshot,
  tenantName: string,
): Promise<Blob> {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const margin = 15;
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const cx = pageWidth / 2;

  const sd = snapshot.step_data;
  const cutoverLabel = formatCutoverDate(snapshot.cutover_date);
  const now = new Date();

  // ── Header ──────────────────────────────────────────────────────────────
  let y = margin;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.text(tenantName, cx, y, { align: 'center' });
  y += 7;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.text('RINGKASAN SALDO AWAL', cx, y, { align: 'center' });
  y += 7;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.text(`Per Cutover Date: ${cutoverLabel}`, cx, y, { align: 'center' });
  y += 10;

  // ── Build table rows ─────────────────────────────────────────────────────

  const rows: TableRow[] = [];

  // ── AKTIVA ───────────────────────────────────────────────────────────────
  rows.push({ label: 'AKTIVA', amount: null, kind: 'section', sectionColor: COLOR_SECTION_AKTIVA });

  // Kas & Bank (from step1_cash.accounts)
  let totalKas = 0;
  for (const acc of sd.step1_cash.accounts) {
    rows.push({ label: `  ${acc.cash_account_name}`, amount: acc.opening_balance, kind: 'detail' });
    totalKas += acc.opening_balance;
  }
  if (sd.step1_cash.accounts.length === 0) {
    rows.push({ label: '  Kas & Bank', amount: 0, kind: 'detail' });
  }

  // Piutang Usaha
  const piutang = sd.step2_aktiva.piutang.aggregate_amount;
  rows.push({ label: '  Piutang Usaha', amount: piutang, kind: 'detail' });

  // Persediaan
  const persediaan = sd.step2_aktiva.persediaan.final_amount;
  rows.push({ label: '  Persediaan', amount: persediaan, kind: 'detail' });

  // Aktiva Tetap
  const aktivaTetap = sd.step2_aktiva.aktiva_tetap.amount;
  if (aktivaTetap > 0) {
    rows.push({ label: '  Aktiva Tetap (neto)', amount: aktivaTetap, kind: 'detail' });
  }

  // Aktiva lain-lain
  for (const item of sd.step2_aktiva.lain_lain) {
    rows.push({ label: `  ${item.coa_name}`, amount: item.amount, kind: 'detail' });
  }

  const totalAktiva =
    totalKas +
    piutang +
    persediaan +
    aktivaTetap +
    sd.step2_aktiva.lain_lain.reduce((s, r) => s + r.amount, 0);

  rows.push({ label: 'Total Aktiva', amount: totalAktiva, kind: 'subtotal' });

  // ── KEWAJIBAN ─────────────────────────────────────────────────────────────
  rows.push({ label: '', amount: null, kind: 'detail' }); // blank spacer
  rows.push({ label: 'KEWAJIBAN', amount: null, kind: 'section', sectionColor: COLOR_SECTION_KEWAJIBAN });

  const hutang = sd.step3_kewajiban.hutang_usaha.aggregate_amount;
  rows.push({ label: '  Hutang Usaha', amount: hutang, kind: 'detail' });

  for (const item of sd.step3_kewajiban.lain_lain) {
    rows.push({ label: `  ${item.coa_name}`, amount: item.amount, kind: 'detail' });
  }

  const totalKewajiban =
    hutang + sd.step3_kewajiban.lain_lain.reduce((s, r) => s + r.amount, 0);

  rows.push({ label: 'Total Kewajiban', amount: totalKewajiban, kind: 'subtotal' });

  // ── EKUITAS ───────────────────────────────────────────────────────────────
  rows.push({ label: '', amount: null, kind: 'detail' }); // blank spacer
  rows.push({ label: 'EKUITAS', amount: null, kind: 'section', sectionColor: COLOR_SECTION_EKUITAS });

  const modal = sd.step4_ekuitas.modal_owner.amount;
  rows.push({ label: '  Modal Owner', amount: modal, kind: 'detail' });

  const prive = sd.step4_ekuitas.prive.amount;
  if (prive > 0) {
    rows.push({ label: '  Prive (Pengambilan)', amount: -prive, kind: 'detail' });
  }

  // Laba Ditahan — balancing figure: Aktiva - Kewajiban - (Modal - Prive)
  const labaDitahan = totalAktiva - totalKewajiban - (modal - prive);
  rows.push({ label: '  Laba Ditahan', amount: labaDitahan, kind: 'detail' });

  const totalEkuitas = modal - prive + labaDitahan;
  rows.push({ label: 'Total Ekuitas', amount: totalEkuitas, kind: 'subtotal' });

  // ── TOTAL CHECK ROW ───────────────────────────────────────────────────────
  const totalKewajibanEkuitas = totalKewajiban + totalEkuitas;
  const isBalanced = Math.abs(totalAktiva - totalKewajibanEkuitas) < 0.01;
  rows.push({
    label: isBalanced ? '✓ SEIMBANG — Total Aktiva = Kewajiban + Ekuitas' : '✗ TIDAK SEIMBANG — Periksa kembali',
    amount: totalAktiva,
    kind: 'balance',
  });

  // ── Render table ──────────────────────────────────────────────────────────
  const tableBody = rows.map(r => [r.label, r.amount !== null ? formatRpPDF(r.amount) : '']);

  autoTable(doc, {
    startY: y,
    margin: { left: margin, right: margin },
    head: [['Keterangan', 'Rupiah (Rp)']],
    body: tableBody,
    theme: 'plain',
    styles: {
      fontSize: 9,
      cellPadding: { top: 1.5, bottom: 1.5, left: 2, right: 2 },
      overflow: 'linebreak',
    },
    headStyles: {
      fillColor: COLOR_HEADER_BG,
      fontStyle: 'bold',
      fontSize: 9,
      textColor: [30, 30, 30] as [number, number, number],
    },
    columnStyles: {
      0: { halign: 'left',  cellWidth: 'auto' },
      1: { halign: 'right', cellWidth: 48 },
    },
    didParseCell: (hookData) => {
      const ri = hookData.row.index;
      const row = rows[ri];
      if (!row || hookData.section !== 'body') return;

      switch (row.kind) {
        case 'section':
          hookData.cell.styles.fillColor = row.sectionColor ?? COLOR_HEADER_BG;
          hookData.cell.styles.fontStyle = 'bold';
          hookData.cell.styles.fontSize = 9;
          break;
        case 'subtotal':
          hookData.cell.styles.fillColor = COLOR_SUBTOTAL;
          hookData.cell.styles.fontStyle = 'bold';
          break;
        case 'balance':
          hookData.cell.styles.fillColor = isBalanced ? COLOR_BALANCE_OK : COLOR_BALANCE_NG;
          hookData.cell.styles.fontStyle = 'bold';
          hookData.cell.styles.fontSize = 9;
          hookData.cell.styles.textColor = isBalanced
            ? [6, 95, 70] as [number, number, number]
            : [159, 18, 57] as [number, number, number];
          break;
        case 'detail':
          hookData.cell.styles.fillColor = COLOR_WHITE;
          break;
      }
    },
  });

  // ── Signature lines ───────────────────────────────────────────────────────
  const sigY = (doc.lastAutoTable?.finalY ?? y + 40) + 12;

  // Guard: if we're too close to the bottom, skip signatures (will be cut off)
  if (sigY < pageHeight - 40) {
    const leftX = margin + 10;
    const rightX = pageWidth - margin - 60;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.text('Mengetahui,', leftX, sigY);
    doc.text('Disiapkan oleh,', rightX, sigY);

    const lineY = sigY + 18;
    doc.setLineWidth(0.3);
    doc.line(leftX, lineY, leftX + 55, lineY);
    doc.line(rightX, lineY, rightX + 55, lineY);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.text('Owner', leftX, lineY + 5);
    doc.text('Akuntan', rightX, lineY + 5);
  }

  // ── Footer ────────────────────────────────────────────────────────────────
  const footerY = pageHeight - 8;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(120, 120, 120);
  doc.text(`Dicetak: ${formatWIB(now)}`, margin, footerY);
  doc.text('Garindo ERP', pageWidth - margin, footerY, { align: 'right' });
  doc.setTextColor(0, 0, 0);

  // ── Output ────────────────────────────────────────────────────────────────
  const blob = doc.output('blob');
  const fileName = `saldo-awal-${snapshot.cutover_date}.pdf`;

  // Trigger browser download
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);

  return blob;
}
