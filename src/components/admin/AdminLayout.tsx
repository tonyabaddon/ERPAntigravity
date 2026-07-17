// src/components/admin/AdminLayout.tsx
import React, { useEffect, useState } from 'react';
import { ShieldCheck, LogOut } from 'lucide-react';
import { supabase, tenantContextService } from '../../lib/supabaseClient';
import { adminToast } from '../../lib/adminToast';
import { decodeJwt } from '../../lib/jwt';
import { AdminSidebar } from './AdminSidebar';

interface ImpersonationState {
  active: boolean;
  slug: string | null;
}

interface AdminLayoutProps {
  children: React.ReactNode;
  /** Override active path for testing; defaults to window.location.pathname. */
  activePath?: string;
}

export function AdminLayout({ children, activePath }: AdminLayoutProps) {
  const [adminEmail, setAdminEmail] = useState<string | null>(null);
  const [impersonation, setImpersonation] = useState<ImpersonationState>({
    active: false,
    slug: null,
  });
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!supabase) return;

    supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;

      const session = data.session;
      if (!session) return;

      // Fetch admin email
      setAdminEmail(session.user.email ?? null);

      // Decode JWT to read impersonation claims
      const claims = decodeJwt(session.access_token);
      if (claims?.impersonating) {
        setImpersonation({
          active: true,
          slug: typeof claims.impersonating_slug === 'string' ? claims.impersonating_slug : null,
        });
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  async function handleLogout() {
    if (!supabase) return;
    await supabase.auth.signOut();
    window.location.href = '/login';
  }

  async function handleExitImpersonation() {
    if (submitting) return;
    setSubmitting(true);
    try {
      await tenantContextService.stopImpersonation();
      adminToast.success('Keluar dari impersonation');
      setImpersonation({ active: false, slug: null });
      window.location.href = '/admin';
    } catch (err) {
      adminToast.error('Gagal keluar impersonation', err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen flex flex-col font-vosi" style={{ background: '#FAF7F0' }}>
      {/* Top header — navy bg, white text */}
      <header
        className="flex justify-between items-center px-5 py-3 shrink-0"
        style={{ background: '#0B2545', color: '#ffffff' }}
      >
        <div className="flex items-center gap-2 text-[13px] font-semibold">
          <ShieldCheck size={16} strokeWidth={1.8} strokeLinecap="round" style={{ color: '#F9B233' }} />
          <span>Caleo Admin</span>
        </div>
        <div className="flex items-center gap-4 text-[12px]" style={{ color: '#9DB2CE' }}>
          {adminEmail && <span className="truncate max-w-[200px]">{adminEmail}</span>}
          <button
            onClick={handleLogout}
            className="flex items-center gap-1 hover:text-white transition-colors"
            title="Keluar"
          >
            <LogOut size={14} strokeWidth={1.8} strokeLinecap="round" />
            <span>Keluar</span>
          </button>
        </div>
      </header>

      {/* Impersonation banner — shown only when active */}
      {impersonation.active && (
        <div
          className="px-5 py-2 text-[12px] text-center flex items-center justify-center gap-2"
          style={{ background: '#F9B233', color: '#0B2545' }}
          data-testid="impersonation-banner"
        >
          <span>Menyamar sebagai:</span>
          <strong>{impersonation.slug}</strong>
          <span>—</span>
          <button
            onClick={handleExitImpersonation}
            disabled={submitting}
            className="underline font-semibold disabled:opacity-50"
          >
            Keluar ▸
          </button>
        </div>
      )}

      {/* Body: sidebar + main content */}
      <div className="flex flex-1 min-h-0">
        <AdminSidebar activePath={activePath} />
        <main className="flex-1 p-5 overflow-auto" style={{ background: '#ffffff' }}>
          {children}
        </main>
      </div>
    </div>
  );
}
