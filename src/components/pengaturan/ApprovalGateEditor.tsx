/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ApprovalGateEditor — reusable per-gate config editor (7 knobs).
// Used by ApprovalRulesPanel to expose full approval_settings config
// per request_type. Rejects WA_BUTTON verification (per feedback memory).

import { useState } from 'react';
import { upsertApprovalSettings } from '../../lib/discountApproval/api';
import type { VerificationMethod } from '../../lib/discountApproval/types';

export interface ApprovalGateSettings {
  approval_required: boolean;
  verification_method: VerificationMethod;
  threshold_amount: number | null;
  threshold_percent: number | null;
  threshold_qty: number | null;
  approver_role: string;
  requestor_bypass_self: boolean;
  reason_required: boolean;
}

interface Props {
  requestType: string;
  initialValues: ApprovalGateSettings;
  onSaved?: () => void;
  showToast?: (msg: string, tone?: 'success' | 'warning' | 'info') => void;
}

export function ApprovalGateEditor({ requestType, initialValues, onSaved, showToast }: Props) {
  const [settings, setSettings] = useState<ApprovalGateSettings>(initialValues);
  const [saving, setSaving] = useState(false);

  const update = <K extends keyof ApprovalGateSettings>(k: K, v: ApprovalGateSettings[K]) => {
    setSettings((s) => ({ ...s, [k]: v }));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await upsertApprovalSettings({
        requestType,
        approvalRequired: settings.approval_required,
        verificationMethod: settings.verification_method,
        thresholdAmount: settings.threshold_amount,
        thresholdPercent: settings.threshold_percent,
        thresholdQty: settings.threshold_qty,
        approverRole: settings.approver_role,
        requestorBypassSelf: settings.requestor_bypass_self,
        reasonRequired: settings.reason_required,
      });
      showToast?.('Aturan disimpan', 'success');
      onSaved?.();
    } catch (e) {
      showToast?.(e instanceof Error ? e.message : String(e), 'warning');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3" style={{ fontSize: '14px' }}>
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={settings.approval_required}
          onChange={(e) => update('approval_required', e.target.checked)}
        />
        <span className="text-sm font-medium">Aktifkan approval owner</span>
      </label>

      {settings.approval_required && (
        <div className="ml-6 space-y-3 border-l-2 border-slate-200 pl-3">
          <div>
            <div className="text-xs font-medium text-slate-500 mb-1">Ambang batas approval</div>
            <label className="block mb-1">
              <span className="text-xs text-slate-600">Nominal Rp</span>
              <input
                type="number"
                min={0}
                value={settings.threshold_amount ?? ''}
                onChange={(e) =>
                  update('threshold_amount', e.target.value ? Number(e.target.value) : null)
                }
                placeholder="kosong = tidak dicek"
                className="mt-0.5 w-full rounded border border-slate-300 px-3 py-1.5 text-sm"
              />
            </label>
            <label className="block">
              <span className="text-xs text-slate-600">Persentase %</span>
              <input
                type="number"
                min={0}
                max={100}
                step={0.1}
                value={settings.threshold_percent ?? ''}
                onChange={(e) =>
                  update('threshold_percent', e.target.value ? Number(e.target.value) : null)
                }
                placeholder="kosong = tidak dicek"
                className="mt-0.5 w-full rounded border border-slate-300 px-3 py-1.5 text-sm"
              />
            </label>
            <p className="mt-1 text-xs text-slate-500">
              Approval trigger kalau discount melewati salah satu ambang.
            </p>
          </div>

          <fieldset>
            <legend className="text-xs font-medium text-slate-500 mb-1">Metode verifikasi</legend>
            <label className="block">
              <input
                type="radio"
                name={`verif_${requestType}`}
                checked={settings.verification_method === 'APP_INBOX'}
                onChange={() => update('verification_method', 'APP_INBOX')}
              />
              <span className="ml-2 text-sm">Approval Inbox (owner review di menu Persetujuan)</span>
            </label>
            <label className="block">
              <input
                type="radio"
                name={`verif_${requestType}`}
                checked={settings.verification_method === 'PIN'}
                onChange={() => update('verification_method', 'PIN')}
              />
              <span className="ml-2 text-sm">PIN inline (owner input PIN 6 digit langsung)</span>
            </label>
            <p className="mt-1 text-xs text-slate-400 italic">WA_BUTTON tidak tersedia</p>
          </fieldset>

          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={settings.reason_required}
              onChange={(e) => update('reason_required', e.target.checked)}
            />
            <span className="text-sm">Wajib isi alasan (audit fraud)</span>
          </label>

          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={settings.requestor_bypass_self}
              onChange={(e) => update('requestor_bypass_self', e.target.checked)}
            />
            <span className="text-sm">Owner bypass approval untuk sale-nya sendiri</span>
          </label>

          <label className="block">
            <span className="text-xs font-medium text-slate-500">Approver role</span>
            <select
              value={settings.approver_role}
              onChange={(e) => update('approver_role', e.target.value)}
              className="mt-0.5 w-full rounded border border-slate-300 px-3 py-1.5 text-sm"
            >
              <option value="Owner">Owner</option>
              <option value="Admin">Admin</option>
            </select>
          </label>
        </div>
      )}

      <div className="flex justify-end gap-2 border-t border-slate-100 pt-2">
        <button
          type="button"
          disabled={saving}
          onClick={handleSave}
          className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {saving ? 'Menyimpan...' : 'Simpan pengaturan'}
        </button>
      </div>
    </div>
  );
}

export default ApprovalGateEditor;
