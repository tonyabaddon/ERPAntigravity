import { useState } from 'react';
import type { DbCustomer } from '../../../types';
import { insertNewCustomer, requestCustomerCreditActivate } from '../../../lib/customers/customerWrappers';
import { extractErrorMessage } from '../../../lib/extractErrorMessage';

interface Props {
  onSaved: (customer: DbCustomer) => void;
  onCancel: () => void;
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
  showTierField?: boolean;
}

export default function NewCustomerInlineForm({ onSaved, onCancel, showToast, showTierField = false }: Props) {
  const [name, setName] = useState('');
  const [wa, setWa] = useState('');
  const [company, setCompany] = useState('');
  const [address, setAddress] = useState('');
  const [tier, setTier] = useState<'eceran' | 'grosir'>('eceran');
  const [requestTempo, setRequestTempo] = useState(false);
  const [limit, setLimit] = useState('');
  const [term, setTerm] = useState('');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const canSubmit = name.trim().length > 0 && wa.trim().length > 0 && !submitting;

  const onSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const customer = await insertNewCustomer({
        name: name.trim(),
        wa_number: wa.trim(),
        company: company.trim() || undefined,
        address: address.trim() || undefined,
        ...(showTierField ? { default_pricing_tier: tier } : {}),
      });
      if (requestTempo) {
        const parsedLimit = parseFloat(limit.replace(/[.,]/g, '')) || 0;
        const parsedTerm = parseInt(term, 10) || 0;
        if (parsedLimit > 0 && parsedTerm > 0) {
          try {
            await requestCustomerCreditActivate(customer.id, parsedTerm, parsedLimit, reason.trim() || undefined);
            showToast('Customer tersimpan; request TEMPO terkirim ke Owner.', 'success');
          } catch (e) {
            showToast('Customer tersimpan, tapi gagal kirim request TEMPO. Coba dari menu Pelanggan.', 'warning');
          }
        } else {
          showToast('Customer tersimpan. Limit/term TEMPO belum di-set; lewati.', 'info');
        }
      } else {
        showToast('Customer baru tersimpan.', 'success');
      }
      onSaved(customer);
    } catch (e) {
      const rawMsg = extractErrorMessage(e);
      // F5-05: map unique constraint violation to Bahasa-friendly message
      const friendlyMsg = rawMsg.includes('uq_customers_wa_tenant')
        ? 'Nomor HP sudah terdaftar untuk customer lain di toko ini. Cek dulu di daftar Pelanggan.'
        : rawMsg;
      showToast(`Gagal simpan customer: ${friendlyMsg}`, 'warning');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div data-testid="new-customer-form" className="mt-3 border-2 border-[#012749]/30 rounded-lg p-4 bg-[#012749]/5">
      <div className="flex items-center justify-between mb-3">
        <div>
          <div className="text-sm font-extrabold text-[#012749]">Customer Baru</div>
          <div className="text-[11px] text-slate-600">Akan tersimpan ke daftar Pelanggan.</div>
        </div>
        <button type="button" onClick={onCancel} className="text-slate-400 hover:text-slate-700 text-sm">×</button>
      </div>

      <div className="grid grid-cols-2 gap-3 text-xs">
        <div>
          <label className="block text-[11px] font-bold text-slate-600 mb-1">Nama <span className="text-red-500">*</span></label>
          <input value={name} onChange={(e) => setName(e.target.value)} className="w-full px-3 py-2 border border-slate-300 rounded-lg" />
        </div>
        <div>
          <label className="block text-[11px] font-bold text-slate-600 mb-1">No HP / WhatsApp <span className="text-red-500">*</span></label>
          <input value={wa} onChange={(e) => setWa(e.target.value)} placeholder="08xxx" className="w-full px-3 py-2 border border-slate-300 rounded-lg" />
        </div>
        <div>
          <label className="block text-[11px] font-bold text-slate-600 mb-1">Perusahaan / PT</label>
          <input value={company} onChange={(e) => setCompany(e.target.value)} className="w-full px-3 py-2 border border-slate-300 rounded-lg" />
        </div>
        <div>
          <label className="block text-[11px] font-bold text-slate-600 mb-1">Alamat</label>
          <input value={address} onChange={(e) => setAddress(e.target.value)} className="w-full px-3 py-2 border border-slate-300 rounded-lg" />
        </div>
      </div>

      {showTierField && (
        <div className="mt-3 pt-3 border-t border-[#012749]/20">
          <label className="block text-[11px] font-bold text-slate-600 mb-1.5">Tipe Harga default</label>
          <div className="flex gap-1.5">
            {(['eceran', 'grosir'] as const).map((t) => {
              const active = tier === t;
              return (
                <button
                  key={t}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setTier(t)}
                  className={`text-xs font-semibold px-3 py-1.5 rounded-full transition-colors ${
                    active
                      ? t === 'grosir'
                        ? 'bg-purple-600 text-white'
                        : 'bg-[#012749] text-white'
                      : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                  }`}
                >
                  {t === 'eceran' ? 'Eceran' : 'Grosir'}
                </button>
              );
            })}
          </div>
          <p className="text-[11px] text-slate-500 mt-1 italic">Otomatis dipakai saat customer ini transaksi; kasir bebas switch per pesanan.</p>
        </div>
      )}

      <div className="mt-3 pt-3 border-t border-[#012749]/20">
        <label className="flex items-center gap-2 text-xs font-bold text-slate-700 cursor-pointer">
          <input type="checkbox" checked={requestTempo} onChange={(e) => setRequestTempo(e.target.checked)} className="rounded" />
          Ajukan TEMPO (kredit) untuk customer ini
        </label>
        {requestTempo && (
          <>
            <p className="text-[11px] text-slate-500 mt-1 ml-6">
              Centang kalau customer mau bayar nanti. <strong>Butuh approval Owner dulu</strong> — request masuk ke Persetujuan, customer baru bisa pakai TEMPO setelah disetujui.
            </p>
            <div className="mt-2 ml-6 space-y-2">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-bold text-slate-600 mb-1">Limit Kredit yang diminta (Rp)</label>
                  <input value={limit} onChange={(e) => setLimit(e.target.value)} placeholder="Mis: 5.000.000" className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-lg" />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-600 mb-1">Term (hari)</label>
                  <input value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Mis: 14" className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-lg" />
                </div>
              </div>
              <div>
                <label className="block text-[11px] font-bold text-slate-600 mb-1">Alasan / Justifikasi (optional)</label>
                <textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Mis: Customer regular, sudah belanja 3x via WA. Owner tetangga sebelah." className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-lg" />
                <p className="text-[10px] text-slate-500 mt-1 italic">Bantu Owner decide cepat. Tampil sebagai blockquote di Persetujuan inbox.</p>
              </div>
            </div>
            <p className="text-[11px] text-amber-700 mt-2 ml-6 italic">
              ⚠️ Untuk transaksi sekarang: customer baru saja dibuat & TEMPO belum di-approve, jadi pesanan ini harus pakai <strong>LUNAS</strong> atau <strong>DP</strong>. TEMPO bisa dipakai untuk pesanan berikutnya setelah Owner approve.
            </p>
          </>
        )}
      </div>

      <div className="mt-3 flex justify-end gap-2">
        <button type="button" onClick={onCancel} disabled={submitting} className="px-3 py-1.5 text-xs font-semibold rounded-lg text-slate-600 hover:bg-slate-100 disabled:opacity-50">Batal</button>
        <button type="button" onClick={onSubmit} disabled={!canSubmit} className="px-4 py-1.5 text-xs font-bold rounded-lg bg-[#012749] text-white hover:opacity-90 disabled:opacity-50">
          {submitting ? 'Menyimpan…' : '✓ Simpan & Pilih'}
        </button>
      </div>
    </div>
  );
}
