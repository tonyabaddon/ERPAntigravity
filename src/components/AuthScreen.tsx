/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { Rocket, Mail, Lock, Heart, ShieldCheck, Sparkles, AlertCircle } from 'lucide-react';
import { supabase, isSupabaseConfigured, adminUsersService } from '../lib/supabaseClient';
import { PermissionSet, ALL_PERMISSIONS } from '../types';

interface AuthScreenProps {
  onLoginSuccess: (userData: { id: string; name: string; role: string; permissions: PermissionSet; avatarUrl: string; storeName: string }) => void;
}

function deriveDisplayName(email: string, fullName?: string): string {
  if (fullName) return fullName;
  return email.split('@')[0];
}

export default function AuthScreen({ onLoginSuccess }: AuthScreenProps) {
  const [view, setView] = useState<'signIn' | 'signUp'>('signIn');

  // Sign In inputs
  const [signInEmail, setSignInEmail] = useState('');
  const [signInOtp, setSignInOtp] = useState('');
  const [signInSent, setSignInSent] = useState(false);
  const [signInLoading, setSignInLoading] = useState(false);

  // Sign Up inputs
  const [signUpName, setSignUpName] = useState('');
  const [signUpStore, setSignUpStore] = useState('');
  const [signUpEmail, setSignUpEmail] = useState('');
  const [signUpOtp, setSignUpOtp] = useState('');
  const [signUpSent, setSignUpSent] = useState(false);
  const [signUpAgree, setSignUpAgree] = useState(false);
  const [signUpLoading, setSignUpLoading] = useState(false);

  // Alerts / notifications
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 5000);
  };

  // Dev bypass when Supabase is not configured
  const devBypass = (email: string, name?: string, storeName?: string) => {
    onLoginSuccess({
      id: '',
      name: name ?? deriveDisplayName(email),
      role: 'Owner',
      permissions: ALL_PERMISSIONS,
      avatarUrl: '',
      storeName: storeName ?? 'Dev Store',
    });
  };

  const handleSendSignInOtp = async () => {
    if (!signInEmail) {
      showToast('⚠️ Silakan masukkan alamat email terlebih dahulu!');
      return;
    }
    if (!isSupabaseConfigured || !supabase) {
      setSignInSent(true);
      showToast('⚠️ Supabase belum dikonfigurasi — mode dev aktif. Gunakan kode 123456.');
      return;
    }
    setSignInLoading(true);
    const { error } = await supabase.auth.signInWithOtp({ email: signInEmail });
    setSignInLoading(false);
    if (error) {
      showToast(`❌ Gagal kirim OTP: ${error.message}`);
      return;
    }
    setSignInSent(true);
    showToast(`✉️ Kode OTP dikirim ke ${signInEmail}!`);
  };

  const handleSignInSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!signInSent) {
      showToast('⚠️ Tolong kirimkan kode OTP terlebih dahulu!');
      return;
    }
    if (!signInOtp) {
      showToast('⚠️ Tolong masukkan kode OTP!');
      return;
    }
    // Dev bypass
    if (!isSupabaseConfigured || !supabase) {
      if (signInOtp === '123456') {
        showToast('🎉 Masuk sukses (dev mode)!');
        setTimeout(() => devBypass(signInEmail), 1000);
      } else {
        showToast('❌ Kode OTP tidak valid!');
      }
      return;
    }
    setSignInLoading(true);
    const { data, error } = await supabase.auth.verifyOtp({
      email: signInEmail,
      token: signInOtp,
      type: 'email',
    });
    setSignInLoading(false);
    if (error) {
      showToast(`❌ OTP tidak valid: ${error.message}`);
      return;
    }
    const user = data.user;
    if (!user) {
      showToast('❌ Gagal mendapatkan data pengguna.');
      return;
    }
    let adminRow = null;
    try {
      adminRow = await adminUsersService.fetchByEmail(signInEmail);
    } catch (err) {
      setSignInLoading(false);
      showToast('❌ Gagal memuat data akses. Coba lagi.');
      return;
    }
    if (!adminRow) {
      setSignInLoading(false);
      showToast('❌ Email belum terdaftar sebagai admin. Minta owner untuk menambahkan akun Anda.');
      return;
    }
    showToast('🎉 Masuk sukses! Memuat sistem ERP...');
    setTimeout(() => {
      onLoginSuccess({
        id: user.id,
        name: deriveDisplayName(user.email ?? '', adminRow!.name),
        role: adminRow!.role,
        permissions: adminRow!.permissions as PermissionSet,
        avatarUrl: user.user_metadata?.avatar_url ?? '',
        storeName: user.user_metadata?.store_name ?? '',
      });
    }, 800);
  };

  const handleSendSignUpOtp = async () => {
    if (!signUpEmail) {
      showToast('⚠️ Silakan masukkan email bisnis terlebih dahulu!');
      return;
    }
    if (!isSupabaseConfigured || !supabase) {
      setSignUpSent(true);
      showToast('⚠️ Supabase belum dikonfigurasi — mode dev aktif. Gunakan kode 123456.');
      return;
    }
    setSignUpLoading(true);
    const { error } = await supabase.auth.signInWithOtp({ email: signUpEmail });
    setSignUpLoading(false);
    if (error) {
      showToast(`❌ Gagal kirim OTP: ${error.message}`);
      return;
    }
    setSignUpSent(true);
    showToast(`✉️ Kode OTP dikirim ke ${signUpEmail}!`);
  };

  const handleSignUpSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!signUpName || !signUpStore || !signUpEmail || !signUpOtp) {
      showToast('⚠️ Silakan melengkapi semua formulir pendaftaran!');
      return;
    }
    if (!signUpAgree) {
      showToast('⚠️ Anda harus menyetujui Syarat & Ketentuan terlebih dahulu.');
      return;
    }
    // Dev bypass
    if (!isSupabaseConfigured || !supabase) {
      if (signUpOtp === '123456') {
        showToast(`🎉 Toko "${signUpStore}" sukses terdaftar (dev mode)!`);
        setTimeout(() => devBypass(signUpEmail, signUpName, signUpStore), 1200);
      } else {
        showToast('❌ Kode OTP tidak valid!');
      }
      return;
    }
    setSignUpLoading(true);
    const { data, error } = await supabase.auth.verifyOtp({
      email: signUpEmail,
      token: signUpOtp,
      type: 'email',
    });
    if (error) {
      setSignUpLoading(false);
      showToast(`❌ OTP tidak valid: ${error.message}`);
      return;
    }
    // Save name and store to user metadata
    const { error: updateError } = await supabase.auth.updateUser({
      data: { full_name: signUpName, store_name: signUpStore },
    });
    if (updateError) {
      setSignUpLoading(false);
      showToast(`❌ Gagal simpan profil: ${updateError.message}`);
      return;
    }
    // Auto-create Owner row in admin_users
    if (isSupabaseConfigured && data.user) {
      try {
        await adminUsersService.upsert({
          id: data.user.id,
          name: signUpName,
          email: signUpEmail,
          whatsapp: null,
          role: 'Owner',
          permissions: ALL_PERMISSIONS,
          status: 'Aktif',
        });
      } catch (err) {
        console.error('Failed to create owner row in admin_users:', err);
        // Non-fatal: continue login with all permissions
      }
    }
    setSignUpLoading(false);
    showToast(`🎉 Toko "${signUpStore}" sukses terdaftar! Mengalihkan ke Dashboard.`);
    setTimeout(() => {
      onLoginSuccess({
        id: data.user?.id ?? '',
        name: signUpName,
        role: 'Owner',
        permissions: ALL_PERMISSIONS,
        avatarUrl: '',
        storeName: signUpStore,
      });
    }, 1200);
  };

  return (
    <div className="min-h-screen flex flex-col md:flex-row overflow-hidden bg-[#f8f9ff]">
      {/* Toast Notifikasi */}
      {toastMessage && (
        <div className="fixed top-6 right-6 md:right-1/2 md:translate-x-1/2 z-[100] animate-bounce">
          <div className="bg-[#1e3d60] text-white border border-blue-500/20 px-6 py-3.5 rounded-full shadow-2xl flex items-center gap-3">
            <ShieldCheck className="w-5 h-5 text-emerald-400 shrink-0" />
            <span className="font-extrabold text-xs tracking-tight">{toastMessage}</span>
          </div>
        </div>
      )}

      {/* Dev mode banner */}
      {!isSupabaseConfigured && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[100] bg-amber-500 text-white text-xs font-bold px-6 py-2 rounded-full shadow-lg">
          ⚠️ Dev Mode — Supabase belum dikonfigurasi. OTP: 123456
        </div>
      )}

      {/* Left Branding Grid */}
      <section className="relative w-full md:w-1/2 bg-gradient-to-br from-[#1e3d60] to-[#102a43] overflow-hidden flex flex-col p-12 justify-between">
        <div className="absolute -top-20 -left-20 w-96 h-96 bg-emerald-500/20 rounded-full filter blur-[100px] animate-pulse"></div>
        <div className="absolute bottom-20 -right-20 w-80 h-80 bg-blue-500/20 rounded-full filter blur-[100px]" style={{ animationDelay: '-5s' }}></div>

        <div className="relative z-10">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-[#2d8a4e] rounded-xl flex items-center justify-center shadow-lg shadow-[#2d8a4e]/30">
              <Rocket className="w-5 h-5 text-white fill-white" />
            </div>
            <span className="text-white font-extrabold text-2xl tracking-tight">ERP Pro</span>
          </div>
        </div>

        <div className="relative z-10 flex flex-col items-center text-center space-y-10 py-12">
          <div className="flex items-center justify-center gap-6">
            <div className="w-20 h-20 rounded-3xl bg-white/10 backdrop-blur-md border border-white/20 flex flex-col items-center justify-center shadow-2xl skew-y-3 rotate-[-6deg]">
              <span className="material-symbols-outlined text-[#25D366] text-3xl">chat</span>
              <div className="w-8 h-1 bg-white/20 rounded-full mt-2"></div>
            </div>
            <div className="w-28 h-28 bg-[#2d8a4e] rounded-[2rem] flex flex-col items-center justify-center shadow-[0_20px_50px_rgba(46,125,50,0.4)] relative">
              <span className="material-symbols-outlined text-white text-5xl">smart_toy</span>
              <div className="absolute -top-1 -right-1 w-6 h-6 bg-red-500 rounded-full border-2 border-white animate-ping"></div>
              <div className="absolute -top-1 -right-1 w-6 h-6 bg-red-500 rounded-full border-2 border-white"></div>
            </div>
            <div className="w-20 h-20 rounded-3xl bg-white/10 backdrop-blur-md border border-white/20 flex flex-col items-center justify-center shadow-2xl rotate-[6deg]">
              <span className="material-symbols-outlined text-white/80 text-3xl">dashboard</span>
              <div className="w-8 h-1 bg-white/20 rounded-full mt-2"></div>
            </div>
          </div>

          <div className="max-w-md mx-auto space-y-4">
            <h1 className="text-white font-extrabold text-2xl md:text-3xl tracking-tight leading-tight">
              Satu Aplikasi untuk Kendali Penuh Toko Anda
            </h1>
            <p className="text-white/70 text-sm md:text-base leading-relaxed font-light">
              Kelola stok, pantau transaksi, dan otomasi balasan pelanggan lewat WhatsApp AI Bot.
            </p>
          </div>
        </div>

        <div className="relative z-10 text-white/40 text-xs text-center md:text-left">
          Copyright © 2026 TechSaaS System. Seluruh Hak Cipta Dilindungi.
        </div>
      </section>

      {/* Right Authentication Form Area */}
      <section className="w-full md:w-1/2 flex items-center justify-center p-6 md:p-12 bg-[#f8f9ff] relative">
        <div className="absolute inset-0 pointer-events-none opacity-20 overflow-hidden">
          <div className="absolute top-1/4 left-1/4 w-64 h-64 bg-emerald-300 blur-3xl rounded-full"></div>
          <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-blue-300 blur-3xl rounded-full"></div>
        </div>

        <div className="w-full max-w-[520px] bg-white rounded-[2rem] shadow-2xl p-8 md:p-12 flex flex-col gap-6 relative z-10 border border-[#e5eeff]">
          {view === 'signIn' ? (
            <div className="flex flex-col gap-6 animate-fadeIn">
              <div className="space-y-2">
                <h2 className="text-[#012749] font-extrabold text-2xl tracking-tight">Selamat Datang Kembali 👋</h2>
                <p className="text-[#43474e] text-sm leading-relaxed">
                  Silakan masuk untuk mengelola sistem ERP dan WhatsApp Bot Garindo Jaya Panel Anda.
                </p>
              </div>

              <form onSubmit={handleSignInSubmit} className="space-y-5">
                <div className="space-y-1.5 animate-slideUp">
                  <label className="text-xs font-bold text-[#0b1c30] tracking-wider uppercase block px-2">Alamat Email</label>
                  <div className="flex items-center bg-[#eff4ff] rounded-full px-6 py-3 border-2 border-transparent focus-within:border-[#2d8a4e] transition-all">
                    <Mail className="w-5 h-5 text-gray-400 mr-3 shrink-0" />
                    <input
                      type="email"
                      value={signInEmail}
                      onChange={(e) => setSignInEmail(e.target.value)}
                      placeholder="email@bisnisanda.com"
                      className="bg-transparent border-none focus:ring-0 w-full text-sm font-semibold outline-none py-1 text-[#0b1c30]"
                    />
                    <button
                      type="button"
                      onClick={handleSendSignInOtp}
                      disabled={signInLoading}
                      className="text-[#2d8a4e] font-extrabold text-xs whitespace-nowrap hover:underline cursor-pointer ml-2 disabled:opacity-50"
                    >
                      {signInLoading ? '...' : signInSent ? 'Kirim Ulang' : 'Kirim OTP'}
                    </button>
                  </div>
                </div>

                <div className="space-y-1.5 transition-all duration-300">
                  <label className="text-xs font-bold text-[#0b1c30] tracking-wider uppercase block px-2">Kode OTP</label>
                  <div className="flex items-center bg-[#eff4ff] rounded-full px-6 py-3 border-2 border-transparent focus-within:border-[#2d8a4e] transition-all">
                    <Lock className="w-5 h-5 text-gray-400 mr-3 shrink-0" />
                    <input
                      type="text"
                      maxLength={8}
                      value={signInOtp}
                      onChange={(e) => setSignInOtp(e.target.value)}
                      placeholder={signInSent ? 'Masukkan kode OTP dari email' : 'Kirim OTP terlebih dahulu'}
                      disabled={!signInSent}
                      className="bg-transparent border-none focus:ring-0 w-full text-sm font-semibold outline-none py-1 text-[#0b1c30]"
                    />
                  </div>
                  {signInSent && (
                    <p className="text-[11px] text-gray-500 italic px-2">
                      Cek email Anda untuk kode OTP dari Supabase.
                    </p>
                  )}
                </div>

                <div className="flex items-center justify-between text-xs px-2 select-none">
                  <span className="text-[#43474e] font-medium flex items-center gap-1">
                    <AlertCircle className="w-3.5 h-3.5 text-emerald-600" /> OTP via Email
                  </span>
                </div>

                <button
                  type="submit"
                  disabled={signInLoading}
                  className="w-full bg-[#2d8a4e] text-white py-4 rounded-full font-bold shadow-lg shadow-[#2d8a4e]/20 hover:shadow-xl hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.98] transition-all flex items-center justify-center gap-2 cursor-pointer mt-2 disabled:opacity-60"
                >
                  <Heart className="w-4 h-4 fill-white shrink-0" />
                  <span>{signInLoading ? 'MEMVERIFIKASI...' : 'MASUK DENGAN OTP'}</span>
                </button>
              </form>

              <div className="text-center pt-2">
                <p className="text-gray-500 text-sm">
                  Belum memiliki akun toko?{' '}
                  <button onClick={() => setView('signUp')} className="text-[#2d8a4e] font-extrabold hover:underline cursor-pointer">
                    Daftar Toko Baru Sekarang
                  </button>
                </p>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-6 animate-fadeIn">
              <div className="space-y-2">
                <h2 className="text-[#012749] font-extrabold text-2xl tracking-tight">Mulai Efisiensikan Toko Anda ⚡</h2>
                <p className="text-[#43474e] text-sm leading-relaxed">
                  Daftarkan diri Anda sebagai Owner Bisnis untuk mengaktifkan sistem otomasi AI.
                </p>
              </div>

              <form onSubmit={handleSignUpSubmit} className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-[#0b1c30] block px-2">Nama Lengkap</label>
                    <div className="flex bg-[#eff4ff] rounded-full px-6 py-2.5 border-2 border-transparent focus-within:border-[#2d8a4e] transition-all">
                      <input
                        type="text"
                        required
                        value={signUpName}
                        onChange={(e) => setSignUpName(e.target.value)}
                        placeholder="Contoh: Budi Santoso"
                        className="bg-transparent border-none focus:ring-0 w-full text-xs font-semibold outline-none py-1 text-[#0b1c30]"
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-[#0b1c30] block px-2">Nama Bisnis</label>
                    <div className="flex bg-[#eff4ff] rounded-full px-6 py-2.5 border-2 border-transparent focus-within:border-[#2d8a4e] transition-all">
                      <input
                        type="text"
                        required
                        value={signUpStore}
                        onChange={(e) => setSignUpStore(e.target.value)}
                        placeholder="Garindo Jaya Panel Cabang Baru"
                        className="bg-transparent border-none focus:ring-0 w-full text-xs font-semibold outline-none py-1 text-[#0b1c30]"
                      />
                    </div>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-[#0b1c30] block px-2">Email Bisnis Utama</label>
                  <div className="flex items-center bg-[#eff4ff] rounded-full px-6 py-2.5 border-2 border-transparent focus-within:border-[#2d8a4e] transition-all">
                    <Mail className="w-4 h-4 text-gray-400 mr-2.5 shrink-0" />
                    <input
                      type="email"
                      required
                      value={signUpEmail}
                      onChange={(e) => setSignUpEmail(e.target.value)}
                      placeholder="admin@sinarelektrik.com"
                      className="bg-transparent border-none focus:ring-0 w-full text-xs font-semibold outline-none py-1 text-[#0b1c30]"
                    />
                    <button
                      type="button"
                      onClick={handleSendSignUpOtp}
                      disabled={signUpLoading}
                      className="text-[#2d8a4e] font-extrabold text-xs whitespace-nowrap hover:underline cursor-pointer ml-1 disabled:opacity-50"
                    >
                      {signUpLoading ? '...' : signUpSent ? 'Kirim Ulang' : 'Kirim OTP'}
                    </button>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-[#0b1c30] block px-2">Verifikasi Kode OTP</label>
                  <div className="flex items-center bg-[#eff4ff] rounded-full px-6 py-2.5 border-2 border-transparent focus-within:border-[#2d8a4e] transition-all">
                    <ShieldCheck className="w-4 h-4 text-gray-400 mr-2.5 shrink-0" />
                    <input
                      type="text"
                      maxLength={8}
                      required
                      value={signUpOtp}
                      onChange={(e) => setSignUpOtp(e.target.value)}
                      placeholder={signUpSent ? 'Masukkan kode OTP dari email' : 'Klik Kirim OTP dulu'}
                      disabled={!signUpSent}
                      className="bg-transparent border-none focus:ring-0 w-full text-xs font-semibold outline-none py-1 text-[#0b1c30]"
                    />
                  </div>
                </div>

                <label className="flex items-start gap-3 cursor-pointer group mt-3 px-2 select-none">
                  <input
                    type="checkbox"
                    checked={signUpAgree}
                    onChange={(e) => setSignUpAgree(e.target.checked)}
                    className="mt-0.5 w-4 h-4 rounded text-[#2d8a4e] focus:ring-[#2d8a4e]/20 border-gray-300 transition-all cursor-pointer"
                  />
                  <span className="text-xs text-[#43474e] leading-tight font-medium group-hover:text-black">
                    Saya menyetujui Syarat & Ketentuan serta Kebijakan Privasi TechSaaS ERP System.
                  </span>
                </label>

                <button
                  type="submit"
                  disabled={signUpLoading}
                  className="w-full bg-[#2d8a4e] text-white py-4 rounded-full font-bold shadow-lg shadow-[#2d8a4e]/20 hover:shadow-xl hover:-translate-y-0.5 transition-all flex items-center justify-center gap-2 cursor-pointer mt-4 disabled:opacity-60"
                >
                  <Sparkles className="w-4 h-4 shrink-0 fill-white" />
                  <span>{signUpLoading ? 'MEMVERIFIKASI...' : 'VERIFIKASI & DAFTAR TOKO'}</span>
                </button>
              </form>

              <div className="text-center pt-2">
                <p className="text-gray-500 text-sm">
                  Sudah memiliki akun toko?{' '}
                  <button onClick={() => setView('signIn')} className="text-[#2d8a4e] font-extrabold hover:underline cursor-pointer">
                    Masuk di Sini
                  </button>
                </p>
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
