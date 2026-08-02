// Tukar Faktur Detail — Phase 2b.
// Layout per mockup Layar 5:
//   - Header w/ status badge + actions (Cetak · Edit Header · Hapus · Bayar)
//   - 3 header cards: Supplier · JT Countdown · Total/Pembayaran
//   - Daftar Faktur table w/ JT-asli strikethrough when overridden
//   - Riwayat + Lampiran (Lampiran shown only if photo_urls populated)
//   - Tanda Terima preview collapsible
import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  CalendarClock,
  ChevronRight,
  CreditCard,
  FileText,
  Printer,
  Sparkles,
  Store,
  X,
  XOctagon,
} from 'lucide-react';
import { tukarFakturService } from '../../../lib/tukarFakturService';
import type { DbTukarFaktur, TukarFakturStatus, UpdateTukarFakturPayload } from '../../../types';
import { formatIDR } from '../../../lib/formatIDR';

interface Props {
  tfNumber: string;
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
  onBack: () => void;
  /** Parent navigates to Pembayaran form with `?prefill_tf=<id>`. */
  onBayar: (tfId: string) => void;
}

const fmtDate = (s?: string | null) =>
  s ? new Date(s).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

const STATUS_BADGE: Record<TukarFakturStatus, string> = {
  BELUM_LUNAS: 'bg-amber-100 text-amber-800',
  DIBAYAR_SEBAGIAN: 'bg-sky-100 text-sky-800',
  LUNAS: 'bg-green-100 text-green-800',
  VOIDED: 'bg-gray-200 text-gray-600',
};

const STATUS_LABEL: Record<TukarFakturStatus, string> = {
  BELUM_LUNAS: 'Belum Lunas',
  DIBAYAR_SEBAGIAN: 'Dibayar Sebagian',
  LUNAS: 'Lunas',
  VOIDED: 'Dihapus',
};

function daysFromToday(s?: string | null): number | null {
  if (!s) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((new Date(s + 'T00:00:00').getTime() - today.getTime()) / 86400000);
}

