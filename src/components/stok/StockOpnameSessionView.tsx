import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import EmptyState from '../ui/EmptyState';
import LoadingState from '../ui/LoadingState';
import {
  fetchOpnameCounts,
  getOpnameSession,
  recordOpnameCount,
  acknowledgeOpnameWitness,
  submitOpnameForOwner,
  adminUsersService,
  supabase,
} from '../../lib/supabaseClient';
import type {
  OpnameCount,
  OpnameSession,
  PermissionSet,
} from '../../types';
import { formatRpDelta } from '../../lib/format';
import { useWarehouses } from '../../hooks/useWarehouses';
import { DamageFlagModal } from './DamageFlagModal';
import { extractErrorMessage } from '../../lib/extractErrorMessage';

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
  pending_owner: 'Menunggu Persetujuan',
  committed: 'Selesai',
  rejected: 'Ditolak',
  abandoned: 'Dibatalkan',
};

const STATUS_PILL: Record<OpnameSession['status'], string> = {
  in_progress: 'bg-amber-100 text-amber-800 border border-amber-200',
  pending_owner: 'bg-blue-100 text-blue-800 border border-blue-200',
  committed: 'bg-emerald-100 text-emerald-800 border border-emerald-200',
  rejected: 'bg-rose-100 text-rose-800 border border-rose-200',
  abandoned: 'bg-slate-100 text-slate-600 border border-slate-200',
};

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
  // Resolve warehouse_id / legacy text to a human-readable name.
  const { warehouses } = useWarehouses({ activeOnly: false });
  const warehouseName = (whKey: string | null | undefined): string => {
    if (!whKey) return '—';
    // Try uuid lookup first (future: when warehouse_id is on count rows).
    const byId = warehouses.find(w => w.id === whKey);
    if (byId) return byId.name;
    // Fall back: legacy text values 'atas' / 'bawah' → capitalise first letter.
    return whKey.charAt(0).toUpperCase() + whKey.slice(1);
  };

  const [session, setSession] = useState<OpnameSession | null>(null);
  const [counts, setCounts] = useState<OpnameCount[]>([]);
  const [skuMeta, setSkuMeta] = useState<Record<string, SkuMeta>>({});
  const [filter, setFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  // userId → display name (Penghitung / Saksi resolution). Previously the
  // detail view showed `id.slice(0, 8)` which surfaced raw "bf47bc57"
  // strings to the operator (2026-06-12 e2e audit).
  const [adminNames, setAdminNames] = useState<Record<string, string>>({});

  // Local draft of counted_qty so user can type then commit on blur without
  // each keystroke roundtripping to the DB.
  const [draft, setDraft] = useState<Record<string, string>>({});

  // Rev 3: damage flag modal state.
  const [flaggingKey, setFlaggingKey] = useState<string | null>(null);

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
      showToast(extractErrorMessage(e), 'warning');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
    // One-shot admin lookup. Failure leaves the map empty and the row falls
    // back to the truncated-UUID display.
    adminUsersService
      .fetchAll()
      .then((rows) => {
        const map: Record<string, string> = {};
        for (const a of rows) map[a.id] = a.name;
        setAdminNames(map);
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  const resolveName = (uid: string | null | undefined): string => {
    if (!uid) return '—';
    return adminNames[uid] ?? uid.slice(0, 8);
  };

  const [requireWitness, setRequireWitness] = useState<boolean>(true);

  // Fetch opname_require_witness setting at mount.
  // company_settings has no `id` column — PK is tenant_id, RLS returns
  // exactly the one row for the JWT-scoped tenant. Previous `.eq('id', 1)`
  // silently returned 0 rows → default TRUE stuck (bug 2026-07-24).
  useEffect(() => {
    if (!supabase) return;
    supabase
      .from('company_settings')
      .select('opname_require_witness')
      .maybeSingle()
      .then(({ data }) => {
        if (data && typeof (data as { opname_require_witness?: boolean }).opname_require_witness === 'boolean') {
          setRequireWitness((data as { opname_require_witness: boolean }).opname_require_witness);
        }
      });
  }, []);

  const isCounter = !!session && !!currentUser && currentUser.id === session.countedByUserId;
  const isWitness = !!session && !!currentUser
    && !!session.witnessedByUserId
    && currentUser.id === session.witnessedByUserId;
  const isEditable = !!session && session.status === 'in_progress'
    && (isCounter || isWitness || (!requireWitness && isCounter));
  const witnessAcked = !!session?.witnessAcknowledgedAt;
  const canAckWitness = !!session && isWitness && !witnessAcked && session.status === 'in_progress';
  // Submit allowed when:
  //   - witness required: counter + witness acked
  //   - witness optional: counter alone (no ack required)
  const canSubmit = !!session && isCounter && session.status === 'in_progress'
    && (requireWitness ? witnessAcked : true);

  const filteredCounts = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return counts;
    return counts.filter((c) =>
      c.sku.toLowerCase().includes(q)
      || (skuMeta[c.sku]?.name ?? '').toLowerCase().includes(q),
    );
  }, [counts, filter, skuMeta]);

  // Group counts by SKU; within each SKU, key by warehouse text value (legacy
  // 'atas'/'bawah' or uuid when the opname RPC is migrated in a future task).
  const groupedBySku = useMemo(() => {
    const map = new Map<string, Record<string, OpnameCount>>();
    for (const c of filteredCounts) {
      const existing: Record<string, OpnameCount> = map.get(c.sku) ?? {};
      existing[c.warehouse] = c;
      map.set(c.sku, existing);
    }
    return map;
  }, [filteredCounts]);

  const filledCount = counts.filter((c) => c.countedQty !== null && c.countedQty !== undefined).length;
  const totalCount = counts.length;
  const totalVariance = counts.reduce((sum, c) => sum + (c.varianceValue ?? 0), 0);

  // Blind-count: non-Owner roles see input field only, no Sistem/Selisih,
  // during the input window (status='in_progress'). Backend RPC also masks
  // these fields server-side as defense in depth.
  const isOwner = currentUser?.role === 'Owner';
  const isBlindMode = session?.status === 'in_progress' && !isOwner;

  // Re-ack required banner: counter edited a count after witness ack, so
  // witness_acknowledged_at was cleared by record_opname_count. Surface a
  // visible cue so witness knows to ack again before submit unlocks.
  const [prevAcked, setPrevAcked] = useState(false);
  // Reset when opening a different session — without this, a session that
  // was previously acknowledged bleeds prevAcked=true into an unrelated
  // fresh session, firing "witness must re-ack" on session B when nothing
  // was invalidated.
  useEffect(() => { setPrevAcked(false); }, [sessionId]);
  useEffect(() => {
    if (session?.witnessAcknowledgedAt) setPrevAcked(true);
  }, [session?.witnessAcknowledgedAt]);
  const ackInvalidated = prevAcked && !session?.witnessAcknowledgedAt;

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
      showToast(extractErrorMessage(e), 'warning');
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
      showToast(extractErrorMessage(e), 'warning');
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
      const result = await submitOpnameForOwner(sessionId, currentUser.id);
      if (result.auto) {
        showToast('Sesi selesai — semua cocok dengan sistem (Selesai Otomatis)', 'success');
      } else {
        showToast('Sesi dikirim ke Owner untuk persetujuan', 'success');
      }
      onClose();
    } catch (e) {
      showToast(extractErrorMessage(e), 'warning');
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
        <LoadingState label="Memuat sesi…" inline />
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
      <div className="bg-white border border-slate-200 rounded p-4 flex items-start justify-between gap-3 flex-wrap">
        <div>
          <span className={`inline-block px-2 py-0.5 rounded-full text-xs ${STATUS_PILL[session.status]}`}>
            {STATUS_LABEL[session.status]}
          </span>
          <h1 className="text-lg font-bold text-slate-900 mt-1">
            Sesi Opname #{session.id}
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Penghitung: <b>{isCounter ? `${currentUser?.name} (Anda)` : resolveName(session.countedByUserId)}</b>
            {session.witnessedByUserId && (
              <>{' · '}Saksi: <b>{isWitness ? `${currentUser?.name} (Anda)` : resolveName(session.witnessedByUserId)}</b></>
            )}
            {' · '}Mulai {formatDateTime(session.startedAt)}
          </p>
          {witnessAcked && session.witnessAcknowledgedAt && (
            <p className="text-xs text-emerald-700 mt-1">
              Saksi acknowledged {formatDateTime(session.witnessAcknowledgedAt)}
            </p>
          )}
        </div>
        <div className="text-right">
          {isBlindMode ? (
            <>
              <span className="inline-block px-2 py-1 rounded-full text-xs bg-slate-100 text-slate-700 border border-slate-300">
                🔒 Tanpa Lihat Sistem
              </span>
              <p className="text-xs text-slate-500 mt-2">Diisi: {filledCount}/{totalCount}</p>
            </>
          ) : (
            <>
              <p className="text-xs uppercase tracking-wide text-slate-500">Total Selisih</p>
              <p className={`font-bold text-xl ${totalVariance < 0 ? 'text-rose-600' : totalVariance > 0 ? 'text-emerald-700' : 'text-slate-900'}`}>
                {formatRpDelta(totalVariance)}
              </p>
              <p className="text-xs text-slate-500 mt-1">Diisi: {filledCount}/{totalCount}</p>
            </>
          )}
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

      {/* Counts cards (grouped per SKU) */}
      {groupedBySku.size === 0 ? (
        <div className="bg-white border border-slate-200 rounded">
          <EmptyState message={counts.length === 0 ? 'Sesi ini belum punya scope. Kembali ke daftar.' : 'Tidak ada SKU cocok dengan pencarian.'} inline />
        </div>
      ) : (
        <div className="space-y-2">
          {Array.from(groupedBySku).map(([sku, group]) => {
            const groupEntries = Object.entries(group) as [string, OpnameCount][];
            const allFilled = groupEntries.length > 0 && groupEntries.every(
              ([, c]) => c.countedQty !== null && c.countedQty !== undefined
            );
            return (
              <div
                key={sku}
                className={`bg-white border border-slate-200 rounded overflow-hidden ${
                  allFilled ? 'border-l-4 border-l-emerald-500' : ''
                }`}
              >
                <div className="px-3 py-2 bg-slate-50 border-b border-slate-200 flex items-center gap-2 flex-wrap">
                  <span className="font-mono text-xs text-slate-600">{sku}</span>
                  <span className="text-slate-400">·</span>
                  <span className="font-semibold text-slate-800 text-sm">
                    {skuMeta[sku]?.name ?? '—'}
                  </span>
                </div>
                {/* Column header row — adapts between blind 3-6-3 and full 2-3-3-4 layouts */}
                {isBlindMode ? (
                  <div className="grid grid-cols-12 px-3 py-1 items-center border-t border-slate-100 text-xs text-slate-400 uppercase tracking-wide bg-slate-50/50">
                    <div className="col-span-3">Gudang</div>
                    <div className="col-span-6 text-right pr-3">Stok Fisik (yang Anda hitung)</div>
                    <div className="col-span-3"></div>
                  </div>
                ) : (
                  <div className="grid grid-cols-12 px-3 py-1 items-center border-t border-slate-100 text-xs text-slate-400 uppercase tracking-wide bg-slate-50/50">
                    <div className="col-span-2">Gudang</div>
                    <div className="col-span-2 text-right">Sistem</div>
                    <div className="col-span-2 text-right">Fisik (input)</div>
                    <div className="col-span-3 text-right">Selisih</div>
                    <div className="col-span-3 text-right">Rusak</div>
                  </div>
                )}
                {/* Iterate over the warehouse keys actually present for this SKU (supports N warehouses) */}
                {groupEntries.map(([wh, c]) => {
                  const key = `${c.sku}-${c.warehouse}`;
                  const draftValue = draft[key];
                  const inputValue = draftValue !== undefined
                    ? draftValue
                    : (c.countedQty !== null && c.countedQty !== undefined ? String(c.countedQty) : '');
                  const damagedQty = c.damagedQty ?? 0;
                  const canFlagDamage =
                    isEditable
                    && c.countedQty !== null
                    && c.countedQty !== undefined
                    && c.countedQty > 0
                    && session?.status === 'in_progress';
                  const flagButton = canFlagDamage ? (
                    <button
                      type="button"
                      onClick={() => setFlaggingKey(key)}
                      className={`inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium transition-colors ${
                        damagedQty > 0
                          ? 'bg-orange-100 text-orange-800 hover:bg-orange-200'
                          : 'border border-slate-200 text-slate-500 hover:bg-orange-50 hover:text-orange-700 hover:border-orange-300'
                      }`}
                      title={damagedQty > 0
                        ? `${damagedQty} unit ditandai rusak — klik untuk ubah`
                        : 'Flag ada barang rusak dari hasil hitungan'}
                    >
                      <AlertTriangle className="h-3 w-3" />
                      {damagedQty > 0 ? `${damagedQty} rusak` : 'Flag rusak'}
                    </button>
                  ) : damagedQty > 0 ? (
                    <span className="inline-flex items-center gap-1 rounded bg-orange-100 px-2 py-1 text-xs font-medium text-orange-800">
                      <AlertTriangle className="h-3 w-3" />
                      {damagedQty} rusak
                    </span>
                  ) : null;

                  return isBlindMode ? (
                    <div
                      key={key}
                      className="grid grid-cols-12 px-3 py-2 items-center border-t border-slate-100 text-sm"
                    >
                      <div className="col-span-3 text-xs uppercase tracking-wide text-slate-500">
                        {warehouseName(wh)}
                      </div>
                      <div className="col-span-6 text-right">
                        <input
                          type="number"
                          value={inputValue}
                          onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
                          onBlur={() => onBlurCount(c)}
                          disabled={!isEditable || busy === key}
                          className="border border-slate-300 rounded px-2 py-1 w-32 text-right text-sm disabled:bg-slate-50"
                        />
                      </div>
                      <div className="col-span-3 flex justify-end">{flagButton}</div>
                    </div>
                  ) : (
                    <div
                      key={key}
                      className="grid grid-cols-12 px-3 py-2 items-center border-t border-slate-100 text-sm"
                    >
                      <div className="col-span-2 text-xs uppercase tracking-wide text-slate-500">
                        {warehouseName(wh)}
                      </div>
                      <div className="col-span-2 text-right text-slate-800 font-medium">
                        {c.systemQtySnapshot ?? '—'}
                      </div>
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
                        className={`col-span-3 text-right font-semibold ${
                          (c.varianceValue ?? 0) < 0 ? 'text-rose-600'
                          : (c.varianceValue ?? 0) > 0 ? 'text-emerald-700'
                          : 'text-slate-400'
                        }`}
                      >
                        {c.countedQty !== null && c.countedQty !== undefined
                          ? (
                            <>
                              {c.variance ?? 0}{' '}
                              <span className="text-xs font-normal">({formatRpDelta(c.varianceValue ?? 0)})</span>
                            </>
                          )
                          : <span className="text-xs italic">belum dihitung</span>
                        }
                      </div>
                      <div className="col-span-3 flex justify-end">{flagButton}</div>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}

      {/* Re-ack banner — surfaces after counter edits a count following an existing
          witness ack. Hidden when witness is disabled (no ack to invalidate). */}
      {requireWitness && session.status === 'in_progress' && ackInvalidated && (
        <div className="rounded bg-amber-50 border border-amber-300 px-3 py-2 text-sm text-amber-900">
          Counter mengubah angka — saksi perlu acknowledge ulang sebelum submit.
        </div>
      )}

      {/* Action bar */}
      {session.status === 'in_progress' && (
        <div className="flex flex-wrap gap-2 items-center">
          {requireWitness && (
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
          )}
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
            {busy === 'submit' ? 'Mengirim…' : 'Kirim ke Owner untuk Disetujui'}
          </button>
        </div>
      )}

      {session.status === 'pending_owner' && (
        <div className="rounded bg-blue-50 border border-blue-200 px-3 py-2 text-sm text-blue-800">
          Sesi ini sudah dikirim ke Owner. Menunggu persetujuan.
        </div>
      )}
      {session.status === 'committed' && (
        <div className="rounded bg-emerald-50 border border-emerald-200 px-3 py-2 text-sm text-emerald-800">
          Sesi sudah disetujui Owner.
        </div>
      )}
      {session.status === 'rejected' && (
        <div className="rounded bg-rose-50 border border-rose-200 px-3 py-2 text-sm text-rose-800">
          Sesi ditolak oleh Owner.
        </div>
      )}

      {(() => {
        if (!flaggingKey) return null;
        const flagRow = counts.find((c) => `${c.sku}-${c.warehouse}` === flaggingKey);
        if (!flagRow || flagRow.countedQty == null) return null;
        return (
          <DamageFlagModal
            open
            sessionId={sessionId}
            sku={flagRow.sku}
            skuName={skuMeta[flagRow.sku]?.name}
            warehouse={flagRow.warehouse}
            countedQty={flagRow.countedQty}
            initialDamagedQty={flagRow.damagedQty ?? 0}
            initialNotes={flagRow.damageNotes ?? ''}
            initialEvidenceUrls={flagRow.damageEvidenceUrls ?? undefined}
            onClose={() => setFlaggingKey(null)}
            onSaved={() => {
              setFlaggingKey(null);
              void refresh();
            }}
            showToast={showToast}
          />
        );
      })()}
    </div>
  );
}
