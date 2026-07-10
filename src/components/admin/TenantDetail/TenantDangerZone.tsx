// src/components/admin/TenantDetail/TenantDangerZone.tsx
// Zona Bahaya (Danger Zone) section rendered at the bottom of TenantDetailShell
// when the current user is a super_admin.
// Contains the Delete Tenant action gated behind a confirm-slug modal.
// VOSI design tokens; Bahasa Indonesia copy.
import { useState } from 'react';
import type { AdminTenantRow } from '../../../lib/adminTypes';
import { DeleteTenantModal } from './DeleteTenantModal';

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  tenant:    AdminTenantRow;
  onDeleted: () => void;
}

// ─── TenantDangerZone ─────────────────────────────────────────────────────────

export function TenantDangerZone({ tenant, onDeleted }: Props) {
  const [modalOpen, setModalOpen] = useState(false);

  return (
    <section
      className="border rounded-xl p-5 mt-4"
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

      {/* Delete action row */}
      <div
        className="flex flex-wrap items-center justify-between gap-3 border rounded-lg px-4 py-3"
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
