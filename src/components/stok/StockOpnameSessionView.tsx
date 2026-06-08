import { useEffect, useMemo, useState } from 'react';
import {
  fetchOpnameCounts,
  getOpnameSession,
  recordOpnameCount,
  acknowledgeOpnameWitness,
  submitOpnameForOwner,
  supabase,
} from '../../lib/supabaseClient';
import type {
  OpnameCount,
  OpnameSession,
  PermissionSet,
} from '../../types';

interface StockOpnameSessionViewProps {
  sessionId: number;
  currentUser: {
    id: string;
    name: string;
    role: string;
    permissions: PermissionSet;
  } | null;
  onClose: () => void;
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
}

interface SkuMeta {
  sku: string;
  name: string;
}

const STATUS_LABEL: Record<OpnameSession['status'], string> = {
  in_progress: 'Berlangsung',
  pending_owner: 'Menunggu Owner',
  committed: 'Selesai',
  rejected: 'Ditolak',
};

const STATUS_PILL: Record<OpnameSession['status'], string> = {
  in_progress: 'bg-amber-100 text-amber-800 border border-amber-200',
  pending_owner: 'bg-blue-100 text-blue-800 border border-blue-200',
  committed: 'bg-emerald-100 text-emerald-800 border border-emerald-200',
  rejected: 'bg-rose-100 text-rose-800 border border-rose-200',
};

function formatRp(value: number): string {
  const sign = value < 0 ? '−' : value > 0 ? '+' : '';
  return `${sign}Rp ${Math.abs(value).toLocaleString('id-ID')}`;
}

function formatDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString('id-ID', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

export default function StockOpnameSessionView({
  sessionId,
  currentUser,
  onClose,
  showToast,
}: StockOpnameSessionViewProps) {
  const [session, setSession] = useState<OpnameSession | null>(null);
  const [counts, setCounts] = useState<OpnameCount[]>([]);
  const [skuMeta, setSkuMeta] = useState<Record<string, SkuMeta>>({});
  const [filter, setFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  // Local draft of counted_qty so user can type then commit on blur without
  // each keystroke roundtripping to the DB.
  const [draft, setDraft] = useState<Record<string, string>>({});

  const refresh = async () => {
    try {
      const [sess, rows] = await Promise.all([
        getOpnameSession(sessionId),
        fetchOpnameCounts(sessionId),
      ]);
      setSession(sess);
      setCounts(rows);

      // Pull SKU display names for the count rows.
      if (supabase && rows.length > 0) {
        const skus = Array.from(new Set(rows.map((r) => r.sku)));
        const { data, error } = await supabase
          .from('stocks')
          .select('sku, name')
          .in('sku', skus);
        if (!error && data) {
          const map: Record<string, SkuMeta> = {};
          for (const s of data as { sku: string; name: string }[]) {
            map[s.sku] = { sku: s.sku, name: s.name };
          }
          setSkuMeta(map);
        }
      }
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e), 'warning');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  const isCounter = !!session && !!currentUser && currentUser.id === session.countedByUserId;
  const isWitness = !!session && !!currentUser && currentUser.id === session.witnessedByUserId;
  const isEditable = !!session && session.status === 'in_progress'
    && (isCounter || isWitness);
  const witnessAcked = !!session?.witnessAcknowledgedAt;
  const canAckWitness = !!session && isWitness && !witnessAcked && session.status === 'in_progress';
  const canSubmit = !!session && isCounter && witnessAcked && session.status === 'in_progress';

  const filteredCounts = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return counts;
    return counts.filter((c) =>
      c.sku.toLowerCase().includes(q)
      || (skuMeta[c.sku]?.name ?? '').toLowerCase().includes(q),
    );
  }, [counts, filter, skuMeta]);

  const groupedBySku = useMemo(() => {
    const map = new Map<string, { atas?: OpnameCount; bawah?: OpnameCount }>();
    for (const c of filteredCounts) {
      const existing = map.get(c.sku) ?? {};
      existing[c.warehouse] = c;
      map.set(c.sku, existing);
    }
    return map;
  }, [filteredCounts]);

  const filledCount = counts.filter((c) => c.countedQty !== null && c.countedQty !== undefined).length;
  const totalCount = counts.length;
  const totalVariance = counts.reduce((sum, c) => sum + (c.varianceValue || 0), 0);

  const onBlurCount = async (c: OpnameCount) => {
    if (!currentUser) return;
    const key = `${c.sku}-${c.warehouse}`;
    const raw = draft[key];
    if (raw === undefined) return;
    const parsed = parseInt(raw, 10);
    if (Number.isNaN(parsed)) {
      showToast('Angka hitung tidak valid', 'warning');
      return;
    }
    if (parsed === c.countedQty) return;
    setBusy(key);
    try {
      await recordOpnameCount({
        session_id: sessionId,
        sku: c.sku,
        warehouse: c.warehouse,
        counted_qty: parsed,
        actor_user_id: currentUser.id,
      });
      await refresh();
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e), 'warning');
    } finally {
      setBusy(null);
    }
  };

  const onAcknowledge = async () => {
    if (!currentUser) return;
    setBusy('ack');
    try {
      await acknowledgeOpnameWitness(sessionId, currentUser.id);
      showToast('Acknowledgement saksi tercatat', 'success');
      await refresh();
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e), 'warning');
    } finally {
      setBusy(null);
    }
  };

  const onSubmit = async () => {
    if (!currentUser) return;
    if (filledCount === 0) {
      showToast('Belum ada count yang diisi', 'warning');
      return;
    }
    setBusy('submit');
    try {
      await submitOpnameForOwner(sessionId, currentUser.id);
      showToast('Sesi opname dikirim ke Owner untuk commit', 'success');
      onClose();
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e), 'warning');
    } finally {
      setBusy(null);
    }
  };

  if (loading) {
    return (
      <div className="p-6">
        <button onClick={onClose} className="text-sm text-slate-500 mb-3">
          ← Kembali
        </button>
        <p className="text-sm text-slate-500">Memuat sesi…</p>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="p-6">
        <button onClick={onClose} className="text-sm text-slate-500 mb-3">
          ← Kembali
        </button>
        <p className="text-sm text-rose-600">Sesi #{sessionId} tidak ditemukan.</p>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-4">
      <button onClick={onClose} className="text-sm text-slate-500">
        ← Kembali ke daftar
      </button>

      {/* Header */}
      <div className="bg-white border border-slate-200 rounded-lg p-4 flex items-start justify-between gap-3 flex-wrap">
        <div>
          <span className={`inline-block px-2 py-0.5 rounded-full text-xs ${STATUS_PILL[session.status]}`}>
            {STATUS_LABEL[session.status]}
          </span>
          <h1 className="text-lg font-bold text-slate-900 mt-1">
            Sesi Opname #{session.id}
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Penghitung: <b>{isCounter ? `${currentUser?.name} (Anda)` : session.countedByUserId.slice(0, 8)}</b>
            {' · '}Saksi: <b>{isWitness ? `${currentUser?.name} (Anda)` : session.witnessedByUserId.slice(0, 8)}</b>
            {' · '}Mulai {formatDateTime(session.startedAt)}
          </p>
          {witnessAcked && session.witnessAcknowledgedAt && (
            <p className="text-xs text-emerald-700 mt-1">
              Saksi acknowledged {formatDateTime(session.witnessAcknowledgedAt)}
            </p>
          )}
        </div>
        <div className="text-right">
          <p className="text-xs uppercase tracking-wide text-slate-500">Total Varians</p>
          <p className={`font-bold text-xl ${totalVariance < 0 ? 'text-rose-600' : totalVariance > 0 ? 'text-emerald-700' : 'text-slate-900'}`}>
            {formatRp(totalVariance)}
          </p>
          <p className="text-xs text-slate-500 mt-1">Diisi: {filledCount}/{totalCount}</p>
        </div>
      </div>

      {/* Filter */}
      <div>
        <input
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Cari SKU atau nama barang…"
          className="w-full border border-slate-300 rounded px-3 py-2 text-sm"
        />
      </div>

      {/* Counts table */}
      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="grid grid-cols-12 px-3 py-2 bg-slate-50 text-xs uppercase tracking-wide text-slate-500 font-semibold">
          <div className="col-span-2">SKU</div>
          <div className="col-span-4">Nama</div>
          <div className="col-span-1">Gudang</div>
          <div className="col-span-1 text-right">Sistem</div>
          <div className="col-span-2 text-right">Hitung</div>
          <div className="col-span-2 text-right">Varians</div>
        </div>
        {filteredCounts.length === 0 ? (
          <div className="px-3 py-6 text-sm text-slate-500 text-center">
            {counts.length === 0
              ? 'Sesi ini belum punya scope. Kembali ke daftar.'
              : 'Tidak ada SKU cocok dengan pencarian.'}
          </div>
        ) : (
          filteredCounts.map((c) => {
            const key = `${c.sku}-${c.warehouse}`;
            const draftValue = draft[key];
            const inputValue = draftValue !== undefined
              ? draftValue
              : (c.countedQty !== null && c.countedQty !== undefined ? String(c.countedQty) : '');
            return (
              <div
                key={key}
                className="grid grid-cols-12 px-3 py-2 items-center border-t border-slate-100 text-sm"
              >
                <div className="col-span-2 font-mono text-xs">{c.sku}</div>
                <div className="col-span-4 font-semibold text-slate-800">
                  {skuMeta[c.sku]?.name ?? '—'}
                </div>
                <div className="col-span-1 text-xs text-slate-600">
                  {c.warehouse === 'atas' ? 'Atas' : 'Bawah'}
                </div>
                <div className="col-span-1 text-right">{c.systemQtySnapshot}</div>
                <div className="col-span-2 text-right">
                  <input
                    type="number"
                    value={inputValue}
                    onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
                    onBlur={() => onBlurCount(c)}
                    disabled={!isEditable || busy === key}
                    className="border border-slate-300 rounded px-2 py-1 w-20 text-right text-sm disabled:bg-slate-50"
                  />
                </div>
                <div
                  className={`col-span-2 text-right font-semibold ${
                    c.varianceValue < 0 ? 'text-rose-600'
                    : c.varianceValue > 0 ? 'text-emerald-700'
                    : 'text-slate-400'
                  }`}
                >
                  {c.countedQty !== null && c.countedQty !== undefined
                    ? formatRp(c.varianceValue)
                    : '—'}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Action bar */}
      {session.status === 'in_progress' && (
        <div className="flex flex-wrap gap-2 items-center">
          <button
            onClick={onAcknowledge}
            disabled={!canAckWitness || busy === 'ack'}
            className="py-2 px-4 border border-slate-300 rounded-full text-sm disabled:opacity-50"
            title={
              !isWitness ? 'Hanya saksi yang dapat acknowledge'
              : witnessAcked ? 'Saksi sudah acknowledge'
              : ''
            }
          >
            {witnessAcked
              ? `Saksi ✓ acknowledged`
              : busy === 'ack' ? 'Memproses…' : 'Saya Saksi (Acknowledge)'}
          </button>
          <span className="flex-1" />
          <button
            onClick={onSubmit}
            disabled={!canSubmit || busy === 'submit'}
            className="py-2 px-4 bg-emerald-600 text-white rounded-full text-sm disabled:opacity-50"
            title={
              !isCounter ? 'Hanya penghitung yang dapat submit'
              : !witnessAcked ? 'Saksi belum acknowledge'
              : ''
            }
          >
            {busy === 'submit' ? 'Mengirim…' : 'Kirim ke Owner untuk Commit'}
          </button>
        </div>
      )}

      {session.status === 'pending_owner' && (
        <div className="rounded bg-blue-50 border border-blue-200 px-3 py-2 text-sm text-blue-800">
          Sesi ini sudah dikirim ke Owner. Menunggu commit.
        </div>
      )}
      {session.status === 'committed' && (
        <div className="rounded bg-emerald-50 border border-emerald-200 px-3 py-2 text-sm text-emerald-800">
          Sesi sudah di-commit oleh Owner.
        </div>
      )}
      {session.status === 'rejected' && (
        <div className="rounded bg-rose-50 border border-rose-200 px-3 py-2 text-sm text-rose-800">
          Sesi ditolak oleh Owner.
        </div>
      )}
    </div>
  );
}
