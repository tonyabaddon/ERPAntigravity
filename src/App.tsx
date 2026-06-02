/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { 
  Bot, 
  Search, 
  HelpCircle, 
  UserCircle2, 
  ShieldCheck, 
  LogOut,
  Bell,
  Menu,
  Zap,
  Info,
  AlertTriangle
} from 'lucide-react';

import { ActivePage, StockItem, AdminUser, NotificationConfig } from './types';
import Sidebar from './components/Sidebar';
import AuthScreen from './components/AuthScreen';
import DashboardScreen from './components/DashboardScreen';
import SalesInboxScreen from './components/SalesInboxScreen';
import StockManagerScreen from './components/StockManagerScreen';
import UserManagementScreen from './components/UserManagementScreen';
import NotificationSettingsScreen from './components/NotificationSettingsScreen';
import WhatsappAiScreen from './components/WhatsappAiScreen';

import {
  INITIAL_STOCK,
  INITIAL_ADMINS,
  INITIAL_CONFIG
} from './initialData';

import { isSupabaseConfigured, supabaseService } from './lib/supabaseClient';


export default function App() {
  // Gating system: start at 'auth' or direct bypass for immediate interaction 
  const [activePage, setActivePage] = useState<ActivePage>('auth');
  const [currentUser, setCurrentUser] = useState<{ name: string; role: string; avatarUrl: string; storeName: string } | null>(null);

  // General state databases loaded from templates or LocalStorage
  const [stockList, setStockList] = useState<StockItem[]>(() => {
    const saved = localStorage.getItem('sinar_elektrik_stocks');
    return saved ? JSON.parse(saved) : INITIAL_STOCK;
  });

  const [admins, setAdmins] = useState<AdminUser[]>(() => {
    const saved = localStorage.getItem('sinar_elektrik_admins');
    return saved ? JSON.parse(saved) : INITIAL_ADMINS;
  });

  const [config, setConfig] = useState<NotificationConfig>(() => {
    const saved = localStorage.getItem('sinar_elektrik_config');
    return saved ? JSON.parse(saved) : INITIAL_CONFIG;
  });

  // Global Floating Alert state
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [toastType, setToastType] = useState<'success' | 'info' | 'warning'>('success');
  const [showHistoryModal, setShowHistoryModal] = useState(false);

  // Sync state modifications to localStorage
  useEffect(() => {
    localStorage.setItem('sinar_elektrik_stocks', JSON.stringify(stockList));
  }, [stockList]);

  useEffect(() => {
    localStorage.setItem('sinar_elektrik_admins', JSON.stringify(admins));
  }, [admins]);

  useEffect(() => {
    localStorage.setItem('sinar_elektrik_config', JSON.stringify(config));
  }, [config]);

  // Load stocks on mount if Supabase is active
  useEffect(() => {
    if (isSupabaseConfigured) {
      supabaseService.fetchStocks().then(data => {
        if (data && data.length > 0) {
          const mapped: StockItem[] = data.map(item => ({
            sku: item.sku,
            name: item.name,
            category: item.category,
            price: Number(item.price),
            stock: Number(item.stock),
            status: (item.status === 'Stok Tipis' ? 'Stok Tipis' : 'Sinkron') as 'Sinkron' | 'Stok Tipis'
          }));
          setStockList(mapped);
          triggerToast('🌐 Database Supabase Sinkron! Ketersediaan stok live dimuat.', 'success');
        } else {
          // If Supabase table is empty, seed it with INITIAL_STOCK
          INITIAL_STOCK.forEach(async (item) => {
            try {
              await supabaseService.upsertStock(item);
            } catch (e) {
              console.error(e);
            }
          });
          triggerToast('⚡ Supabase terdeteksi kosong. Melakukan seeding data inisial.', 'info');
        }
      }).catch(err => {
        console.error('Failed to load from Supabase:', err);
        triggerToast('⚠️ Cloud Supabase offline. Menggunakan data local cache.', 'warning');
      });
    }
  }, []);

  const handleStockUpdate = async (updatedStocks: StockItem[]) => {
    // Save to local state and localStorage
    setStockList(updatedStocks);

    if (isSupabaseConfigured) {
      try {
        // Find which items were deleted (exists in stockList but not in updatedStocks)
        const deletedItems = stockList.filter(oldItem => !updatedStocks.some(newItem => newItem.sku === oldItem.sku));
        for (const deleted of deletedItems) {
          await supabaseService.deleteStock(deleted.sku);
        }

        // Find which items were modified or added (exists in updatedStocks but either have different values or didn't exist in stockList)
        const itemsToUpsert = updatedStocks.filter(newItem => {
          const oldItem = stockList.find(o => o.sku === newItem.sku);
          if (!oldItem) return true; // Added
          return oldItem.name !== newItem.name || 
                 oldItem.category !== newItem.category || 
                 oldItem.price !== newItem.price || 
                 oldItem.stock !== newItem.stock || 
                 oldItem.status !== newItem.status; // Modified
        });

        for (const item of itemsToUpsert) {
          await supabaseService.upsertStock(item);
        }
      } catch (err) {
        console.error('Supabase update failed:', err);
        triggerToast('⚠️ Sinkronisasi Cloud Supabase gagal. Simpan lokal sukses.', 'warning');
      }
    }
  };


  // Handle successful login
  const handleLoginSuccess = (user: { name: string; role: string; avatarUrl: string; storeName: string }) => {
    setCurrentUser(user);
    setActivePage('dashboard');
  };

  // Handle logout
  const handleLogout = () => {
    setCurrentUser(null);
    setActivePage('auth');
  };

  const triggerToast = (msg: string, type: 'success' | 'info' | 'warning' = 'success') => {
    setToastMessage(msg);
    setToastType(type);
    setTimeout(() => {
      setToastMessage(null);
    }, 4500);
  };

  // Total alert indicators
  const lowStockCount = stockList.filter(item => item.stock < config.lowStockAlert).length;
  
  // Custom router render logic
  const renderPage = () => {
    switch (activePage) {
      case 'dashboard':
        return (
          <DashboardScreen
            onPageChange={setActivePage}
            lowStockCount={lowStockCount}
          />
        );
      case 'sales-inbox':
        return (
          <SalesInboxScreen />
        );
      case 'ai-stock':
        return (
          <StockManagerScreen 
            stockList={stockList} 
            onStockUpdate={handleStockUpdate} 
            showToast={triggerToast}
          />
        );
      case 'user-management':
        return (
          <UserManagementScreen 
            admins={admins} 
            onAdminsUpdate={setAdmins} 
            showToast={triggerToast}
          />
        );
      case 'notifications':
        return (
          <NotificationSettingsScreen 
            config={config} 
            onConfigChange={setConfig} 
            showToast={triggerToast}
          />
        );
      case 'whatsapp-ai':
        return (
          <WhatsappAiScreen 
            stockList={stockList}
            showToast={triggerToast}
          />
        );
      default:
        return null;
    }
  };

  // Switch to Auth Screen if no session active
  if (activePage === 'auth' || !currentUser) {
    return <AuthScreen onLoginSuccess={handleLoginSuccess} />;
  }

  return (
    <div 
      className="min-h-screen bg-[#f8f9ff] text-[#0b1c30] flex font-sans"
      style={{ background: 'radial-gradient(circle at 70% 80%, #eff4ff 0%, #f8f9ff 100%)' }}
    >
      {/* Dynamic Animated Success / Alert Toaster */}
      {toastMessage && (
        <div className="fixed top-8 left-1/2 -translate-x-1/2 z-[100] animate-bounce-subtle">
          <div className="bg-white px-8 py-4 rounded-full shadow-2xl flex items-center gap-3 border border-[#abc9f3] whitespace-nowrap">
            {toastType === 'success' && <ShieldCheck className="w-5 h-5 text-[#2d8a4e] shrink-0 fill-emerald-50" />}
            {toastType === 'warning' && <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0" />}
            {toastType === 'info' && <Info className="w-5 h-5 text-[#1e3d60] shrink-0" />}
            <span className="font-extrabold text-xs text-[#012749] tracking-tight">{toastMessage}</span>
          </div>
        </div>
      )}

      {/* Global Collapsible Sidebar Menu */}
      <Sidebar 
        activePage={activePage} 
        onPageChange={setActivePage} 
        currentUser={currentUser} 
        onLogout={handleLogout}
      />

      {/* Primary Layout Wrapper (Leaves room for the 80px fixed wide sidebar) */}
      <main className="flex-1 ml-[96px] mr-6 my-6 flex flex-col gap-6 min-h-[calc(100vh-48px)]">
        
        {/* Top Control Header Bar */}
        <header className="flex justify-between items-center w-full px-8 py-4 bg-white/60 backdrop-blur-xl rounded-3xl border border-white/60 shadow-sm shrink-0">
          <div className="flex items-center gap-5">
            <div className="flex items-center gap-2">
              <Zap className="w-5 h-5 text-[#012749] fill-blue-950 shrink-0" />
              <h1 className="font-extrabold text-lg text-primary tracking-tight">
                {currentUser?.storeName || 'Sinar Elektrik'}
              </h1>
            </div>
            
            <div className="h-5 w-px bg-slate-200" />
            
            <nav className="flex gap-4">
              <button 
                onClick={() => setActivePage('notifications')}
                className={`text-xs font-bold transition-all cursor-pointer ${
                  activePage === 'notifications' 
                    ? 'text-[#2d8a4e] border-b-2 border-[#2d8a4e] pb-1' 
                    : 'text-slate-400 hover:text-[#012749]'
                }`}
              >
                Settings
              </button>
              <button 
                onClick={() => setShowHistoryModal(true)}
                className="text-xs font-bold text-slate-400 hover:text-[#012749] cursor-pointer"
              >
                Konfigurasi Histori
              </button>
            </nav>
          </div>

          <div className="flex items-center gap-3 select-none">
            {/* Soft search helper */}
            <div className="relative hidden md:block">
              <input 
                type="text" 
                placeholder="Cari menu..." 
                onClick={() => triggerToast("🔍 Gunakan pintasan navigasi di sidebar untuk berpindah tab.", 'info')}
                className="bg-[#eff4ff] border-none rounded-full px-5 py-2 w-56 text-xs font-semibold focus:ring-1 focus:ring-[#012749]"
              />
              <Search className="w-3.5 h-3.5 text-slate-400 absolute right-4 top-1/2 -translate-y-1/2" />
            </div>

            <button 
              onClick={() => setActivePage('notifications')}
              className="w-9 h-9 rounded-full bg-slate-50 border border-slate-100 flex items-center justify-center text-slate-600 hover:bg-slate-100 relative cursor-pointer"
              title="Notifikasi Laporan"
            >
              <Bell className="w-4 h-4" />
              <span className="absolute top-1 right-1 w-2 h-2 bg-[#2d8a4e] rounded-full" />
            </button>
            
            <button 
              onClick={() => triggerToast(`📌 Toko: ${currentUser?.storeName || 'Sinar Elektrik'} • User: ${currentUser?.name} • Keamanan: Premium GPN`, 'info')}
              className="w-9 h-9 rounded-full bg-slate-50 border border-slate-100 flex items-center justify-center text-slate-600 hover:bg-slate-100 cursor-pointer"
              title="Informasi Sistem"
            >
              <HelpCircle className="w-4 h-4" />
            </button>
          </div>
        </header>

        {/* Core Screen Route Portlet */}
        <div className="flex-1 min-h-0">
          {renderPage()}
        </div>

        {/* Global Footer credits */}
        <footer className="flex justify-between items-center py-4 px-2 shrink-0 select-none">
          <p className="text-[10px] uppercase font-bold tracking-widest text-[#43474e]/60">
            © 2026 Sinar Elektrik MSME ERP • Powered by DeepMind &amp; Gemini AI
          </p>
          <div className="flex gap-4">
            <span className="text-[10px] text-[#43474e]/50 font-bold hover:text-slate-700 cursor-pointer" onClick={() => triggerToast("📜 Syarat Ketentuan Layanan Cloud SaaS Berlaku.", 'info')}>Terms</span>
            <span className="text-[10px] text-[#43474e]/50 font-bold hover:text-slate-700 cursor-pointer" onClick={() => triggerToast("🔒 Kebijakan Privasi CRM Enkripsi GPN Aktif.", 'info')}>Privacy</span>
          </div>
        </footer>
      </main>

      {/* Histori Configuration Modal */}
      {showHistoryModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center px-4 bg-black/40 backdrop-blur-sm animate-fadeIn">
          <div className="bg-white rounded-[2rem] border border-blue-105 shadow-2x p-8 max-w-sm w-full space-y-4 animate-slideUp">
            <div className="flex items-center gap-2.5">
              <Info className="w-6 h-6 text-[#1e3d60]" />
              <h4 className="font-extrabold text-[#012749]">Informasi Histori ERP</h4>
            </div>
            <p className="text-xs text-slate-500 leading-relaxed font-semibold">
              Seluruh rekayasa stok, revisi hak akses tim pengurus, and draf invoice kiriman tersimpan dengan aman di server lokal virtual browser Anda (LocalStorage).
            </p>
            <div className="flex justify-end pt-2">
              <button 
                onClick={() => setShowHistoryModal(false)}
                className="px-6 py-2 bg-[#012749] text-white rounded-full text-xs font-bold hover:scale-105 transition-all cursor-pointer"
              >
                Mengerti
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
