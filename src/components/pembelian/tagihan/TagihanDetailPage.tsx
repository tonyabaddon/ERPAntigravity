// Tagihan Detail — read-only view of a STOCK type purchase_invoices row.
// Shows: Pesanan link card, Supplier card, JT card, attachments, items,
// paid_amount progress bar, Bayar action if not fully paid.
import React, { useEffect, useState } from 'react';
import {
  ChevronRight, Printer, ArrowLeft, Store, CalendarClock, Link as LinkIcon,
  AlertTriangle, XOctagon, X, Wallet, Layers,
} from 'lucide-react';
import { purchaseInvoiceService } from '../../../lib/purchaseInvoiceService';
import { supabase } from '../../../lib/supabaseClient';
import { navigate } from '../../../lib/urlRoute';
import type { DbPurchaseInvoice, TagihanStatus } from '../../../types';
import { wibDateString } from '../../../lib/format';

type TagihanRow = DbPurchaseInvoice & {
  pesanan_id?: string | null;
  paid_amount?: number;
  tukar_faktur_id?: string | null;
};

interface Props {
  tghNumber: string;
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
  onBack: () => void;
  onOpenPesanan?: (pesananId: string) => void;
  onOpenPembayaran?: (supplierId: string) => void;
}

const fmtRp = (n: number) => 'Rp ' + Math.round(n).toLocaleString('id-ID');
const fmtDate = (s?: string | null) =>
  s ? new Date(s).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

function effectiveStatus(t: TagihanRow, today = wibDateString()): TagihanStatus | 'TERLAMBAT' | 'VOID' {
  if (t.voided_at) return 'VOID';
  const s = t.status as TagihanStatus;
  if (s === 'LUNAS') return 'LUNAS';
  if (t.payment_due_at && t.payment_due_at < today) return 'TERLAMBAT';
  return s;
}

function statusBadgeCls(label: string): string {
  switch (label) {
    case 'LUNAS': return 'bg-green-100 text-green-800';
    case 'DIBAYAR_SEBAGIAN': return 'bg-sky-100 text-sky-800';
    case 'TERLAMBAT': return 'bg-red-100 text-red-800';
    case 'BELUM_LUNAS': return 'bg-amber-100 text-amber-800';
    case 'VOID': return 'bg-gray-200 text-gray-600';
    default: return 'bg-gray-100 text-gray-700';
  }
}

function statusLabel(label: string): string {
  switch (label) {
    case 'LUNAS': return '● Lunas';
    case 'DIBAYAR_SEBAGIAN': return '◐ Dibayar Sebagian';
    case 'TERLAMBAT': return '⚠ Terlambat';
    case 'BELUM_LUNAS': return '○ Belum Lunas';
    case 'VOID': return 'VOID';
    default: return label;
  }
}

