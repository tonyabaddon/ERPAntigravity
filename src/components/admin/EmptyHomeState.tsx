// src/components/admin/EmptyHomeState.tsx
// Welcome hero shown when only 1 tenant exists (Garindo only).
// Prompts the admin to onboard a second tenant.
// Uses native <a href> — project has no react-router-dom (custom urlRoute.ts pattern).

interface Props {
  existingSlug: string;
}

export function EmptyHomeState({ existingSlug }: Props) {
  return (
    <div
      className="border rounded-xl p-8 text-center"
      style={{ background: '#ffffff', borderColor: '#ECEEF1' }}
      data-testid="empty-home-state"
    >
      {/* Icon */}
      <div
        className="w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-4 text-2xl"
        style={{ background: '#FAF7F0', border: '2px solid #F9B233' }}
        aria-hidden="true"
      >
        🏢
      </div>

      <h3
        className="text-[15px] font-bold mb-2"
        style={{ color: '#0B2545', fontFamily: 'Plus Jakarta Sans, system-ui, sans-serif' }}
      >
        Ayo onboard tenant kedua.
      </h3>

      <p className="text-[13px] mb-5 max-w-sm mx-auto" style={{ color: '#5A6472' }}>
        Kamu sudah punya{' '}
        <strong style={{ color: '#0B2545' }}>{existingSlug}</strong>. Untuk tenant kedua, klik
        tombol di bawah — wizard akan pandu step-by-step.
      </p>

      <a
        href="/admin/tenants/new"
        className="inline-block rounded-xl px-6 py-2.5 font-semibold text-[14px] transition-opacity hover:opacity-90"
        style={{ background: '#F9B233', color: '#0B2545' }}
      >
        + Onboard tenant baru
      </a>

      <div className="mt-3 text-[12px]" style={{ color: '#9DB2CE' }}>
        Sudah punya?{' '}
        <a
          href="/admin/tenants"
          className="underline font-medium"
          style={{ color: '#5A6472' }}
        >
          Lihat daftar tenant →
        </a>
      </div>
    </div>
  );
}
