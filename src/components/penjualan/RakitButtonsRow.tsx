// src/components/penjualan/RakitButtonsRow.tsx
//
// Wizard Step 2 jasa-type picker. Renders dynamically from serviceTypesService.fetchActive()
// so that toggling is_active in Pengaturan → Jenis Jasa immediately affects the wizard.
//
// Backwards-compat: each DbServiceType.code is mapped to the legacy RakitServiceType union
// so the existing cart state / RPC payload layer stays unchanged in Phase 1.
//
// Known limitation: tenant-added service_types whose code doesn't match the map are skipped
// with a console.warn. Full wiring (widen union → service_type_id in RakitJobLine) is Phase 2.
import React, { useEffect, useState } from 'react';
import type { RakitServiceType } from '../../types';
import type { DbServiceType } from '../../types';
import { serviceTypesService } from '../../lib/pengaturan/pengaturanServices';
import { captureError } from '../../lib/captureError';

// Map from seeded service_types.code → legacy RakitServiceType union value.
// Seeded codes: 'custom_panel', 'wiring_panel'.
const CODE_TO_RAKIT: Record<string, RakitServiceType> = {
  custom_panel: 'jasa_custom_panel',
  wiring_panel: 'jasa_rakit',
};

interface RakitButtonsRowProps {
  formOpen: boolean;
  formType: RakitServiceType | null;
  onOpen: (type: RakitServiceType) => void;
}

export default function RakitButtonsRow({ formOpen, formType, onOpen }: RakitButtonsRowProps) {
  const [serviceTypes, setServiceTypes] = useState<DbServiceType[]>([]);
  const disabled = formOpen;

  useEffect(() => {
    serviceTypesService.fetchActive()
      .then(setServiceTypes)
      .catch((err: unknown) => captureError(err, { feature: 'penjualan', action: 'fetch_service_types' }));
  }, []);

  // Filter to only service types whose code maps to a known RakitServiceType.
  const knownTypes = serviceTypes.filter((st) => {
    if (st.code in CODE_TO_RAKIT) return true;
    console.warn(`RakitButtonsRow: unknown service_type code "${st.code}" — skipped until Phase 2 wiring`);
    return false;
  });

  if (knownTypes.length === 0) {
    // Loading or all deactivated
    return (
      <div className="grid grid-cols-2 gap-2">
        <div className="h-9 rounded-sm bg-slate-100 animate-pulse" />
        <div className="h-9 rounded-sm bg-slate-100 animate-pulse" />
      </div>
    );
  }

  return (
    <div className={`grid gap-2`} style={{ gridTemplateColumns: `repeat(${knownTypes.length}, 1fr)` }}>
      {knownTypes.map((st) => {
        const rakitType = CODE_TO_RAKIT[st.code];
        const color = st.color_hex ?? 'var(--color-caleo-primary)';
        const isActive = disabled && formType === rakitType;
        return (
          <button
            key={st.id}
            type="button"
            onClick={() => onOpen(rakitType)}
            disabled={disabled}
            className={`px-3 py-2 text-xs font-semibold rounded-sm border transition disabled:opacity-50`}
            style={{
              backgroundColor: isActive
                ? `${color}22`
                : `${color}10`,
              color,
              borderColor: isActive ? color : `${color}44`,
              cursor: disabled ? 'not-allowed' : 'pointer',
            }}
          >
            + {st.name}
          </button>
        );
      })}
    </div>
  );
}
