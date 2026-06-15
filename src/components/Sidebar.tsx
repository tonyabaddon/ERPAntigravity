/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import {
  LayoutDashboard,
  Inbox,
  Package,
  Users,
  Settings,
  LogOut,
  Zap,
  UserCheck,
  TrendingUp,
  BarChart2,
  ShoppingCart,
  ShoppingBag,
  Receipt,
  ClipboardCheck,
  PackageSearch,
  BookCheck,
  Warehouse,
} from 'lucide-react';
import { ActivePage, PermissionSet } from '../types';
import { listPendingApprovals, subscribeApprovalRequests } from '../lib/supabaseClient';
import PendingApprovalBadge from './approval/PendingApprovalBadge';

interface SidebarProps {
  activePage: ActivePage;
  onPageChange: (page: ActivePage) => void;
  currentUser: { name: string; role: string; permissions: PermissionSet; avatarUrl: string } | null;
  onLogout: () => void;
}

type Category = 'operasional' | 'inventory' | 'kontrol' | 'sistem';

const CATEGORY_LABELS: Record<Category, string> = {
  operasional: 'Operasional',
  inventory: 'Inventory',
  kontrol: 'Kontrol & Laporan',
  sistem: 'Sistem',
};

const CATEGORY_ORDER: Category[] = ['operasional', 'inventory', 'kontrol', 'sistem'];

type MenuItem = {
  id: ActivePage;
  label: string;
  icon: React.ElementType;
  category: Category;
  /** When an array is provided, the entry is visible if ANY listed key is truthy. */
  permKey: keyof PermissionSet | Array<keyof PermissionSet>;
};

