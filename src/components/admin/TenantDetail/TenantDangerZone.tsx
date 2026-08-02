// src/components/admin/TenantDetail/TenantDangerZone.tsx
// Zona Bahaya (Danger Zone) section rendered at the bottom of TenantDetailShell
// when the current user is a super_admin.
// Contains: (1) Download All Data (export for UU PDP hak subjek data /
// backup before deletion) — P2-#6, (2) Delete Tenant action gated behind
// confirm-slug modal.
// VOSI design tokens; Bahasa Indonesia copy.
import { useState } from 'react';
import type { AdminTenantRow } from '../../../lib/adminTypes';
import { DeleteTenantModal } from './DeleteTenantModal';
import { supabase } from '../../../lib/supabaseClient';
import { adminToast } from '../../../lib/adminToast';
import { extractErrorMessage } from '../../../lib/extractErrorMessage';

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  tenant:    AdminTenantRow;
  onDeleted: () => void;
}

// ─── TenantDangerZone ─────────────────────────────────────────────────────────

export function TenantDangerZone({ tenant, onDeleted }: Props) {
  const [modalOpen, setModalOpen] = useState(false);
  const [exporting, setExporting] = useState(false);

  async function handleExport() {
    if (exporting) return;
    setExporting(true);
    try {
      const { data, error } = await supabase.rpc('export_tenant_data', {
        p_tenant_id: tenant.tenant_id,
      });
      if (error) {
        adminToast.error(`Export gagal: ${error.message}`);
        return;
      }
      // Trigger client-side download of JSON blob
      const blob = new Blob([JSON.stringify(data, null, 2)], {
        type: 'application/json',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const ts = new Date().toISOString().split('T')[0];
      a.href = url;
      a.download = `caleo-export-${tenant.slug || tenant.tenant_id}-${ts}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      adminToast.success(`Export selesai: ${(blob.size / 1024).toFixed(1)} KB`);
    } catch (err) {
      const msg = extractErrorMessage(err);
      adminToast.error(`Export error: ${msg}`);
    } finally {
      setExporting(false);
    }
  }

  return (
    <section
      className="border rounded p-5 mt-4"
      style={{ borderColor: '#fca5a5', background: '#fff7f7' }}
      data-testid="tenant-danger-zone"
      aria-label="Zona Bahaya"
    >
      {/* Section heading */}
      <h2
        className="text-[14px] font-bold mb-1"
        style={{ color: '#991b1b' }}
      >
        Zona Bahaya
      </h2>
      <p
        className="text-[12px] mb-4"
        style={{ color: '#7f1d1d' }}
      >
        Aksi di bawah ini bersifat permanen dan tidak dapat dibatalkan.
      </p>

      {/* Export action row (non-destructive but grouped here as "before you delete, take backup") */}
      <div
        className="flex flex-wrap items-center justify-between gap-3 border rounded px-4 py-3 mb-3"
        style={{ borderColor: '#fbbf24', background: '#ffffff' }}
      >
        <div>
          <p
            className="text-[13px] font-semibold"
            style={{ color: '#0B2545' }}
          >
            Download semua data tenant
          </p>
          <p
            className="text-[12px] mt-0.5"
            style={{ color: '#5A6472' }}
          >
            Export lengkap semua data tenant sebagai JSON. Wajib sebelum menghapus tenant, atau untuk memenuhi UU PDP hak subjek data.
          </p>
        </div>
        <button
          type="button"
          onClick={handleExport}
          disabled={exporting}
          className="font-bold rounded-full px-4 py-2 text-[13px] hover:opacity-90 transition-opacity flex-shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
          style={{ background: '#0B2545', color: '#ffffff' }}
          data-testid="export-tenant-data-btn"
        >
          {exporting ? 'Menyiapkan…' : 'Download JSON'}
        </button>
      </div>

      {/* Delete action row */}
      <div
        className="flex flex-wrap items-center justify-between gap-3 border rounded px-4 py-3"
        style={{ borderColor: '#fca5a5', background: '#ffffff' }}
      >
        <div>
          <p
            className="text-[13px] font-semibold"
            style={{ color: '#0B2545' }}
          >
            Hapus tenant ini
          </p>
          <p
            className="text-[12px] mt-0.5"
            style={{ color: '#5A6472' }}
          >
            Ini akan hapus semua data tenant permanen. Auth users tidak ikut terhapus.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setModalOpen(true)}
          className="text-white font-bold rounded-full px-4 py-2 text-[13px] hover:opacity-90 transition-opacity flex-shrink-0"
          style={{ background: '#DC2626' }}
          data-testid="open-delete-tenant-modal-btn"
        >
          Hapus Tenant
        </button>
      </div>

      <DeleteTenantModal
        open={modalOpen}
        tenant={tenant}
        onClose={() => setModalOpen(false)}
        onDeleted={onDeleted}
      />
    </section>
  );
}
