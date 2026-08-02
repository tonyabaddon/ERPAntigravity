import React, { useState, useRef, useEffect } from 'react';
import { MessageSquare, Search, Send, PlusCircle, ChevronDown, ChevronUp } from 'lucide-react';
import { useRealtimeConversations, ConversationWithMessages } from '../hooks/useRealtimeConversations';
import type { DbMessage, ConversationState } from '../types';
import type { ActivePage } from '../types';
import { categorize, categoryCounts, type InboxCategory } from '../lib/salesInboxCategorize';
import { conversationService } from '../lib/supabaseClient';
import { getSignedChatMediaUrl } from '../lib/chatMediaSignedUrl';
import { extractErrorMessage } from '../lib/extractErrorMessage';

const CONV_STATE_DISPLAY: Record<string, { label: string; badgeClass: string }> = {
  GREETING:         { label: 'Sapa',             badgeClass: 'bg-violet-100 text-violet-700' },
  COLLECTING:       { label: 'Kumpul Data',       badgeClass: 'bg-blue-100 text-blue-700' },
  CLARIFYING:       { label: 'Klarifikasi',       badgeClass: 'bg-sky-100 text-sky-700' },
  STOCK_CHECK:      { label: 'Cek Stok',          badgeClass: 'bg-cyan-100 text-cyan-700' },
  CONFIRMING:       { label: 'Konfirmasi',         badgeClass: 'bg-amber-100 text-amber-700' },
  BOOKED:           { label: 'Perlu Konfirmasi Admin', badgeClass: 'bg-purple-100 text-purple-800' },
  TIMEOUT_REMINDER: { label: 'Follow-up',          badgeClass: 'bg-violet-100 text-violet-700' },
  APPROVED:         { label: 'Disetujui',          badgeClass: 'bg-teal-100 text-teal-700' },
  COMPLETED:        { label: 'Selesai',            badgeClass: 'bg-emerald-100 text-emerald-700' },
  CANCELLED:        { label: 'Dibatalkan',         badgeClass: 'bg-gray-100 text-gray-500' },
  ESCALATED_ADMIN:  { label: 'Butuh Admin',        badgeClass: 'bg-red-100 text-red-700' },
  ESCALATED_WIRING: { label: 'Eskalasi Wiring',    badgeClass: 'bg-orange-100 text-orange-700' },
  ADD_MORE:         { label: 'Tambah Item',         badgeClass: 'bg-indigo-100 text-indigo-700' },
  DELIVERY:         { label: 'Pengiriman',          badgeClass: 'bg-lime-100 text-lime-700' },
};

const STEPPER_STEPS = [
  { label: 'Sapa',           states: ['GREETING'] },
  { label: 'Kumpul Data',    states: ['COLLECTING', 'CLARIFYING'] },
  { label: 'Cek Stok',       states: ['STOCK_CHECK'] },
  { label: 'Konfirmasi',     states: ['CONFIRMING'] },
  { label: 'Konfirmasi Admin', states: ['BOOKED', 'TIMEOUT_REMINDER', 'APPROVED'] },
  { label: 'Selesai',        states: ['COMPLETED'] },
];

const OFF_PATH_STATES = new Set(['ESCALATED_ADMIN', 'ESCALATED_WIRING', 'CANCELLED']);

function getModeBanner(conv: ConversationWithMessages): {
  bg: string; text: string; btnLabel: string; makeActive: boolean; isLocked: boolean;
} {
  const lockedUntil = conv.state_locked_until ? new Date(conv.state_locked_until) : null;
  const isLocked = lockedUntil !== null && lockedUntil > new Date();

  if (isLocked) {
    return {
      bg: 'bg-emerald-700',
      text: `👤 Mode Admin · Status di-lock sampai ${lockedUntil!.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}`,
      btnLabel: 'Aktifkan AI Sekarang',
      makeActive: true,
      isLocked: true,
    };
  }
  if (conv.state === 'ESCALATED_ADMIN' || conv.state === 'ESCALATED_WIRING') {
    return {
      bg: 'bg-red-700',
      text: `🚨 ${CONV_STATE_DISPLAY[conv.state]?.label ?? conv.state} — AI dijeda otomatis`,
      btnLabel: 'Kembalikan ke AI',
      makeActive: true,
      isLocked: false,
    };
  }
  if (!conv.ai_active) {
    return { bg: 'bg-emerald-700', text: '👤 Mode Admin — AI dinonaktifkan', btnLabel: 'Aktifkan AI', makeActive: true, isLocked: false };
  }
  return {
    bg: 'bg-blue-700',
    text: `🤖 Dikelola AI · ${CONV_STATE_DISPLAY[conv.state]?.label ?? conv.state}`,
    btnLabel: 'Ambil Alih',
    makeActive: false,
    isLocked: false,
  };
}

