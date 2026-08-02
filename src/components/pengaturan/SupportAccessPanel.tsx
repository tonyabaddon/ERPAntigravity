// src/components/pengaturan/SupportAccessPanel.tsx
// Tenant owner-only panel to manage VOSI support access.
// F-10 Phase 2b — pairs with migration 20261115000050.
//
// Behavior:
// - Lists all grants (active + historical) issued for this tenant.
// - "Grant new access" modal collects admin email, duration, reason.
// - Revoke button on active grants (confirm modal + optional reason).
// - Empty state with contextual help.

import React, { useEffect, useState, useCallback } from 'react';
import { ShieldCheck, Clock, XCircle, PlusCircle, RefreshCw, Info } from 'lucide-react';
import {
  impersonationGrantsService,
  ImpersonationGrant,
} from '../../lib/impersonationGrantsService';
import { captureError } from '../../lib/captureError';
import { extractErrorMessage } from '../../lib/extractErrorMessage';

interface Props {
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
}

const DURATION_CHOICES: Array<{ hours: number; label: string }> = [
  { hours: 4, label: '4 jam' },
  { hours: 24, label: '1 hari' },
  { hours: 24 * 7, label: '7 hari' },
  { hours: 24 * 30, label: '30 hari' },
];

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('id-ID', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function humanErr(err: unknown): string {
  const msg = extractErrorMessage(err);
  if (msg.includes('IMPERSONATION_NOT_GRANTED'))
    return 'Akses belum diberikan tenant.';
  if (msg.includes('ADMIN_NOT_FOUND'))
    return 'Email Caleo admin tidak ditemukan atau tidak aktif.';
  if (msg.includes('NOT_TENANT_OWNER'))
    return 'Hanya Owner yang bisa mengelola akses ini.';
  if (msg.includes('REASON_REQUIRED')) return 'Alasan grant wajib diisi.';
  if (msg.includes('INVALID_EXPIRY'))
    return 'Durasi harus antara 1 jam sampai 30 hari.';
  if (msg.includes('GRANT_NOT_FOUND')) return 'Grant sudah tidak ada.';
  return msg;
}

export default function SupportAccessPanel({ showToast }: Props) {
  const [grants, setGrants] = useState<ImpersonationGrant[]>([]);
  const [loading, setLoading] = useState(true);
  const [showGrantForm, setShowGrantForm] = useState(false);
  const [grantForm, setGrantForm] = useState({
    admin_email: '',
    hours: 24,
    reason: '',
  });
  const [saving, setSaving] = useState(false);
  const [pendingRevoke, setPendingRevoke] = useState<ImpersonationGrant | null>(
    null
  );
  const [revokeReason, setRevokeReason] = useState('');
  const [revoking, setRevoking] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await impersonationGrantsService.list();
      setGrants(rows);
    } catch (err) {
      captureError(err, { feature: 'pengaturan_support_access', action: 'list_impersonation_grants' });
      showToast(humanErr(err), 'warning');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    load();
  }, [load]);

  const handleGrant = async () => {
    if (!grantForm.admin_email.trim()) {
      showToast('Email Caleo admin wajib diisi.', 'warning');
      return;
    }
    if (!grantForm.reason.trim()) {
      showToast('Alasan grant wajib diisi.', 'warning');
      return;
    }
    setSaving(true);
    try {
      await impersonationGrantsService.grant({
        admin_email: grantForm.admin_email.trim(),
        expires_in_hours: grantForm.hours,
        reason: grantForm.reason.trim(),
      });
      showToast('✅ Akses support berhasil diberikan.', 'success');
      setShowGrantForm(false);
      setGrantForm({ admin_email: '', hours: 24, reason: '' });
      await load();
    } catch (err) {
      captureError(err, { feature: 'pengaturan_support_access', action: 'grant_impersonation' });
      showToast(humanErr(err), 'warning');
    } finally {
      setSaving(false);
    }
  };

  const handleRevoke = async () => {
    if (!pendingRevoke) return;
    setRevoking(true);
    try {
      await impersonationGrantsService.revoke({
        grant_id: pendingRevoke.id,
        reason: revokeReason.trim() || 'no reason',
      });
      showToast('✅ Akses support dicabut. Sesi aktif juga dihentikan.', 'success');
      setPendingRevoke(null);
      setRevokeReason('');
      await load();
    } catch (err) {
      captureError(err, { feature: 'pengaturan_support_access', action: 'revoke_impersonation' });
      showToast(humanErr(err), 'warning');
    } finally {
      setRevoking(false);
    }
  };

  const active = grants.filter((g) => g.is_active);
  const historical = grants.filter((g) => !g.is_active);

  return (
    <div className="space-y-6 animate-fadeIn">
      <section>
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 bg-emerald-100 rounded-sm flex items-center justify-center shrink-0">
            <ShieldCheck className="w-5 h-5 text-emerald-700" />
          </div>
          <div className="flex-1">
            <h3 className="text-base font-bold text-[#012749]">Support Access</h3>
            <p className="text-[13px] text-slate-600 mt-0.5">
              Berikan akses login ke tim Caleo kalau butuh bantuan support. Akses selalu
              time-boxed dan bisa dicabut kapan saja. Tanpa grant aktif, tidak ada tim
              Caleo yang bisa masuk ke akun ini.
            </p>
          </div>
        </div>
      </section>

      <div className="flex items-center justify-between gap-3">
        <div className="text-[13px] text-slate-500">
          {loading
            ? 'Memuat…'
            : `${active.length} akses aktif · ${historical.length} riwayat`}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={load}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-sm border border-slate-200 text-[13px] text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            disabled={loading}
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Refresh
          </button>
          <button
            type="button"
            onClick={() => setShowGrantForm(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-sm bg-[#012749] text-white text-[13px] font-semibold hover:bg-[#0b1c30]"
          >
            <PlusCircle className="w-4 h-4" />
            Beri akses baru
          </button>
        </div>
      </div>

      <section>
        <h4 className="text-[13px] font-semibold text-slate-800 mb-2">Akses aktif</h4>
        {loading && (
          <div className="rounded-sm border border-slate-200 p-4 text-[13px] text-slate-500">
            Memuat…
          </div>
        )}
        {!loading && active.length === 0 && (
          <div className="rounded-sm border border-dashed border-slate-300 p-6 text-center text-[13px] text-slate-500 space-y-1">
            <div className="text-slate-700 font-semibold">Belum ada akses support aktif.</div>
            <div>
              Klik <b>Beri akses baru</b> di atas kalau tim Caleo perlu bantu debug atau
              setup akun.
            </div>
          </div>
        )}
        {!loading && active.length > 0 && (
          <div className="space-y-2">
            {active.map((g) => (
              <div
                key={g.id}
                className="rounded-sm border border-emerald-200 bg-emerald-50/50 p-4 flex items-start gap-3"
              >
                <ShieldCheck className="w-5 h-5 text-emerald-700 shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-semibold text-emerald-900 break-all">
                    {g.admin_email}
                  </div>
                  <div className="text-[12px] text-emerald-800 mt-1 flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    Kedaluwarsa {fmtDate(g.expires_at)}
                  </div>
                  <div className="text-[12px] text-slate-600 mt-1">
                    Diberikan oleh {g.granted_by_email} · {fmtDate(g.granted_at)}
                  </div>
                  <div className="text-[12px] text-slate-600 mt-1 italic">
                    Alasan: {g.reason}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setPendingRevoke(g)}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-sm border border-rose-300 bg-white text-[13px] text-rose-700 font-semibold hover:bg-rose-50 shrink-0"
                >
                  <XCircle className="w-3.5 h-3.5" />
                  Cabut
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <h4 className="text-[13px] font-semibold text-slate-800 mb-2">Riwayat</h4>
        {!loading && historical.length === 0 && (
          <div className="text-[13px] text-slate-400 italic">Belum ada riwayat.</div>
        )}
        {historical.length > 0 && (
          <div className="rounded-sm border border-slate-200 overflow-hidden">
            <table className="w-full text-[12px]">
              <thead className="bg-slate-50 text-slate-700">
                <tr>
                  <th className="text-left px-3 py-2 font-semibold">Admin</th>
                  <th className="text-left px-3 py-2 font-semibold">Diberikan</th>
                  <th className="text-left px-3 py-2 font-semibold">Berakhir</th>
                  <th className="text-left px-3 py-2 font-semibold">Status</th>
                  <th className="text-left px-3 py-2 font-semibold">Alasan</th>
                </tr>
              </thead>
              <tbody>
                {historical.map((g) => (
                  <tr key={g.id} className="border-t border-slate-100">
                    <td className="px-3 py-2 break-all">{g.admin_email}</td>
                    <td className="px-3 py-2">{fmtDate(g.granted_at)}</td>
                    <td className="px-3 py-2">{fmtDate(g.expires_at)}</td>
                    <td className="px-3 py-2">
                      {g.revoked_at ? (
                        <span className="text-rose-700">
                          Dicabut {fmtDate(g.revoked_at)}
                        </span>
                      ) : (
                        <span className="text-slate-500">Kedaluwarsa</span>
                      )}
                    </td>
                    <td className="px-3 py-2 italic text-slate-600">{g.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {showGrantForm && (
        <div
          className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
          onClick={() => setShowGrantForm(false)}
        >
          <div
            className="bg-white rounded-sm w-full max-w-md p-6 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 bg-emerald-100 rounded-sm flex items-center justify-center shrink-0">
                <ShieldCheck className="w-5 h-5 text-emerald-700" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-[#012749]">Beri akses support</h3>
                <p className="text-[13px] text-slate-600 mt-0.5">
                  Caleo admin akan bisa impersonate akun ini sampai batas waktu.
                </p>
              </div>
            </div>

            <div>
              <label className="block text-[13px] font-semibold text-slate-700 mb-1">
                Email Caleo admin
              </label>
              <input
                type="email"
                autoFocus
                value={grantForm.admin_email}
                onChange={(e) =>
                  setGrantForm((f) => ({ ...f, admin_email: e.target.value }))
                }
                placeholder="support@caleo.id"
                className="w-full px-3 py-2 rounded-sm border border-slate-300 text-[13px] focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>

            <div>
              <label className="block text-[13px] font-semibold text-slate-700 mb-1">
                Durasi akses
              </label>
              <div className="grid grid-cols-4 gap-2">
                {DURATION_CHOICES.map((c) => (
                  <button
                    key={c.hours}
                    type="button"
                    onClick={() => setGrantForm((f) => ({ ...f, hours: c.hours }))}
                    className={`px-2 py-2 rounded-sm text-[12px] font-semibold border transition ${
                      grantForm.hours === c.hours
                        ? 'bg-[#012749] text-white border-[#012749]'
                        : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                    }`}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-[13px] font-semibold text-slate-700 mb-1">
                Alasan (wajib)
              </label>
              <textarea
                rows={3}
                value={grantForm.reason}
                onChange={(e) =>
                  setGrantForm((f) => ({ ...f, reason: e.target.value }))
                }
                placeholder="Mis: bantu setup akun bank, debug error laporan, dll."
                className="w-full px-3 py-2 rounded-sm border border-slate-300 text-[13px] focus:outline-none focus:ring-2 focus:ring-emerald-500 resize-none"
              />
            </div>

            <div className="flex items-start gap-2 text-[12px] text-amber-800 bg-amber-50 border border-amber-200 rounded-sm p-3">
              <Info className="w-4 h-4 shrink-0 mt-0.5" />
              <div>
                Grant ini masuk audit log. Setelah durasi habis atau dicabut, Caleo
                admin nggak bisa masuk lagi tanpa grant baru.
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowGrantForm(false)}
                className="px-4 py-2 rounded-sm text-[13px] font-semibold text-slate-600 hover:bg-slate-100"
                disabled={saving}
              >
                Batal
              </button>
              <button
                type="button"
                onClick={handleGrant}
                disabled={saving}
                className="px-4 py-2 rounded-sm bg-[#012749] text-white text-[13px] font-semibold hover:bg-[#0b1c30] disabled:opacity-50"
              >
                {saving ? 'Menyimpan…' : 'Beri akses'}
              </button>
            </div>
          </div>
        </div>
      )}

      {pendingRevoke && (
        <div
          className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
          onClick={() => setPendingRevoke(null)}
        >
          <div
            className="bg-white rounded-sm w-full max-w-md p-6 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 bg-rose-100 rounded-sm flex items-center justify-center shrink-0">
                <XCircle className="w-5 h-5 text-rose-700" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-[#012749]">Cabut akses?</h3>
                <p className="text-[13px] text-slate-600 mt-0.5">
                  Kalau <b>{pendingRevoke.admin_email}</b> lagi impersonate akun ini,
                  sesi mereka langsung dihentikan.
                </p>
              </div>
            </div>

            <div>
              <label className="block text-[13px] font-semibold text-slate-700 mb-1">
                Alasan (opsional)
              </label>
              <textarea
                rows={2}
                value={revokeReason}
                onChange={(e) => setRevokeReason(e.target.value)}
                placeholder="Mis: masalah sudah selesai."
                className="w-full px-3 py-2 rounded-sm border border-slate-300 text-[13px] focus:outline-none focus:ring-2 focus:ring-rose-500 resize-none"
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setPendingRevoke(null)}
                className="px-4 py-2 rounded-sm text-[13px] font-semibold text-slate-600 hover:bg-slate-100"
                disabled={revoking}
              >
                Batal
              </button>
              <button
                type="button"
                onClick={handleRevoke}
                disabled={revoking}
                className="px-4 py-2 rounded-sm bg-rose-600 text-white text-[13px] font-semibold hover:bg-rose-700 disabled:opacity-50"
              >
                {revoking ? 'Mencabut…' : 'Cabut akses'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
