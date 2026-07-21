import { useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import type { Order, OrderItem } from '../../lib/sales/types';
import { formatIDR } from '../../lib/formatIDR';

interface Props {
  order: Order;
  onClose: () => void;
  onSaved: () => void;
}

/**
 * Pre-payment edit modal. Lets admin tweak `ongkir_amount`, `delivery_address`,
 * and item quantities BEFORE the customer has paid (sub-stages 2a..2d). Records
 * a mandatory reason into `audit_log` so changes are traceable.
 *
 * Why client-side, not an RPC: audit_log HAS RLS (t_insert_own policy for
 * authenticated where tenant_id = _resolve_tenant_id() AND _check_expiry_ok());
 * the tenant_id column defaults to _resolve_tenant_id() so this INSERT without
 * an explicit tenant_id passes the policy check cleanly. kasir_transactions has
 * a permissive policy (`anon_all_kasir`) that allows the UPDATE. This pair of
 * writes is atomic-enough at MSME single-admin scale. Verified 2026-07-21 via
 * `set_config('request.jwt.claims', ...) + SET LOCAL ROLE authenticated + INSERT`
 * smoke — see tests/sql/qa-week/2e-regression.sql. If this graduates to
 * multi-admin tenancy, swap to a SECURITY DEFINER RPC.
 */
export function EditOrderModal({ order, onClose, onSaved }: Props) {
  const initialItems: OrderItem[] = order.items ?? [];

  const [ongkir, setOngkir] = useState<number>(order.ongkir_amount ?? 0);
  const [address, setAddress] = useState<string>(order.delivery_address ?? order.customer_address ?? '');
  const [items, setItems] = useState<OrderItem[]>(initialItems);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reasonValid = reason.trim().length >= 5;

  function updateQty(idx: number, qty: number) {
    setItems(prev => prev.map((it, i) => {
      if (i !== idx) return it;
      const unit = it.unit_price ?? (it.qty > 0 ? it.subtotal / it.qty : 0);
      const nextQty = Math.max(0, Math.floor(qty));
      return { ...it, qty: nextQty, subtotal: Math.round(unit * nextQty) };
    }));
  }

  async function handleSubmit() {
    if (!reasonValid) {
      setError('Alasan wajib (minimal 5 karakter).');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const subtotal = items.reduce((acc, it) => acc + (it.subtotal || 0), 0);
      const newTotal = subtotal + ongkir;

      // Audit-log first, mutation second. If the audit INSERT fails we abort
      // without touching kasir_transactions — no untracked mutations possible.
      // (kasir_transactions has no updated_at column, see migration
      //  20260604000008_kasir_transactions.sql; UPDATE list intentionally omits
      //  it.)
      const { data: userRes } = await supabase.auth.getUser();
      const actorId = userRes?.user?.id ?? null;
      const { error: auditErr } = await supabase.from('audit_log').insert({
        event_type: 'order_modified',
        actor_user_id: actorId,
        payload: {
          order_id: order.id,
          changes: {
            ongkir_before: order.ongkir_amount ?? 0,
            ongkir_after: ongkir,
            delivery_address_before: order.delivery_address ?? null,
            delivery_address_after: address || null,
            items_before: initialItems,
            items_after: items,
            total_before: order.total,
            total_after: newTotal,
          },
          reason: reason.trim(),
        },
      });
      if (auditErr) {
        console.error('audit_log insert failed', auditErr);
        throw new Error('Gagal mencatat audit. Edit dibatalkan.');
      }

      const { error: updateErr } = await supabase
        .from('kasir_transactions')
        .update({
          ongkir_amount: ongkir,
          delivery_address: address || null,
          items,
          subtotal,
          total_amount: newTotal,
        })
        .eq('id', order.id);
      if (updateErr) throw updateErr;

      onSaved();
      // eslint-disable-next-line no-alert
      alert('Pesanan berhasil diperbarui.');
      onClose();
    } catch (err) {
      console.error('EditOrderModal save failed', err);
      setError(err instanceof Error ? err.message : 'Simpan gagal.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 260, padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'white', borderRadius: 16, padding: 24,
          maxWidth: 640, width: '100%', maxHeight: '90vh', overflowY: 'auto',
        }}
      >
        <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--color-primary)', marginBottom: 4 }}>
          Edit Pesanan (pre-bayar)
        </div>
        <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 16 }}>
          Order #{order.id.slice(0, 8)} · {order.customer}
        </div>

        {/* Ongkir */}
        <div style={{ marginBottom: 16 }}>
          <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 4 }}>Ongkir (Rp)</label>
          <input
            type="number"
            value={ongkir}
            min={0}
            onChange={(e) => setOngkir(Math.max(0, Number(e.target.value || 0)))}
            style={{ width: '100%', padding: '8px 12px', border: '1px solid #e5e7eb', borderRadius: 8, fontSize: 13 }}
          />
        </div>

        {/* Delivery address */}
        <div style={{ marginBottom: 16 }}>
          <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 4 }}>Alamat Pengiriman</label>
          <textarea
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            rows={2}
            style={{ width: '100%', padding: '8px 12px', border: '1px solid #e5e7eb', borderRadius: 8, fontSize: 13, fontFamily: 'inherit' }}
          />
        </div>

        {/* Items */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 8 }}>Items</div>
          {items.length === 0 ? (
            <div style={{ fontSize: 12, color: '#9ca3af', fontStyle: 'italic' }}>Tidak ada item.</div>
          ) : (
            <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: '#f9fafb' }}>
                  <th style={{ textAlign: 'left', padding: '6px 8px', fontWeight: 600, color: '#6b7280' }}>Produk</th>
                  <th style={{ textAlign: 'right', padding: '6px 8px', fontWeight: 600, color: '#6b7280', width: 80 }}>Qty</th>
                  <th style={{ textAlign: 'right', padding: '6px 8px', fontWeight: 600, color: '#6b7280', width: 120 }}>Subtotal</th>
                </tr>
              </thead>
              <tbody>
                {items.map((it, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid #f3f4f6' }}>
                    <td style={{ padding: '6px 8px' }}>{it.name}</td>
                    <td style={{ padding: '6px 8px', textAlign: 'right' }}>
                      <input
                        type="number"
                        value={it.qty}
                        min={0}
                        onChange={(e) => updateQty(i, Number(e.target.value || 0))}
                        style={{ width: 60, textAlign: 'right', padding: '4px 6px', border: '1px solid #e5e7eb', borderRadius: 6, fontSize: 12 }}
                      />
                    </td>
                    <td style={{ padding: '6px 8px', textAlign: 'right', fontFamily: 'ui-monospace,monospace' }}>
                      {formatIDR(it.subtotal)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Reason — required */}
        <div style={{ marginBottom: 16 }}>
          <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 4 }}>
            Alasan perubahan <span style={{ color: '#b91c1c' }}>*</span>
          </label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            placeholder="Minimal 5 karakter, mis. ‘Customer minta tambah qty kabel jadi 3’."
            style={{ width: '100%', padding: '8px 12px', border: `1px solid ${reasonValid || reason.length === 0 ? '#e5e7eb' : '#fca5a5'}`, borderRadius: 8, fontSize: 13, fontFamily: 'inherit' }}
          />
          {!reasonValid && reason.length > 0 && (
            <div style={{ fontSize: 11, color: '#b91c1c', marginTop: 4 }}>Minimal 5 karakter.</div>
          )}
        </div>

        {error && <div style={{ fontSize: 12, color: '#b91c1c', marginBottom: 8 }}>⚠️ {error}</div>}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button
            onClick={onClose}
            disabled={saving}
            style={{ padding: '8px 14px', borderRadius: 10, background: 'white', border: '1px solid #e5e7eb', cursor: 'pointer', fontWeight: 600, fontSize: 12 }}
          >
            Batal
          </button>
          <button
            onClick={handleSubmit}
            disabled={saving || !reasonValid}
            style={{
              padding: '8px 18px', borderRadius: 10,
              background: saving || !reasonValid ? '#9ca3af' : 'var(--color-primary)',
              color: 'white', border: 'none',
              cursor: saving || !reasonValid ? 'not-allowed' : 'pointer',
              fontWeight: 700, fontSize: 12,
            }}
          >
            {saving ? 'Menyimpan…' : '💾 Simpan Perubahan'}
          </button>
        </div>
      </div>
    </div>
  );
}