export default function TukarFakturDetailPage({ tfNumber, showToast, onBack, onBayar }: Props) {
  const [tf, setTf] = useState<DbTukarFaktur | null>(null);
  const [loading, setLoading] = useState(true);
  const [printing, setPrinting] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [showDelete, setShowDelete] = useState(false);

  async function reload() {
    setLoading(true);
    try {
      const result = await tukarFakturService.fetchByNumber(tfNumber);
      setTf(result);
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Gagal load Tukar Faktur', 'warning');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tfNumber]);

  async function handlePrint() {
    if (!tf) return;
    setPrinting(true);
    try {
      const { printTandaTerima } = await import('../../../lib/tandaTerimaPdf');
      await printTandaTerima(tf);
      showToast('Tanda Terima dibuka di tab baru.', 'success');
      // Refresh to show new printed_at timestamp
      await reload();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Gagal cetak Tanda Terima', 'warning');
    } finally {
      setPrinting(false);
    }
  }

  if (loading) {
    return <div className="p-8 text-center text-sm text-gray-500">Memuat...</div>;
  }
  if (!tf) {
    return <div className="p-8 text-center text-sm text-gray-500">Tukar Faktur tidak ditemukan.</div>;
  }

  const isVoided = !!tf.voided_at;
  const isLunas = tf.status === 'LUNAS';
  const isPaid = Number(tf.paid_amount) > 0;
  const canBayar = !isVoided && !isLunas;
  const canDelete = !isVoided && !isPaid;

  const days = daysFromToday(tf.payment_due_at);
  const dueSoon = !isLunas && !isVoided && days !== null && days <= 7;
  const overdue = days !== null && days < 0 && !isLunas && !isVoided;

  // JT countdown progress bar: assume window = 30 days from tukar_date to JT.
  // If today within that window, show progress; else clamp.
  const totalWindowMs =
    new Date(tf.payment_due_at + 'T00:00:00').getTime() -
    new Date(tf.tukar_date + 'T00:00:00').getTime();
  const elapsedMs = Date.now() - new Date(tf.tukar_date + 'T00:00:00').getTime();
  const progressPct =
    totalWindowMs > 0 ? Math.max(0, Math.min(100, (elapsedMs / totalWindowMs) * 100)) : 0;

  const outstanding = Number(tf.total_amount) - Number(tf.paid_amount);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-xs text-gray-500">
        <button onClick={onBack} className="inline-flex items-center gap-1 hover:text-gray-800">
          <ArrowLeft className="w-3 h-3" /> Pembelian
        </button>
        <ChevronRight className="w-3 h-3" />
        <span>Tukar Faktur</span>
        <ChevronRight className="w-3 h-3" />
        <span className="text-gray-800 font-semibold">{tf.tf_number}</span>
      </div>

      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <h1 className="text-xl font-extrabold" style={{ color: 'var(--color-caleo-primary)' }}>
              {tf.tf_number}
            </h1>
            <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${STATUS_BADGE[tf.status]}`}>
              {STATUS_LABEL[tf.status]}
            </span>
          </div>
          <div className="text-xs text-gray-500">
            Tukar Faktur tanggal {fmtDate(tf.tukar_date)} · {tf.supplier?.name ?? '—'}
          </div>
        </div>

        <div className="flex gap-2 flex-wrap">
          <button
            onClick={handlePrint}
            disabled={printing}
            className="inline-flex items-center gap-2 text-sm font-semibold text-gray-700 px-3 py-2 rounded-sm border border-gray-200 hover:bg-gray-50 disabled:opacity-50"
          >
            <Printer className="w-4 h-4" /> {printing ? 'Memproses...' : 'Cetak Tanda Terima'}
          </button>
          {!isVoided && (
            <button
              onClick={() => setShowEdit(true)}
              className="text-sm font-semibold text-gray-700 px-3 py-2 rounded-sm border border-gray-200 hover:bg-gray-50"
            >
              Edit Header
            </button>
          )}
          {canDelete && (
            <button
              onClick={() => setShowDelete(true)}
              className="inline-flex items-center gap-2 text-sm font-semibold text-red-700 px-3 py-2 rounded-sm border border-red-200 hover:bg-red-50"
            >
              <XOctagon className="w-4 h-4" /> Hapus
            </button>
          )}
          {canBayar && (
            <button
              onClick={() => onBayar(tf.id)}
              className="inline-flex items-center gap-2 text-sm font-bold text-white px-3 py-2 rounded-sm"
              style={{ background: 'var(--color-caleo-primary)' }}
            >
              <CreditCard className="w-4 h-4" /> Bayar Tukar Faktur
            </button>
          )}
        </div>
      </div>

      {isVoided && (
        <div className="bg-red-50 border border-red-200 rounded-sm p-4 flex items-start gap-3">
          <AlertTriangle className="w-4 h-4 text-red-600 mt-0.5 flex-shrink-0" />
          <div>
            <div className="text-sm font-bold text-red-800">Tukar Faktur ini sudah dihapus</div>
            <div className="text-xs text-red-700 mt-1">{tf.notes ?? '—'}</div>
            <div className="text-[11px] text-red-600 mt-1">Dihapus {fmtDate(tf.voided_at)}</div>
          </div>
        </div>
      )}

      {/* Header cards */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-white/78 backdrop-blur-xl rounded-sm border border-gray-200 shadow-sm p-4">
          <div className="flex items-center gap-2 mb-2">
            <Store className="w-3.5 h-3.5 text-violet-600" />
            <div className="text-[11px] font-bold uppercase tracking-wide text-gray-500">Supplier</div>
          </div>
          <div className="font-bold text-gray-800">{tf.supplier?.name ?? '—'}</div>
          <div className="text-xs text-gray-500 mt-1">
            Net {tf.supplier?.payment_term_days ?? 0} hari
          </div>
        </div>

        <div
          className={`rounded-sm border shadow-sm p-4 ${
            overdue
              ? 'bg-red-50 border-red-200'
              : dueSoon
              ? 'bg-amber-50 border-amber-200'
              : 'bg-white/78 backdrop-blur-xl border-gray-200'
          }`}
        >
          <div className="flex items-center gap-2 mb-2">
            <CalendarClock
              className={`w-3.5 h-3.5 ${
                overdue ? 'text-red-600' : dueSoon ? 'text-amber-600' : 'text-indigo-600'
              }`}
            />
            <div
              className={`text-[11px] font-bold uppercase tracking-wide ${
                overdue ? 'text-red-700' : dueSoon ? 'text-amber-700' : 'text-gray-500'
              }`}
            >
              Jatuh Tempo
            </div>
          </div>
          <div
            className={`font-bold ${
              overdue ? 'text-red-700' : dueSoon ? 'text-amber-700' : 'text-gray-800'
            }`}
          >
            {fmtDate(tf.payment_due_at)}
          </div>
          {!isLunas && !isVoided && days !== null && (
            <div
              className={`text-xs font-semibold mt-1 ${
                overdue ? 'text-red-600' : dueSoon ? 'text-amber-600' : 'text-gray-500'
              }`}
            >
              {days < 0
                ? `Terlambat ${Math.abs(days)} hari`
                : days === 0
                ? 'Hari ini'
                : `${days} hari lagi`}
            </div>
          )}
          <div className="mt-2 w-full h-1.5 bg-white/60 rounded-full overflow-hidden border border-gray-100">
            <div
              className={`h-full ${
                overdue ? 'bg-red-500' : dueSoon ? 'bg-amber-500' : 'bg-indigo-400'
              }`}
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>

        <div
          className={`rounded-sm border shadow-sm p-4 ${
            isLunas ? 'bg-green-50 border-green-200' : 'bg-indigo-50 border-indigo-200'
          }`}
        >
          <div className="flex items-center gap-2 mb-2">
            <FileText
              className={`w-3.5 h-3.5 ${isLunas ? 'text-green-700' : 'text-indigo-600'}`}
            />
            <div
              className={`text-[11px] font-bold uppercase tracking-wide ${
                isLunas ? 'text-green-700' : 'text-indigo-700'
              }`}
            >
              Total Bundle
            </div>
          </div>
          <div
            className={`text-xl font-extrabold ${isLunas ? 'text-green-700' : 'text-indigo-700'}`}
          >
            {formatIDR(tf.total_amount)}
          </div>
          <div className="text-[11px] text-gray-600 mt-1">
            Dibayar <strong>{formatIDR(tf.paid_amount)}</strong>
            {!isLunas && (
              <>
                {' '}· Sisa <strong>{formatIDR(outstanding)}</strong>
              </>
            )}
          </div>
        </div>
      </div>

      {tf.notes && (
        <div className="bg-white/78 backdrop-blur-xl rounded-sm border border-gray-200 shadow-sm p-4">
          <div className="text-[11px] font-bold uppercase tracking-wide text-gray-500 mb-1">
            Catatan
          </div>
          <div className="text-sm text-gray-700">{tf.notes}</div>
        </div>
      )}

      {/* Daftar Faktur dalam Bundle */}
      <div className="bg-white/78 backdrop-blur-xl rounded-sm border border-gray-200 shadow-sm p-5">
        <div className="flex items-center justify-between mb-3">
          <div className="text-xs font-bold uppercase tracking-wide text-gray-500">
            Daftar Faktur dalam Bundle
          </div>
          <div className="text-[11px] text-gray-500">{tf.tagihans?.length ?? 0} Faktur</div>
        </div>
        {(!tf.tagihans || tf.tagihans.length === 0) ? (
          <div className="p-6 text-center text-sm text-gray-400 border border-dashed border-gray-200 rounded-sm">
            Tidak ada Faktur dalam bundle ini.
          </div>
        ) : (
          <table className="w-full">
            <thead className="border-b border-gray-200">
              <tr>
                <th className="text-left py-2 text-[11px] font-semibold text-gray-500 uppercase">
                  Faktur
                </th>
                <th className="text-center py-2 w-24 text-[11px] font-semibold text-gray-500 uppercase">
                  Tgl
                </th>
                <th className="text-center py-2 w-44 text-[11px] font-semibold text-gray-500 uppercase">
                  JT (asli → bundle)
                </th>
                <th className="text-right py-2 w-32 text-[11px] font-semibold text-gray-500 uppercase">
                  Nominal
                </th>
                <th className="text-right py-2 w-32 text-[11px] font-semibold text-gray-500 uppercase">
                  Dibayar
                </th>
              </tr>
            </thead>
            <tbody>
              {(tf.tagihans ?? []).map(t => {
                const jtOverridden = t.payment_due_at !== tf.payment_due_at;
                return (
                  <tr key={t.id} className="border-b border-gray-100">
                    <td className="py-3">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="bg-gray-100 text-gray-700 text-xs font-bold px-2 py-0.5 rounded">
                          {t.pi_number}
                        </span>
                        {t.supplier_invoice_number && (
                          <span className="text-xs text-gray-500">{t.supplier_invoice_number}</span>
                        )}
                        {t.is_tf_quick_add && (
                          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-sky-100 text-sky-700 inline-flex items-center gap-1">
                            <Sparkles className="w-3 h-3" /> Quick-add
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="py-3 text-center text-xs text-gray-600">
                      {fmtDate(t.purchase_date)}
                    </td>
                    <td className="py-3 text-center text-xs">
                      {jtOverridden ? (
                        <>
                          <span className="line-through text-gray-400">
                            {fmtDate(t.payment_due_at)}
                          </span>
                          <span className="mx-1 text-gray-400">→</span>
                          <span className="font-bold text-amber-700">
                            {fmtDate(tf.payment_due_at)}
                          </span>
                        </>
                      ) : (
                        <span className="font-bold text-gray-700">{fmtDate(t.payment_due_at)}</span>
                      )}
                    </td>
                    <td className="py-3 text-right text-sm font-bold" style={{ color: 'var(--color-caleo-primary)' }}>
                      {formatIDR(Number(t.total))}
                    </td>
                    <td
                      className={`py-3 text-right text-sm ${
                        Number(t.paid_amount) > 0 ? 'text-sky-700 font-bold' : 'text-gray-400'
                      }`}
                    >
                      {formatIDR(Number(t.paid_amount))}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={3} className="py-3 text-right text-xs font-semibold text-gray-500">
                  TOTAL
                </td>
                <td className="py-3 text-right text-xl font-extrabold" style={{ color: 'var(--color-caleo-primary)' }}>
                  {formatIDR(tf.total_amount)}
                </td>
                <td className="py-3 text-right text-sm font-bold text-sky-700">
                  {formatIDR(tf.paid_amount)}
                </td>
              </tr>
            </tfoot>
          </table>
        )}
      </div>

      {/* Lampiran + Riwayat */}
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-white/78 backdrop-blur-xl rounded-sm border border-gray-200 shadow-sm p-4">
          <div className="text-[11px] font-bold uppercase tracking-wide text-gray-500 mb-2">
            Lampiran Foto
          </div>
          {tf.photo_urls && tf.photo_urls.length > 0 ? (
            <div className="grid grid-cols-3 gap-2">
              {tf.photo_urls.map((u, i) => (
                <a key={i} href={u} target="_blank" rel="noopener noreferrer" className="block">
                  <img
                    src={u}
                    alt={`Lampiran ${i + 1}`}
                    className="w-full h-20 object-cover rounded-sm border border-gray-200"
                  />
                </a>
              ))}
            </div>
          ) : (
            <div className="text-xs text-gray-400">Belum ada lampiran foto.</div>
          )}
        </div>

        <div className="bg-gray-50 rounded-sm border border-gray-200 p-4">
          <div className="text-[11px] font-bold uppercase tracking-wide text-gray-500 mb-2">
            Riwayat
          </div>
          <div className="space-y-1 text-xs text-gray-600">
            <div>Dibuat {fmtDate(tf.created_at)}</div>
            {tf.updated_at !== tf.created_at && <div>Update {fmtDate(tf.updated_at)}</div>}
            {tf.tanda_terima_printed_at && (
              <div>Tanda Terima dicetak {fmtDate(tf.tanda_terima_printed_at)}</div>
            )}
            {Number(tf.paid_amount) > 0 && (
              <div>Total dibayar {formatIDR(tf.paid_amount)}</div>
            )}
            {tf.voided_at && (
              <div className="text-red-600">Dihapus {fmtDate(tf.voided_at)}</div>
            )}
          </div>
        </div>
      </div>

      {/* Tanda Terima preview */}
      <details className="bg-white/78 backdrop-blur-xl rounded-sm border border-gray-200 shadow-sm overflow-hidden">
        <summary className="cursor-pointer px-5 py-3 text-xs font-bold uppercase tracking-wide text-gray-500 hover:bg-gray-50">
          Preview Tanda Terima (klik untuk expand)
        </summary>
        <div className="px-5 pb-5 pt-2 bg-gray-50 border-t border-gray-200">
          <pre className="font-mono text-[10px] leading-tight whitespace-pre overflow-auto text-gray-700">
{buildTandaTerimaPreview(tf)}
          </pre>
        </div>
      </details>

      {showEdit && tf && (
        <EditHeaderModal
          tf={tf}
          showToast={showToast}
          onClose={() => setShowEdit(false)}
          onSaved={async () => {
            setShowEdit(false);
            await reload();
          }}
        />
      )}

      {showDelete && tf && (
        <DeleteTfModal
          tf={tf}
          showToast={showToast}
          onClose={() => setShowDelete(false)}
          onDeleted={() => {
            setShowDelete(false);
            onBack();
          }}
        />
      )}
    </div>
  );
}

function buildTandaTerimaPreview(tf: DbTukarFaktur): string {
  const lines: string[] = [];
  lines.push('   TANDA TERIMA TUKAR FAKTUR');
  lines.push(`         ${tf.tf_number}`);
  lines.push('--------------------------------');
  lines.push(`Tanggal  : ${fmtDate(tf.tukar_date)}`);
  lines.push(`Supplier : ${tf.supplier?.name ?? '—'}`);
  lines.push(`JT Bayar : ${fmtDate(tf.payment_due_at)}`);
  lines.push('--------------------------------');
  lines.push('DAFTAR FAKTUR:');
  (tf.tagihans ?? []).forEach((t, i) => {
    const label = t.supplier_invoice_number || t.pi_number;
    lines.push(`${i + 1}. ${label.padEnd(18)} ${formatIDR(Number(t.total)).padStart(12)}`);
  });
  lines.push('--------------------------------');
  lines.push(`TOTAL${' '.repeat(15)}${formatIDR(Number(tf.total_amount)).padStart(12)}`);
  return lines.join('\n');
}

// ── Edit Header Modal ──
interface EditHeaderProps {
  tf: DbTukarFaktur;
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
  onClose: () => void;
  onSaved: () => void;
}

function EditHeaderModal({ tf, showToast, onClose, onSaved }: EditHeaderProps) {
  const [tukarDate, setTukarDate] = useState(tf.tukar_date);
  const [paymentDueAt, setPaymentDueAt] = useState(tf.payment_due_at);
  const [notes, setNotes] = useState(tf.notes ?? '');
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setSaving(true);
    try {
      const payload: UpdateTukarFakturPayload = {
        tukar_date: tukarDate,
        payment_due_at: paymentDueAt,
        notes: notes.trim() || undefined,
      };
      await tukarFakturService.update(tf.id, payload);
      showToast(`${tf.tf_number} di-update.`, 'success');
      onSaved();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Gagal update', 'warning');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="bg-white rounded-sm border border-gray-200 shadow-xl w-full max-w-md"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
          <h2 className="text-sm font-bold" style={{ color: 'var(--color-caleo-primary)' }}>
            Edit Header {tf.tf_number}
          </h2>
          <button onClick={onClose}>
            <X className="w-4 h-4 text-gray-400" />
          </button>
        </div>
        <div className="px-5 py-4 space-y-3">
          <div>
            <label className="text-xs font-semibold text-gray-600 block mb-1.5">
              Tanggal Tukar Faktur
            </label>
            <input
              type="date"
              value={tukarDate}
              onChange={e => setTukarDate(e.target.value)}
              className="w-full text-sm py-2 px-3 rounded-sm border border-gray-300"
            />
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-600 block mb-1.5">JT Bayar Bundle</label>
            <input
              type="date"
              value={paymentDueAt}
              onChange={e => setPaymentDueAt(e.target.value)}
              className="w-full text-sm py-2 px-3 rounded-sm border border-gray-300"
            />
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-600 block mb-1.5">Catatan</label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={3}
              className="w-full text-sm px-3 py-2 rounded-sm border border-gray-300"
            />
          </div>
          <div className="text-[11px] text-gray-500">
            Edit Header tidak mengubah daftar Faktur dalam bundle. Untuk ganti Faktur, gunakan tombol
            "Lepas dari Bundle" per row (Phase 2c).
          </div>
        </div>
        <div className="flex justify-end gap-2 px-5 py-3 border-t border-gray-200">
          <button
            onClick={onClose}
            className="text-sm font-medium text-gray-600 px-4 py-2 rounded-sm border border-gray-200 hover:bg-gray-50"
          >
            Batal
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="text-sm font-semibold text-white px-4 py-2 rounded-sm disabled:opacity-50"
            style={{ background: 'var(--color-caleo-primary)' }}
          >
            {saving ? 'Menyimpan...' : 'Simpan'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Delete Modal ──
interface DeleteProps {
  tf: DbTukarFaktur;
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
  onClose: () => void;
  onDeleted: () => void;
}

function DeleteTfModal({ tf, showToast, onClose, onDeleted }: DeleteProps) {
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const valid = reason.trim().length >= 10;

  async function handleConfirm() {
    if (!valid) return;
    setSaving(true);
    try {
      await tukarFakturService.delete(tf.id, reason.trim());
      showToast(`${tf.tf_number} dihapus.`, 'success');
      onDeleted();
    } catch (e) {
      const msg = String(e instanceof Error ? e.message : 'Gagal hapus');
      if (msg.includes('cannot_delete_paid_tf')) {
        showToast('TF sudah ada pembayaran — void Pembayaran dulu sebelum hapus.', 'warning');
      } else {
        showToast(msg, 'warning');
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="bg-white rounded-sm border border-red-200 shadow-xl w-full max-w-md"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-red-100 bg-red-50">
          <h2 className="text-sm font-bold text-red-800 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4" /> Hapus {tf.tf_number}
          </h2>
          <button onClick={onClose}>
            <X className="w-4 h-4 text-gray-400" />
          </button>
        </div>
        <div className="px-5 py-4 space-y-3">
          <p className="text-xs text-gray-600">
            Hapus akan: (1) unlink semua Tagihan biasa dari bundle (Tagihan tetap ada, JT kembali ke
            asli), (2) cascade-hapus Tagihan quick-add yang tidak punya konteks lain, (3) soft-delete
            TF (tetap visible di history).
          </p>
          <div>
            <label className="text-xs font-semibold text-gray-700 block mb-1">
              Alasan hapus (min. 10 karakter) *
            </label>
            <textarea
              value={reason}
              onChange={e => setReason(e.target.value)}
              rows={3}
              placeholder="Contoh: Salah supplier, mau dibuat ulang"
              className="w-full text-sm px-3 py-2 rounded-sm border border-gray-300 focus:border-red-400 focus:outline-none"
            />
            <div className="text-[11px] text-gray-400 mt-1">{reason.length} / 10 minimum</div>
          </div>
        </div>
        <div className="flex justify-end gap-2 px-5 py-3 border-t border-gray-200">
          <button
            onClick={onClose}
            className="text-sm font-medium text-gray-600 px-4 py-2 rounded-sm border border-gray-200 hover:bg-gray-50"
          >
            Batal
          </button>
          <button
            onClick={handleConfirm}
            disabled={!valid || saving}
            className="text-sm font-semibold text-white bg-red-600 px-4 py-2 rounded-sm hover:bg-red-700 disabled:opacity-50"
          >
            {saving ? 'Memproses...' : 'Hapus'}
          </button>
        </div>
      </div>
    </div>
  );
}
