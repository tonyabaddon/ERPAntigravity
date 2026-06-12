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
  Bell,
  Settings,
  LogOut,
  Zap,
  UserCheck,
  Bot,
  TrendingUp,
  ClipboardList,
  BarChart2,
  ShoppingCart,
  Receipt,
  ClipboardCheck,
  PackageSearch,
  Clock,
  Warehouse
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

type MenuItem = {
  id: ActivePage;
  label: string;
  icon: React.ElementType;
  description: string;
  /** When an array is provided, the entry is visible if ANY listed key is truthy. */
  permKey: keyof PermissionSet | Array<keyof PermissionSet>;
};

export default function Sidebar({ activePage, onPageChange, currentUser, onLogout }: SidebarProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);

  // If user is not logged in / is on auth screen, we don't render standard sidebar
  if (activePage === 'auth' || !currentUser) return null;

  const menuItems: Array<MenuItem> = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, description: 'Ringkasan Toko', permKey: 'dashboard' },
    { id: 'sales-inbox', label: 'Sales Inbox', icon: Inbox, description: 'Percakapan WA', permKey: 'salesInbox' },
    { id: 'laporan', label: 'Laporan', icon: BarChart2, description: 'Analitik & Tren', permKey: 'laporan' },
    { id: 'ai-stock', label: 'AI Stock Manager', icon: Package, description: 'Stok & Harga', permKey: 'aiStock' },
    { id: 'manajemen-gudang', label: 'Manajemen Gudang', icon: Warehouse, description: 'Konfigurasi Lokasi', permKey: 'can_manage_warehouses' },
    { id: 'stok-opname', label: 'Stok Opname', icon: PackageSearch, description: 'Sesi Opname & Riwayat', permKey: 'can_start_opname' },
    {
      id: 'wip-list',
      label: 'WIP Rakit',
      icon: Clock,
      description: 'Transaksi rakit in progress',
      permKey: 'aiStock' as keyof PermissionSet,
    },
    { id: 'persetujuan', label: 'Persetujuan', icon: ClipboardCheck, description: 'Approval Inbox', permKey: ['can_approve_adjustment', 'can_approve_price_change', 'can_commit_opname'] },
    { id: 'kasir', label: 'Kasir', icon: Receipt, description: 'Rekonsiliasi Harian', permKey: 'kasir' },
    { id: 'penjualanBaru', label: 'Catat Penjualan', icon: ShoppingCart, description: 'Input Penjualan Baru', permKey: 'kasir' },
    { id: 'pembelian', label: 'Pembelian', icon: ShoppingCart, description: 'PO & Supplier', permKey: 'pembelian' },
    { id: 'rekonsiliasi', label: 'Rekonsiliasi', icon: Receipt, description: 'Tutup Buku Bulanan', permKey: 'reconciliation' as keyof PermissionSet },
    { id: 'pipeline', label: 'Pipeline', icon: TrendingUp, description: 'Leads & Prospek', permKey: 'pipeline' },
    { id: 'pelanggan', label: 'Pelanggan', icon: Users, description: 'Profil & Riwayat', permKey: 'pelanggan' },
    { id: 'order-history', label: 'Riwayat Pesanan', icon: ClipboardList, description: 'Semua Pesanan', permKey: 'orderHistory' },
    { id: 'user-management', label: 'User Management', icon: UserCheck, description: 'Akses Admin', permKey: 'userManagement' },
    { id: 'notifications', label: 'Notification Settings', icon: Bell, description: 'Detak Jantung WA', permKey: 'notifications' },
    { id: 'whatsapp-ai', label: 'WhatsApp AI', icon: Bot, description: 'whatsmeow & Gemini', permKey: 'whatsappAi' },
    { id: 'settings', label: 'Pengaturan', icon: Settings, description: 'Konfigurasi Sistem', permKey: 'settings' },
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

      {/* Navigation Links */}
      <nav className="flex-1 space-y-1.5 px-3">
        {visibleItems.map((item) => {
          const IconComponent = item.icon;
          const isActive = activePage === item.id;
          return (
            <button
              key={item.id}
              onClick={() => onPageChange(item.id)}
              className={`w-full flex items-center gap-4 py-3 px-4 rounded-full transition-all duration-200 cursor-pointer text-left group/item ${
                isActive 
                  ? 'bg-white/15 text-emerald-300 font-bold shadow-lg shadow-white/5' 
                  : 'text-white/70 hover:bg-white/10 hover:text-white'
              }`}
            >
              <div className="relative shrink-0">
                <IconComponent className={`w-5 h-5 transition-transform duration-200 group-hover/item:scale-110 ${isActive ? 'text-emerald-300' : ''}`} />
                {item.id === 'persetujuan' && pendingCount > 0 && !isExpanded && (
                  <span className="absolute -top-1.5 -right-1.5">
                    <PendingApprovalBadge count={pendingCount} size="sm" />
                  </span>
                )}
              </div>
              <div className={`flex flex-col flex-1 transition-opacity duration-300 ${isExpanded ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
                <span className="text-sm font-semibold whitespace-nowrap">{item.label}</span>
                <span className="text-[10px] text-white/40 font-medium whitespace-nowrap select-none">{item.description}</span>
              </div>
              {item.id === 'persetujuan' && pendingCount > 0 && isExpanded && (
                <span className={`transition-opacity duration-300 opacity-100`}>
                  <PendingApprovalBadge count={pendingCount} size="md" />
                </span>
              )}
            </button>
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
