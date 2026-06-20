// Tanda Terima PDF — client-side jsPDF generation per spec §9 + decision Q2.
// A5 format, monospace courier, regenerated from current TF state (no snapshot).
// After printing, mark `tanda_terima_printed_at` for audit (non-fatal).
import jsPDF from 'jspdf';
import type { DbTukarFaktur } from '../types';
import { tukarFakturService } from './tukarFakturService';

// TODO: Phase 3 multi-tenant — read from store_settings.
const COMPANY_NAME = 'Garindo Jaya Panel';

function fmtDate(s?: string | null) {
  return s
    ? new Date(s).toLocaleDateString('id-ID', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      })
    : '—';
}

function fmtRp(n: number) {
  return 'Rp ' + Math.round(n).toLocaleString('id-ID');
}

export function generateTandaTerima(tf: DbTukarFaktur): Blob {
  const doc = new jsPDF({ format: 'a5', unit: 'mm', orientation: 'portrait' });
  // A5 portrait is 148 x 210mm
  const pageW = 148;
  const leftX = 8;
  const rightX = pageW - 8;
  const centerX = pageW / 2;
  let y = 14;

  doc.setFontSize(11).setFont('courier', 'bold');
  doc.text('TANDA TERIMA TUKAR FAKTUR', centerX, y, { align: 'center' });
  y += 5;
  doc.setFontSize(9);
  doc.text(tf.tf_number, centerX, y, { align: 'center' });
  y += 4;
  doc.setLineDashPattern([1, 1], 0);
  doc.line(leftX, y, rightX, y);
  y += 4;
  doc.setFontSize(8).setFont('courier', 'normal');

  const headerRows: Array<[string, string]> = [
    ['Tanggal', fmtDate(tf.tukar_date)],
    ['Supplier', tf.supplier?.name ?? '—'],
    ['Penerima', COMPANY_NAME],
    ['JT Bayar', fmtDate(tf.payment_due_at)],
  ];
  headerRows.forEach(([k, v]) => {
    doc.text(k + ':', leftX, y);
    doc.text(v, rightX, y, { align: 'right' });
    y += 4;
  });
  y += 2;
  doc.setLineDashPattern([1, 1], 0);
  doc.line(leftX, y, rightX, y);
  y += 4;
  doc.setFont('courier', 'bold').text('DAFTAR FAKTUR:', leftX, y);
  y += 4;
  doc.setFont('courier', 'normal');
  (tf.tagihans ?? []).forEach((t, idx) => {
    const label = t.supplier_invoice_number || t.pi_number;
    doc.text(`${idx + 1}. ${label}`, leftX, y);
    doc.text(fmtRp(Number(t.total)), rightX, y, { align: 'right' });
    y += 4;
  });
  y += 1;
  doc.setLineDashPattern([], 0);
  doc.line(leftX, y, rightX, y);
  y += 4;
  doc.setFont('courier', 'bold');
  doc.text('TOTAL', leftX, y);
  doc.text(fmtRp(Number(tf.total_amount)), rightX, y, { align: 'right' });
  y += 16;

  // Signature blocks
  doc.setFont('courier', 'normal').setFontSize(7);
  doc.line(20, y, 60, y);
  doc.line(88, y, 128, y);
  y += 3;
  doc.text('Penerima', 40, y, { align: 'center' });
  doc.text('Penyerah', 108, y, { align: 'center' });
  y += 6;
  doc.setFontSize(6).setFont('courier', 'italic');
  doc.text(
    `Dicetak otomatis · ${COMPANY_NAME} · ${new Date().toLocaleString('id-ID')}`,
    centerX,
    y,
    { align: 'center' },
  );

  return doc.output('blob');
}

export async function printTandaTerima(tf: DbTukarFaktur) {
  const blob = generateTandaTerima(tf);
  const url = URL.createObjectURL(blob);
  window.open(url, '_blank');
  // Mark printed timestamp (audit) — non-fatal if it fails
  try {
    await tukarFakturService.markPrinted(tf.id);
  } catch {
    /* ignore */
  }
}
