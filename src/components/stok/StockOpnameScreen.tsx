import { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import {
  fetchOpnameAuditLog,
  listOpnameSessions,
  startOpnameSession,
  supabase,
} from '../../lib/supabaseClient';
import type { OpnameAuditEntry } from '../../lib/supabaseClient';
import type {
  OpnameSession,
  DbAdminUser,
  PermissionSet,
} from '../../types';
import { formatRpDelta } from '../../lib/format';
import StockOpnameSessionView from './StockOpnameSessionView';

interface StockOpnameScreenProps {
  currentUser: {
    id: string;
    name: string;
    role: string;
    permissions: PermissionSet;
  } | null;
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
}

type OpnameType = OpnameSession['opnameType'];

const TYPE_LABEL: Record<OpnameType, string> = {
  full: 'Full',
  per_kategori: 'Per Kategori',
  per_sku_list: 'Per SKU List',
};

const STATUS_LABEL: Record<OpnameSession['status'], string> = {
  in_progress: 'Berlangsung',
  pending_owner: 'Menunggu Persetujuan',
  committed: 'Selesai',
  rejected: 'Ditolak',
};

const STATUS_PILL: Record<OpnameSession['status'], string> = {
  in_progress: 'bg-amber-100 text-amber-800 border border-amber-200',
  pending_owner: 'bg-blue-100 text-blue-800 border border-blue-200',
  committed: 'bg-emerald-100 text-emerald-800 border border-emerald-200',
  rejected: 'bg-rose-100 text-rose-800 border border-rose-200',
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

export default function StockOpnameScreen({
  currentUser,
  showToast,
}: StockOpnameScreenProps) {
  const [sessions, setSessions] = useState<OpnameSession[]>([]);
  const [users, setUsers] = useState<DbAdminUser[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);

  // Start-new-session modal state
  const [showStartModal, setShowStartModal] = useState(false);
  const [opnameType, setOpnameType] = useState<OpnameType>('full');
  const [witnessId, setWitnessId] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);
  const [requireWitness, setRequireWitness] = useState<boolean>(true);
  const [auditEntries, setAuditEntries] = useState<OpnameAuditEntry[]>([]);
  const [auditLoading, setAuditLoading] = useState<boolean>(false);

  // Fetch opname_require_witness setting at mount. Default TRUE (MSME-safe).
  useEffect(() => {
    if (!supabase) return;
    supabase
      .from('company_settings')
      .select('opname_require_witness')
      .eq('id', 1)
      .maybeSingle()
      .then(({ data }) => {
        if (data && typeof (data as { opname_require_witness?: boolean }).opname_require_witness === 'boolean') {
          setRequireWitness((data as { opname_require_witness: boolean }).opname_require_witness);
        }
      });
  }, []);

  // Owner-only: fetch audit log entries on mount (and when sessions list refreshes).
  useEffect(() => {
    if (currentUser?.role !== 'Owner' || !supabase) return;
    setAuditLoading(true);
    fetchOpnameAuditLog(7)
      .then(setAuditEntries)
      .catch(err => console.error('audit fetch error:', err))
      .finally(() => setAuditLoading(false));
  }, [currentUser?.role, sessions.length]);

  const refresh = async () => {
    if (!supabase) return;
    setLoading(true);
    try {
      const rows = await listOpnameSessions(20);
      setSessions(rows);
      const { data: u, error: uErr } = await supabase
        .from('admin_users')
        .select('*')
        .eq('status', 'Aktif')
        .neq('id', currentUser?.id ?? '00000000-0000-0000-0000-000000000000');
      if (uErr) throw uErr;
      setUsers((u ?? []) as unknown as DbAdminUser[]);
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e), 'warning');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser?.id]);

  const activeSession = useMemo(
    () => sessions.find((s) => s.status === 'in_progress' || s.status === 'pending_owner') ?? null,
    [sessions],
  );

  const historySessions = useMemo(
    () => sessions
      .filter((s) => !activeSession || s.id !== activeSession.id)
      .slice(0, 6),
    [sessions, activeSession],
  );

  const counterName = (id: string) =>
    users.find((u) => u.id === id)?.name
    ?? (id === currentUser?.id ? currentUser?.name ?? 'Anda' : id.slice(0, 8));

  const openStartModal = () => {
    if (!currentUser) {
      showToast('Tidak ada user aktif', 'warning');
      return;
    }
    setOpnameType('full');
    setWitnessId('');
    setShowStartModal(true);
  };

  const onStart = async () => {
    if (!currentUser) return;
    if (requireWitness && !witnessId) {
      showToast('Pilih saksi terlebih dahulu', 'warning');
      return;
    }
    if (requireWitness && witnessId === currentUser.id) {
      showToast('Saksi tidak boleh sama dengan penghitung', 'warning');
      return;
    }
    setSubmitting(true);
    try {
      const sid = await startOpnameSession({
        opname_type: opnameType,
        scope_payload: {},
        counted_by: currentUser.id,
        witnessed_by: requireWitness ? witnessId : null,
      });
      showToast('Sesi opname dimulai', 'success');
      setShowStartModal(false);
      setActiveSessionId(sid);
      void refresh();
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e), 'warning');
    } finally {
      setSubmitting(false);
    }
  };

  if (activeSessionId !== null) {
    return (
      <StockOpnameSessionView
        sessionId={activeSessionId}
        currentUser={currentUser}
        onClose={() => {
          setActiveSessionId(null);
          void refresh();
        }}
        showToast={showToast}
      />
    );
  }

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Stok Opname</h1>
          <p className="text-xs text-slate-500">
            Penghitung dan saksi harus orang berbeda. Owner sign-off untuk persetujuan.
          </p>
        </div>
        <button
          onClick={openStartModal}
          disabled={!currentUser?.permissions?.can_start_opname}
          className="py-2 px-4 bg-emerald-600 text-white rounded-full text-sm font-semibold disabled:opacity-50"
        >
          + Mulai Sesi Baru
        </button>
      </div>

      {/* Active session card */}
      <section className="space-y-2">
        <h2 className="text-xs uppercase tracking-wide text-slate-500 font-semibold">
          Sesi Aktif
        </h2>
        {activeSession ? (
          <div
            onClick={() => setActiveSessionId(activeSession.id)}
            className="bg-white border border-amber-200 rounded-lg p-4 cursor-pointer hover:border-amber-400 transition"
          >
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div>
                <span
                  className={`inline-block px-2 py-0.5 rounded-full text-xs ${STATUS_PILL[activeSession.status]}`}
                >
                  {STATUS_LABEL[activeSession.status]}
                </span>
                <h3 className="font-bold text-slate-900 mt-1">
                  Opname #{activeSession.id} · {TYPE_LABEL[activeSession.opnameType]}
                </h3>
                <p className="text-xs text-slate-500 mt-1">
                  Penghitung: <b>{counterName(activeSession.countedByUserId)}</b>
                  {' · '}Saksi: <b>{counterName(activeSession.witnessedByUserId)}</b>
                  {' · '}Mulai {formatDateTime(activeSession.startedAt)}
                </p>
              </div>
              <div className="text-right">
                <p className="text-xs uppercase tracking-wide text-slate-500">Total Selisih</p>
                <p className="font-bold text-lg text-slate-900">
                  {formatRpDelta(activeSession.varianceTotalValue)}
                </p>
              </div>
            </div>
          </div>
        ) : (
          <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 text-sm text-slate-500">
            Tidak ada sesi opname yang aktif.
          </div>
        )}
      </section>

      {/* History */}
      <section className="space-y-2">
        <h2 className="text-xs uppercase tracking-wide text-slate-500 font-semibold">
          Riwayat
        </h2>
        {loading && sessions.length === 0 ? (
          <p className="text-sm text-slate-500">Memuat…</p>
        ) : historySessions.length === 0 ? (
          <p className="text-sm text-slate-500">Belum ada riwayat opname.</p>
        ) : (
          <ul className="space-y-2">
            {historySessions.map((s) => (
              <li
                key={s.id}
                onClick={() => setActiveSessionId(s.id)}
                className="bg-white border border-slate-200 rounded-lg p-3 text-sm cursor-pointer hover:border-slate-400"
              >
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div>
                    <p className="font-semibold text-slate-900">
                      #{s.id} · {TYPE_LABEL[s.opnameType]}
                    </p>
                    <p className="text-xs text-slate-500">
                      {formatDateTime(s.startedAt)}
                      {' · '}Penghitung {counterName(s.countedByUserId)}
                      {' · '}Saksi {counterName(s.witnessedByUserId)}
                    </p>
                  </div>
                  <div className="text-right">
                    <span
                      className={`inline-block px-2 py-0.5 rounded-full text-xs ${STATUS_PILL[s.status]}`}
                    >
                      {STATUS_LABEL[s.status]}
                    </span>
                    <p className="text-xs text-slate-600 mt-1">
                      Selisih {formatRpDelta(s.varianceTotalValue)}
                    </p>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Catatan Audit Opname (Owner only) */}
      {currentUser?.role === 'Owner' && (
        <section className="space-y-2">
          <h2 className="text-xs uppercase tracking-wide text-slate-500 font-semibold">
            Catatan Audit Opname (7 hari terakhir)
          </h2>
          {auditLoading ? (
            <p className="text-sm text-slate-500">Memuat…</p>
          ) : auditEntries.length === 0 ? (
            <p className="text-sm text-slate-500">Belum ada catatan audit.</p>
          ) : (
            <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead className="text-xs text-slate-500 uppercase bg-slate-50/50">
                  <tr className="border-b border-slate-200">
                    <th className="text-left py-2 px-3">Waktu</th>
                    <th className="text-left py-2 px-3">Sesi</th>
                    <th className="text-left py-2 px-3">Penghitung</th>
                    <th className="text-left py-2 px-3">Saksi</th>
                    <th className="text-right py-2 px-3">Total Selisih</th>
                    <th className="text-left py-2 px-3">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {auditEntries.map(e => (
                    <tr key={e.id} className="border-b border-slate-100 last:border-b-0">
                      <td className="py-2 px-3 text-xs text-slate-600">{formatDateTime(e.createdAt)}</td>
                      <td className="py-2 px-3 font-mono text-xs">#{e.sessionId}</td>
                      <td className="py-2 px-3">{e.counterName ?? '—'}</td>
                      <td className="py-2 px-3">{e.witnessName ?? <span className="text-xs italic text-slate-400">(solo)</span>}</td>
                      <td className={`py-2 px-3 text-right font-semibold ${
                        e.totalVarianceValue < 0 ? 'text-rose-600'
                        : e.totalVarianceValue > 0 ? 'text-emerald-700'
                        : 'text-slate-400'
                      }`}>
                        {formatRpDelta(e.totalVarianceValue)}
                      </td>
                      <td className="py-2 px-3">
                        <span className={`inline-block px-2 py-0.5 rounded-full text-xs border ${
                          e.eventType === 'opname_auto_commit' ? 'bg-emerald-100 text-emerald-800 border-emerald-200'
                          : e.eventType === 'opname_owner_commit' ? 'bg-blue-100 text-blue-800 border-blue-200'
                          : 'bg-rose-100 text-rose-800 border-rose-200'
                        }`}>
                          {e.eventType === 'opname_auto_commit' ? 'Selesai Otomatis'
                            : e.eventType === 'opname_owner_commit' ? 'Disetujui Owner'
                            : 'Ditolak'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {/* Start session modal */}
      {showStartModal && (
        <div
          className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
          onClick={() => !submitting && setShowStartModal(false)}
        >
          <div
            className="bg-white rounded-lg max-w-md w-full p-4 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h2 className="font-bold text-slate-900">Mulai Sesi Opname Baru</h2>
              <button onClick={() => !submitting && setShowStartModal(false)}>
                <X className="w-4 h-4" />
              </button>
            </div>

            <div>
              <label className="block text-xs text-slate-600 mb-1">Tipe Opname</label>
              <select
                value={opnameType}
                onChange={(e) => setOpnameType(e.target.value as OpnameType)}
                className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm"
              >
                <option value="full">Full</option>
                <option value="per_kategori">Per Kategori</option>
                <option value="per_sku_list">Per SKU List</option>
              </select>
              <p className="text-xs text-slate-500 mt-1">
                Scope rinci dapat diset oleh Owner setelah sesi dimulai.
              </p>
            </div>

            {requireWitness && (
              <div>
                <label className="block text-xs text-slate-600 mb-1">
                  Saksi (wajib, bukan penghitung)
                </label>
                <select
                  value={witnessId}
                  onChange={(e) => setWitnessId(e.target.value)}
                  className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm"
                >
                  <option value="">— Pilih Saksi —</option>
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name} ({u.role})
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="rounded bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800">
              Penghitung: <b>{currentUser?.name ?? '—'}</b>. Sesi dikunci ke Anda
              sampai dikirim ke Owner.
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => !submitting && setShowStartModal(false)}
                className="flex-1 py-2 border border-slate-200 rounded-full text-sm"
              >
                Batal
              </button>
              <button
                onClick={onStart}
                disabled={submitting || (requireWitness && !witnessId)}
                className="flex-1 py-2 bg-emerald-600 text-white rounded-full text-sm disabled:opacity-50"
              >
                {submitting ? 'Memulai…' : 'Mulai Sesi'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
