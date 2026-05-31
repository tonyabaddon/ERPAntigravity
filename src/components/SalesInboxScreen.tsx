/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect } from 'react';
import { 
  Search, 
  Bell, 
  Bot, 
  User, 
  ArrowLeftRight, 
  Phone, 
  MoreVertical, 
  Send, 
  Smile, 
  PlusCircle, 
  AlertCircle, 
  Receipt,
  Truck,
  CheckCircle,
  HelpCircle
} from 'lucide-react';
import { ChatItem, ChatStatusType, Message } from '../types';

interface SalesInboxScreenProps {
  chats: ChatItem[];
  onChatsUpdate: (updatedChats: ChatItem[]) => void;
}

export default function SalesInboxScreen({ chats, onChatsUpdate }: SalesInboxScreenProps) {
  const [activeFilter, setActiveFilter] = useState<'Semua' | 'Belum Dibaca' | 'Butuh Admin' | 'Dikelola AI'>('Semua');
  const [activeChatId, setActiveChatId] = useState<string>(chats[2]?.id || chats[0]?.id || '');
  const [searchQuery, setSearchQuery] = useState('');
  
  // Local text input for sending a message
  const [inputText, setInputText] = useState('');
  const [isAiTyping, setIsAiTyping] = useState(false);
  
  const bottomRef = useRef<HTMLDivElement>(null);

  // Scroll to bottom of chat on change
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [activeChatId, chats, isAiTyping]);

  // Find active chat object
  const activeChat = chats.find(c => c.id === activeChatId);

  // Filter messages based on tab category
  const filteredChats = chats.filter(chat => {
    // Search filter
    if (searchQuery && !chat.name.toLowerCase().includes(searchQuery.toLowerCase())) {
      return false;
    }

    if (activeFilter === 'Semua') return true;
    if (activeFilter === 'Belum Dibaca') return chat.unreadCount > 0;
    if (activeFilter === 'Butuh Admin') return chat.status === 'BUTUH_ADMIN' || chat.status === 'WIRING_CUSTOM';
    if (activeFilter === 'Dikelola AI') return chat.status === 'DIKELOLA_AI';
    return true;
  });

  // Toggle state handle: Swapping automated AI flow
  const handleToggleAi = (chatId: string) => {
    const updated = chats.map(c => {
      if (c.id === chatId) {
        const nextStatus: ChatStatusType = c.status === 'DIKELOLA_AI' ? 'BUTUH_ADMIN' : 'DIKELOLA_AI';
        const systemMsgText = nextStatus === 'DIKELOLA_AI' 
          ? '👤 SYSTEM: KOS berjalan kembali. AI MENGOTOMASI BALASAN.' 
          : '👤 SYSTEM: KASUS MEMERLUKAN PENANGANAN MANUSIA. AI MENGHENTIKAN OTOMATISASI.';
        
        const sysMsg: Message = {
          id: `sys_${Date.now()}`,
          sender: 'system',
          text: systemMsgText,
          time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        };

        return { 
          ...c, 
          status: nextStatus,
          messages: [...c.messages, sysMsg]
        };
      }
      return c;
    });
    onChatsUpdate(updated);
  };

  // Human agent message typing & sending
  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim() || !activeChat) return;

    const newMessage: Message = {
      id: `msg_${Date.now()}`,
      sender: 'admin', // human agent
      text: inputText,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };

    const updatedMessages = [...activeChat.messages, newMessage];

    // Reset unread count since we replied
    const updatedChats = chats.map(c => {
      if (c.id === activeChat.id) {
        return {
          ...c,
          unreadCount: 0,
          lastMessage: inputText,
          messages: updatedMessages
        };
      }
      return c;
    });

    onChatsUpdate(updatedChats);
    setInputText('');

    // If active chat is DIKELOLA_AI, simulate customer replying, or trigger AI response helper!
    if (activeChat.status === 'DIKELOLA_AI') {
      setIsAiTyping(true);
      setTimeout(() => {
        setIsAiTyping(false);
        const autoText = getSimulatedAiReply(inputText);
        const aiResponse: Message = {
          id: `ai_${Date.now()}`,
          sender: 'ai',
          text: autoText,
          time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        };

        onChatsUpdate(chats.map(c => {
          if (c.id === activeChat.id) {
            return {
              ...c,
              lastMessage: autoText,
              messages: [...updatedMessages, aiResponse]
            };
          }
          return c;
        }));
      }, 1500);
    }
  };

  // Helper script returning customized Indonesian replies
  const getSimulatedAiReply = (userMsg: string): string => {
    const text = userMsg.toLowerCase();
    if (text.includes('harga') || text.includes('berapa')) {
      return 'Halo Kak! Seluruh daftar nominal harga stok kami terintegrasi. Untuk Kabel Tembaga 40A harganya Rp 120.000, Box Panel kecil Rp 650.000, dan Sakelar Broco harganya Rp 25.000 saja. Ada yang bisa kami buatkan nota ordernya?';
    }
    if (text.includes('kirim') || text.includes('ongkir') || text.includes('kapan')) {
      return 'Barang akan dikirim hari ini juga Kak dari Sinar Elektrik jika pesanan diselesaikan sebelum jam 16:00 sore melalui kurir JNE, J&T atau Instant GoSend!';
    }
    if (text.includes('bayar') || text.includes('rek') || text.includes('transfer')) {
      return 'Tentu! Sinar Elektrik menyokong pembayaran instan via QRIS GPN dan virtual account. Apakah Kakak bersedia saya terbitkan Link Pembayarannya sekarang?';
    }
    return 'Pesanan Anda disalin dengan baik! Ada item tambahan instalasi kelistrikan lain yang bisa kami bantu sediakan untuk melengkapi pengiriman hari ini?';
  };

  // Quick Action: generate payment mock link
  const triggerQuickAction = (type: 'payment' | 'shipping' | 'ai') => {
    if (!activeChat) return;

    let sysText = '';
    let responseText = '';

    if (type === 'payment') {
      sysText = '🔗 SYSTEM: PEMBUATAN LINK PEMBAYARAN DI-UPDATE';
      responseText = `Halo Kak! Link Pembayaran Resmi untuk total pesanan sebesar Rp 237.500 telah berhasil dibuat oleh sistem Sinar Elektrik. Silakan click tautan ini untuk bayar instan via QRIS/VA: https://payment.sinarelektrik.com/pay/qris_8390293`;
    } else if (type === 'shipping') {
      sysText = '📦 SYSTEM: CEK STATUS KIRIMAN UTILITY RUNNING';
      responseText = `Yth. Customer, no resi kiriman Anda untuk order 10x Keripik Tempe Super adalah: JNE-905183901A. Paket terupdate per menit ini: "SEDANG DI-SORTIR DI HUB UTAMA SURABAYA". Estimasi tiba besok siang!`;
    } else {
      handleToggleAi(activeChat.id);
      return;
    }

    const sysMessage: Message = {
      id: `sys_${Date.now()}`,
      sender: 'system',
      text: sysText,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };

    const actionMessage: Message = {
      id: `act_${Date.now() + 1}`,
      sender: type === 'payment' ? 'ai' : 'admin',
      text: responseText,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };

    onChatsUpdate(chats.map(c => {
      if (c.id === activeChat.id) {
        return {
          ...c,
          lastMessage: responseText,
          messages: [...c.messages, sysMessage, actionMessage]
        };
      }
      return c;
    }));
  };

  return (
    <div className="flex-1 flex flex-col lg:flex-row gap-6 h-[calc(100vh-140px)] overflow-hidden animate-fadeIn">
      
      {/* Left List Card panel Column */}
      <section className="w-full lg:w-[35%] flex flex-col gap-4 overflow-hidden h-full">
        {/* Search Inputs */}
        <div className="relative">
          <input 
            type="text" 
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-[#eff4ff] rounded-full px-6 py-3 border-none focus:ring-2 focus:ring-[#012749]/20 transition-all text-sm placeholder:text-gray-400 font-semibold"
            placeholder="Cari nama percakapan..."
          />
          <Search className="w-4 h-4 text-slate-400 absolute right-5 top-1/2 -translate-y-1/2" />
        </div>

        {/* Categories filters */}
        <div className="flex gap-2 mb-2 overflow-x-auto hide-scrollbar whitespace-nowrap px-1 py-1 shrink-0 select-none">
          {(['Semua', 'Belum Dibaca', 'Butuh Admin', 'Dikelola AI'] as const).map((filter) => {
            const isActive = activeFilter === filter;
            return (
              <button
                key={filter}
                onClick={() => setActiveFilter(filter)}
                className={`px-4 py-2 text-xs font-bold rounded-full transition-all cursor-pointer ${
                  isActive 
                    ? 'bg-[#012749] text-white shadow-lg shadow-[#012749]/15' 
                    : 'bg-white text-[#1e3d60] border border-blue-100 hover:bg-[#eff4ff]'
                }`}
              >
                {filter}
              </button>
            );
          })}
        </div>

        {/* Chats Stack */}
        <div className="flex-1 overflow-y-auto pr-1 space-y-3 hide-scrollbar pb-10">
          {filteredChats.length === 0 ? (
            <div className="bg-white rounded-3xl p-8 text-center border border-blue-50/50">
              <p className="text-slate-400 text-sm font-semibold">Tidak ditemukan percakapan.</p>
            </div>
          ) : (
            filteredChats.map((chat) => {
              const isSelected = chat.id === activeChatId;
              const hasUnread = chat.unreadCount > 0;
              
              // Status badges logic
              let statusLabel = '';
              let statusStyle = '';
              
              if (chat.status === 'BUTUH_ADMIN') {
                statusLabel = 'BUTUH ADMIN';
                statusStyle = 'bg-rose-500 text-white animate-pulse';
              } else if (chat.status === 'WIRING_CUSTOM') {
                statusLabel = 'WIRING / CUSTOM';
                statusStyle = 'bg-orange-500 text-white';
              } else {
                statusLabel = 'DIKELOLA AI';
                statusStyle = 'bg-emerald-50 text-emerald-700 border border-emerald-200';
              }

              return (
                <div
                  key={chat.id}
                  onClick={() => {
                    setActiveChatId(chat.id);
                    // Reset unread count upon click
                    onChatsUpdate(chats.map(c => c.id === chat.id ? { ...c, unreadCount: 0 } : c));
                  }}
                  className={`p-5 rounded-3xl border transition-all cursor-pointer relative overflow-hidden group hover:scale-[1.01] ${
                    isSelected 
                      ? 'bg-white shadow-2xl shadow-primary/10 border-[#abc9f3] ring-1 ring-blue-100' 
                      : 'bg-white/60 hover:bg-white border-transparent shadow-[#012749]/5 hover:shadow-lg'
                  }`}
                >
                  {/* Glowing alert ping */}
                  {hasUnread && (
                    <div className="absolute top-4 right-4 flex h-2.5 w-2.5">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500"></span>
                    </div>
                  )}

                  <div className="flex justify-between items-start mb-3">
                    <div className="flex items-center gap-3">
                      <div className={`w-11 h-11 rounded-full font-bold text-sm flex items-center justify-center shrink-0 border ${
                        isSelected ? 'bg-[#012749] text-white' : 'bg-[#e5eeff] text-[#012749]'
                      }`}>
                        {chat.initials}
                      </div>
                      <div>
                        <h4 className="font-extrabold text-[#012749] text-sm group-hover:text-[#2d8a4e] transition-colors">{chat.name}</h4>
                        <p className="text-[10px] text-gray-400 font-semibold mt-0.5">{chat.date} • {chat.time}</p>
                      </div>
                    </div>
                    
                    <span className={`px-2.5 py-0.5 rounded-full text-[8px] font-black uppercase tracking-wider ${statusStyle}`}>
                      {statusLabel}
                    </span>
                  </div>

                  <p className="text-xs text-slate-500 line-clamp-1 font-medium leading-relaxed">
                    {chat.lastMessage}
                  </p>
                </div>
              );
            })
          )}
        </div>
      </section>

      {/* Right Column Conversation box section */}
      <section className="flex-1 bg-white rounded-3xl border border-[#e5eeff] shadow-2xl shadow-primary/5 flex flex-col overflow-hidden relative min-h-0">
        {activeChat ? (
          <>
            {/* Header section of Active Chat */}
            <div className="px-6 py-4 border-b border-[#eff4ff] flex justify-between items-center bg-white/60 backdrop-blur-md z-10 shrink-0 select-none">
              <div className="flex items-center gap-3">
                <div className="relative">
                  <div className="w-12 h-12 rounded-full bg-[#012749] text-white font-black flex items-center justify-center text-base">
                    {activeChat.initials}
                  </div>
                  <div className={`absolute bottom-0 right-0 w-3.5 h-3.5 border-2 border-white rounded-full ${
                    activeChat.status === 'DIKELOLA_AI' ? 'bg-[#2d8a4e]' : 'bg-rose-500'
                  }`} />
                </div>
                <div>
                  <h3 className="font-bold text-[#012749] text-base">{activeChat.name}</h3>
                  <p className="text-xs font-bold text-[#2d8a4e] flex items-center gap-1 mt-0.5">
                    {activeChat.status === 'DIKELOLA_AI' ? (
                      <>
                        <Bot className="w-3.5 h-3.5 fill-emerald-100" /> Dikelola AI Aktif
                      </>
                    ) : (
                      <span className="text-rose-600 font-medium flex items-center gap-1">
                        <User className="w-3.5 h-3.5" /> Pengambilalihan Manual Admin
                      </span>
                    )}
                  </p>
                </div>
              </div>

              {/* Header override controls panel */}
              <div className="flex items-center gap-2">
                <button 
                  onClick={() => handleToggleAi(activeChat.id)}
                  className={`px-4 py-2 rounded-full text-xs font-black shadow-md cursor-pointer flex items-center gap-1.5 transition-all outline-none ${
                    activeChat.status === 'DIKELOLA_AI'
                      ? 'bg-rose-600 text-white hover:bg-rose-700'
                      : 'bg-[#2d8a4e] text-white hover:bg-emerald-700'
                  }`}
                >
                  <ArrowLeftRight className="w-3.5 h-3.5" />
                  {activeChat.status === 'DIKELOLA_AI' ? 'Alihkan ke Admin' : 'Aktifkan AI Bot'}
                </button>
                <button className="w-9 h-9 rounded-full bg-[#eff4ff] flex items-center justify-center text-blue-900 hover:bg-[#d5e4ff] transition-all cursor-pointer">
                  <Phone className="w-4 h-4" />
                </button>
                <button className="w-9 h-9 rounded-full bg-[#eff4ff] flex items-center justify-center text-blue-900 hover:bg-[#d5e4ff] transition-all cursor-pointer">
                  <MoreVertical className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Conversation Log screen bubbles */}
            <div className="flex-1 overflow-y-auto p-6 space-y-6 bg-gradient-to-b from-[#e5eeff]/10 to-white">
              {activeChat.messages.map((msg) => {
                if (msg.sender === 'system') {
                  return (
                    <div key={msg.id} className="w-full flex justify-center my-4 animate-fadeIn">
                      <div className="bg-white/95 border border-[#abc9f3] px-6 py-2.5 rounded-full flex items-center gap-2 shadow-xl shadow-[#012749]/5 max-w-[90%] text-center">
                        <AlertCircle className="w-4 h-4 text-[#012749]" />
                        <span className="text-[10px] font-bold text-[#012749] tracking-wider uppercase leading-none">
                          {msg.text}
                        </span>
                      </div>
                    </div>
                  );
                }

                const isMe = msg.sender === 'admin' || msg.sender === 'ai';
                return (
                  <div 
                    key={msg.id} 
                    className={`flex flex-col max-w-[75%] gap-1.5 ${isMe ? 'items-end self-end ml-auto' : 'items-start'}`}
                  >
                    <div className={`px-5 py-3 rounded-full relative shadow-sm border ${
                      isMe 
                        ? msg.sender === 'ai'
                          ? 'bg-[#012749] text-white border-blue-950 rounded-br-none'
                          : 'bg-[#1e3d60] text-white border-blue-900 rounded-br-none'
                        : 'bg-[#eff4ff] text-[#012749] border-blue-50 rounded-bl-none'
                    }`}>
                      <p className="text-sm leading-relaxed text-left font-medium">{msg.text}</p>
                    </div>

                    <div className="flex items-center gap-1.5 text-[9px] text-[#43474e] font-bold tracking-wider px-2">
                      {msg.sender === 'ai' && <Bot className="w-3.5 h-3.5 text-[#2d8a4e]" />}
                      <span>{msg.sender === 'ai' ? 'ASISTEN AI' : msg.sender === 'admin' ? 'STAFF ADMIN' : 'PELANGGAN'} • {msg.time}</span>
                    </div>
                  </div>
                );
              })}

              {/* Bot typing simulation visual */}
              {isAiTyping && (
                <div className="flex flex-col max-w-[70%] items-end self-end ml-auto gap-1">
                  <div className="bg-[#012749] text-white px-5 py-3 rounded-3xl rounded-br-none flex items-center gap-1">
                    <span className="w-1.5 h-1.5 bg-white/70 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                    <span className="w-1.5 h-1.5 bg-white/70 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                    <span className="w-1.5 h-1.5 bg-white/70 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                  </div>
                  <span className="text-[9px] text-gray-400 font-bold tracking-widest px-2">ASISTEN AI SEDANG BERPIKIR...</span>
                </div>
              )}

              <div ref={bottomRef} className="h-2" />
            </div>

            {/* Quick Actions overlay bar */}
            <div className="absolute bottom-24 left-1/2 -translate-x-1/2 flex gap-3 w-full justify-center px-6 pointer-events-auto select-none overflow-x-auto hide-scrollbar z-10">
              <button 
                onClick={() => triggerQuickAction('payment')}
                className="bg-white border border-[#abc9f3] px-5 py-2.5 rounded-full text-xs font-black text-[#1e3d60] hover:bg-[#eff4ff] transition-all flex items-center gap-1.5 shadow-xl shadow-[#012749]/10 shrink-0 cursor-pointer hover:-translate-y-0.5"
              >
                <Receipt className="w-3.5 h-3.5" /> Buat Link Pembayaran
              </button>
              <button 
                onClick={() => triggerQuickAction('shipping')}
                className="bg-white border border-[#abc9f3] px-5 py-2.5 rounded-full text-xs font-black text-[#1e3d60] hover:bg-[#eff4ff] transition-all flex items-center gap-1.5 shadow-xl shadow-[#012749]/10 shrink-0 cursor-pointer hover:-translate-y-0.5"
              >
                <Truck className="w-3.5 h-3.5" /> status Kiriman
              </button>
              <button 
                onClick={() => triggerQuickAction('ai')}
                className="bg-[#2d8a4e] text-white px-5 py-2.5 rounded-full text-xs font-black hover:bg-[#005227] transition-all flex items-center gap-1.5 shadow-xl shadow-[#2d8a4e]/20 shrink-0 cursor-pointer hover:-translate-y-0.5 animate-pulse"
              >
                <Bot className="w-3.5 h-3.5 text-emerald-200" /> Alihkan ke AI
              </button>
            </div>

            {/* Typing input forms bar */}
            <form onSubmit={handleSendMessage} className="p-5 bg-white border-t border-[#eff4ff] shrink-0">
              <div className="bg-[#eff4ff] rounded-full flex items-center p-1.5 pl-6 gap-3 shadow-inner">
                <button type="button" className="text-[#102a43] hover:text-[#2d8a4e] cursor-pointer">
                  <PlusCircle className="w-5 h-5" />
                </button>
                <input 
                  type="text"
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  placeholder={`Ketik pesan balasan untuk ${activeChat.name}...`}
                  className="flex-1 bg-transparent border-none focus:ring-0 text-slate-800 font-semibold text-sm py-2.5 outline-none"
                />
                <button type="button" className="text-[#102a43] hover:text-[#2d8a4e] cursor-pointer">
                  <Smile className="w-5 h-5" />
                </button>
                
                <button 
                  type="submit"
                  disabled={!inputText.trim()}
                  className={`w-11 h-11 rounded-full flex items-center justify-center transition-all ${
                    inputText.trim() 
                      ? 'bg-[#2d8a4e] text-white shadow-md hover:scale-105 cursor-pointer' 
                      : 'bg-gray-200 text-gray-400 cursor-not-allowed'
                  }`}
                >
                  <Send className="w-4 h-4 fill-current" />
                </button>
              </div>
            </form>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-center p-10">
            <Bot className="w-16 h-16 text-slate-300 mb-4 animate-bounce" />
            <h3 className="font-bold text-[#012749]">Pilih Percakapan</h3>
            <p className="text-slate-400 text-xs mt-1.5">Pilih salah satu customer untuk melangsungkan interaksi.</p>
          </div>
        )}
      </section>
    </div>
  );
}
