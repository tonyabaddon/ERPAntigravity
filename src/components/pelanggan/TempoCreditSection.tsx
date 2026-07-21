// src/components/pelanggan/TempoCreditSection.tsx
import { useState, useEffect } from 'react';
import { DbCustomer } from '../../types';
import { customerCreditService, supabase } from '../../lib/supabaseClient';
import { formatIDR } from '../../lib/formatIDR';

interface Props {
  customer: DbCustomer;
  onChanged: () => void;
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
}


const DEFAULT_TERM_OPTIONS = [7, 14, 30, 60, 90];

export default function TempoCreditSection({ customer, onChanged, showToast }: Props) {
  const [termOptions, setTermOptions] = useState<number[]>(DEFAULT_TERM_OPTIONS);
  const [selectedTerm, setSelectedTerm] = useState(30);
  const [limitInput, setLimitInput] = useState('');
  const [reasonInput, setReasonInput] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [pendingRequestId, setPendingRequestId] = useState<number | null>(null);

  // Load tenant's allowed term values from piutang_settings
  useEffect(() => {
    if (!supabase) return;
    void Promise.resolve(
      supabase
        .from('piutang_settings')
        .select('term_days_allowed')
        .single()
    ).then(({ data }) => {
      if (data?.term_days_allowed?.length) setTermOptions(data.term_days_allowed as number[]);
    }).catch(() => { /* keep default */ });
  }, []);

  // Check if a pending request already exists for this customer (poll on mount).
  useEffect(() => {
    if (!supabase) return;
    void Promise.resolve(
      supabase
        .from('approval_requests')
        .select('id, request_type, status, payload')
        .eq('status', 'pending')
        .in('request_type', ['customer_credit_activate', 'customer_credit_limit_change', 'customer_credit_deactivate'])
        .order('id', { ascending: false })
        .limit(20)
    ).then(({ data }) => {
      const found = (data ?? []).find((r) => {
        const payload = r.payload as Record<string, unknown> | null;
        return payload?.customer_id === customer.id;
      });
      if (found) setPendingRequestId(found.id);
    }).catch(() => {});
  }, [customer.id]);

  const handleRequestActivate = async () => {
    const limit = Number(limitInput.replace(/\D/g, ''));
    if (!limit || limit <= 0) {
      showToast('Limit harus diisi & > 0', 'warning');
      return;
    }
    setSubmitting(true);
    try {
      const id = await customerCreditService.requestActivate(customer.id, selectedTerm, limit, reasonInput || null);
      setPendingRequestId(id);
      showToast('Permintaan dikirim ke owner', 'success');
      onChanged();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Gagal mengirim permintaan', 'warning');
    } finally {
      setSubmitting(false);
    }
  };

  const handleRequestChange = async () => {
    const limit = Number(limitInput.replace(/\D/g, ''));
    if (!limit || limit <= 0) { showToast('Limit baru harus > 0', 'warning'); return; }
    if (reasonInput.trim().length < 5) { showToast('Alasan minimal 5 karakter', 'warning'); return; }
    setSubmitting(true);
    try {
      const id = await customerCreditService.requestLimitChange(customer.id, limit, reasonInput);
      setPendingRequestId(id);
      showToast('Permintaan ubah limit dikirim ke owner', 'success');
      onChanged();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Gagal mengirim permintaan', 'warning');
    } finally {
      setSubmitting(false);
    }
  };

  const handleRequestDeactivate = async () => {
    if (reasonInput.trim().length < 5) { showToast('Alasan minimal 5 karakter', 'warning'); return; }
    setSubmitting(true);
    try {
      const id = await customerCreditService.requestDeactivate(customer.id, reasonInput);
      setPendingRequestId(id);
      showToast('Permintaan nonaktifkan dikirim ke owner', 'success');
      onChanged();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Gagal mengirim permintaan', 'warning');
    } finally {
      setSubmitting(false);
    }
  };

  // ── Render: 3 states ───────────────────────────────────────────────────
  if (pendingRequestId !== null) {
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
        <div className="text-sm font-semibold text-amber-800 mb-1">⏳ Menunggu Persetujuan Owner</div>
        <div className="text-xs text-amber-700">Owner akan approve dengan PIN dari halaman Persetujuan.</div>
      </div>
    );
  }

  if (!customer.allows_tempo) {
    // State A: not activated
    return (
      <div className="bg-slate-50 rounded-lg p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="text-sm font-semibold text-on-surface">Tempo & Limit Kredit</div>
          <span className="bg-slate-200 text-slate-600 text-[10px] font-bold px-2 py-0.5 rounded-full">BELUM AKTIF</span>
        </div>
        <div className="text-xs text-slate-500 mb-3">
          Aktifkan jika ini customer langganan grosir terpercaya. Permintaan akan dikirim ke owner.
        </div>
        <div className="mb-3">
          <label className="text-[11px] font-semibold text-slate-600 uppercase mb-1 block">Jangka Waktu (Net)</label>
          <div className="flex gap-2 flex-wrap">
            {termOptions.map(d => (
              <button key={d} type="button"
                className={'px-3 py-2 rounded border text-sm ' + (selectedTerm === d ? 'border-2 border-primary bg-primary/5 text-primary font-semibold' : 'border-slate-300 text-slate-700')}
                onClick={() => setSelectedTerm(d)}>
                {d} hari
              </button>
            ))}
          </div>
        </div>
        <div className="mb-3">
          <label className="text-[11px] font-semibold text-slate-600 uppercase mb-1 block">Limit Kredit Maksimum</label>
          <div className="relative">
            <span className="absolute left-3 top-2 text-sm text-slate-500">Rp</span>
            <input type="text" value={limitInput} onChange={e => setLimitInput(e.target.value.replace(/\D/g, ''))}
              placeholder="50000000" className="w-full pl-9 pr-3 py-2 border border-slate-300 rounded text-sm font-mono" />
          </div>
        </div>
        <div className="mb-3">
          <label className="text-[11px] font-semibold text-slate-600 uppercase mb-1 block">Alasan (opsional)</label>
          <input type="text" value={reasonInput} onChange={e => setReasonInput(e.target.value)}
            className="w-full px-3 py-2 border border-slate-300 rounded text-sm" />
        </div>
        <button onClick={handleRequestActivate} disabled={submitting}
          className="w-full bg-channel-grosir text-white py-2.5 rounded-lg text-sm font-semibold disabled:opacity-50">
          🔐 Minta Persetujuan Owner
        </button>
      </div>
    );
  }

  // State C: activated
  const usagePct = 0; // Phase 1A: outstanding tracking lands in Phase 1B; show 0% placeholder.
  return (
    <div className="bg-secondary/5 rounded-lg p-4 border border-secondary/20">
      <div className="flex items-center justify-between mb-3">
        <div className="text-sm font-semibold text-on-surface flex items-center gap-2">
          <span className="text-secondary">●</span> Tempo & Limit Kredit
        </div>
        <span className="bg-secondary/15 text-secondary text-[10px] font-bold px-2 py-0.5 rounded-full">AKTIF</span>
      </div>

      <div className="grid grid-cols-2 gap-3 mb-3">
        <div>
          <div className="text-[10px] text-slate-500 uppercase mb-0.5">Jangka Waktu</div>
          <div className="text-base font-semibold text-on-surface">Net {customer.term_days} hari</div>
        </div>
        <div>
          <div className="text-[10px] text-slate-500 uppercase mb-0.5">Limit Kredit</div>
          <div className="text-base font-semibold text-on-surface">{formatIDR(customer.credit_limit)}</div>
        </div>
      </div>

      <div className="mb-3">
        <div className="flex justify-between text-[11px] text-slate-600 mb-1">
          <span className="font-semibold">Terpakai</span>
          <span>{formatIDR(0)} / {formatIDR(customer.credit_limit)} ({usagePct}%)</span>
        </div>
        <div className="w-full bg-slate-200 rounded-full h-2">
          <div className="bg-secondary rounded-full h-2" style={{ width: `${usagePct}%` }}></div>
        </div>
        <div className="text-[11px] text-slate-500 mt-1">Outstanding tracking ditambahkan di Phase 1B</div>
      </div>

      <div className="mb-3">
        <label className="text-[11px] font-semibold text-slate-600 uppercase mb-1 block">Limit baru (untuk Ubah) atau Alasan (untuk Nonaktifkan)</label>
        <div className="relative">
          <span className="absolute left-3 top-2 text-sm text-slate-500">Rp</span>
          <input type="text" value={limitInput} onChange={e => setLimitInput(e.target.value.replace(/\D/g, ''))}
            placeholder="limit baru" className="w-full pl-9 pr-3 py-2 border border-slate-300 rounded text-sm font-mono mb-2" />
        </div>
        <input type="text" value={reasonInput} onChange={e => setReasonInput(e.target.value)}
          placeholder="alasan (minimal 5 karakter)"
          className="w-full px-3 py-2 border border-slate-300 rounded text-sm" />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <button onClick={handleRequestChange} disabled={submitting}
          className="bg-white border border-slate-300 text-slate-700 py-2 rounded-lg text-sm font-medium hover:bg-slate-50 disabled:opacity-50">
          ✏️ Ubah Limit
        </button>
        <button onClick={handleRequestDeactivate} disabled={submitting}
          className="bg-white border border-red-300 text-red-600 py-2 rounded-lg text-sm font-medium hover:bg-red-50 disabled:opacity-50">
          🚫 Nonaktifkan
        </button>
      </div>
      <div className="text-[11px] text-slate-400 text-center mt-2">Kedua aksi di atas perlu approval owner</div>
    </div>
  );
}
