/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { 
  Bot, 
  Smartphone, 
  QrCode, 
  Trash2, 
  Cpu, 
  Zap, 
  ToggleLeft, 
  ToggleRight, 
  Plus, 
  Terminal, 
  Send,
  Code,
  FileCode,
  CheckCircle,
  AlertTriangle,
  PlayCircle,
  Copy,
  Check,
  RefreshCw,
  Clock,
  User,
  ShieldCheck
} from 'lucide-react';
import { WhatsappAiNumber, StockItem } from '../types';

interface WhatsappAiScreenProps {
  stockList: StockItem[];
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
}

const DEFAULT_WA_NUMBERS: WhatsappAiNumber[] = [
  {
    id: 'wa_1',
    phoneNumber: '+6281299887766',
    name: 'CS Sinar Elektrik Utama',
    status: 'CONNECTED',
    isEnabled: true,
    isAiEnabled: true,
    createdAt: '22 Mei 2026'
  },
  {
    id: 'wa_2',
    phoneNumber: '+6281144556677',
    name: 'Grup Kontraktor Jawa Timur',
    status: 'CONNECTED',
    isEnabled: true,
    isAiEnabled: false,
    createdAt: '24 Mei 2026'
  },
  {
    id: 'wa_3',
    phoneNumber: '+6289912345678',
    name: 'Hotline Urgent Owner',
    status: 'DISCONNECTED',
    isEnabled: false,
    isAiEnabled: false,
    createdAt: '30 Mei 2026'
  }
];