function getAvatarColor(conv: ConversationWithMessages): string {
  if (conv.state === 'ESCALATED_ADMIN' || conv.state === 'ESCALATED_WIRING') return 'bg-red-600';
  if (conv.state === 'COMPLETED' || conv.state === 'CANCELLED') return 'bg-gray-400';
  if (conv.ai_active) return 'bg-[#012749]';
  return 'bg-[#2d8a4e]';
}

function getDisplayName(conv: ConversationWithMessages): string {
  return conv.collected_data.name || conv.customer_phone;
}

function getInitials(conv: ConversationWithMessages): string {
  return getDisplayName(conv).slice(0, 2).toUpperCase();
}

export default function SalesInboxScreen({
  onNavigate,
  userRole,
}: {
  onNavigate?: (page: ActivePage) => void;
  userRole: string | null;
}) {
  const { conversations, orders, paymentUploadedOrders, sendAdminMessage, sendAdminMedia, toggleAiControl, loading } =
    useRealtimeConversations();

  const canOverride = userRole === 'Owner' || userRole === 'Staff Admin Toko';

  const [activeChatId, setActiveChatId] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState<InboxCategory>('butuhAksi');
  const [inputText, setInputText] = useState('');
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [stateDropdownOpen, setStateDropdownOpen] = useState(false);
  // Force re-render every 60s to refresh lock countdown display
  const [, forceTick] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const activeChat = conversations.find(c => c.id === activeChatId) ?? null;
  const allOrders = [...orders, ...paymentUploadedOrders];
  const activeOrder = activeChat ? allOrders.find(o => o.conversation_id === activeChat.id) : null;

  useEffect(() => {
    if (!activeChatId && conversations.length > 0) {
      setActiveChatId(conversations[0].id);
    }
  }, [conversations, activeChatId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [activeChat?.messages.length, activeChatId]);

  // Re-render every 60 seconds to refresh lock countdown in header badge
  useEffect(() => {
    const id = setInterval(() => forceTick(t => t + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  const counts = categoryCounts(conversations);

  const filteredConvs = conversations.filter(conv => {
    const name = (conv.collected_data.name ?? '').toLowerCase();
    const q = searchQuery.toLowerCase();
    if (q && !conv.customer_phone.includes(q) && !name.includes(q)) return false;
    if (categorize(conv) !== activeCategory) return false;
    return true;
  });

  const handleSend = async () => {
    if (!inputText.trim() || !activeChatId || sending) return;
    const text = inputText.trim();
    // Clear input optimistically but be ready to restore on failure.
    setInputText('');
    setSending(true);
    setSendError(null);
    try {
      await sendAdminMessage(activeChatId, text);
    } catch (err) {
      // Restore the text so admin can retry — was silently lost on failure.
      setInputText(text);
      setSendError(extractErrorMessage(err));
    } finally {
      setSending(false);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !activeChatId || uploading) return;
    setUploading(true);
    setSendError(null);
    try {
      await sendAdminMedia(activeChatId, file);
      // Only clear picker on success — was clearing on failure too, so retry
      // required re-picking the file.
      e.target.value = '';
    } catch (err) {
      setSendError(`Upload gagal: ${extractErrorMessage(err)}`);
    } finally {
      setUploading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-gray-500 text-sm">
        Memuat percakapan...
      </div>
    );
  }

  return (
    <div className="flex h-full">
      {/* LEFT PANEL */}
      <div className="w-56 shrink-0 flex flex-col border-r border-gray-200 bg-gray-50">
        {/* Header */}
        <div className="bg-[#012749] text-white px-3 py-3 flex items-center gap-2 shrink-0">
          <MessageSquare className="w-4 h-4" />
          <span className="font-bold text-sm">Inbox AI</span>
          <span className="ml-auto bg-white/20 text-xs font-bold px-2 py-0.5 rounded-full">
            {conversations.length}
          </span>
        </div>

        {/* Search */}
        <div className="p-2 border-b border-gray-100 shrink-0">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-400" />
            <input
              className="w-full bg-white border border-gray-200 rounded-sm pl-7 pr-2 py-1.5 text-xs outline-none focus:border-[#012749]"
              placeholder="Cari..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
            />
          </div>
        </div>

        {/* Kategori list (Slack-style) */}
        <div className="border-b border-gray-100 shrink-0">
          <div className="px-3 pt-2 pb-1 text-[9px] font-bold uppercase tracking-widest text-gray-400">
            Kategori
          </div>
          {(
            [
              { id: 'butuhAksi', label: '🔴 Butuh Aksi', accent: 'red',     active: 'bg-red-50 border-l-red-500 text-red-700',         badge: 'bg-red-500 text-white' },
              { id: 'aiAktif',   label: '🔵 AI Aktif',   accent: 'blue',    active: 'bg-blue-50 border-l-blue-500 text-blue-700',      badge: 'bg-blue-500 text-white' },
              { id: 'menunggu',  label: '🟡 Menunggu',   accent: 'amber',   active: 'bg-amber-50 border-l-amber-500 text-amber-700',    badge: 'bg-amber-500 text-white' },
              { id: 'riwayat',   label: '✅ Riwayat',    accent: 'gray',    active: 'bg-gray-100 border-l-gray-400 text-gray-600',       badge: 'bg-gray-400 text-white' },
            ] as const
          ).map(({ id, label, active, badge }) => {
            const isActive = activeCategory === id;
            return (
              <button
                key={id}
                onClick={() => setActiveCategory(id)}
                className={`w-full px-3 py-2 flex items-center justify-between text-left border-l-[3px] ${
                  isActive ? active : 'border-l-transparent hover:bg-gray-100 text-gray-700'
                }`}
              >
                <span className={`text-xs ${isActive ? 'font-bold' : ''}`}>{label}</span>
                <span className={`text-[10px] font-bold px-1.5 rounded-full ${
                  isActive ? badge : 'bg-gray-200 text-gray-700'
                }`}>
                  {counts[id]}
                </span>
              </button>
            );
          })}
        </div>

        {/* Conversation list */}
        <div className="flex-1 overflow-y-auto divide-y divide-gray-100">
          {filteredConvs.length === 0 ? (
            <p className="text-center text-xs text-gray-400 mt-8 px-3">
              {searchQuery ? 'Tidak ada percakapan yang cocok.' : 'Belum ada percakapan.'}
            </p>
          ) : (
            filteredConvs.map(conv => {
              const isSelected = conv.id === activeChatId;
              const stateInfo = CONV_STATE_DISPLAY[conv.state];
              const lastMsg = conv.messages.at(-1);
              const lastTime = lastMsg
                ? new Date(lastMsg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                : '';
              return (
                <div
                  key={conv.id}
                  onClick={() => setActiveChatId(conv.id)}
                  className={`px-3 py-2.5 cursor-pointer hover:bg-gray-50 flex items-start gap-2 border-l-[3px] ${
                    isSelected ? 'bg-indigo-50 border-l-[#012749]' : 'border-l-transparent'
                  }`}
                >
                  <div
                    className={`w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0 ${getAvatarColor(conv)}`}
                  >
                    {getInitials(conv)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-1">
                      <span className="font-bold text-xs text-gray-800 truncate">{getDisplayName(conv)}</span>
                      <span className="text-[8px] text-gray-300 shrink-0">{lastTime}</span>
                    </div>
                    <p className="text-[10px] text-gray-400 truncate mt-0.5">
                      {lastMsg?.text || '...'}
                    </p>
                    {stateInfo && (
                      <span className={`inline-block mt-1 text-[8px] font-bold px-1.5 py-0.5 rounded-full ${stateInfo.badgeClass}`}>
                        {stateInfo.label}
                      </span>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* CENTER + RIGHT PANELS */}
      {activeChat ? (
        <>
          {/* CENTER PANEL */}
          <div className="flex-1 min-w-0 flex flex-col">
            {/* Chat header */}
            <div className="bg-[#012749] text-white px-4 py-2.5 flex items-center gap-2.5 shrink-0">
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${getAvatarColor(activeChat)}`}
              >
                {getInitials(activeChat)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-bold text-sm truncate">{getDisplayName(activeChat)}</div>
                <div className="text-[10px] opacity-60">{activeChat.customer_phone}</div>
              </div>
              {/* State badge — clickable dropdown trigger for canOverride users */}
              {(() => {
                const stateInfo = CONV_STATE_DISPLAY[activeChat.state];
                const lockedUntil = activeChat.state_locked_until ? new Date(activeChat.state_locked_until) : null;
                const minutesLeft = lockedUntil && lockedUntil > new Date()
                  ? Math.max(0, Math.ceil((lockedUntil.getTime() - Date.now()) / 60_000))
                  : null;
                return (
                  <div className="relative">
                    <button
                      disabled={!canOverride}
                      onClick={() => setStateDropdownOpen(o => !o)}
                      className={`flex items-center gap-1.5 text-[10px] font-bold px-3 py-1.5 rounded-full ${stateInfo?.badgeClass ?? 'bg-gray-100 text-gray-600'} ${canOverride ? 'hover:opacity-80 cursor-pointer' : 'cursor-default'}`}
                    >
                      {minutesLeft !== null && <span>🔒</span>}
                      {stateInfo?.label ?? activeChat.state}
                      {minutesLeft !== null && <span className="opacity-70">· {minutesLeft} min</span>}
                      {canOverride && (stateDropdownOpen
                        ? <ChevronUp className="w-3.5 h-3.5" />
                        : <ChevronDown className="w-3.5 h-3.5" />
                      )}
                    </button>
                    {stateDropdownOpen && canOverride && (
                      <StateOverrideDropdown
                        currentState={activeChat.state}
                        onPick={async (newState) => {
                          try {
                            await conversationService.manuallyOverrideConversationState(activeChat.id, newState);
                            setStateDropdownOpen(false);
                          } catch (e) {
                            alert(`Gagal ubah status: ${extractErrorMessage(e)}`);
                          }
                        }}
                        onClose={() => setStateDropdownOpen(false)}
                      />
                    )}
                  </div>
                );
              })()}
            </div>

            {/* Mode banner */}
            {(() => {
              const banner = getModeBanner(activeChat);
              return (
                <div className={`${banner.bg} text-white px-4 py-1.5 flex items-center justify-between text-xs shrink-0`}>
                  <span>{banner.text}</span>
                  <button
                    onClick={async () => {
                      if (banner.isLocked) {
                        try {
                          await conversationService.clearConversationLock(activeChat.id);
                        } catch (e) {
                          alert(`Gagal clear lock: ${extractErrorMessage(e)}`);
                        }
                      } else {
                        const isEscalated =
                          activeChat.state === 'ESCALATED_ADMIN' || activeChat.state === 'ESCALATED_WIRING';
                        toggleAiControl(activeChat.id, banner.makeActive, isEscalated ? 'COLLECTING' : undefined);
                      }
                    }}
                    className="bg-white/20 hover:bg-white/30 rounded-sm px-2 py-1 text-[10px] font-bold"
                  >
                    {banner.btnLabel}
                  </button>
                </div>
              );
            })()}

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-3 bg-[#f8f9ff] flex flex-col gap-2">
              {activeChat.messages.map(msg => (
                <ChatBubble key={msg.id} msg={msg} />
              ))}
              <div ref={bottomRef} />
            </div>

            {/* Input bar */}
            <div className="bg-white border-t border-gray-200 px-3 py-2 flex items-center gap-2 shrink-0">
              <input
                type="file"
                ref={fileInputRef}
                className="hidden"
                accept=".pdf,.png,.jpg,.jpeg,.gif,.xlsx,.xls,.doc,.docx"
                onChange={handleFileChange}
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                className="text-gray-400 hover:text-gray-600"
              >
                <PlusCircle className="w-4 h-4" />
              </button>
              <input
                className="flex-1 bg-gray-50 border border-gray-200 rounded-sm px-3 py-1.5 text-xs outline-none focus:border-[#012749]"
                placeholder="Ketik pesan admin..."
                value={inputText}
                onChange={e => setInputText(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && !e.shiftKey && handleSend()}
              />
              <button
                onClick={handleSend}
                disabled={!inputText.trim() || sending}
                className="bg-[#012749] text-white rounded-sm p-1.5 disabled:opacity-40"
              >
                <Send className="w-3.5 h-3.5" />
              </button>
            </div>
            {sendError && (
              <div
                className="mx-3 mb-2 text-[11px] text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1"
                role="alert"
              >
                Gagal kirim: {sendError}
              </div>
            )}
          </div>

          {/* RIGHT PANEL */}
          <RightPanel conv={activeChat} order={activeOrder} onNavigate={onNavigate ?? (() => {})} />
        </>
      ) : (
        <div className="flex-1 flex items-center justify-center text-gray-300">
          <div className="text-center">
            <MessageSquare className="w-10 h-10 mx-auto mb-2" />
            <p className="text-sm font-semibold text-gray-400">Pilih percakapan untuk mulai</p>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── State Override Dropdown ─────────────────────────────────────────────────

const ALL_CONV_STATES: ConversationState[] = [
  'GREETING', 'COLLECTING', 'CLARIFYING', 'STOCK_CHECK', 'CONFIRMING',
  'BOOKED', 'TIMEOUT_REMINDER', 'APPROVED', 'ADD_MORE', 'DELIVERY',
  'ESCALATED_ADMIN', 'ESCALATED_WIRING', 'COMPLETED', 'CANCELLED',
];
const TERMINAL_STATES: ConversationState[] = ['COMPLETED', 'CANCELLED'];

function StateOverrideDropdown({
  currentState,
  onPick,
  onClose,
}: {
  currentState: ConversationState;
  onPick: (s: ConversationState) => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onEsc);
    return () => document.removeEventListener('keydown', onEsc);
  }, [onClose]);

  return (
    <>
      <div className="fixed inset-0 z-10" onClick={onClose} />
      <div className="absolute top-full right-0 mt-1 bg-white text-gray-800 rounded-sm shadow-2xl border border-gray-200 w-64 z-20">
        <div className="px-3 py-2 border-b border-gray-100">
          <div className="text-[9px] font-bold uppercase tracking-wide text-gray-400">Ubah Status Manual</div>
          <div className="text-[10px] text-gray-500 mt-0.5">AI di-pause 15 menit. Admin handle balas. Auto-resume saat lock expire.</div>
        </div>
        <div className="max-h-56 overflow-y-auto py-1 text-xs">
          {ALL_CONV_STATES.map(s => {
            const info = CONV_STATE_DISPLAY[s];
            const isCurrent = s === currentState;
            const isTerminal = TERMINAL_STATES.includes(s);
            return (
              <button
                key={s}
                disabled={isTerminal || isCurrent}
                onClick={() => !isTerminal && !isCurrent && onPick(s)}
                className={`w-full text-left px-3 py-1.5 flex items-center gap-2 ${
                  isTerminal ? 'opacity-40 cursor-not-allowed' :
                  isCurrent ? 'bg-gray-100 cursor-default' :
                  'hover:bg-gray-50'
                }`}
              >
                <span className={`inline-block text-[8px] font-bold px-1.5 py-0.5 rounded-full ${info?.badgeClass ?? 'bg-gray-100 text-gray-600'}`}>
                  {info?.label ?? s}
                </span>
                <span className="text-gray-400 text-[9px] font-mono">
                  {s}{isCurrent ? ' · saat ini' : isTerminal ? ' · terminal' : ''}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </>
  );
}

// ─── Chat Bubble ─────────────────────────────────────────────────────────────

interface ChatBubbleProps { msg: DbMessage; }
const ChatBubble: React.FC<ChatBubbleProps> = ({ msg }) => {
  const time = new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  // Resolve chat-media URL (handles both legacy public URLs and new tenant-prefixed paths)
  // State machine: 'loading' → 'loaded' | 'error' (distinguishes "still loading" from "broken")
  const [mediaState, setMediaState] = useState<'loading' | 'loaded' | 'error'>('loading');
  const [resolvedMediaUrl, setResolvedMediaUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!msg.media_url) {
      setMediaState('error');
      setResolvedMediaUrl(null);
      return;
    }
    setMediaState('loading');
    setResolvedMediaUrl(null);
    getSignedChatMediaUrl(msg.media_url).then(url => {
      if (url) {
        setResolvedMediaUrl(url);
        setMediaState('loaded');
      } else {
        setMediaState('error');
      }
    });
  }, [msg.media_url]);

  if (msg.sender === 'system') {
    return (
      <div className="text-center text-[9px] text-gray-400 italic py-1">
        {msg.text}
      </div>
    );
  }

  const isCustomer = msg.sender === 'customer';
  const isAdmin = msg.sender === 'admin';

  const bubbleClass = isCustomer
    ? 'bg-white border border-gray-200 rounded-sm rounded-tl-none text-gray-800'
    : isAdmin
      ? 'bg-[#2d8a4e] text-white rounded-sm rounded-tr-none'
      : 'bg-[#012749] text-white rounded-sm rounded-tr-none';

  const senderLabel = isCustomer ? 'Pelanggan' : isAdmin ? '👤 Admin' : '🤖 AI';

  return (
    <div className={`flex ${isCustomer ? 'justify-start' : 'justify-end'}`}>
      <div className="flex flex-col" style={{ maxWidth: '68%' }}>
        <span className="text-[9px] text-gray-400 mb-0.5 px-1">{senderLabel}</span>
        <div className={`px-3 py-2 text-xs leading-relaxed ${bubbleClass}`}>
          {msg.media_url ? (
            <>
              {mediaState === 'loading' && (
                <span className="opacity-60">[lampiran memuat…]</span>
              )}
              {mediaState === 'error' && (
                <span className="text-red-400 opacity-80">[lampiran tidak tersedia]</span>
              )}
              {mediaState === 'loaded' && resolvedMediaUrl && (
                <a href={resolvedMediaUrl} target="_blank" rel="noreferrer" className="underline opacity-80">
                  [{msg.media_type?.toUpperCase() ?? 'FILE'} attachment]
                </a>
              )}
            </>
          ) : (
            msg.text
          )}
          <p className="text-[8px] opacity-60 mt-1 text-right">{time}</p>
        </div>
      </div>
    </div>
  );
};

// ─── Right Panel ──────────────────────────────────────────────────────────────

import type { DbOrder } from '../types';
import { formatIDR } from '../lib/formatIDR';

interface RightPanelProps {
  conv: ConversationWithMessages;
  order: DbOrder | null | undefined;
  onNavigate: (page: string) => void;
}
function RightPanel({ conv, order, onNavigate }: RightPanelProps) {
  const isOffPath = OFF_PATH_STATES.has(conv.state);
  const activeStep = isOffPath ? -1 : STEPPER_STEPS.findIndex(s => s.states.includes(conv.state));
  const cd = conv.collected_data;

  const dataFields: { icon: string; value: string }[] = [];
  if (cd.name) dataFields.push({ icon: '👤', value: cd.name });
  if (cd.company) dataFields.push({ icon: '🏢', value: cd.company });
  if (cd.product) {
    const qty = cd.quantity ? ` × ${cd.quantity}` : '';
    dataFields.push({ icon: '📦', value: `${cd.product}${qty}` });
  }
  if (cd.address) dataFields.push({ icon: '📍', value: cd.address });
  const specs = cd.specs;
  if (specs) {
    const parts = [specs.size, specs.color, specs.notes].filter(Boolean);
    if (parts.length > 0) dataFields.push({ icon: '📐', value: parts.join(', ') });
  }

  return (
    <div className="w-48 shrink-0 flex flex-col border-l border-gray-200 bg-white overflow-y-auto">
      {/* Header */}
      <div className="bg-gray-50 border-b border-gray-200 px-3 py-2 text-xs font-bold text-gray-600 shrink-0">
        📋 Konteks Percakapan
      </div>

      {/* Section: Alur */}
      <div className="px-3 py-2.5 border-b border-gray-100">
        <div className="text-[8px] font-bold text-gray-400 uppercase tracking-wide mb-2">Alur Percakapan</div>
        {isOffPath && (
          <div className={`text-[9px] font-bold px-2 py-0.5 rounded-full mb-2 inline-block ${CONV_STATE_DISPLAY[conv.state]?.badgeClass ?? ''}`}>
            {CONV_STATE_DISPLAY[conv.state]?.label ?? conv.state}
          </div>
        )}
        <div>
          {STEPPER_STEPS.map((step, i) => {
            const isDone = activeStep > i;
            const isActive = activeStep === i;
            return (
              <div key={i} className="flex items-start gap-2">
                <div className="flex flex-col items-center">
                  <div className={`w-2 h-2 rounded-full mt-0.5 shrink-0 ${
                    isDone ? 'bg-[#2d8a4e]' : isActive ? 'bg-amber-500 ring-2 ring-amber-200' : 'bg-gray-200'
                  }`} />
                  {i < STEPPER_STEPS.length - 1 && (
                    <div className={`w-px flex-1 min-h-[10px] ${isDone ? 'bg-[#2d8a4e]' : 'bg-gray-200'}`} />
                  )}
                </div>
                <div className={`text-[9px] pb-2 ${
                  isDone ? 'text-gray-400' : isActive ? 'font-bold text-amber-700' : 'text-gray-300'
                }`}>
                  {step.label}{isActive && ' ◀'}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Section: Data Terkumpul */}
      <div className="px-3 py-2.5 border-b border-gray-100">
        <div className="text-[8px] font-bold text-gray-400 uppercase tracking-wide mb-2">Data Terkumpul</div>
        {dataFields.length === 0 ? (
          <p className="text-[9px] text-gray-400 italic">Data belum terkumpul.</p>
        ) : (
          dataFields.map((f, i) => (
            <div key={i} className="flex items-start gap-1.5 mb-1">
              <span className="text-[10px] shrink-0">{f.icon}</span>
              <span className="text-[9px] text-gray-700 font-medium leading-snug">{f.value}</span>
            </div>
          ))
        )}
      </div>

      {/* Section: Pesanan Terkait */}
      <div className="px-3 py-2.5 border-b border-gray-100">
        <div className="text-[8px] font-bold text-gray-400 uppercase tracking-wide mb-2">Pesanan Terkait</div>
        {order ? (
          <div>
            <div className="font-mono text-[10px] font-bold text-[#012749]">
              {order.gjp_order_id ?? order.id.slice(0, 8)}
            </div>
            <div className="text-sm font-extrabold text-[#2d8a4e]">
              {formatIDR(order.total)}
            </div>
            <div className="text-[9px] text-gray-400 mt-0.5">
              {order.status.replace(/_/g, ' ')}
            </div>
            {order.status === 'PENDING_ADMIN_CONFIRMATION' && (
              <button
                onClick={() => onNavigate('order-history')}
                className="mt-2 w-full bg-purple-600 hover:bg-purple-700 text-white text-[9px] font-bold py-1.5 rounded-sm"
              >
                🔔 Konfirmasi Pesanan
              </button>
            )}
          </div>
        ) : (
          <p className="text-[9px] text-gray-400 italic">Belum ada pesanan.</p>
        )}
      </div>

      {/* Section: Follow-up */}
      <div className="px-3 py-2.5">
        <div className="text-[8px] font-bold text-gray-400 uppercase tracking-wide mb-2">Follow-up Otomatis</div>
        <div className="text-xs font-bold text-gray-700">{conv.followup_count_today} / 2</div>
        <div className="text-[9px] text-gray-400 mt-0.5">terkirim hari ini</div>
      </div>
    </div>
  );
}
