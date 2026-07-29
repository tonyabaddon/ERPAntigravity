import { useState } from 'react';
import type { DbCustomer, DbCustomerWithStats, DbTenantSettings, KasirChannel } from '../../../types';
import { CHANNEL_REQUIRES_ORDER_NO } from '../../../lib/salesChannels';
import ChannelSelector from '../ChannelSelector';
import { TokpedStrip, WhatsappStrip } from '../ChannelStrip';
import CustomerPanel from '../CustomerPanel';
import NewCustomerInlineForm from './NewCustomerInlineForm';

interface Props {
  channel: KasirChannel;
  setChannel: (c: KasirChannel) => void;
  customer: DbCustomer | undefined;
  setCustomer: (c: DbCustomer | undefined) => void;
  customers: DbCustomerWithStats[];
  marketplaceOrderNo: string;
  setMarketplaceOrderNo: (s: string) => void;
  waPhone: string;
  setWaPhone: (s: string) => void;
  waChatUrl: string;
  setWaChatUrl: (s: string) => void;
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
  showTierField?: boolean;
  tenantSettings?: DbTenantSettings;
}

export default function Step1ChannelCustomer(props: Props) {
  const [showNewCustomerForm, setShowNewCustomerForm] = useState(false);

  return (
    <div className="p-6 space-y-6">
      <div>
        <label className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-2">
          Channel Penjualan <span className="text-red-500">*</span>
        </label>
        <ChannelSelector value={props.channel} onChange={props.setChannel} />
        <p className="text-[11px] text-slate-400 mt-2 italic">Atur kanal aktif di Pengaturan → Kanal Penjualan.</p>
        {CHANNEL_REQUIRES_ORDER_NO.has(props.channel) && (
          <div className="mt-4">
            <TokpedStrip value={props.marketplaceOrderNo} onChange={props.setMarketplaceOrderNo} />
          </div>
        )}
        {props.channel === 'whatsapp' && (
          <div className="mt-4">
            <WhatsappStrip
              phone={props.waPhone}
              chatUrl={props.waChatUrl}
              onPhoneChange={props.setWaPhone}
              onChatUrlChange={props.setWaChatUrl}
            />
          </div>
        )}
      </div>

      <div className="step-divider" />

      <div>
        <label className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-2">
          Customer <span className="text-red-500">*</span>
        </label>
        <CustomerPanel
          customers={props.customers}
          selectedCustomerId={props.customer?.id ?? null}
          onSelectExisting={(c) => props.setCustomer(c)}
          onClearSelection={() => props.setCustomer(undefined)}
        />
        <p className="text-[11px] text-slate-500 mt-1.5 italic">
          💡 Tip: cari pakai nomor HP untuk auto-detect kalau customer pernah belanja sebelumnya — bantu repeat-buyer recognition.
        </p>
        {!props.customer && !showNewCustomerForm && (
          <div className="mt-3 flex items-center justify-between text-[11px]">
            <div className="text-slate-500">Tidak ketemu di daftar?</div>
            <button
              type="button"
              onClick={() => setShowNewCustomerForm(true)}
              className="px-4 py-1.5 text-xs font-bold rounded-lg bg-[#012749] text-white hover:opacity-90"
            >
              + Customer Baru
            </button>
          </div>
        )}
        {showNewCustomerForm && (
          <NewCustomerInlineForm
            onSaved={(c) => { props.setCustomer(c); setShowNewCustomerForm(false); }}
            onCancel={() => setShowNewCustomerForm(false)}
            showToast={props.showToast}
            showTierField={props.showTierField}
            tenantSettings={props.tenantSettings}
          />
        )}
        <p className="mt-2 text-[11px] text-slate-500 italic">
          ℹ️ Setiap customer wajib tersimpan di daftar Pelanggan — database MSME penting.
        </p>
      </div>
    </div>
  );
}