export default function WhatsappAiScreen({ stockList, showToast }: WhatsappAiScreenProps) {
  // State for WhatsApp Numbers
  const [waNumbers, setWaNumbers] = useState<WhatsappAiNumber[]>(() => {
    const saved = localStorage.getItem('sinar_elektrik_wa_numbers');
    return saved ? JSON.parse(saved) : DEFAULT_WA_NUMBERS;
  });

  // State for Add Form
  const [newPhone, setNewPhone] = useState('');
  const [newName, setNewName] = useState('');
  const [newAiEnabled, setNewAiEnabled] = useState(true);

  // States for whatsmeow Setup Simulator
  const [isGeneratingQr, setIsGeneratingQr] = useState(false);
  const [qrState, setQrState] = useState<'IDLE' | 'SCANNING' | 'SUCCESS'>('IDLE');
  const [generatedPhoneCode, setGeneratedPhoneCode] = useState('');
  const [pairingPhone, setPairingPhone] = useState('');
  const [terminalLogs, setTerminalLogs] = useState<string[]>([
    '[SYSTEM] Initializing whatsmeow framework package... READY',
    '[SYSTEM] Client logged out. Secure session SQLite DB detected.',
    '[SYSTEM] Ready to establish SQLite auth state store.'
  ]);

  // States for Sandbox Simulator
  const [sandboxSelectedId, setSandboxSelectedId] = useState<string>(waNumbers[0]?.id || '');
  const [sandboxText, setSandboxText] = useState('');
  const [sandboxMessages, setSandboxMessages] = useState<Array<{ sender: 'user' | 'ai' | 'system'; text: string; time: string }>>([
    {
      sender: 'system',
      text: '📲 SIMULASI CHAT: Tulis pesan dari pelanggan di kolom bawah dan amati bagaimana system menjawab.',
      time: '09:00'
    }
  ]);
  const [isSandboxAiTyping, setIsSandboxAiTyping] = useState(false);

  // Active sandbox number
  const selectedWaNumber = waNumbers.find(num => num.id === sandboxSelectedId);

  // Ref for logging terminal scroll
  const logTerminalRef = useRef<HTMLDivElement>(null);
  const sandboxScrollRef = useRef<HTMLDivElement>(null);

  // Code snippet toggle state
  const [activeCodeTab, setActiveCodeTab] = useState<'go' | 'node'>('go');
  const [copiedCodeFlag, setCopiedCodeFlag] = useState(false);

  // Save changes to LocalStorage
  useEffect(() => {
    localStorage.setItem('sinar_elektrik_wa_numbers', JSON.stringify(waNumbers));
  }, [waNumbers]);

  // Scroll logging terminal automatically
  useEffect(() => {
    if (logTerminalRef.current) {
      logTerminalRef.current.scrollTop = logTerminalRef.current.scrollHeight;
    }
  }, [terminalLogs]);

  // Scroll sandbox automatically
  useEffect(() => {
    if (sandboxScrollRef.current) {
      sandboxScrollRef.current.scrollTop = sandboxScrollRef.current.scrollHeight;
    }
  }, [sandboxMessages, isSandboxAiTyping]);

  // Function to push logs to our whatsmeow emulator console
  const pushTerminalLog = (logText: string) => {
    const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    setTerminalLogs(prev => [...prev, `[${timestamp}] ${logText}`]);
  };

  // Setup/Pair number simulator via QR
  const handleTriggerQrGeneration = () => {
    if (isGeneratingQr) return;
    setIsGeneratingQr(true);
    setQrState('IDLE');
    setGeneratedPhoneCode('');
    pushTerminalLog('whatsmeow client requested QR Code block...');
    
    setTimeout(() => {
      setIsGeneratingQr(false);
      setQrState('SCANNING');
      pushTerminalLog('QR Code successfully generated matching Go whatsmeow channel hash.');
      
      // Auto-simulate scan after 5 seconds
      setTimeout(() => {
        setQrState('SUCCESS');
        const simulatedNo = '+62814' + Math.floor(10000000 + Math.random() * 90000000);
        pushTerminalLog(`[SUCCESS] scanned QR code correctly!`);
        pushTerminalLog(`Authenticated as ${simulatedNo}`);
        
        // Add scanned instance to WA numbers list
        const newInstance: WhatsappAiNumber = {
          id: 'wa_' + Date.now(),
          phoneNumber: simulatedNo,
          name: 'WhatsApp Web QR Scanner',
          status: 'CONNECTED',
          isEnabled: true,
          isAiEnabled: true,
          createdAt: new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })
        };
        setWaNumbers(prev => [...prev, newInstance]);
        showToast(`🎉 whatsmeow berhasil terhubung ke ${simulatedNo}!`, 'success');
      }, 5500);

    }, 1500);
  };

  // Generate pairing code
  const handleGeneratePairingCode = (e: React.FormEvent) => {
    e.preventDefault();
    if (!pairingPhone.trim()) {
      showToast('⚠️ Masukkan nomor telepon terlebih dahulu!', 'warning');
      return;
    }
    const cleanNo = pairingPhone.startsWith('+62') ? pairingPhone : '+62' + pairingPhone.replace(/^0+/, '');
    pushTerminalLog(`whatsmeow client request pairing code for target phone: ${cleanNo}`);
    
    setTimeout(() => {
      const code = generateRandomPairingCode();
      setGeneratedPhoneCode(code);
      pushTerminalLog(`[whatsmeow] SECURE CODE FOR ${cleanNo}: ${code}`);
      pushTerminalLog(`Masukkan kode di atas pada aplikasi WhatsApp ponsel Anda (Menu perangkat tertaut).`);
      
      // Simulate connection completion
      setTimeout(() => {
        // Find if this phone already exists, if not instantiate
        const existingIndex = waNumbers.findIndex(v => v.phoneNumber === cleanNo);
        if (existingIndex !== -1) {
          const updated = [...waNumbers];
          updated[existingIndex].status = 'CONNECTED';
          updated[existingIndex].isEnabled = true;
          setWaNumbers(updated);
        } else {
          const newNumber: WhatsappAiNumber = {
            id: 'wa_' + Date.now(),
            phoneNumber: cleanNo,
            name: `Device Link ${cleanNo.slice(-4)}`,
            status: 'CONNECTED',
            isEnabled: true,
            isAiEnabled: true,
            createdAt: new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })
          };
          setWaNumbers(prev => [...prev, newNumber]);
        }
        setGeneratedPhoneCode('');
        setPairingPhone('');
        showToast(`🎉 whatsmeow pairing code sukses tertaut pada ${cleanNo}!`, 'success');
        pushTerminalLog(`[SUCCESS] Client ${cleanNo} authenticated & initialized SQLite Auth Storage.`);
      }, 7050);

    }, 850);
  };

  const generateRandomPairingCode = () => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 4; i++) code += chars.charAt(Math.floor(Math.random() * chars.length));
    code += '-';
    for (let i = 0; i < 4; i++) code += chars.charAt(Math.floor(Math.random() * chars.length));
    return code;
  };

  // Add new WA manual number
  const handleAddManualNumber = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPhone.trim() || !newName.trim()) {
      showToast('⚠️ Lengkapi nomor WhatsApp dan detail nama alias!', 'warning');
      return;
    }
    const formattedPhone = newPhone.startsWith('+') ? newPhone : '+62' + newPhone.replace(/^0+/, '');
    
    // Check if duplicate
    if (waNumbers.find(v => v.phoneNumber === formattedPhone)) {
      showToast('⚠️ Nomor WhatsApp ini sudah terdaftar!', 'warning');
      return;
    }

    const newNumber: WhatsappAiNumber = {
      id: 'wa_' + Date.now(),
      phoneNumber: formattedPhone,
      name: newName,
      status: 'DISCONNECTED',
      isEnabled: true,
      isAiEnabled: newAiEnabled,
      createdAt: new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })
    };

    setWaNumbers(prev => [...prev, newNumber]);
    setNewPhone('');
    setNewName('');
    showToast(`📝 Nomor ${formattedPhone} berhasil ditambahkan! Silakan pasangkan dengan whatsmeow untuk mengaktifkan.`, 'success');
    pushTerminalLog(`Nomor manual didaftarkan ke DB: ${formattedPhone} - status: disconnected.`);
  };

  // Toggle Is Enabled
  const handleToggleEnable = (id: string) => {
    const updated = waNumbers.map(n => {
      if (n.id === id) {
        const nextEnabled = !n.isEnabled;
        pushTerminalLog(`Number ${n.phoneNumber} isEnabled set to ${nextEnabled}`);
        if (!nextEnabled) {
          return { ...n, isEnabled: nextEnabled, status: 'DISCONNECTED' as const };
        } else {
          return { ...n, isEnabled: nextEnabled };
        }
      }
      return n;
    });
    setWaNumbers(updated);
    showToast('⚙️ Status keaktifan nomor WhatsApp diperbarui!', 'success');
  };

  // Toggle Is AI Auto-Reply Enabled 
  const handleToggleAiEnabled = (id: string) => {
    const updated = waNumbers.map(n => {
      if (n.id === id) {
        const nextAi = !n.isAiEnabled;
        pushTerminalLog(`State Auto-Reply Gemini AI untuk ${n.phoneNumber} dirubah menjadi: ${nextAi ? 'AKTIF' : 'NONAKTIF'}`);
        return { ...n, isAiEnabled: nextAi };
      }
      return n;
    });
    setWaNumbers(updated);
    showToast('🤖 Konfigurasi kecerdasan AI diperbarui!', 'success');
  };

  // Delete/Unregister WA Number
  const handleDeleteNumber = (id: string, phoneNo: string) => {
    setWaNumbers(prev => prev.filter(n => n.id !== id));
    pushTerminalLog(`Menghapus tautan instances SQLite whatsmeow untuk: ${phoneNo}`);
    showToast(`🗑️ Sambungan WhatsApp ${phoneNo} dibatalkan dari platform.`, 'warning');
  };

  // Handle Sandbox Messaging Sim
  const handleSendSandboxSim = (e: React.FormEvent) => {
    e.preventDefault();
    if (!sandboxText.trim()) return;

    if (!selectedWaNumber) {
      showToast('⚠️ Silakan pilih nomor WhatsApp penerima di menu dropdown simulasi!', 'warning');
      return;
    }

    const currentMsg = sandboxText;
    const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    // Append user's payload
    const userPayload = {
      sender: 'user' as const,
      text: currentMsg,
      time: timestamp
    };

    setSandboxMessages(prev => [...prev, userPayload]);
    setSandboxText('');

    // Check if the number is enabled and online
    if (!selectedWaNumber.isEnabled) {
      setTimeout(() => {
        setSandboxMessages(prev => [...prev, {
          sender: 'system' as const,
          text: `❌ ERROR SENDING WA: Nomor WhatsApp [${selectedWaNumber.phoneNumber}] dinonaktifkan oleh Administrator Sinar Elektrik.`,
          time: timestamp
        }]);
      }, 600);
      return;
    }

    if (selectedWaNumber.status !== 'CONNECTED') {
      setTimeout(() => {
        setSandboxMessages(prev => [...prev, {
          sender: 'system' as const,
          text: `⚠️ WA PENDING: Koneksi whatsmeow untuk [${selectedWaNumber.phoneNumber}] sedang offline/belum terhubung dengan QR.`,
          time: timestamp
        }]);
      }, 700);
      return;
    }

    // Check if AI auto reply is enabled
    if (!selectedWaNumber.isAiEnabled) {
      setTimeout(() => {
        setSandboxMessages(prev => [...prev, {
          sender: 'system' as const,
          text: `👤 HUMAN INTERACTION MODE: Balasan otomatis dinonaktifkan untuk nomor ini. Laporan masuk dialihkan ke tab 'Sales Inbox' untuk ditangani staf admin secara manual.`,
          time: timestamp
        }]);
      }, 800);
      return;
    }

    // If AI auto reply is active, generate a highly contextual smart reply utilizing the stock list!
    setIsSandboxAiTyping(true);
    pushTerminalLog(`[INCOMING MESSAGE] from Client to ${selectedWaNumber.phoneNumber}: "${currentMsg}"`);
    pushTerminalLog(`[AI INFERENCE] Querying Sinar Elektrik Live Stock for response synthesis...`);

    setTimeout(() => {
      setIsSandboxAiTyping(false);
      const aiResponseText = generateSmartStockResponse(currentMsg, stockList);
      
      setSandboxMessages(prev => [...prev, {
        sender: 'ai' as const,
        text: aiResponseText,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      }]);

      pushTerminalLog(`[AI OUTGOING REPLY] Sent: "${aiResponseText.slice(0, 60)}..." successfully via whatsmeow thread.`);
    }, 1200);
  };

  const generateSmartStockResponse = (query: string, items: StockItem[]): string => {
    const text = query.toLowerCase();
    
    // General greetings
    const hasGreeting = text.includes('halo') || text.includes('pagi') || text.includes('siang') || text.includes('malam') || text.includes('bro') || text.includes('selamat');
    
    // Inventory matching
    let matchingItems = items.filter(item => {
      const nameParts = item.name.toLowerCase().split(' ');
      return nameParts.some(part => part.length > 2 && text.includes(part)) || text.includes(item.category.toLowerCase());
    });

    if (matchingItems.length > 0) {
      let response = `Halo Kak! Terima kasih telah menghubungi Sinar Elektrik MSME ERP ⚡. Terkait pertanyaan Kakak tentang produk tersebut, berikut ketersediaan stok kami:\n\n`;
      matchingItems.forEach(item => {
        response += `📦 *${item.name}* (SKU: ${item.sku})\n`;
        response += `   • *Harga*: Rp ${item.price.toLocaleString('id-ID')}\n`;
        response += `   • *Stok*: ${item.stock} Pcs • [${item.status === 'Sinkron' ? 'Ready Hari Ini' : 'Stok Menipis'}]\n\n`;
      });
      response += `Pemesanan sebelum jam 16:00 sore akan langsung kami kemas dan kirimkan hari ini menggunakan QRIS GPN, JNE, atau Instant Courier. Apakah diproses orderannya Kak? 😊`;
      return response;
    }

    if (text.includes('harga') || text.includes('berapa') || text.includes('pricelist') || text.includes('harga kabel')) {
      let response = `Halo Kak! Sinar Elektrik menyajikan pricing katalog kelistrikan real-time sebagai berikut:\n\n`;
      items.forEach(item => {
        response += `🔹 *${item.name}*: Rp ${item.price.toLocaleString('id-ID')} [Stok: ${item.stock}]\n`;
      });
      response += `\nAdakah item pelengkap kabel, panel, atau aksesoris sakelar lain yang ingin Anda pesan langsung?`;
      return response;
    }

    if (text.includes('kirim') || text.includes('ongkir') || text.includes('alamat') || text.includes('lokasi')) {
      return `Yth. Pelanggan, gudang Sinar Elektrik berlokasi di pusat kelistrikan Surabaya-Jakarta. Seluruh pemesanan diproses instan via GoSend, GrabExpress, JNE, maupun kargo langganan kontraktor Kakak. Pengiriman dilakukan maksimal jam 17:00 WIB. Ada alamat instalasi proyek yang bisa kami bantu hitungkan estimasi ongkirnya?`;
    }

    // Default polite fallback using model rules
    return `Yth. Pelanggan Sinar Elektrik ⚡, pesan Kakak telah disalin oleh system WhatsApp AI Sinar Elektrik. 

Untuk kenyamanan Anda, data inventaris toko terintegrasi langsung dengan database ERP. Jika ada pengerjaan panel atau pengerjaan grounding proyek, silakan sebutkan nama kabel/sakelar/ukuran panel yang dicari agar AI kami bisa mengonfirmasi harga instan dalam 1 detik!`;
  };

  const handleCopyCode = () => {
    const codeMap = {
      go: codeSnippetGo,
      node: codeSnippetNode
    };
    navigator.clipboard.writeText(codeMap[activeCodeTab]);
    setCopiedCodeFlag(true);
    showToast('📋 Go setup script berhasil disalin ke clipboard!', 'success');
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
              Hubungkan akun WhatsApp baru ke compiler sistem lokal. whatsmeow adalah library Go-lang WhatsApp Web API paling legendaris yang 100% aman dan terhindar dari pemblokiran (anti-ban).
            </p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 select-none bg-[#f8f9ff] p-6 rounded-[2rem] border border-blue-50/50">
              
              {/* QR Code visual box */}
              <div className="flex flex-col items-center justify-center bg-white border border-[#abc9f3]/40 p-6 rounded-2xl relative min-h-[220px]">
                {qrState === 'IDLE' && !isGeneratingQr && (
                  <div className="text-center space-y-3">
                    <div className="w-16 h-16 mx-auto rounded-full bg-slate-50 border border-slate-100 flex items-center justify-center text-slate-300">
                      <QrCode className="w-8 h-8" />
                    </div>
                    <button 
                      onClick={handleTriggerQrGeneration}
                      className="bg-[#012749] hover:bg-[#2d8a4e] text-white px-5 py-2.5 rounded-full text-xs font-bold transition-all cursor-pointer shadow-md inline-flex items-center gap-1"
                    >
                      Mulai scan QR
                    </button>
                    <p className="text-[10px] text-gray-400">Generate whatsmeow secure QR code</p>
                  </div>
                )}

                {isGeneratingQr && (
                  <div className="text-center space-y-3">
                    <RefreshCw className="w-8 h-8 text-emerald-600 animate-spin mx-auto" />
                    <p className="text-xs text-[#012749] font-bold">Menghubungi whatsmeow websocket...</p>
                  </div>
                )}

                {qrState === 'SCANNING' && (
                  <div className="text-center space-y-4">
                    {/* Beautiful QR placeholder */}
                    <div className="w-36 h-36 bg-[#eff4ff] border border-blue-105 rounded-xl flex items-center justify-center p-3 mx-auto relative overflow-hidden">
                      <div className="absolute top-1/2 left-0 right-0 h-0.5 bg-emerald-500 animate-bounce shadow-[0_0_10px_rgba(16,185,129,0.8)]" />
                      {/* Grid design recreating QR style */}
                      <div className="grid grid-cols-4 gap-2.5 w-full h-full opacity-60">
                        <div className="bg-[#012749] rounded" />
                        <div className="bg-[#012749] rounded" />
                        <div className="border-4 border-[#012749] rounded" />
                        <div className="bg-[#012749] rounded" />
                        <div className="border-4 border-[#012749] rounded" />
                        <div className="bg-[#012749] rounded" />
                        <div className="bg-[#012749] rounded" />
                        <div className="border-4 border-[#012749] rounded" />
                      </div>
                    </div>
                    <div>
                      <span className="text-[10px] block font-black text-amber-600 bg-amber-50 rounded-full px-4 py-1 animate-pulse border border-amber-100">
                        Pindai QR via WA Ponsel Anda
                      </span>
                    </div>
                  </div>
                )}

                {qrState === 'SUCCESS' && (
                  <div className="text-center space-y-3">
                    <CheckCircle className="w-12 h-12 text-emerald-500 mx-auto animate-bounce shrink-0" />
                    <h4 className="font-extrabold text-[#012749] text-xs">BERHASIL TERSAMBUNG</h4>
                    <p className="text-[10px] text-gray-400">whatsmeow session SQLite DB has saved credentials.</p>
                    <button 
                      onClick={() => setQrState('IDLE')}
                      className="text-[10px] text-[#2d8a4e] font-black underline hover:text-emerald-700"
                    >
                      Koneksikan baru
                    </button>
                  </div>
                )}
              </div>

              {/* Pairing code container form */}
              <div className="flex flex-col justify-between py-1">
                <div>
                  <h4 className="text-xs font-black text-[#012749] mb-1">Cara Cepat Pairing Code:</h4>
                  <p className="text-[10px] text-gray-400 font-semibold leading-relaxed mb-4">
                    Masukkan nomor telepon Anda di bawah ini jika enggan memindai QR Code, dan masukkan 8 digit PIN unik berikut di aplikasi WhatsApp Anda.
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
                      Ambil Code
                    </button>
                  </div>

                  {generatedPhoneCode && (
                    <div className="bg-[#eff4ff] border-2 border-dashed border-[#abc9f3] text-[#012749] rounded-2xl p-3 text-center">
                      <span className="text-[8px] font-black text-gray-400 block uppercase tracking-wider mb-1">Secure whatsmeow PIN Code</span>
                      <span className="font-mono text-lg font-black text-[#012749] tracking-widest">{generatedPhoneCode}</span>
                    </div>
                  )}
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

        {/* Right Column: Numbers list & active testing Sandbox (5 cols) */}
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

            {/* List entries */}
            <div className="space-y-4">
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

                    <button 
                      onClick={() => handleDeleteNumber(num.id, num.phoneNumber)}
                      className="text-gray-400 hover:text-red-500 p-1.5 hover:bg-red-50 rounded-xl transition-all cursor-pointer"
                      title="Batalkan Sambungan Nomor"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
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

            {/* Manual adding item form */}
            <form onSubmit={handleAddManualNumber} className="bg-[#f8f9ff] p-5 rounded-[2rem] border border-blue-50/50 space-y-4">
              <span className="text-[10px] font-black text-gray-400 block tracking-widest uppercase">➕ Daftarkan Nomor WhatsApp Manual</span>
              
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

          {/* Sandbox interactive preview emulator */}
          <div className="bg-white rounded-[2.5rem] p-8 border border-[#e5eeff] shadow-xl space-y-5">
            <div>
              <h3 className="text-base font-extrabold text-[#012749] flex items-center gap-2">
                <Bot className="w-5 h-5 text-emerald-600" />
                Simulator Chat Pelanggan WA (Sandbox)
              </h3>
              <p className="text-[10px] text-gray-400 font-extrabold uppercase mt-1">Uji Coba GPN Integrasi &amp; Respon AI</p>
            </div>

            <div className="space-y-4">
              <div className="flex items-center gap-3 bg-[#eff4ff]/60 px-4 py-2.5 rounded-2xl">
                <span className="text-[10px] font-bold text-slate-500 whitespace-nowrap">Kirim Ke WA:</span>
                <select 
                  value={sandboxSelectedId}
                  onChange={(e) => {
                    setSandboxSelectedId(e.target.value);
                    setSandboxMessages([{
                      sender: 'system',
                      text: `📲 Mengganti saluran simulasi. Menghubungi WhatsApp milik: [${waNumbers.find(v => v.id === e.target.value)?.name || 'Unknown'}]`,
                      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                    }]);
                  }}
                  className="w-full bg-transparent border-none text-xs font-black text-[#012749] focus:ring-0 select-none cursor-pointer outline-none p-0"
                >
                  {waNumbers.map((num) => (
                    <option key={num.id} value={num.id}>
                      {num.name} ({num.phoneNumber})
                    </option>
                  ))}
                </select>
              </div>

              {/* Chat bubbles container */}
              <div 
                ref={sandboxScrollRef}
                className="bg-[#f0f2f5] rounded-3xl p-4 h-[240px] overflow-y-auto space-y-4 shadow-inner border border-[#e5eeff]/10"
              >
                {sandboxMessages.map((msg, index) => {
                  if (msg.sender === 'system') {
                    return (
                      <div key={index} className="flex justify-center text-center">
                        <span className="text-[9px] font-extrabold bg-white/90 border border-[#abc9f3]/40 text-slate-500 rounded-lg px-4 py-1.5 max-w-[90%] leading-relaxed">
                          {msg.text}
                        </span>
                      </div>
                    );
                  }

                  const isAI = msg.sender === 'ai';
                  return (
                    <div key={index} className={`flex flex-col max-w-[85%] ${isAI ? 'ml-auto items-end text-right' : 'items-start text-left'}`}>
                      <div className={`p-3 rounded-2xl text-xs font-medium leading-relaxed shadow-sm border ${
                        isAI 
                          ? 'bg-[#d9fdd3] text-zinc-900 border-[#c4e9be] rounded-tr-none' 
                          : 'bg-white text-zinc-900 border-zinc-100 rounded-tl-none'
                      }`}>
                        {/* Preserve layout lines for WA mock-markup */}
                        <p className="whitespace-pre-wrap">{msg.text}</p>
                      </div>
                      <span className="text-[9px] text-gray-400 font-bold tracking-wider mt-1 px-1">{isAI ? 'Gemini AI Bot' : 'Pelanggan'} • {msg.time}</span>
                    </div>
                  );
                })}

                {isSandboxAiTyping && (
                  <div className="flex flex-col max-w-[85%] ml-auto items-end">
                    <div className="bg-[#d9fdd3] text-zinc-900 px-4 py-2.5 rounded-2xl rounded-tr-none flex items-center gap-1 border border-[#c4e9be]">
                      <span className="w-1 h-3 bg-zinc-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                      <span className="w-1 h-3 bg-zinc-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                      <span className="w-1 h-3 bg-zinc-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                    </div>
                    <span className="text-[8px] text-gray-400 font-bold block mt-1 tracking-widest uppercase">whatsmeow AI replying...</span>
                  </div>
                )}
              </div>

              {/* Chat typing form */}
              <form onSubmit={handleSendSandboxSim} className="flex items-center gap-2 bg-[#eff4ff] p-1.5 rounded-full pl-5 border border-[#abc9f3]/30">
                <input 
                  type="text" 
                  value={sandboxText}
                  onChange={(e) => setSandboxText(e.target.value)}
                  placeholder={`Kirim pesan untuk menguji AI...`}
                  className="flex-1 bg-transparent border-none text-xs font-bold text-slate-850 p-1.5 outline-none focus:ring-0"
                />
                <button 
                  type="submit"
                  disabled={!sandboxText.trim() || isSandboxAiTyping}
                  className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 transition-transform ${
                    sandboxText.trim() && !isSandboxAiTyping
                      ? 'bg-[#2d8a4e] hover:scale-105 cursor-pointer text-white shadow-md' 
                      : 'bg-slate-200 text-slate-400 cursor-not-allowed'
                  }`}
                >
                  <Send className="w-3.5 h-3.5 fill-current" />
                </button>
              </form>
              
              <div className="flex items-center gap-2 justify-center text-[9px] text-gray-400 font-semibold select-none">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
                <span>Simulasi sandbox ditenagai integrasi inventaris produk real-time.</span>
              </div>
            </div>
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
