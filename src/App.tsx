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

import { ActivePage, StockItem, NotificationConfig, PermissionSet, ALL_PERMISSIONS, KasirChannel } from './types';
import { useURLRoute, navigate, replaceRoute } from './lib/urlRoute';
import Sidebar from './components/Sidebar';
import AuthScreen from './components/AuthScreen';
import DashboardScreen from './components/DashboardScreen';
import SalesInboxScreen from './components/SalesInboxScreen';
import StockManagerScreen from './components/StockManagerScreen';
import UserManagementScreen from './components/UserManagementScreen';
import NotificationSettingsScreen from './components/NotificationSettingsScreen';
import WhatsappAiScreen from './components/WhatsappAiScreen';
import PengaturanScreen from './components/PengaturanScreen';
import PipelineScreen from './components/PipelineScreen';
import OrderHistoryScreen from './components/OrderHistoryScreen';
import PelangganScreen from './components/PelangganScreen';
import LaporanScreen from './components/LaporanScreen';
import PembelianScreen from './components/PembelianScreen';
import KasirScreen from './components/KasirScreen';
import PenjualanBaruScreen from './components/PenjualanBaruScreen';
import PenjualanScreen from './components/PenjualanScreen';
import ApprovalInboxScreen from './components/approval/ApprovalInboxScreen';
import StockOpnameScreen from './components/stok/StockOpnameScreen';
import RekonsiliasiScreen from './components/RekonsiliasiScreen';
import WipListScreen from './components/WipListScreen';
import ManajemenGudangScreen from './components/ManajemenGudangScreen';

import {
  INITIAL_STOCK,
  INITIAL_CONFIG
} from './initialData';

import { isSupabaseConfigured, supabase, supabaseService, adminUsersService } from './lib/supabaseClient';
import { SalesChannelsProvider } from './contexts/SalesChannelsContext';

// Local type guard for the channel URL param. Defensive — if URL is hand-edited
// with a bogus channel, fall back to undefined (UI shows default channel picker).
// Mirrors the KasirChannel union in src/types.ts (14 canonical sales channels).
function isKasirChannel(value: string | undefined): value is KasirChannel {
  if (!value) return false;
  return [
    'walkin', 'grosir', 'sales', 'expo',
    'tokopedia', 'shopee', 'lazada', 'blibli', 'bukalapak', 'ralali', 'bhinneka',
    'whatsapp', 'instagram', 'website',
  ].includes(value);
}

