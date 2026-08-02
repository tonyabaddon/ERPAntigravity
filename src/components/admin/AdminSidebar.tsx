// src/components/admin/AdminSidebar.tsx
import React, { useEffect, useState } from 'react';
import {
  Home,
  Building2,
  ScrollText,
  Package,
  Settings,
  HelpCircle,
  Coins,
  UsersRound,
  Banknote,
  ClipboardCheck,
  DollarSign,
  Bot,
} from 'lucide-react';
import { isSuperAdmin } from '../../lib/adminAuth';
import { paymentVerificationApi } from '../../lib/paymentVerificationApi';
import { handleAdminSPAClick } from '../../lib/urlRoute';

interface NavItem {
  to: string;
  label: string;
  icon: React.ReactNode;
  exact?: boolean;
  badge?: number;
  /** When true, this item is hidden for sales_rep (requires super_admin role). */
  superAdminOnly?: boolean;
  /** When set, the badge count is sourced dynamically rather than from item.badge. */
  badgeSource?: 'pendingPayments';
}

const NAV_ITEMS: NavItem[] = [
  {
    to: '/admin',
    label: 'Beranda',
    icon: <Home size={16} strokeWidth={1.8} strokeLinecap="round" />,
    exact: true,
  },
  {
    to: '/admin/tenants',
    label: 'Tenant',
    icon: <Building2 size={16} strokeWidth={1.8} strokeLinecap="round" />,
  },
  {
    to: '/admin/audit',
    label: 'Log aktivitas',
    icon: <ScrollText size={16} strokeWidth={1.8} strokeLinecap="round" />,
  },
  {
    to: '/admin/plans',
    label: 'Paket',
    icon: <Package size={16} strokeWidth={1.8} strokeLinecap="round" />,
  },
  {
    to: '/admin/revenue',
    label: 'Pendapatan',
    icon: <Coins size={16} strokeWidth={1.8} strokeLinecap="round" />,
    superAdminOnly: true,
  },
  {
    to: '/admin/sales-reps',
    label: 'Sales Reps',
    icon: <UsersRound size={16} strokeWidth={1.8} strokeLinecap="round" />,
    superAdminOnly: true,
  },
  {
    to: '/admin/payments/pending',
    label: 'Verifikasi Pembayaran',
    icon: <ClipboardCheck size={16} strokeWidth={1.8} strokeLinecap="round" />,
    superAdminOnly: true,
    badgeSource: 'pendingPayments',
  },
  {
    to: '/admin/settings/payment',
    label: 'Pengaturan Pembayaran',
    icon: <Banknote size={16} strokeWidth={1.8} strokeLinecap="round" />,
    superAdminOnly: true,
  },
  {
    to: '/admin/billing',
    label: 'Biaya Tenant',
    icon: <DollarSign size={16} strokeWidth={1.8} strokeLinecap="round" />,
    superAdminOnly: true,
  },
  {
    to: '/admin/caleo-bot',
    label: 'Caleo Bot',
    icon: <Bot size={16} strokeWidth={1.8} strokeLinecap="round" />,
    superAdminOnly: true,
  },
  {
    to: '/admin/settings',
    label: 'Pengaturan',
    icon: <Settings size={16} strokeWidth={1.8} strokeLinecap="round" />,
  },
  {
    to: '/admin/help',
    label: 'Bantuan',
    icon: <HelpCircle size={16} strokeWidth={1.8} strokeLinecap="round" />,
  },
];

interface AdminSidebarProps {
  /** Current pathname, defaults to window.location.pathname for easy testability. */
  activePath?: string;
}

function isActive(item: NavItem, activePath: string): boolean {
  if (item.exact) {
    return activePath === item.to;
  }
  return activePath.startsWith(item.to);
}

