// src/components/admin/AdminSidebar.tsx
import React from 'react';
import {
  Home,
  Building2,
  ScrollText,
  Package,
  Settings,
  HelpCircle,
} from 'lucide-react';

interface NavItem {
  to: string;
  label: string;
  icon: React.ReactNode;
  exact?: boolean;
  badge?: number;
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

  return (
    <aside
      className="w-52 shrink-0 flex flex-col font-vosi"
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
          aria-label="VOSI logo"
        >
          V
        </div>
        <span
          className="text-sm font-bold tracking-tight"
          style={{ color: '#0B2545' }}
        >
          VOSI Admin
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
        {NAV_ITEMS.map((item) => {
          const active = isActive(item, currentPath);
          return (
            <a
              key={item.to}
              href={item.to}
              aria-current={active ? 'page' : undefined}
              className="flex items-center gap-2.5 px-3 py-2 rounded-xl text-[13px] font-medium transition-colors"
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
              {item.badge !== undefined && item.badge > 0 && (
                <span
                  className="ml-auto text-[11px] font-bold px-1.5 py-0.5 rounded-full"
                  style={{ background: '#F9B233', color: '#0B2545' }}
                >
                  {item.badge}
                </span>
              )}
            </a>
          );
        })}
      </nav>
    </aside>
  );
}