export default function Sidebar({ activePage, onPageChange, currentUser, onLogout }: SidebarProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);

  // If user is not logged in / is on auth screen, we don't render standard sidebar
  if (activePage === 'auth' || !currentUser) return null;

  const menuItems: Array<MenuItem> = [
    // Operasional
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, category: 'operasional', permKey: 'dashboard' },
    { id: 'sales-inbox', label: 'Sales Inbox', icon: Inbox, category: 'operasional', permKey: 'salesInbox' },
    { id: 'penjualan', label: 'Penjualan', icon: ShoppingCart, category: 'operasional', permKey: 'kasir' },
    { id: 'kasir', label: 'Kasir', icon: Receipt, category: 'operasional', permKey: 'kasir' },
    { id: 'pelanggan', label: 'Pelanggan', icon: Users, category: 'operasional', permKey: 'pelanggan' },
    { id: 'pipeline', label: 'Pipeline', icon: TrendingUp, category: 'operasional', permKey: 'pipeline' },
    // Inventory
    { id: 'ai-stock', label: 'Produk & Stok', icon: Package, category: 'inventory', permKey: 'aiStock' },
    { id: 'stok-opname', label: 'Stok Opname', icon: PackageSearch, category: 'inventory', permKey: 'can_start_opname' },
    { id: 'pembelian', label: 'Pembelian', icon: ShoppingBag, category: 'inventory', permKey: 'pembelian' },
    { id: 'manajemen-gudang', label: 'Manajemen Gudang', icon: Warehouse, category: 'inventory', permKey: 'can_manage_warehouses' },
    // Kontrol & Laporan
    { id: 'persetujuan', label: 'Persetujuan', icon: ClipboardCheck, category: 'kontrol', permKey: ['can_approve_adjustment', 'can_approve_price_change', 'can_commit_opname'] },
    { id: 'rekonsiliasi', label: 'Rekonsiliasi & Tutup Buku', icon: BookCheck, category: 'kontrol', permKey: 'reconciliation' as keyof PermissionSet },
    { id: 'laporan', label: 'Laporan', icon: BarChart2, category: 'kontrol', permKey: 'laporan' },
    // Sistem
    { id: 'user-management', label: 'User Management', icon: UserCheck, category: 'sistem', permKey: 'userManagement' },
    { id: 'settings', label: 'Pengaturan', icon: Settings, category: 'sistem', permKey: 'settings' },
  ];

  const perms = currentUser?.permissions;
  // Some perm keys are defaulted-on (legacy boolean keys treat "missing" as visible),
  // while Phase 2 action keys (can_*) are opt-in and only visible when truthy.
  const isPermVisible = (key: keyof PermissionSet): boolean => {
    if (!perms) return true;
    const value = perms[key];
    if (typeof key === 'string' && key.startsWith('can_')) {
      return value === true;
    }
    return value !== false;
  };

  const visibleItems = menuItems.filter(item => {
    if (Array.isArray(item.permKey)) {
      return item.permKey.some(isPermVisible);
    }
    return isPermVisible(item.permKey);
  });

  // Subscribe to pending approvals so the Persetujuan badge stays fresh.
  // Only run when the current user can actually approve something.
  const canApproveAny = !!(
    perms?.can_approve_adjustment ||
    perms?.can_approve_price_change ||
    perms?.can_commit_opname
  );
  useEffect(() => {
    if (!canApproveAny) {
      setPendingCount(0);
      return;
    }
    let cancelled = false;
    const refresh = () => {
      void listPendingApprovals()
        .then(rows => {
          if (!cancelled) setPendingCount(rows.length);
        })
        .catch(() => { /* silent — badge is best-effort */ });
    };
    refresh();
    const unsub = subscribeApprovalRequests(() => refresh());
    return () => {
      cancelled = true;
      unsub();
    };
  }, [canApproveAny]);

  useEffect(() => {
    if (currentUser?.permissions) {
      const isVisible = visibleItems.some(item => item.id === activePage);
      if (!isVisible) {
        onPageChange('dashboard');
      }
    }
  }, [currentUser?.permissions]);

  return (
    <aside 
      id="sidebar"
      className={`fixed left-4 top-4 bottom-4 z-50 bg-[#012749] shadow-2xl rounded-3xl flex flex-col py-8 overflow-hidden transition-all duration-300 ease-in-out group ${
        isExpanded ? 'w-64' : 'w-20'
      }`}
      onMouseEnter={() => setIsExpanded(true)}
      onMouseLeave={() => setIsExpanded(false)}
      style={{ boxShadow: '0 20px 50px rgba(1, 39, 73, 0.25)' }}
    >
      {/* Brand Header */}
      <div className="px-5 mb-10 flex items-center gap-4 overflow-hidden whitespace-nowrap">
        <div className="w-10 h-10 bg-[#2d8a4e] text-white rounded-xl flex items-center justify-center shrink-0 shadow-lg shadow-[#2d8a4e]/20 hover:rotate-12 transition-transform duration-300">
          <Zap className="w-5 h-5 fill-white text-[#2d8a4e]" />
        </div>
        <div className={`transition-opacity duration-300 ${isExpanded ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
          <h1 className="text-lg font-extrabold text-white tracking-tight leading-none">Garindo Jaya Panel</h1>
          <p className="text-[10px] text-emerald-400 font-bold uppercase tracking-widest mt-1">MSME ERP Suite</p>
        </div>
      </div>

      {/* Navigation Links — grouped by category */}
      <nav className="flex-1 px-3 overflow-y-auto">
        {CATEGORY_ORDER.map((cat, catIdx) => {
          const itemsInCategory = visibleItems.filter(item => item.category === cat);
          if (itemsInCategory.length === 0) return null;
          const isFirst = catIdx === 0 || !CATEGORY_ORDER.slice(0, catIdx).some(c => visibleItems.some(v => v.category === c));
          return (
            <div key={cat} className="space-y-0.5">
              {isExpanded ? (
                <div className={`px-4 ${isFirst ? 'pt-1' : 'pt-3'} pb-1.5`}>
                  <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-emerald-400/70 whitespace-nowrap">
                    {CATEGORY_LABELS[cat]}
                  </p>
                </div>
              ) : (
                !isFirst && (
                  <div className="py-1.5 px-3">
                    <div className="h-px bg-white/10"></div>
                  </div>
                )
              )}

              {itemsInCategory.map(item => {
                const IconComponent = item.icon;
                const isActive = activePage === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => onPageChange(item.id)}
                    className={`w-full flex items-center gap-3 py-2.5 px-4 rounded-full text-left transition-all duration-200 cursor-pointer group/item ${
                      isActive
                        ? 'bg-white/15 text-emerald-300 font-bold shadow-lg shadow-white/5'
                        : 'text-white/70 hover:bg-white/10 hover:text-white'
                    }`}
                    title={!isExpanded ? item.label : undefined}
                  >
                    <div className="relative shrink-0">
                      <IconComponent className={`w-5 h-5 transition-transform duration-200 group-hover/item:scale-110 ${isActive ? 'text-emerald-300' : ''}`} />
                      {item.id === 'persetujuan' && pendingCount > 0 && !isExpanded && (
                        <span className="absolute -top-1.5 -right-1.5">
                          <PendingApprovalBadge count={pendingCount} size="sm" />
                        </span>
                      )}
                    </div>
                    <span className={`text-sm font-semibold flex-1 whitespace-nowrap transition-opacity duration-300 ${isExpanded ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
                      {item.label}
                    </span>
                    {item.id === 'persetujuan' && pendingCount > 0 && isExpanded && (
                      <span className="transition-opacity duration-300 opacity-100 shrink-0">
                        <PendingApprovalBadge count={pendingCount} size="md" />
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          );
        })}
      </nav>

      {/* Footer Profile */}
      <div className="mt-auto px-3 pt-6 border-t border-white/10 space-y-3">
        <div className="flex items-center gap-3 p-2 bg-white/5 rounded-2xl overflow-hidden whitespace-nowrap">
          <img 
            alt="User Avatar" 
            className="w-10 h-10 rounded-xl object-cover shrink-0 ring-2 ring-emerald-500/30" 
            src={currentUser.avatarUrl}
            referrerPolicy="no-referrer"
          />
          <div className={`flex flex-col transition-opacity duration-300 overflow-hidden ${isExpanded ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
            <p className="text-xs font-bold text-white truncate">{currentUser.name}</p>
            <p className="text-[10px] text-white/50 truncate font-semibold">{currentUser.role}</p>
          </div>
        </div>

        <button 
          onClick={onLogout}
          className="w-full flex items-center gap-4 py-3 px-4 rounded-full text-red-300 hover:bg-red-500/10 hover:text-red-200 transition-all cursor-pointer text-left font-semibold text-sm"
        >
          <LogOut className="w-5 h-5 shrink-0" />
          <span className={`transition-opacity duration-300 ${isExpanded ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
            Keluar Sistem
          </span>
        </button>
      </div>
    </aside>
  );
}
