import { verifyOwnerPin } from '../../lib/supabaseClient';
import PinPad from '../ui/PinPad';

interface OwnerPinPadProps {
  approvalId: number;
  onSuccess: () => void;
  onCancel: () => void;
  showToast?: (msg: string, type?: 'success' | 'error') => void;
  onSendToWA?: () => void;
}

/**
 * Owner PIN pad specialised for the adjustment/opname/price_change/initial_stock
 * flow — the PIN itself only flips the approval gate via verify_owner_pin;
 * the caller (ApprovalInboxScreen) runs the commit RPC AFTER onSuccess fires.
 *
 * Visual is the shared PinPad component so all persetujuan PIN entries look
 * identical across the app (founder-flagged consistency requirement 2026-07-24).
 */
export default function OwnerPinPad({
  approvalId,
  onSuccess,
  onCancel,
  showToast,
  onSendToWA,
}: OwnerPinPadProps) {
  const handlePinComplete = async (pin: string) => {
    const ok = await verifyOwnerPin(approvalId, pin);
    if (ok) {
      showToast?.('PIN benar — disetujui', 'success');
      onSuccess();
      return { ok: true };
    }
    showToast?.('PIN salah', 'error');
    return { ok: false, error: 'PIN salah — coba lagi' };
  };

  return (
    <PinPad
      onPinComplete={handlePinComplete}
      onCancel={onCancel}
      showDemoHint
      trailingAction={onSendToWA ? { label: 'Kirim ke WA Owner', onClick: onSendToWA, tone: 'emerald' } : undefined}
    />
  );
}
