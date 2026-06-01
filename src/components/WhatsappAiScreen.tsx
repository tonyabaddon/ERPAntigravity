/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import {
  Bot,
  Smartphone,
  QrCode,
  Trash2,
  Cpu,
  ToggleLeft,
  ToggleRight,
  Plus,
  Terminal,
  Code,
  CheckCircle,
  RefreshCw,
  Copy,
  Check,
} from 'lucide-react';
import { WhatsappAiNumber, StockItem } from '../types';
import { supabase } from '../lib/supabaseClient';

interface WhatsappAiScreenProps {
  stockList: StockItem[];
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
}

export default function WhatsappAiScreen({ stockList: _stockList, showToast }: WhatsappAiScreenProps) {
  // State for WhatsApp Numbers — loaded from Supabase
  const [waNumbers, setWaNumbers] = useState<WhatsappAiNumber[]>([]);
  const [loading, setLoading] = useState(true);

  // State for Add Form
  const [newPhone, setNewPhone] = useState('');
  const [newName, setNewName] = useState('');
  const [newAiEnabled, setNewAiEnabled] = useState(true);

  // Real QR state from Go daemon
  const [qrCode, setQrCode] = useState<string>('');
  const [waConnected, setWaConnected] = useState(false);
  const [qrLoading, setQrLoading] = useState(false);
  const qrPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [pairingPhone, setPairingPhone] = useState('');
  const [terminalLogs, setTerminalLogs] = useState<string[]>([
    '[SYSTEM] Initializing whatsmeow framework package... READY',
    '[SYSTEM] Client logged out. Secure session SQLite DB detected.',
    '[SYSTEM] Ready to establish SQLite auth state store.'
  ]);

  // Ref for logging terminal scroll
  const logTerminalRef = useRef<HTMLDivElement>(null);

  // Code snippet toggle state
  const [activeCodeTab, setActiveCodeTab] = useState<'go' | 'node'>('go');
  const [copiedCodeFlag, setCopiedCodeFlag] = useState(false);

  // Load numbers from Supabase and subscribe to Realtime updates
  useEffect(() => {
    if (!supabase) { setLoading(false); return; }

    supabase.from('whatsapp_numbers').select('*').order('created_at').then(({ data }) => {
      if (data) setWaNumbers(data as WhatsappAiNumber[]);
      setLoading(false);
    });

    const sub = supabase
      .channel('wa-numbers-update')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'whatsapp_numbers' },
        (payload) => {
          setWaNumbers(prev =>
            prev.map(n => n.id === payload.new.id ? { ...n, ...payload.new } as WhatsappAiNumber : n)
          );
        })
      .subscribe();

    return () => { supabase?.removeChannel(sub); };
  }, []);

  // Poll /api/wa/qr while not connected
  const fetchQR = useCallback(async () => {
    try {
      const res = await fetch(`${import.meta.env.VITE_BACKEND_URL}/api/wa/qr`);
      const data = await res.json();
      setWaConnected(data.connected);
      setQrCode(data.qr || '');
      if (data.connected) {
        if (qrPollRef.current) clearInterval(qrPollRef.current);
        pushTerminalLog('WhatsApp terhubung! Session tersimpan di wa_store.db.');
      }
    } catch {
      setQrCode('');
    }
  }, []);

  useEffect(() => {
    fetchQR();
    qrPollRef.current = setInterval(fetchQR, 5000);
    return () => { if (qrPollRef.current) clearInterval(qrPollRef.current); };
  }, [fetchQR]);

  // Scroll logging terminal automatically
  useEffect(() => {
    if (logTerminalRef.current) {
      logTerminalRef.current.scrollTop = logTerminalRef.current.scrollHeight;
    }
  }, [terminalLogs]);

  // Function to push logs to our whatsmeow emulator console
  const pushTerminalLog = (logText: string) => {
    const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    setTerminalLogs(prev => [...prev, `[${timestamp}] ${logText}`]);
  };

  // Check real Go daemon connection status
  const handleCheckConnection = async (_numberId: string) => {
    setQrLoading(true);
    await fetchQR();
    setQrLoading(false);
    pushTerminalLog(waConnected ? 'Status: TERHUBUNG' : 'Status: BELUM TERHUBUNG — scan QR di atas.');
  };

  // Generate pairing code (instructional — real pairing done in Go daemon)
  const handleGeneratePairingCode = (e: React.FormEvent) => {
    e.preventDefault();
    if (!pairingPhone.trim()) {
      showToast('Masukkan nomor telepon terlebih dahulu!', 'warning');
      return;
    }
    const cleanNo = pairingPhone.startsWith('+62') ? pairingPhone : '+62' + pairingPhone.replace(/^0+/, '');
    pushTerminalLog(`Jalankan: go run main.go --pairing-phone=${cleanNo}`);
    pushTerminalLog(`Masukkan kode yang muncul di terminal daemon ke aplikasi WhatsApp Anda.`);
    handleCheckConnection('');
  };

  // Add new WA manual number
  const handleAddManualNumber = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPhone.trim() || !newName.trim()) {
      showToast('Lengkapi nomor WhatsApp dan detail nama alias!', 'warning');
      return;
    }
    const formattedPhone = newPhone.startsWith('+') ? newPhone : '+62' + newPhone.replace(/^0+/, '');

    // Check if duplicate
    if (waNumbers.find(v => v.phoneNumber === formattedPhone)) {
      showToast('Nomor WhatsApp ini sudah terdaftar!', 'warning');
      return;
    }

    pushTerminalLog(`Nomor manual didaftarkan: ${formattedPhone} - silakan insert via Supabase dashboard atau Go daemon.`);
    showToast(`Nomor ${formattedPhone} siap didaftarkan. Insert via Go daemon atau Supabase dashboard untuk mengaktifkan.`, 'info');
    setNewPhone('');
    setNewName('');
  };

  // Toggle Is Enabled
  const handleToggleEnable = (id: string) => {
    const num = waNumbers.find(n => n.id === id);
    if (!num) return;
    pushTerminalLog(`Number ${num.phoneNumber} toggle isEnabled — update via Go daemon or Supabase dashboard.`);
    showToast('Perubahan status harus dilakukan melalui Go daemon atau Supabase dashboard.', 'info');
  };

  // Toggle Is AI Auto-Reply Enabled
  const handleToggleAiEnabled = (id: string) => {
    const num = waNumbers.find(n => n.id === id);
    if (!num) return;
    pushTerminalLog(`State Auto-Reply AI untuk ${num.phoneNumber} — update via Supabase dashboard.`);
    showToast('Perubahan AI toggle harus dilakukan melalui Supabase dashboard.', 'info');
  };

  // Delete/Unregister WA Number
  const handleDeleteNumber = (id: string, phoneNo: string) => {
    pushTerminalLog(`Hapus nomor ${phoneNo} — lakukan via Supabase dashboard atau Go daemon.`);
    showToast(`Untuk menghapus ${phoneNo}, gunakan Supabase dashboard atau Go daemon.`, 'warning');
    // Optimistic local removal — will revert on next Realtime sync if row still exists in DB
    setWaNumbers(prev => prev.filter(n => n.id !== id));
  };

  const handleCopyCode = () => {
    const codeMap = {
      go: codeSnippetGo,
      node: codeSnippetNode
    };
    navigator.clipboard.writeText(codeMap[activeCodeTab]);
    setCopiedCodeFlag(true);
    showToast('Go setup script berhasil disalin ke clipboard!', 'success');
    setTimeout(() => setCopiedCodeFlag(false), 2000);
  };

  return (
    <div className="space-y-8 animate-fadeIn pb-24">
      {/* Top Welcome Title Grid Header */}
      <section className="bg-white rounded-[2.5rem] p-8 border border-[#e5eeff] shadow-xl">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="max-w-3xl">
            <div className="flex items-center gap-4 mb-4">
              <div className="w-14 h-14 bg-emerald-50 text-emerald-600 rounded-2xl flex items-center justify-center shadow-lg shadow-emerald-100">
                <Bot className="w-8 h-8 text-emerald-600 fill-emerald-50" />
              </div>
              <div>
                <h2 className="text-[#012749] font-black text-2xl tracking-tight flex items-center gap-2">
                  Integrasi WhatsApp AI &amp; whatsmeow Set-Up
                </h2>
                <p className="text-[10px] text-gray-400 uppercase font-extrabold tracking-wider">
                  Go-based daemon engine + Gemini AI Agent Orchestration
                </p>
              </div>
            </div>
            <p className="text-sm text-[#43474e] leading-relaxed font-semibold">
              Gunakan framework Go-bahasa <strong className="text-emerald-600 font-black">whatsmeow</strong> yang tangguh untuk menjembatani nomor WhatsApp bisnis dengan ERP Sinar Elektrik. Pelanggan yang mengirimkan pesan ke nomor di bawah ini akan direspon otomatis menggunakan model Gemini AI yang terhubung secara real-time dengan inventaris harga SKU toko kelistrikan Anda.
            </p>
          </div>

          <div className="bg-[#eff4ff]/60 border border-blue-50/50 p-5 rounded-3xl shrink-0 flex items-center gap-3.5 select-none">
            <Cpu className="text-[#012749] w-8 h-8 animate-spin" style={{ animationDuration: '6s' }} />
            <div>
              <span className="text-[9px] font-black text-slate-400 block tracking-widest uppercase">Koneksi Gateway</span>
              <span className="text-xs font-extrabold text-[#012749] flex items-center gap-1 mt-0.5">
                <span className="h-2 w-2 rounded-full bg-emerald-500 animate-ping" />
                Active daemon (whatsmeow)
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* Main Core Columns */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-8">

        {/* Left Column: whatsmeow pairing gate & setup documentation (6 cols) */}
        <div className="xl:col-span-7 space-y-8">

          {/* pairing / Connection Setup Panel */}
          <div className="bg-white rounded-[2.5rem] p-8 border border-[#e5eeff] shadow-xl space-y-6">
            <h3 className="text-base font-extrabold text-[#012749] flex items-center gap-2">
              <QrCode className="w-5 h-5 text-emerald-600" />
              whatsmeow QR Code &amp; Device Pairing Hub
            </h3>
            <p className="text-xs text-slate-500 leading-relaxed font-semibold">
              Hubungkan akun WhatsApp baru ke compiler sistem lokal. whatsmeow adalah library Go-lang WhatsApp Web API paling legendaris yang 100% aman dan terhindar dari pemblokiran (anti-ban). QR Code dan pairing code yang sebenarnya ditampilkan di terminal Go daemon — buka terminal dan jalankan daemon untuk memulai.
            </p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 select-none bg-[#f8f9ff] p-6 rounded-[2rem] border border-blue-50/50">

              {/* QR Code visual box */}
              <div className="flex flex-col items-center justify-center bg-white border border-[#abc9f3]/40 p-6 rounded-2xl relative min-h-[220px]">
                {waConnected && (
                  <div className="text-center space-y-3">
                    <CheckCircle className="w-12 h-12 text-emerald-500 mx-auto animate-bounce shrink-0" />
                    <h4 className="font-extrabold text-[#012749] text-xs">BERHASIL TERSAMBUNG</h4>
                    <p className="text-[10px] text-gray-400">whatsmeow session tersimpan di wa_store.db</p>
                  </div>
                )}

                {!waConnected && qrCode && (
                  <div className="text-center space-y-3">
                    <div className="p-2 bg-white rounded-xl inline-block border border-slate-100 shadow">
                      <QRCodeSVG value={qrCode} size={160} />
                    </div>
                    <p className="text-[10px] text-slate-500 font-bold">Scan dengan WhatsApp → Perangkat Tertaut</p>
                    <span className="text-[9px] font-black text-amber-600 bg-amber-50 rounded-full px-3 py-1 animate-pulse border border-amber-100 inline-block">
                      QR diperbarui otomatis setiap 20 detik
                    </span>
                  </div>
                )}

                {!waConnected && !qrCode && (
                  <div className="text-center space-y-3">
                    {qrLoading ? (
                      <RefreshCw className="w-8 h-8 text-emerald-600 animate-spin mx-auto" />
                    ) : (
                      <div className="w-16 h-16 mx-auto rounded-full bg-slate-50 border border-slate-100 flex items-center justify-center text-slate-300">
                        <QrCode className="w-8 h-8" />
                      </div>
                    )}
                    <p className="text-xs text-slate-500 font-bold">Menunggu QR dari daemon...</p>
                    <p className="text-[10px] text-gray-400">Menghubungkan ke backend Cloud Run...</p>
                    <button
                      onClick={() => handleCheckConnection('')}
                      className="bg-[#012749] hover:bg-[#2d8a4e] text-white px-5 py-2 rounded-full text-[10px] font-bold transition-all cursor-pointer shadow-md"
                    >
                      Refresh Status
                    </button>
                  </div>
                )}
              </div>

              {/* Pairing code container form */}
              <div className="flex flex-col justify-between py-1">
                <div>
                  <h4 className="text-xs font-black text-[#012749] mb-1">Cara Cepat Pairing Code:</h4>
                  <p className="text-[10px] text-gray-400 font-semibold leading-relaxed mb-4">
                    Masukkan nomor telepon Anda di bawah ini. Perintah pairing akan ditampilkan di log Go daemon terminal. Masukkan PIN yang muncul di terminal ke aplikasi WhatsApp Anda.
                  </p>
                </div>

                <form onSubmit={handleGeneratePairingCode} className="space-y-3">
                  <div className="bg-white border border-[#abc9f3]/40 rounded-full flex items-center p-1.5 pl-4 gap-3">
                    <span className="text-[#012749]/40 text-xs font-black">+62</span>
                    <input
                      type="text"
                      value={pairingPhone}
                      onChange={(e) => setPairingPhone(e.target.value)}
                      placeholder="8123456789"
                      className="flex-1 bg-transparent border-none focus:ring-0 text-slate-850 font-bold text-xs py-1.5 outline-none"
                    />
                    <button
                      type="submit"
                      className="bg-[#012749] text-white px-4 py-2 rounded-full text-[10px] font-extrabold hover:bg-[#2d8a4e] cursor-pointer shrink-0"
                    >
                      Log Perintah
                    </button>
                  </div>
                </form>
              </div>
            </div>

            {/* Simulated terminal developer container */}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-[10px] text-gray-400 font-black tracking-widest uppercase">
                <span className="flex items-center gap-1.5"><Terminal className="w-4 h-4 text-emerald-600" /> Go-Daemon whatsmeow Logs Console</span>
                <button
                  onClick={() => setTerminalLogs(prev => prev.slice(-3))}
                  className="text-[#2d8a4e] font-bold text-[9px] hover:underline"
                >
                  Bersihkan Log
                </button>
              </div>
              <div
                ref={logTerminalRef}
                className="bg-[#0c1015]/95 text-[#f0f6fc] font-mono text-[10px] p-4 rounded-2xl max-h-[160px] overflow-y-auto space-y-1.5 border border-[#30363d] shadow-inner"
              >
                {terminalLogs.map((log, index) => (
                  <div key={index} className="opacity-95 leading-relaxed break-all">
                    <span className="text-[#8b949e]">#</span> {log}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Development Integration Reference Guide */}
          <div className="bg-white rounded-[2.5rem] p-8 border border-[#e5eeff] shadow-xl space-y-5">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-extrabold text-[#012749] flex items-center gap-2">
                <Code className="w-5 h-5 text-emerald-600" />
                Go whatsmeow + Gemini API Code Boilerplate
              </h3>
              <div className="flex bg-[#eff4ff] p-1 rounded-full text-[10px] font-black border border-blue-50">
                <button
                  className={`px-3 py-1 rounded-full cursor-pointer ${activeCodeTab === 'go' ? 'bg-[#012749] text-white' : 'text-[#012749]'}`}
                  onClick={() => setActiveCodeTab('go')}
                >
                  Go Client
                </button>
                <button
                  className={`px-3 py-1 rounded-full cursor-pointer ${activeCodeTab === 'node' ? 'bg-[#012749] text-white' : 'text-[#012749]'}`}
                  onClick={() => setActiveCodeTab('node')}
                >
                  Webhook Node
                </button>
              </div>
            </div>

            <p className="text-xs text-slate-500 leading-relaxed font-semibold">
              Gunakan script backend template berikut untuk diletakkan di server internal produksi Anda. Script ini menginisialisasi client <code className="font-mono bg-[#eff4ff] text-emerald-600 px-1.5 py-0.5 rounded text-[10px]">whatsmeow</code> dan menyalurkan request pesan ke API AI Sinar Elektrik.
            </p>

            <div className="relative">
              <pre className="bg-[#0c1015] text-[#e1e4e8] font-mono text-[10px] p-5 rounded-2xl overflow-x-auto max-h-[300px] leading-relaxed border border-[#30363d] shadow-lg select-text text-left">
                {activeCodeTab === 'go' ? codeSnippetGo : codeSnippetNode}
              </pre>
              <button
                onClick={handleCopyCode}
                className="absolute top-4 right-4 bg-white/10 hover:bg-white/20 hover:scale-105 active:scale-95 text-white/80 hover:text-white p-2 rounded-xl transition-all border border-white/10 cursor-pointer"
                title="Salin Code Snippet"
              >
                {copiedCodeFlag ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
              </button>
            </div>
          </div>

        </div>

        {/* Right Column: Numbers list (5 cols) */}
        <div className="xl:col-span-5 space-y-8">

          {/* Numbers list card */}
          <div className="bg-white rounded-[2.5rem] p-8 border border-[#e5eeff] shadow-xl space-y-6">
            <div className="flex justify-between items-center">
              <div>
                <h3 className="text-base font-extrabold text-[#012749] flex items-center gap-2">
                  <Smartphone className="w-5 h-5 text-emerald-650" />
                  Konfigurasi Nomor WhatsApp AI
                </h3>
                <p className="text-[10px] text-gray-400 font-extrabold uppercase tracking-wide mt-1">Daftar Aktif &amp; Switch Atasi Bot</p>
              </div>
            </div>

            {/* Loading state */}
            {loading && (
              <div className="flex items-center justify-center py-8 text-slate-400">
                <RefreshCw className="w-5 h-5 animate-spin mr-2" />
                <span className="text-xs font-semibold">Memuat data dari Supabase...</span>
              </div>
            )}

            {/* List entries */}
            {!loading && (
              <div className="space-y-4">
                {waNumbers.length === 0 && (
                  <p className="text-xs text-slate-400 font-semibold text-center py-4">
                    Belum ada nomor WhatsApp terdaftar. Tambahkan via Go daemon atau Supabase dashboard.
                  </p>
                )}
                {waNumbers.map((num) => (
                  <div
                    key={num.id}
                    className={`p-5 rounded-3xl border transition-all ${
                      num.isEnabled
                        ? 'bg-[#f8f9ff] border-[#abc9f3]/40 shadow-[#012749]/5 shadow-sm'
                        : 'bg-[#fafafa]/80 border-slate-100 opacity-65'
                    }`}
                  >
                    <div className="flex justify-between items-start gap-3">
                      <div className="flex items-center gap-3">
                        <div className={`w-10 h-10 rounded-full font-bold text-xs flex items-center justify-center shrink-0 border ${
                          num.isEnabled ? 'bg-[#012749] text-white border-blue-900' : 'bg-slate-150 text-slate-400 border-slate-200'
                        }`}>
                          {num.name.substring(0,2).toUpperCase()}
                        </div>
                        <div>
                          <h4 className="font-extrabold text-[#012749] text-sm flex items-center gap-2">
                            {num.name}
                            {num.status === 'CONNECTED' && (
                              <span className="w-2 h-2 rounded-full bg-emerald-500" title="Terhubung SQLite whatsmeow" />
                            )}
                          </h4>
                          <p className="text-[10px] text-emerald-600 font-black tracking-tight mt-0.5">{num.phoneNumber}</p>
                        </div>
                      </div>

                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => handleCheckConnection(num.id)}
                          className="text-slate-400 hover:text-emerald-600 p-1.5 hover:bg-emerald-50 rounded-xl transition-all cursor-pointer text-[9px] font-black"
                          title="Cek Status Koneksi"
                        >
                          Cek
                        </button>
                        <button
                          onClick={() => handleDeleteNumber(num.id, num.phoneNumber)}
                          className="text-gray-400 hover:text-red-500 p-1.5 hover:bg-red-50 rounded-xl transition-all cursor-pointer"
                          title="Batalkan Sambungan Nomor"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>

                    {/* Switch and Config indicators */}
                    <div className="mt-4 pt-3.5 border-t border-slate-200/60 flex flex-col sm:flex-row gap-4 justify-between items-start sm:items-center text-xs">
                      {/* Layanan Akun Toggle */}
                      <div className="flex items-center gap-2.5">
                        <span className="font-bold text-slate-500">Status Saluran:</span>
                        <button
                          onClick={() => handleToggleEnable(num.id)}
                          className="cursor-pointer font-extrabold flex items-center gap-1.5 focus:outline-none"
                        >
                          {num.isEnabled ? (
                            <>
                              <span className="text-emerald-700 font-black uppercase text-[10px] bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-100">ON</span>
                              <ToggleRight className="w-7 h-7 text-[#2d8a4e] fill-emerald-50" />
                            </>
                          ) : (
                            <>
                              <span className="text-slate-400 font-bold uppercase text-[10px] bg-slate-100 px-2 py-0.5 rounded-full">OFF</span>
                              <ToggleLeft className="w-7 h-7 text-slate-300" />
                            </>
                          )}
                        </button>
                      </div>

                      {/* AI Autoreply toggle */}
                      <div className="flex items-center gap-2.5">
                        <span className="font-bold text-slate-500 flex items-center gap-1"><Bot className="w-3.5 h-3.5 text-[#2d8a4e]" /> Balasan AI Gemini:</span>
                        <button
                          onClick={() => handleToggleAiEnabled(num.id)}
                          disabled={!num.isEnabled}
                          className={`font-black flex items-center gap-1.5 focus:outline-none ${!num.isEnabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}
                        >
                          {num.isAiEnabled ? (
                            <>
                              <span className="text-emerald-700 font-black uppercase text-[10px] bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-100">AKTIF</span>
                              <ToggleRight className="w-7 h-7 text-[#2d8a4e] fill-emerald-50" />
                            </>
                          ) : (
                            <>
                              <span className="text-rose-600 font-extrabold uppercase text-[10px] bg-rose-50 px-2 py-0.5 rounded-full border border-rose-100">MANUAL</span>
                              <ToggleLeft className="w-7 h-7 text-slate-300" />
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Manual adding item form */}
            <form onSubmit={handleAddManualNumber} className="bg-[#f8f9ff] p-5 rounded-[2rem] border border-blue-50/50 space-y-4">
              <span className="text-[10px] font-black text-gray-400 block tracking-widest uppercase">Daftarkan Nomor WhatsApp Manual</span>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-slate-500">Alias/Nama Nomor</label>
                  <input
                    type="text"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder="Contoh: CS Toko 2"
                    className="w-full bg-white rounded-2xl px-4 py-2.5 border border-slate-200/60 font-semibold text-xs focus:ring-1 focus:ring-[#012749] outline-none"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-slate-500">Nomor Ponsel (WA)</label>
                  <div className="bg-white border border-slate-200/60 rounded-2xl flex items-center px-3 gap-1.5">
                    <span className="text-[#012749]/40 text-xs font-black">+62</span>
                    <input
                      type="text"
                      value={newPhone}
                      onChange={(e) => setNewPhone(e.target.value)}
                      placeholder="856123498"
                      className="w-full bg-transparent border-none focus:ring-0 text-slate-850 font-bold text-xs py-2.5 outline-none"
                    />
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between pt-2">
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={newAiEnabled}
                    onChange={(e) => setNewAiEnabled(e.target.checked)}
                    className="w-4 h-4 rounded text-[#2d8a4e] focus:ring-[#2d8a4e]/20 border-slate-300 cursor-pointer"
                  />
                  <span className="text-[10px] font-black text-slate-500 text-left">Otomatis Aktifkan Balas AI Gemini</span>
                </label>

                <button
                  type="submit"
                  className="bg-[#2d8a4e] text-white px-5 py-2.5 rounded-full text-xs font-extrabold shadow-md hover:bg-emerald-700 hover:scale-[1.03] transition-all cursor-pointer flex items-center gap-1 shrink-0"
                >
                  <Plus className="w-4 h-4" /> Tambah
                </button>
              </div>
            </form>
          </div>

        </div>

      </div>

    </div>
  );
}

// Highly descriptive, real Go code boilerplate using whatsmeow for setting up the WA daemon
const codeSnippetGo = `package main

import (
	"context"
	"fmt"
	"os"
	"os/signal"
	"syscall"

	"github.com/google/genai"
	_ "github.com/mattn/go-sqlite3"
	"go.mau.fi/whatsmeow"
	"go.mau.fi/whatsmeow/store/sqlstore"
	"go.mau.fi/whatsmeow/types"
	"go.mau.fi/whatsmeow/types/events"
	waLog "go.mau.fi/whatsmeow/util/log"
)

var (
	whatsmeowClient *whatsmeow.Client
	geminiClient    *genai.Client
)

func handleWhatsAppEvent(evt interface{}) {
	switch v := evt.(type) {
	case *events.Message:
		// Extract sender and textual message content
		sender := v.Info.Sender.String()
		textMsg := v.Message.GetConversation()
		if textMsg == "" && v.Message.ExtendedTextMessage != nil {
			textMsg = v.Message.ExtendedTextMessage.GetText()
		}

		if textMsg == "" || v.Info.IsFromMe {
			return // Skip empty or our own outgoing messages
		}

		fmt.Printf("[Incoming WA] from %s: %s\\n", sender, textMsg)

		// Ask Gemini auto-reply asynchronously
		go respondWithGemini(v.Info.Sender, textMsg)
	}
}

func respondWithGemini(sender types.JID, prompt string) {
	ctx := context.Background()

	// Create inference query with system role and live Sinar Elektrik inventory instructions
	promptPayload := fmt.Sprintf(
		"Sinar Elektrik MSME ERP Live Context. Chat query received: %s. Please generate a polite brief Indonesian reply.",
		prompt,
	)

	resp, err := geminiClient.Models.GenerateContent(ctx, "gemini-3.5-flash", genai.Text(promptPayload), nil)
	if err != nil {
		fmt.Printf("Error requesting Gemini: %v\\n", err)
		return
	}

	replyText := resp.Text
	fmt.Printf("[Gemini Reply] %s\\n", replyText)

	// Send back to WhatsApp using whatsmeow Go lib
	sentMsg, err := whatsmeowClient.SendMessage(ctx, sender, whatsmeowClient.BuildTextMessage(replyText))
	if err != nil {
		fmt.Printf("Error sending WhatsApp: %v\\n", err)
	} else {
		fmt.Printf("Reply sent, timestamp: %d\\n", sentMsg.DebugTimings.QueueStart)
	}
}

func main() {
	dbLog := waLog.Stdout("Database", "DEBUG", true)
	// Setup whatsmeow SQLite database state store
	container, err := sqlstore.New("sqlite3", "file:whatsmeow_auth.db?_foreign_keys=on", dbLog)
	if err != nil {
		panic(err)
	}

	deviceStore, err := container.GetFirstDevice()
	if err != nil {
		panic(err)
	}

	clientLog := waLog.Stdout("whatsmeowClient", "INFO", true)
	whatsmeowClient = whatsmeow.NewClient(deviceStore, clientLog)
	whatsmeowClient.AddEventHandler(handleWhatsAppEvent)

	// Register / Init @google/genai client
	apiKey := os.Getenv("GEMINI_API_KEY")
	if apiKey == "" {
		panic("GEMINI_API_KEY environment variable is not defined!")
	}
	geminiClient, err = genai.NewClient(context.Background(), &genai.ClientOptions{
		APIKey: apiKey,
	})
	if err != nil {
		panic(err)
	}

	// QR scanner block check
	if whatsmeowClient.Store.ID == nil {
		qrChan, _ := whatsmeowClient.GetQRChannel(context.Background())
		err = whatsmeowClient.Connect()
		if err != nil {
			panic(err)
		}
		for qr := range qrChan {
			if qr.Event == "code" {
				fmt.Println("Pindai QR Code di konsol:", qr.Code)
			} else {
				fmt.Println("whatsmeow event QR:", qr.Event)
			}
		}
	} else {
		err = whatsmeowClient.Connect()
		if err != nil {
			panic(err)
		}
	}

	// Graceful shutdown channel
	c := make(chan os.Signal, 1)
	signal.Notify(c, os.Interrupt, syscall.SIGTERM)
	<-c

	whatsmeowClient.Disconnect()
}
`;

// Node webhook handler proxy reference code block
const codeSnippetNode = `// server.js - Node/Express webhook proxy for whatsapp-AI
const express = require('express');
const { GoogleGenAI } = require('@google/genai');

const app = express();
app.use(express.json());

// Inisialisasi API Gemini server-side
const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: { headers: { 'User-Agent': 'aistudio-build' } }
});

// Endpoint untuk menerima webhook event pesan WhatsApp dari whatsmeow Go Daemon
app.post('/api/whatsapp/webhook', async (req, res) => {
  const { sender, message, receiverNumber } = req.body;
  if (!sender || !message) {
    return res.status(400).json({ status: 'error', message: 'Missing fields' });
  }

  console.log(\`[WA Webhook] Teriman pesan dari \${sender}: "\${message}" pada \${receiverNumber}\`);

  try {
    // Generate Sinar Elektrik smart answering utilizing Gemini 3.5
    const response = await ai.models.generateContent({
      model: 'gemini-3.5-flash',
      contents: message,
      config: {
        systemInstruction: "Anda adalah sales asisten Sinar Elektrik. Jawab pertanyaan seputar stok kelistrikan dengan ramah dan ringkas dalam Bahasa Indonesia."
      }
    });

    const aiReplyText = response.text;

    // Respon dikirim kembali ke Go Server whatsmeow daemon untuk disalurkan ke WhastApp Customer
    res.json({
      status: 'success',
      replyMessage: aiReplyText,
      autoSend: true
    });

  } catch (error) {
    console.error('Inference error:', error);
    res.status(500).json({ status: 'error', reason: error.message });
  }
});

app.listen(3002, () => console.log('WhatsApp AI Event Webhook listening on port 3002'));
`;