export default function App() {
  // URL is single source of truth for navigation. activePage and screen-scoped
  // params (customer, po, channel, bnl, bnl-new-for-order, bnl-new-customer)
  // all derive from the current route.
  const route = useURLRoute();
  // Pre-auth, the AuthScreen gate below uses `!currentUser` to decide what to
  // render — the URL doesn't carry 'auth' anymore. Post-auth, the URL wins.
  const activePage: ActivePage = route.screen;
  const openCustomerId: string | null = route.params.customer ?? null;
  const initialDetailPoNumber: string | null = route.params.po ?? null;
  const initialBnlPiNumber: string | null = route.params.bnl ?? null;
  const initialBnlPrefill: { orderId: string; customerName?: string } | null = (() => {
    const orderId = route.params['bnl-new-for-order'];
    if (!orderId) return null;
    return { orderId, customerName: route.params['bnl-new-customer'] || undefined };
  })();
  // Validate channel param against KasirChannel; invalid → undefined.
  const penjualanInitialChannel: KasirChannel | undefined = isKasirChannel(route.params.channel)
    ? route.params.channel
    : undefined;
  const [currentUser, setCurrentUser] = useState<{ id: string; name: string; role: string; permissions: PermissionSet; avatarUrl: string; storeName: string } | null>(null);

  // General state databases loaded from templates or LocalStorage
  const [stockList, setStockList] = useState<StockItem[]>(() => {
    const saved = localStorage.getItem('sinar_elektrik_stocks');
    return saved ? JSON.parse(saved) : INITIAL_STOCK;
  });

  const [config, setConfig] = useState<NotificationConfig>(() => {
    const saved = localStorage.getItem('sinar_elektrik_config');
    return saved ? JSON.parse(saved) : INITIAL_CONFIG;
  });

  // Global Floating Alert state
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [toastType, setToastType] = useState<'success' | 'info' | 'warning'>('success');

  // Read deep-link query params on boot. URL is already source of truth for
  // logged-in users (useURLRoute reads it directly). For logged-out users,
  // we stash the route in sessionStorage so we can restore after login.
  useEffect(() => {
    if (currentUser) return; // Logged in — URL already drives state.
    const search = window.location.search;
    if (!search || search === '?') return;
    try {
      sessionStorage.setItem('pendingDeepLink', search);
    } catch {
      // sessionStorage unavailable (e.g., private window quota) — ignore.
    }
  }, []);

  // Restore Supabase auth session on page refresh
  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) return;
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (session?.user && !currentUser) {
        const user = session.user;
        // Look up real role + permissions from admin_users (was hardcoded to
        // 'Owner' + ALL_PERMISSIONS before — bypassed any per-role gating
        // including stok-opname blind-count). Fall back to Owner only when
        // no admin_users row exists, so existing auth users stay functional
        // until an Owner provisions them.
        let role: string = 'Owner';
        let permissions: PermissionSet = ALL_PERMISSIONS;
        try {
          const adminRow = await adminUsersService.fetchById(user.id);
          if (adminRow) {
            role = adminRow.role;
            permissions = adminRow.permissions as PermissionSet;
          } else {
            console.warn(`No admin_users row for ${user.id}; defaulting to Owner (provision via User Management)`);
          }
        } catch (err) {
          console.error('Failed to fetch admin_users role on session restore:', err);
        }
        setCurrentUser({
          id: user.id,
          name: user.user_metadata?.full_name ?? (user.email?.split('@')[0] ?? 'User'),
          role,
          permissions,
          avatarUrl: user.user_metadata?.avatar_url ?? '',
          storeName: user.user_metadata?.store_name ?? '',
        });
        // Default destination is dashboard; deep-link overrides if present.
        try {
          const stashedSearch = sessionStorage.getItem('pendingDeepLink');
          if (stashedSearch) {
            sessionStorage.removeItem('pendingDeepLink');
            // Restore the stashed route by replacing the URL. parseSearch in
            // urlRoute.ts gates against unknown screens, so we don't need to
            // pre-validate here.
            window.history.replaceState({}, '', stashedSearch);
            window.dispatchEvent(new Event('urlroute:change'));
          } else {
            // No stash — go to dashboard (idempotent: if URL is already
            // ?screen=dashboard, this is effectively a no-op).
            replaceRoute('dashboard');
          }
        } catch {
          // Stash unreadable — fall through to dashboard.
          replaceRoute('dashboard');
        }
      }
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session) {
        setCurrentUser(null);
        // Don't push 'auth' into URL — let the !currentUser gate render AuthScreen.
        // The next login will replaceRoute() to dashboard or stashed deep-link.
      }
    });
    return () => subscription.unsubscribe();
  }, []);

  // Sync state modifications to localStorage
  useEffect(() => {
    localStorage.setItem('sinar_elektrik_stocks', JSON.stringify(stockList));
  }, [stockList]);

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
            stock_atas: Number(item.stock_atas ?? item.stock),
            stock_bawah: Number(item.stock_bawah ?? 0),
            status: (item.status === 'Stok Tipis' ? 'Stok Tipis' : 'Sinkron') as 'Sinkron' | 'Stok Tipis',
            specs: (item.specs as Record<string, string | number>) ?? {},
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

  const handleStockRefresh = async () => {
    if (!isSupabaseConfigured) return;
    try {
      const data = await supabaseService.fetchStocks();
      if (data && data.length > 0) {
        const mapped: StockItem[] = data.map(item => ({
          sku: item.sku,
          name: item.name,
          category: item.category,
          price: Number(item.price),
          stock: Number(item.stock),
          stock_atas: Number(item.stock_atas ?? item.stock),
          stock_bawah: Number(item.stock_bawah ?? 0),
          status: (item.status === 'Stok Tipis' ? 'Stok Tipis' : 'Sinkron') as 'Sinkron' | 'Stok Tipis',
          specs: (item.specs as Record<string, string | number>) ?? {},
        }));
        setStockList(mapped);
      }
    } catch (err) {
      console.error('Stock refresh failed:', err);
    }
  };

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
                 oldItem.status !== newItem.status ||
                 JSON.stringify(oldItem.specs) !== JSON.stringify(newItem.specs); // Modified
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
  const handleLoginSuccess = (user: { id: string; name: string; role: string; permissions: PermissionSet; avatarUrl: string; storeName: string }) => {
    setCurrentUser(user);
    // Restore stashed deep-link if present; otherwise go to dashboard.
    try {
      const stashedSearch = sessionStorage.getItem('pendingDeepLink');
      if (stashedSearch) {
        sessionStorage.removeItem('pendingDeepLink');
        window.history.replaceState({}, '', stashedSearch);
        window.dispatchEvent(new Event('urlroute:change'));
        return;
      }
    } catch {
      // Stash unreadable — fall through.
    }
    replaceRoute('dashboard');
  };

  const handleOpenCustomer = (customerId: string) => {
    navigate('pelanggan', { customer: customerId });
  };

  // Handle logout
  const handleLogout = async () => {
    if (isSupabaseConfigured && supabase) {
      try {
        await supabase.auth.signOut();
      } catch {
        // best-effort sign-out; clear local state regardless
      }
    }
    setCurrentUser(null);
    // Clear URL params so a refresh post-logout starts clean. AuthScreen renders
    // via the !currentUser gate, not via ?screen=auth.
    window.history.replaceState({}, '', window.location.pathname);
    window.dispatchEvent(new Event('urlroute:change'));
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
            showToast={triggerToast}
            onNavigate={(page) => navigate(page)}
            lowStockCount={lowStockCount}
          />
        );
      case 'sales-inbox':
        return (
          <SalesInboxScreen onNavigate={(page) => navigate(page)} />
        );
      case 'ai-stock':
        return (
          <StockManagerScreen
            stockList={stockList}
            onStockUpdate={handleStockUpdate}
            showToast={triggerToast}
            currentUser={currentUser}
            onNavigateToOpname={() => navigate('stok-opname')}
          />
        );
      case 'manajemen-gudang':
        return (
          <ManajemenGudangScreen
            currentUser={currentUser}
            showToast={triggerToast}
          />
        );
      case 'persetujuan':
        return (
          <ApprovalInboxScreen
            currentUser={currentUser}
            showToast={triggerToast}
          />
        );
      case 'stok-opname':
        return (
          <StockOpnameScreen
            currentUser={currentUser}
            showToast={triggerToast}
          />
        );
      case 'user-management':
        return (
          <UserManagementScreen
            showToast={triggerToast}
            currentUser={currentUser}
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
            onNavigate={(page) => navigate(page)}
          />
        );
      case 'settings':
        return (
          <PengaturanScreen
            showToast={triggerToast}
            notificationConfig={config}
            onNotificationConfigChange={setConfig}
            stockList={stockList}
            onNavigate={(page) => navigate(page)}
            permissions={currentUser?.permissions}
            currentUserRole={currentUser?.role}
          />
        );
      case 'pipeline':
        return (
          <PipelineScreen
            onOpenCustomer={handleOpenCustomer}
            onNavigate={(page) => navigate(page)}
            showToast={triggerToast}
          />
        );
      case 'order-history':
        return (
          <OrderHistoryScreen
            currentUser={currentUser}
            onOpenCustomer={handleOpenCustomer}
            showToast={triggerToast}
          />
        );
      case 'pelanggan':
        return (
          <PelangganScreen
            openCustomerId={openCustomerId}
            onNavigate={(page) => navigate(page)}
            showToast={triggerToast}
          />
        );
      case 'laporan':
        return <LaporanScreen />;
      case 'pembelian':
        return (
          <PembelianScreen
            stockList={stockList}
            showToast={triggerToast}
            onStockRefresh={handleStockRefresh}
            currentUserId={currentUser?.id}
            currentUserPermissions={currentUser?.permissions}
            initialDetailPoNumber={initialDetailPoNumber}
            onDetailConsumed={() => { /* no-op: URL is source of truth; nothing to consume */ }}
            initialBnlPiNumber={initialBnlPiNumber}
            onBnlDetailConsumed={() => { /* no-op: URL is source of truth; nothing to consume */ }}
            initialBnlPrefill={initialBnlPrefill}
          />
        );
      case 'kasir':
        return (
          <KasirScreen
            currentUser={currentUser}
            showToast={triggerToast}
            onOpenPenjualanBaru={(channel) => {
              navigate('penjualanBaru', { channel });
            }}
          />
        );
      case 'penjualan':
        return (
          <PenjualanScreen
            currentUser={currentUser}
            showToast={triggerToast}
            initialChannel={penjualanInitialChannel}
            onBack={() => navigate('kasir')}
            onSaved={(_txId) => navigate('kasir')}
            onNavigate={(page) => navigate(page)}
            onOpenCustomer={handleOpenCustomer}
          />
        );
      case 'penjualanBaru':
        return (
          <PenjualanBaruScreen
            currentUser={currentUser}
            showToast={triggerToast}
            initialChannel={penjualanInitialChannel}
            onBack={() => navigate('kasir')}
            onSaved={(_txId) => navigate('kasir')}
            onNavigate={(page) => navigate(page)}
          />
        );
      case 'rekonsiliasi':
        return (
          <RekonsiliasiScreen
            currentUser={currentUser}
            showToast={triggerToast}
          />
        );
      case 'wip-list':
        return (
          <WipListScreen
            currentUser={currentUser}
            showToast={triggerToast}
          />
        );
      default:
        return null;
    }
  };

  // Detail-tab detection: route carries po param and we want a chromeless shell.
  const isDetailTab = route.screen === 'pembelian' && route.params.po != null;

  // Switch to Auth Screen if no session active. activePage no longer encodes
  // 'auth' (URL never carries ?screen=auth) — gate purely on currentUser.
  if (!currentUser) {
    return <AuthScreen onLoginSuccess={handleLoginSuccess} />;
  }

  // Detail tab: no sidebar, no global header, no footer. Only the toast and the screen.
  // The screen itself owns its top bar (close X + action buttons).
  if (isDetailTab && activePage === 'pembelian') {
    return (
      <div className="min-h-screen bg-gray-50 text-[#0b1c30] font-sans">
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
        <PembelianScreen
          stockList={stockList}
          showToast={triggerToast}
          onStockRefresh={handleStockRefresh}
          currentUserId={currentUser?.id}
          currentUserPermissions={currentUser?.permissions}
          initialDetailPoNumber={initialDetailPoNumber}
          onDetailConsumed={() => { /* no-op: URL is source of truth; nothing to consume */ }}
          initialBnlPiNumber={initialBnlPiNumber}
          onBnlDetailConsumed={() => { /* no-op: URL is source of truth; nothing to consume */ }}
          initialBnlPrefill={initialBnlPrefill}
        />
      </div>
    );
  }

  return (
    <SalesChannelsProvider>
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
        onPageChange={(page) => navigate(page)}
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
                {currentUser?.storeName || 'Garindo Jaya Panel'}
              </h1>
            </div>
            
            {/* Top-nav "Settings" + "Konfigurasi Histori" buttons removed
               on 2026-06-12 e2e audit — "Settings" routed to the same
               Notification Settings page as the sidebar entry, and
               "Konfigurasi Histori" opened a generic info modal whose name
               implied an audit-log view it didn't deliver. Sidebar is now
               the single source of nav. The notification bell on the right
               keeps the quick-access affordance with a recognized icon. */}
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
              onClick={() => navigate('notifications')}
              className="w-9 h-9 rounded-full bg-slate-50 border border-slate-100 flex items-center justify-center text-slate-600 hover:bg-slate-100 relative cursor-pointer"
              title="Notifikasi Laporan"
            >
              <Bell className="w-4 h-4" />
              <span className="absolute top-1 right-1 w-2 h-2 bg-[#2d8a4e] rounded-full" />
            </button>
            
            <button 
              onClick={() => triggerToast(`📌 Toko: ${currentUser?.storeName || 'Garindo Jaya Panel'} • User: ${currentUser?.name} • Keamanan: Premium GPN`, 'info')}
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
            © 2026 Garindo Jaya Panel MSME ERP • Powered by DeepMind &amp; Gemini AI
          </p>
          <div className="flex gap-4">
            <span className="text-[10px] text-[#43474e]/50 font-bold hover:text-slate-700 cursor-pointer" onClick={() => triggerToast("📜 Syarat Ketentuan Layanan Cloud SaaS Berlaku.", 'info')}>Terms</span>
            <span className="text-[10px] text-[#43474e]/50 font-bold hover:text-slate-700 cursor-pointer" onClick={() => triggerToast("🔒 Kebijakan Privasi CRM Enkripsi GPN Aktif.", 'info')}>Privacy</span>
          </div>
        </footer>
      </main>

    </div>
    </SalesChannelsProvider>
  );
}