export function AdminSidebar({ activePath }: AdminSidebarProps) {
  const currentPath =
    activePath ?? (typeof window !== 'undefined' ? window.location.pathname : '/admin');

  // null = unknown (check pending); true = super_admin; false = not super_admin.
  // We show all items while the check is pending (null), then filter once resolved.
  // A sales_rep may briefly see restricted items before they hide — this is acceptable
  // because backend RLS + P0403 gates prevent actual access.
  const [superAdmin, setSuperAdmin] = useState<boolean | null>(null);
  const [pendingCount, setPendingCount] = useState<number>(0);

  useEffect(() => {
    let cancelled = false;
    isSuperAdmin().then((ok) => {
      if (!cancelled) setSuperAdmin(ok);
    }).catch(() => {
      if (!cancelled) setSuperAdmin(false);
    });
    return () => { cancelled = true; };
  }, []);

  // Poll pending payment count every 60s — only for super_admin.
  useEffect(() => {
    if (superAdmin !== true) return;
    let cancelled = false;

    async function loadCount() {
      try {
        const pending = await paymentVerificationApi.listPending();
        if (!cancelled) setPendingCount(pending.length);
      } catch {
        // Non-fatal: badge stays at current count
      }
    }

    loadCount();
    const t = setInterval(loadCount, 60_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [superAdmin]);

  // Hide superAdminOnly items until we've CONFIRMED super_admin. Previous
  // logic showed them during the null (checking) window, letting sales_reps
  // briefly see restricted nav links.
  const visibleNavItems = NAV_ITEMS.filter(
    (item) => !item.superAdminOnly || superAdmin === true
  );

  return (
    <aside
      className="w-52 shrink-0 flex flex-col font-caleo"
      style={{ background: '#ffffff', borderRight: '1px solid #ECEEF1' }}
    >
      {/* Brand mark */}
      <div
        className="flex items-center gap-2 px-4 py-4 border-b"
        style={{ borderColor: '#ECEEF1' }}
      >
        <div
          className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold"
          style={{ background: '#F9B233', color: '#0B2545' }}
          aria-label="Caleo logo"
        >
          V
        </div>
        <span
          className="text-sm font-bold tracking-tight"
          style={{ color: '#0B2545' }}
        >
          Caleo Admin
        </span>
      </div>

      {/* Nav */}
      <nav className="flex-1 py-3 px-2 flex flex-col gap-0.5" aria-label="Admin navigasi">
        <div
          className="px-2 mb-1 text-[11px] font-bold uppercase tracking-widest"
          style={{ color: '#9DB2CE', fontFamily: 'JetBrains Mono, monospace' }}
        >
          Menu
        </div>
        {visibleNavItems.map((item) => {
          const active = isActive(item, currentPath);
          const badgeCount =
            item.badgeSource === 'pendingPayments' ? pendingCount : item.badge;
          return (
            <a
              key={item.to}
              href={item.to}
              onClick={(e) => handleAdminSPAClick(e, item.to)}
              aria-current={active ? 'page' : undefined}
              className="flex items-center gap-2.5 px-3 py-2 rounded text-[13px] font-medium transition-colors"
              style={{
                background: active ? '#0B2545' : 'transparent',
                color: active ? '#ffffff' : '#0B2545',
              }}
              onMouseEnter={(e) => {
                if (!active) {
                  (e.currentTarget as HTMLAnchorElement).style.background = '#FAF7F0';
                }
              }}
              onMouseLeave={(e) => {
                if (!active) {
                  (e.currentTarget as HTMLAnchorElement).style.background = 'transparent';
                }
              }}
            >
              <span
                style={{ color: active ? '#F9B233' : '#0B2545' }}
                aria-hidden="true"
              >
                {item.icon}
              </span>
              <span>{item.label}</span>
              {badgeCount !== undefined && badgeCount > 0 && (
                <span
                  className="ml-auto text-[11px] font-bold px-1.5 py-0.5 rounded-full"
                  style={{
                    background: item.badgeSource === 'pendingPayments' ? '#DC2626' : '#F9B233',
                    color: item.badgeSource === 'pendingPayments' ? '#ffffff' : '#0B2545',
                  }}
                  data-testid={`badge-${item.to.replace(/\//g, '-')}`}
                >
                  {badgeCount}
                </span>
              )}
            </a>
          );
        })}
      </nav>
    </aside>
  );
}
