import type { Order } from './types';
import type { StoreSettings, BankAccount } from '../pengaturan/types';

/**
 * Build a wa.me URL with a pre-filled reminder message for the given
 * order + sub-stage. Returns null if customer_phone is not on file —
 * caller should fall back to copy-to-clipboard.
 *
 * Template is selected by funnel_sub_stage:
 *  - '2c'  → Reminder pembayaran awal (full / DP)
 *  - '3d'  → Reminder pelunasan setelah DP komponen
 *  - '3h'  → Reminder pelunasan setelah biaya final CP/RP disetujui
 *
 * Any other sub-stage returns a generic "Halo {customer}" greeting.
 */
export function buildWhatsAppReminderUrl(
  order: Order,
  settings: StoreSettings,
  banks: BankAccount[],
): { url: string | null; message: string } {
  const phone = normalizePhone(order.customer_phone);
  const message = buildReminderMessage(order, settings, banks);
  if (!phone) return { url: null, message };
  return { url: `https://wa.me/${phone}?text=${encodeURIComponent(message)}`, message };
}

function normalizePhone(raw?: string): string | null {
  if (!raw) return null;
  const digits = raw.replace(/[^0-9]/g, '');
  if (digits.length === 0) return null;
  if (digits.startsWith('62')) return digits;
  if (digits.startsWith('0')) return '62' + digits.slice(1);
  return digits;
}

function rupiah(n: number): string {
  return 'Rp ' + n.toLocaleString('id-ID');
}

function bankLine(banks: BankAccount[]): string {
  const active = banks.filter(b => b.is_active);
  if (active.length === 0) return '(rekening lihat lampiran)';
  const b = active[0];
  return `${b.bank_name} ${b.account_number} a.n. ${b.account_holder}`;
}

function shortId(order: Order): string {
  return order.id.slice(0, 8);
}

function buildReminderMessage(order: Order, settings: StoreSettings, banks: BankAccount[]): string {
  const greeting = `Halo ${order.customer} \u{1F64F}`;
  const store = settings.nama_toko || 'Sinar Elektrik';
  const bank = bankLine(banks);
  const sid = shortId(order);

  switch (order.funnel_sub_stage) {
    case '2c': {
      const isDp = order.payment_type === 'DP';
      if (isDp && (order.dp_amount === undefined || order.dp_amount === null || order.dp_amount === 0)) {
        // Defensive: DP order without a recorded dp_amount would otherwise
        // dunningly ask the customer for the full total — which is wrong.
        return [
          greeting,
          `Pesanan #${sid}: jumlah DP belum di-set di sistem.`,
          `Mohon cek manual dulu sebelum kirim reminder ya.`,
          `— tim ${store}`,
        ].join('\n');
      }
      const amount = isDp ? (order.dp_amount as number) : order.total;
      const label = isDp ? 'DP' : 'pembayaran';
      return [
        greeting,
        `Pesanan #${sid} sebesar ${rupiah(amount)} mohon ditransfer ${label}-nya ya.`,
        `Bank: ${bank}.`,
        `Terima kasih dari tim ${store} \u{1F64F}`,
      ].join('\n');
    }
    case '3d': {
      const sisa = order.total - (order.dp_amount ?? 0);
      return [
        greeting,
        `Terima kasih sudah DP untuk pesanan #${sid}.`,
        `Mohon transfer sisa pelunasan ${rupiah(sisa)} ke ${bank}.`,
        `Begitu masuk, barang langsung kami siapkan untuk pengiriman.`,
        `— tim ${store}`,
      ].join('\n');
    }
    case '3h': {
      const sisa = order.total - (order.dp_amount ?? 0);
      return [
        greeting,
        `Pesanan #${sid}: biaya final sudah disetujui owner.`,
        `Sisa pelunasan ${rupiah(sisa)} mohon ditransfer ke ${bank}.`,
        `Setelah lunas, barang langsung kami kirim/serahkan.`,
        `— tim ${store}`,
      ].join('\n');
    }
    default:
      return [
        greeting,
        `Mengenai pesanan #${sid}, mohon konfirmasi ya.`,
        `— tim ${store}`,
      ].join('\n');
  }
}