export default function TagihanDetailPage({ tghNumber, showToast, onBack, onOpenPesanan, onOpenPembayaran }: Props) {
  const [tgh, setTgh] = useState<TagihanRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [showVoid, setShowVoid] = useState(false);
  // Phase 2b: if this Tagihan is bundled into a TF, show the linked TF number badge.
  // We use a separate fetch (no FK constraint exists on purchase_invoices.tukar_faktur_id
  // — Supabase's relationship embed wouldn't infer it).
  const [tfNumber, setTfNumber] = useState<string | null>(null);
  // Real pesanan_number lookup — was previously fabricating `PSN-<uuid-prefix>`
  // which doesn't match the tenant sequence (PSN-2026-0042), breaking any
  // cross-reference during audits or supplier disputes.
  const [pesananNumber, setPesananNumber] = useState<string | null>(null);

  async function reload() {
    setLoading(true);
    try {
      const data = await purchaseInvoiceService.fetchByNumber(tghNumber);
      setTgh(data as unknown as TagihanRow);
    } catch (e: any) {
      showToast(e?.message ?? 'Gagal load Tagihan', 'warning');
    } finally { setLoading(false); }
  }
  useEffect(() => { reload(); }, [tghNumber]);

  // Resolve linked TF number when tukar_faktur_id is present.
  useEffect(() => {
    const tfId = tgh?.tukar_faktur_id;
    if (!tfId || !supabase) { setTfNumber(null); return; }
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from('tukar_faktur')
        .select('tf_number')
        .eq('id', tfId)
        .maybeSingle();
      if (cancelled) return;
      if (error) {
        console.error('Failed to fetch linked tf_number:', error);
        setTfNumber(null);
        return;
      }
      setTfNumber((data as { tf_number?: string } | null)?.tf_number ?? null);
    })();
    return () => { cancelled = true; };
  }, [tgh?.tukar_faktur_id]);

  // Resolve real pesanan_number when pesanan_id is present.
  useEffect(() => {
    const psId = tgh?.pesanan_id;
    if (!psId || !supabase) { setPesananNumber(null); return; }
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from('pesanan')
        .select('pesanan_number')
        .eq('id', psId)
        .maybeSingle();
      if (cancelled) return;
      if (error) {
        console.error('Failed to fetch pesanan_number:', error);
        setPesananNumber(null);
        return;
      }
      setPesananNumber((data as { pesanan_number?: string } | null)?.pesanan_number ?? null);
    })();
    return () => { cancelled = true; };
  }, [tgh?.pesanan_id]);

  if (loading) return <div className="p-8 text-center text-sm text-gray-500">Memuat...</div>;
  if (!tgh) return <div className="p-8 text-center text-sm text-gray-500">Tagihan tidak ditemukan.</div>;

  const paid = Number(tgh.paid_amount ?? 0);
  const outstanding = Math.max(0, tgh.total - paid);
  const paidPct = tgh.total > 0 ? Math.min(100, (paid / tgh.total) * 100) : 0;
  const eff = effectiveStatus(tgh);
  const isVoided = eff === 'VOID';
  const canPay = !isVoided && eff !== 'LUNAS';

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-xs text-gray-500">
        <button onClick={onBack} className="inline-flex items-center gap-1 hover:text-gray-800"><ArrowLeft className="w-3 h-3" /> Pembelian</button>
        <ChevronRight className="w-3 h-3" /><span>Tagihan</span>
        <ChevronRight className="w-3 h-3" /><span className="text-gray-800 font-semibold">{tgh.pi_number}</span>
      </div>

      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <h1 className="text-xl font-extrabold" style={{ color: '#012749' }}>{tgh.pi_number}</h1>
            <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${statusBadgeCls(eff)}`}>{statusLabel(eff)}</span>
            <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-800">📦 Stok</span>
          </div>
          <div className="text-xs text-gray-500">Tanggal Faktur {fmtDate(tgh.purchase_date)} • {tgh.supplier?.name ?? '—'}</div>
        </div>
        <div className="flex gap-2">
          {/* Phase 2b: secondary entry to Tukar Faktur form (BELUM_LUNAS + not yet bundled). */}
          {tgh.status === 'BELUM_LUNAS' && !tgh.tukar_faktur_id && !isVoided && (
            <button
              onClick={() => navigate('pembelian', { tf: 'new', prefill_tagihan: tgh.id })}
              className="inline-flex items-center gap-1 text-sm font-semibold text-amber-700 px-3 py-2 rounded-lg border border-amber-300 bg-amber-50 hover:bg-amber-100"
            >
              <Layers className="w-4 h-4" /> Tambah ke Tukar Faktur
            </button>
          )}
          {/* Phase 2b: if already bundled, show TF badge linking to TF detail. */}
          {tgh.tukar_faktur_id && tfNumber && (
            <button
              onClick={() => navigate('pembelian', { tf: tfNumber })}
              className="inline-flex items-center gap-1 text-xs font-semibold text-amber-700 px-2.5 py-2 rounded-lg border border-amber-200 bg-amber-50 hover:bg-amber-100"
              title="Buka Tukar Faktur"
            >
              <Layers className="w-3.5 h-3.5" /> Bagian dari {tfNumber}
            </button>
          )}
          {canPay && onOpenPembayaran && (
            <button onClick={() => onOpenPembayaran(tgh.supplier_id)}
              className="inline-flex items-center gap-2 text-sm font-semibold text-white bg-green-600 px-3 py-2 rounded-lg hover:bg-green-700">
              <Wallet className="w-4 h-4" /> Bayar
            </button>
          )}
          {!isVoided && eff !== 'LUNAS' && (
            <button onClick={() => setShowVoid(true)} className="inline-flex items-center gap-2 text-sm font-semibold text-red-700 px-3 py-2 rounded-lg border border-red-200 hover:bg-red-50">
              <XOctagon className="w-4 h-4" /> Void
            </button>
          )}
          <button onClick={() => window.print()} className="inline-flex items-center gap-2 text-sm font-semibold text-gray-700 px-3 py-2 rounded-lg border border-gray-200 hover:bg-gray-50">
            <Printer className="w-4 h-4" /> Print
          </button>
        </div>
      </div>

      {isVoided && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-start gap-3">
          <AlertTriangle className="w-4 h-4 text-red-600 mt-0.5 flex-shrink-0" />
          <div>
            <div className="text-sm font-bold text-red-800">Tagihan ini sudah di-void</div>
            <div className="text-xs text-red-700 mt-1">{tgh.void_reason ?? '—'}</div>
            <div className="text-[11px] text-red-600 mt-1">Void {fmtDate(tgh.voided_at)}</div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-3 gap-4">
        <div className="bg-white/78 backdrop-blur-xl rounded-3xl border border-indigo-200 shadow-sm p-4">
          <div className="flex items-center gap-2 mb-2">
            <LinkIcon className="w-3.5 h-3.5 text-indigo-600" />
            <div className="text-[11px] font-bold uppercase tracking-wide text-gray-500">Pesanan Terkait</div>
          </div>
          <div className="text-sm font-bold text-indigo-700">
            {tgh.pesanan_id ? (pesananNumber ?? 'Memuat…') : '—'}
          </div>
          {tgh.pesanan_id && onOpenPesanan && (
            <button onClick={() => onOpenPesanan(tgh.pesanan_id!)} className="text-[11px] text-indigo-600 font-semibold hover:underline mt-2">Lihat Pesanan →</button>
          )}
        </div>
        <div className="bg-white/78 backdrop-blur-xl rounded-3xl border border-gray-200 shadow-sm p-4">
          <div className="flex items-center gap-2 mb-2">
            <Store className="w-3.5 h-3.5 text-violet-600" />
            <div className="text-[11px] font-bold uppercase tracking-wide text-gray-500">Supplier</div>
          </div>
          <div className="font-bold text-gray-800">{tgh.supplier?.name ?? '—'}</div>
          <div className="text-xs text-gray-500 mt-1">Net {tgh.supplier?.payment_term_days ?? 0} hari</div>
          {tgh.supplier_invoice_number && <div className="text-[11px] text-gray-600 mt-1">Faktur: <strong>{tgh.supplier_invoice_number}</strong></div>}
        </div>
        <div className="bg-white/78 backdrop-blur-xl rounded-3xl border border-amber-200 shadow-sm p-4">
          <div className="flex items-center gap-2 mb-2">
            <CalendarClock className="w-3.5 h-3.5 text-amber-600" />
            <div className="text-[11px] font-bold uppercase tracking-wide text-gray-500">Jatuh Tempo</div>
          </div>
          <div className="font-bold text-amber-700">{fmtDate(tgh.payment_due_at)}</div>
          <div className="text-xs text-gray-500 mt-1">{tgh.payment_method}</div>
        </div>
      </div>

      {/* Paid amount progress */}
      <div className="bg-white/78 backdrop-blur-xl rounded-3xl border border-gray-200 shadow-sm p-5">
        <div className="text-xs font-bold uppercase tracking-wide text-gray-500 mb-3">Status Pembayaran</div>
        <div className="grid grid-cols-3 gap-4 mb-3">
          <div className="bg-gray-50 rounded-lg p-3">
            <div className="text-[11px] text-gray-500 uppercase font-semibold">Total Tagihan</div>
            <div className="text-lg font-extrabold mt-1" style={{ color: '#012749' }}>{fmtRp(tgh.total)}</div>
          </div>
          <div className="bg-green-50 rounded-lg p-3">
            <div className="text-[11px] text-green-700 uppercase font-semibold">Sudah Dibayar</div>
            <div className="text-lg font-extrabold mt-1 text-green-700">{fmtRp(paid)}</div>
          </div>
          <div className="bg-amber-50 rounded-lg p-3">
            <div className="text-[11px] text-amber-700 uppercase font-semibold">Sisa Bayar</div>
            <div className="text-lg font-extrabold mt-1 text-amber-700">{fmtRp(outstanding)}</div>
          </div>
        </div>
        <div className="w-full h-2.5 bg-gray-100 rounded-full overflow-hidden">
          <div className={`h-full ${paid >= tgh.total ? 'bg-green-500' : paid > 0 ? 'bg-sky-500' : 'bg-amber-400'}`} style={{ width: `${paidPct}%` }} />
        </div>
        <div className="text-[11px] text-gray-500 mt-1">{paidPct.toFixed(0)}% terbayar</div>
      </div>

      {tgh.supplier_invoice_photo_url && (
        <div className="bg-white/78 backdrop-blur-xl rounded-3xl border border-gray-200 shadow-sm p-5">
          <div className="text-xs font-bold uppercase tracking-wide text-gray-500 mb-3">Lampiran Faktur</div>
          <a href={tgh.supplier_invoice_photo_url} target="_blank" rel="noreferrer" className="block">
            <img src={tgh.supplier_invoice_photo_url} alt="Faktur" className="w-40 h-40 object-cover rounded-lg border border-gray-200" />
          </a>
        </div>
      )}

      {(() => {
        const itemsArr = tgh.items ?? [];
        const hasItemDiscount = itemsArr.some(it => (it.discount_amount_rp ?? 0) > 0);
        const hasOrderDiscount = (tgh.discount_amount_rp ?? 0) > 0;
        // When any per-item or order-level discount exists, show subtotal row too
        const showBreakdown = hasItemDiscount || hasOrderDiscount;
        const colCount = hasItemDiscount ? 5 : 4;

        return (
          <div className="bg-white/78 backdrop-blur-xl rounded-3xl border border-gray-200 shadow-sm p-5">
            <div className="text-xs font-bold uppercase tracking-wide text-gray-500 mb-3">Barang yang Diterima</div>
            <table className="w-full">
              <thead className="border-b border-gray-200">
                <tr>
                  <th className="text-left py-2 text-[11px] font-semibold text-gray-500 uppercase">SKU / Nama</th>
                  <th className="text-center py-2 w-20 text-[11px] font-semibold text-gray-500 uppercase">Qty</th>
                  <th className="text-right py-2 w-32 text-[11px] font-semibold text-gray-500 uppercase">Harga Beli</th>
                  {hasItemDiscount && (
                    <th className="text-right py-2 w-32 text-[11px] font-semibold text-gray-500 uppercase">Diskon Item</th>
                  )}
                  <th className="text-right py-2 w-32 text-[11px] font-semibold text-gray-500 uppercase">Subtotal</th>
                </tr>
              </thead>
              <tbody>
                {itemsArr.map(it => (
                  <tr key={it.id} className="border-b border-gray-100">
                    <td className="py-3">
                      <div className="flex items-center gap-2">
                        <span className="bg-gray-100 text-gray-600 text-xs font-bold px-2 py-0.5 rounded">{it.sku}</span>
                        <span className="text-sm">{it.product_name}</span>
                      </div>
                      {(it.master_unit_cost ?? 0) > it.unit_cost && (
                        <div className="text-[10px] text-slate-400 mt-0.5">List {fmtRp(it.master_unit_cost ?? 0)}</div>
                      )}
                    </td>
                    <td className="py-3 text-center font-semibold">{it.qty}</td>
                    <td className="py-3 text-right">{fmtRp(it.unit_cost)}</td>
                    {hasItemDiscount && (
                      <td className="py-3 text-right text-orange-700 text-sm">
                        {(it.discount_amount_rp ?? 0) > 0
                          ? `− ${fmtRp(it.discount_amount_rp ?? 0)}`
                          : '—'}
                      </td>
                    )}
                    <td className="py-3 text-right font-bold" style={{ color: '#012749' }}>{fmtRp(it.subtotal)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                {showBreakdown && (
                  <tr>
                    <td colSpan={colCount - 1} className="py-2 text-right text-xs font-semibold text-gray-500">SUBTOTAL</td>
                    <td className="py-2 text-right text-sm font-bold text-gray-700">{fmtRp(tgh.subtotal)}</td>
                  </tr>
                )}
                {hasOrderDiscount && (
                  <tr>
                    <td colSpan={colCount - 1} className="py-1 text-right text-xs font-semibold text-orange-700">
                      Diskon Tagihan{tgh.discount_type === 'PERCENT' ? ` (${tgh.discount_value}%)` : ''}
                    </td>
                    <td className="py-1 text-right text-sm font-semibold text-orange-700">
                      − {fmtRp(tgh.discount_amount_rp ?? 0)}
                    </td>
                  </tr>
                )}
                <tr>
                  <td colSpan={colCount - 1} className="py-3 text-right text-xs font-semibold text-gray-500">TOTAL TAGIHAN</td>
                  <td className="py-3 text-right text-xl font-extrabold" style={{ color: '#012749' }}>{fmtRp(tgh.total)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        );
      })()}

      {tgh.notes && (
        <div className="bg-white/78 backdrop-blur-xl rounded-3xl border border-gray-200 shadow-sm p-4">
          <div className="text-[11px] font-bold uppercase tracking-wide text-gray-500 mb-1">Catatan</div>
          <div className="text-sm text-gray-700">{tgh.notes}</div>
        </div>
      )}

      {showVoid && (
        <VoidTagihanModal tagihan={tgh} onClose={() => setShowVoid(false)} onVoided={reload} showToast={showToast} />
      )}
    </div>
  );
}

interface VoidProps {
  tagihan: TagihanRow;
  onClose: () => void;
  onVoided: () => void;
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
}

function VoidTagihanModal({ tagihan, onClose, onVoided, showToast }: VoidProps) {
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const valid = reason.trim().length >= 10;

  async function handleConfirm() {
    if (!valid) return;
    setSaving(true);
    try {
      await purchaseInvoiceService.void(tagihan.id, reason.trim());
      showToast(`${tagihan.pi_number} di-void.`, 'success');
      onVoided();
      onClose();
    } catch (e: any) {
      showToast(e?.message ?? 'Gagal void.', 'warning');
    } finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-lg border border-red-200 shadow-xl w-full max-w-md" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-red-100 bg-red-50">
          <h2 className="text-sm font-bold text-red-800 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4" /> Void {tagihan.pi_number}
          </h2>
          <button onClick={onClose}><X className="w-4 h-4 text-gray-400" /></button>
        </div>
        <div className="px-5 py-4 space-y-3">
          <p className="text-xs text-gray-600">
            Void akan menandai Tagihan ini sebagai dibatalkan. Stok yang sudah ditambahkan tidak otomatis dikurangi — adjust manual jika perlu.
          </p>
          <div>
            <label className="text-xs font-semibold text-gray-700 block mb-1">Alasan void (min. 10 karakter) *</label>
            <textarea value={reason} onChange={e => setReason(e.target.value)}
              rows={3} placeholder="Contoh: Faktur salah, barang return semua ke supplier"
              className="w-full text-sm px-3 py-2 rounded-lg border border-gray-300 focus:border-red-400 focus:outline-none" />
            <div className="text-[11px] text-gray-400 mt-1">{reason.length} / 10 minimum</div>
          </div>
        </div>
        <div className="flex justify-end gap-2 px-5 py-3 border-t border-gray-200">
          <button onClick={onClose} className="text-sm font-medium text-gray-600 px-4 py-2 rounded-lg border border-gray-200 hover:bg-gray-50">Batal</button>
          <button onClick={handleConfirm} disabled={!valid || saving} className="text-sm font-semibold text-white bg-red-600 px-4 py-2 rounded-lg hover:bg-red-700 disabled:opacity-50">
            {saving ? 'Memproses...' : 'Void'}
          </button>
        </div>
      </div>
    </div>
  );
}
