/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { Rocket, Mail, Lock, Heart, ShieldCheck, Sparkles, AlertCircle } from 'lucide-react';

interface AuthScreenProps {
  onLoginSuccess: (userData: { name: string; role: string; avatarUrl: string; storeName: string }) => void;
}

export default function AuthScreen({ onLoginSuccess }: AuthScreenProps) {
  const [view, setView] = useState<'signIn' | 'signUp'>('signIn');
  
  // Sign In inputs
  const [signInEmail, setSignInEmail] = useState('owner@sinarelektrik.com');
  const [signInOtp, setSignInOtp] = useState('');
  const [signInSent, setSignInSent] = useState(false);
  
  // Sign Up inputs
  const [signUpName, setSignUpName] = useState('');
  const [signUpStore, setSignUpStore] = useState('');
  const [signUpEmail, setSignUpEmail] = useState('');
  const [signUpOtp, setSignUpOtp] = useState('');
  const [signUpSent, setSignUpSent] = useState(false);
  const [signUpAgree, setSignUpAgree] = useState(false);
  
  // Alerts / notifications
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [simulatedCode, setSimulatedCode] = useState<string | null>(null);
  const [showOtpBanner, setShowOtpBanner] = useState(false);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage(null);
    }, 5000);
  };

  const handleSendSignInOtp = () => {
    if (!signInEmail) {
      showToast('⚠️ Silakan masukkan alamat email terlebih dahulu!');
      return;
    }
    setSignInSent(true);
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    setSimulatedCode(code);
    showToast(`✉️ Kode OTP dikirim ke ${signInEmail}!`);
    setShowOtpBanner(true);
  };

  const handleSendSignUpOtp = () => {
    if (!signUpEmail) {
      showToast('⚠️ Silakan masukkan email bisnis terlebih dahulu!');
      return;
    }
    setSignUpSent(true);
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    setSimulatedCode(code);
    showToast(`✉️ Kode OTP dikirim ke ${signUpEmail}!`);
    setShowOtpBanner(true);
  };

  const handleSignInSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!signInSent) {
      showToast('⚠️ Tolong kirimkan kode OTP terlebih dahulu!');
      return;
    }
    if (!signInOtp) {
      showToast('⚠️ Tolong masukkan kode OTP 6-Digit!');
      return;
    }
    if (signInOtp === simulatedCode || signInOtp === '123456') {
      showToast('🎉 Masuk sukses! Memuat sistem ERP...');
      setTimeout(() => {
        onLoginSuccess({
          name: 'Budi Santoso (Owner)',
          role: 'Premium Owner',
          avatarUrl: 'https://lh3.googleusercontent.com/aida-public/AB6AXuDiijLvumk4m2PXGeGkPsZnJm7XlfJ46jtvZLRKtHSIhrLhQXkDWROhqhVrC0h86M2WgCmBJ5i1MCeclrqwYlhxKi3es-CkBZxGllqxWubmjn-enOVXF_YwPQN4WGYb5whMKr3N3gEJqYPU4Ae7vBflnmLpUmc-i6W4EzOKMqLqHNJyZ5CovUPyHyEkY234zFT4aUBHh_JhbEgXFbALKLQrxfWNDhjJ1dGoKzBQQuAmWwcpGEtklLCrsMCFy2tBrXSkBNvXvfJE3pM',
          storeName: 'Sinar Elektrik'
        });
      }, 1000);
    } else {
      showToast('❌ Kode OTP tidak valid! Silakan masukkan kode yang dikirim.');
    }
  };

  const handleSignUpSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!signUpName || !signUpStore || !signUpEmail || !signUpOtp) {
      showToast('⚠️ Silakan melengkapi semua formulir pendaftaran!');
      return;
    }
    if (!signUpAgree) {
      showToast('⚠️ Anda harus menyetujui Syarat & Ketentuan terlebih dahulu.');
      return;
    }
    if (signUpOtp === simulatedCode || signUpOtp === '123456') {
      showToast(`🎉 Toko "${signUpStore}" sukses terdaftar! Mengalihkan ke Dashboard.`);
      setTimeout(() => {
        onLoginSuccess({
          name: `${signUpName} (Owner)`,
          role: 'Premium Owner',
          avatarUrl: 'https://lh3.googleusercontent.com/aida-public/AB6AXuDiijLvumk4m2PXGeGkPsZnJm7XlfJ46jtvZLRKtHSIhrLhQXkDWROhqhVrC0h86M2WgCmBJ5i1MCeclrqwYlhxKi3es-CkBZxGllqxWubmjn-enOVXF_YwPQN4WGYb5whMKr3N3gEJqYPU4Ae7vBflnmLpUmc-i6W4EzOKMqLqHNJyZ5CovUPyHyEkY234zFT4aUBHh_JhbEgXFbALKLQrxfWNDhjJ1dGoKzBQQuAmWwcpGEtklLCrsMCFy2tBrXSkBNvXvfJE3pM',
          storeName: signUpStore
        });
      }, 1200);
    } else {
      showToast('❌ Kode OTP tidak valid!');
    }
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

      {/* Simulated WhatsApp OTP Notification Toast */}
      {showOtpBanner && simulatedCode && (
        <div className="fixed top-6 right-6 md:right-12 md:top-12 z-[120] max-w-sm w-full bg-[#075E54] text-white rounded-3xl shadow-[0_20px_50px_rgba(7,94,84,0.35)] p-5 border border-[#128C7E] animate-slideUp">
          <div className="flex items-start gap-4">
            <div className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center shrink-0">
              <span className="material-symbols-outlined text-white text-xl">chat</span>
            </div>
            <div className="flex-1">
              <div className="flex items-center justify-between">
                <span className="font-extrabold text-[10px] uppercase tracking-wider text-emerald-300">OTP Sinar Elektrik</span>
                <span className="text-[9px] text-white/50 font-bold">Baru saja</span>
              </div>
              <p className="text-xs font-semibold mt-1.5 text-emerald-50">
                Kode OTP verifikasi masuk Anda: <span className="font-mono font-black text-white text-sm bg-black/20 px-2.5 py-0.5 rounded tracking-widest">{simulatedCode}</span>
              </p>
            </div>
            <button 
              onClick={() => setShowOtpBanner(false)}
              className="text-white/60 hover:text-white font-bold text-xs px-1 cursor-pointer select-none"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* Left Branding Grid */}
      <section className="relative w-full md:w-1/2 bg-gradient-to-br from-[#1e3d60] to-[#102a43] overflow-hidden flex flex-col p-12 justify-between">
        {/* Animated Background Orbs */}
        <div className="absolute -top-20 -left-20 w-96 h-96 bg-emerald-500/20 rounded-full filter blur-[100px] animate-pulse"></div>
        <div className="absolute bottom-20 -right-20 w-80 h-80 bg-blue-500/20 rounded-full filter blur-[100px]" style={{ animationDelay: '-5s' }}></div>

        {/* Top Header Logo */}
        <div className="relative z-10">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-[#2d8a4e] rounded-xl flex items-center justify-center shadow-lg shadow-[#2d8a4e]/30">
              <Rocket className="w-5 h-5 text-white fill-white" />
            </div>
            <span className="text-white font-extrabold text-2xl tracking-tight">ERP Pro</span>
          </div>
        </div>

        {/* Mid graphic contents */}
        <div className="relative z-10 flex flex-col items-center text-center space-y-10 py-12">
          <div className="flex items-center justify-center gap-6">
            {/* WA Floating Icon */}
            <div className="w-20 h-20 rounded-3xl bg-white/10 backdrop-blur-md border border-white/20 flex flex-col items-center justify-center shadow-2xl skew-y-3 rotate-[-6deg]">
              <span className="material-symbols-outlined text-[#25D366] text-3xl">chat</span>
              <div className="w-8 h-1 bg-white/20 rounded-full mt-2"></div>
            </div>

            {/* Smart Intelligent Bot */}
            <div className="w-28 h-28 bg-[#2d8a4e] rounded-[2rem] flex flex-col items-center justify-center shadow-[0_20px_50px_rgba(46,125,50,0.4)] relative">
              <span className="material-symbols-outlined text-white text-5xl">smart_toy</span>
              <div className="absolute -top-1 -right-1 w-6 h-6 bg-red-500 rounded-full border-2 border-white animate-ping"></div>
              <div className="absolute -top-1 -right-1 w-6 h-6 bg-red-500 rounded-full border-2 border-white"></div>
            </div>

            {/* Admin Table Icon */}
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
              Kelola stok, pantau transaksi, dan otomasi balasan pelanggan lewat WhatsApp AI Bot. Sistem pintar kami menangani draf pesanan sehingga Anda bisa fokus kembangkan bisnis.
            </p>
          </div>
        </div>

        {/* Bottom Credits copyright */}
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
            /* Sign In Block */
            <div className="flex flex-col gap-6 animate-fadeIn">
              <div className="space-y-2">
                <h2 className="text-[#012749] font-extrabold text-2xl tracking-tight">Selamat Datang Kembali 👋</h2>
                <p className="text-[#43474e] text-sm leading-relaxed">
                  Silakan masuk untuk mengelola sistem ERP dan WhatsApp Bot Sinar Elektrik Anda.
                </p>
              </div>

              <form onSubmit={handleSignInSubmit} className="space-y-5">
                {/* Email Address */}
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
                      className="text-[#2d8a4e] font-extrabold text-xs whitespace-nowrap hover:underline cursor-pointer ml-2"
                    >
                      {signInSent ? 'Kirim Ulang' : 'Kirim OTP'}
                    </button>
                  </div>
                </div>

                {/* OTP verification input */}
                <div className="space-y-1.5 transition-all duration-300">
                  <label className="text-xs font-bold text-[#0b1c30] tracking-wider uppercase block px-2">Kode OTP</label>
                  <div className="flex items-center bg-[#eff4ff] rounded-full px-6 py-3 border-2 border-transparent focus-within:border-[#2d8a4e] transition-all">
                    <Lock className="w-5 h-5 text-gray-400 mr-3 shrink-0" />
                    <input 
                      type="text" 
                      maxLength={6}
                      value={signInOtp}
                      onChange={(e) => setSignInOtp(e.target.value)}
                      placeholder={signInSent ? "Masukkan 6 digit kode OTP" : "Kirim OTP terlebih dahulu"}
                      disabled={!signInSent}
                      className="bg-transparent border-none focus:ring-0 w-full text-sm font-semibold outline-none py-1 text-[#0b1c30]"
                    />
                  </div>
                  {signInSent && (
                    <p className="text-[11px] text-gray-500 italic px-2">
                       Simulasi OTP dikirim ke e-mail. Gunakan tombol 'Kirim OTP' di atas secara nyata.
                    </p>
                  )}
                </div>

                {/* Auxiliary links */}
                <div className="flex items-center justify-between text-xs px-2 select-none">
                  <span className="text-[#43474e] font-medium flex items-center gap-1">
                    <AlertCircle className="w-3.5 h-3.5 text-emerald-600" /> OTP dikendalikan AI
                  </span>
                  <a href="#reset" className="text-[#102a43] hover:text-[#2d8a4e] font-semibold hover:underline" onClick={(e) => { e.preventDefault(); showToast("🔑 Tekan tombol 'Kirim OTP' di atas untuk memicu pembacaan sandi OTP."); }}>
                    Lupa Kode?
                  </a>
                </div>

                {/* Log In Trigger */}
                <button 
                  type="submit"
                  className="w-full bg-[#2d8a4e] text-white py-4 rounded-full font-bold shadow-lg shadow-[#2d8a4e]/20 hover:shadow-xl hover:shadow-[#2d8a4e]/30 hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.98] transition-all flex items-center justify-center gap-2 cursor-pointer mt-2"
                >
                  <Heart className="w-4 h-4 fill-white shrink-0" />
                  <span>MASUK DENGAN OTP</span>
                </button>
              </form>

              {/* Toggle layout to signup */}
              <div className="text-center pt-2">
                <p className="text-gray-500 text-sm">
                  Belum memiliki akun toko?{' '}
                  <button 
                    onClick={() => setView('signUp')}
                    className="text-[#2d8a4e] font-extrabold hover:underline cursor-pointer"
                  >
                    Daftar Toko Baru Sekarang
                  </button>
                </p>
              </div>
            </div>
          ) : (
            /* Sign Up Block */
            <div className="flex flex-col gap-6 animate-fadeIn">
              <div className="space-y-2">
                <h2 className="text-[#012749] font-extrabold text-2xl tracking-tight">Mulai Efisiensikan Toko Anda ⚡</h2>
                <p className="text-[#43474e] text-sm leading-relaxed">
                  Daftarkan diri Anda sebagai Owner Bisnis untuk mengaktifkan sistem otomasi pembukuan & penjualan AI.
                </p>
              </div>

              <form onSubmit={handleSignUpSubmit} className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {/* Staff Owner name */}
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

                  {/* Business Store name */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-[#0b1c30] block px-2">Nama Bisnis</label>
                    <div className="flex bg-[#eff4ff] rounded-full px-6 py-2.5 border-2 border-transparent focus-within:border-[#2d8a4e] transition-all">
                      <input 
                        type="text" 
                        required
                        value={signUpStore}
                        onChange={(e) => setSignUpStore(e.target.value)}
                        placeholder="Sinar Elektrik Cabang Baru"
                        className="bg-transparent border-none focus:ring-0 w-full text-xs font-semibold outline-none py-1 text-[#0b1c30]"
                      />
                    </div>
                  </div>
                </div>

                {/* Email input line */}
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
                      className="text-[#2d8a4e] font-extrabold text-xs whitespace-nowrap hover:underline cursor-pointer ml-1"
                    >
                      {signUpSent ? 'Kirim Ulang' : 'Kirim OTP'}
                    </button>
                  </div>
                  <p className="text-[10px] text-gray-500 italic px-3 font-medium">
                    Email ini akan digunakan untuk Notifikasi Detak Jantung Laporan Otomatis.
                  </p>
                </div>

                {/* Verify OTP Code input */}
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-[#0b1c30] block px-2">Verifikasi Kode OTP</label>
                  <div className="flex items-center bg-[#eff4ff] rounded-full px-6 py-2.5 border-2 border-transparent focus-within:border-[#2d8a4e] transition-all">
                    <ShieldCheck className="w-4 h-4 text-gray-400 mr-2.5 shrink-0" />
                    <input 
                      type="text" 
                      maxLength={6}
                      required
                      value={signUpOtp}
                      onChange={(e) => setSignUpOtp(e.target.value)}
                      placeholder={signUpSent ? "Masukkan 6 digit kode OTP" : "Klik Kirim OTP dlu"}
                      disabled={!signUpSent}
                      className="bg-transparent border-none focus:ring-0 w-full text-xs font-semibold outline-none py-1 text-[#0b1c30]"
                    />
                  </div>
                </div>

                {/* Terms agreement checkbox */}
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

                {/* Trigger registration buttons */}
                <button 
                  type="submit"
                  className="w-full bg-[#2d8a4e] text-white py-4 rounded-full font-bold shadow-lg shadow-[#2d8a4e]/20 hover:shadow-xl hover:shadow-[#2d8a4e]/30 hover:-translate-y-0.5 transition-all flex items-center justify-center gap-2 cursor-pointer mt-4"
                >
                  <Sparkles className="w-4 h-4 shrink-0 fill-white" />
                  <span>VERIFIKASI & DAFTAR TOKO</span>
                </button>
              </form>

              {/* Toggle back to login */}
              <div className="text-center pt-2">
                <p className="text-gray-500 text-sm">
                  Sudah memiliki akun toko?{' '}
                  <button 
                    onClick={() => setView('signIn')}
                    className="text-[#2d8a4e] font-extrabold hover:underline cursor-pointer"
                  >
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
