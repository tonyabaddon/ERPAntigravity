/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
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
  ClipboardList
} from 'lucide-react';
import { ActivePage } from '../types';

interface SidebarProps {
  activePage: ActivePage;
  onPageChange: (page: ActivePage) => void;
  currentUser: { name: string; role: string; avatarUrl: string } | null;
  onLogout: () => void;
}

export default function Sidebar({ activePage, onPageChange, currentUser, onLogout }: SidebarProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  // If user is not logged in / is on auth screen, we don't render standard sidebar
  if (activePage === 'auth' || !currentUser) return null;

  const menuItems = [
    { 
      id: 'dashboard' as ActivePage, 
      label: 'Dashboard', 
      icon: LayoutDashboard,
      description: 'Ringkasan Toko' 
    },
    { 
      id: 'sales-inbox' as ActivePage, 
      label: 'Sales Inbox', 
      icon: Inbox,
      description: 'Percakapan WA' 
    },
    { 
      id: 'ai-stock' as ActivePage, 
      label: 'AI Stock Manager', 
      icon: Package,
      description: 'Stok & Harga' 
    },
    { 
      id: 'user-management' as ActivePage, 
      label: 'User Management', 
      icon: Users,
      description: 'Akses Admin' 
    },
    { 
      id: 'notifications' as ActivePage, 
      label: 'Notification Settings', 
      icon: Bell,
      description: 'Detak Jantung WA' 
    },
    {
      id: 'whatsapp-ai' as ActivePage,
      label: 'WhatsApp AI',
      icon: Bot,
      description: 'whatsmeow & Gemini'
    },
    {
      id: 'settings' as ActivePage,
      label: 'Pengaturan',
      icon: Settings,
      description: 'Konfigurasi Sistem',
    },
    {
      id: 'pipeline' as ActivePage,
      label: 'Pipeline',
      icon: TrendingUp,
      description: 'Leads & Prospek',
    },
    {
      id: 'pelanggan' as ActivePage,
      label: 'Pelanggan',
      icon: Users,
      description: 'Profil & Riwayat',
    },
    {
      id: 'order-history' as ActivePage,
      label: 'Riwayat Pesanan',
      icon: ClipboardList,
      description: 'Semua Pesanan',
    },
  ];

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
          <h1 className="text-lg font-extrabold text-white tracking-tight leading-none">Sinar Elektrik</h1>
          <p className="text-[10px] text-emerald-400 font-bold uppercase tracking-widest mt-1">MSME ERP Suite</p>
        </div>
      </div>

      {/* Navigation Links */}
      <nav className="flex-1 space-y-1.5 px-3">
        {menuItems.map((item) => {
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
              <IconComponent className={`w-5 h-5 shrink-0 transition-transform duration-200 group-hover/item:scale-110 ${isActive ? 'text-emerald-300' : ''}`} />
              <div className={`flex flex-col transition-opacity duration-300 ${isExpanded ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
                <span className="text-sm font-semibold whitespace-nowrap">{item.label}</span>
                <span className="text-[10px] text-white/40 font-medium whitespace-nowrap select-none">{item.description}</span>
              </div>
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
