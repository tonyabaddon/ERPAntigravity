import React, { useState, useRef, useEffect } from 'react';
import {
  Search, ArrowLeftRight, Send, PlusCircle
} from 'lucide-react';
import { useRealtimeConversations, ConversationWithMessages } from '../hooks/useRealtimeConversations';
import type { DbMessage } from '../types';

interface SalesInboxScreenProps {
  // Props are now empty — all data comes from the hook.
}

function getStatusInfo(conv: ConversationWithMessages): { label: string; className: string } {
  const s = conv.state;
  if (s === 'ESCALATED_ADMIN') return { label: 'Butuh Admin', className: 'bg-red-100 text-red-700' };
  if (s === 'ESCALATED_WIRING') return { label: 'Wiring', className: 'bg-yellow-100 text-yellow-700' };
  if (s === 'BOOKED')
    return { label: 'Menunggu Bayar', className: 'bg-amber-100 text-amber-700' };
  if (s === 'COMPLETED')
    return { label: 'Selesai', className: 'bg-emerald-100 text-emerald-700' };
  if (s === 'CANCELLED')
    return { label: 'Batal', className: 'bg-gray-100 text-gray-500' };
  if (!conv.ai_active)
    return { label: 'Manual', className: 'bg-orange-100 text-orange-700' };
  return { label: 'AI', className: 'bg-blue-100 text-blue-700' };
}

export default function SalesInboxScreen(_props: SalesInboxScreenProps) {
  const { conversations, orders, paymentUploadedOrders, sendAdminMessage, sendAdminMedia, toggleAiControl, loading } = useRealtimeConversations();

  const [activeFilter, setActiveFilter] = useState<'Semua' | 'Butuh Admin' | 'Dikelola AI'>('Semua');
  const [activeChatId, setActiveChatId] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState('');
  const [inputText, setInputText] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const activeChat = conversations.find(c => c.id === activeChatId);
  const allOrders = [...orders, ...paymentUploadedOrders];
  const activeOrder = allOrders.find(o => o.conversation_id === activeChatId);

  // Auto-select first conversation
  useEffect(() => {
    if (!activeChatId && conversations.length > 0) {
      setActiveChatId(conversations[0].id);
    }
  }, [conversations, activeChatId]);

  // Scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [activeChat?.messages.length, activeChatId]);

  const filteredChats = conversations.filter(conv => {
    if (searchQuery && !conv.customer_phone.includes(searchQuery) &&
        !(conv.collected_data.name ?? '').toLowerCase().includes(searchQuery.toLowerCase())) {
      return false;
    }
    if (activeFilter === 'Semua') return true;
    if (activeFilter === 'Butuh Admin') {
      return conv.state === 'ESCALATED_ADMIN' || conv.state === 'ESCALATED_WIRING' || !conv.ai_active;
    }
    if (activeFilter === 'Dikelola AI') return conv.ai_active &&
      conv.state !== 'ESCALATED_ADMIN' && conv.state !== 'ESCALATED_WIRING';
    return true;
  });

  const handleSend = async () => {
    if (!inputText.trim() || !activeChatId) return;
    const text = inputText.trim();
    setInputText('');
    await sendAdminMessage(activeChatId, text);
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !activeChatId) return;
    await sendAdminMedia(activeChatId, file);
    e.target.value = '';
  };

  const handleToggleAi = async (conv: ConversationWithMessages) => {
    await toggleAiControl(conv.id, !conv.ai_active);
  };

  const getDisplayName = (conv: ConversationWithMessages) =>
    conv.collected_data.name || conv.customer_phone;

  const getInitials = (conv: ConversationWithMessages) => {
    const name = getDisplayName(conv);
    return name.slice(0, 2).toUpperCase();
  };

  const getLastMessage = (conv: ConversationWithMessages) =>
    conv.messages.at(-1)?.text || '...';

  const statusBadge = (conv: ConversationWithMessages) => {
    const { label, className } = getStatusInfo(conv);
    return (
      <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${className}`}>
        {label}
      </span>
    );
  };

  if (loading) {
    return <div className="flex items-center justify-center h-full text-gray-500">Memuat percakapan...</div>;
  }

  return (
    <div className="flex h-full">
      {/* Sidebar: conversation list */}
      <div className="w-80 border-r flex flex-col bg-white">
        <div className="p-4 border-b">
          <div className="relative">
            <Search className="absolute left-3 top-2.5 w-4 h-4 text-gray-400" />
            <input
              className="w-full pl-9 pr-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Cari percakapan..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
            />
          </div>
        </div>
        <div className="flex gap-1 px-3 py-2 border-b overflow-x-auto">
          {(['Semua', 'Butuh Admin', 'Dikelola AI'] as const).map(f => (
            <button
              key={f}
              onClick={() => setActiveFilter(f)}
              className={`px-3 py-1 rounded-full text-xs whitespace-nowrap ${activeFilter === f ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
            >
              {f}
            </button>
          ))}
        </div>
        <div className="flex-1 overflow-y-auto">
          {filteredChats.map(conv => (
            <div
              key={conv.id}
              onClick={() => setActiveChatId(conv.id)}
              className={`flex items-start gap-3 p-3 cursor-pointer hover:bg-gray-50 ${activeChatId === conv.id ? 'bg-blue-50 border-l-2 border-blue-500' : ''}`}
            >
              <div className="w-10 h-10 rounded-full bg-blue-600 flex items-center justify-center text-white text-sm font-bold shrink-0">
                {getInitials(conv)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-1">
                  <span className="font-medium text-sm truncate">{getDisplayName(conv)}</span>
                  <div className="flex items-center gap-1 shrink-0">
                    {statusBadge(conv)}
                    {conv.followup_count_today > 0 && (
                      <span className="text-xs text-gray-400" title={`${conv.followup_count_today} follow-up otomatis terkirim hari ini`}>
                        ↩{conv.followup_count_today}/2
                      </span>
                    )}
                  </div>
                </div>
                <p className="text-xs text-gray-500 truncate mt-0.5">{getLastMessage(conv)}</p>
              </div>
            </div>
          ))}
          {filteredChats.length === 0 && (
            <p className="text-center text-sm text-gray-400 mt-8">Tidak ada percakapan</p>
          )}
        </div>
      </div>

      {/* Chat panel */}
      {activeChat ? (
        <div className="flex-1 flex flex-col">
          {/* Chat header */}
          <div className="flex items-center justify-between px-4 py-3 border-b bg-white">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-full bg-blue-600 flex items-center justify-center text-white text-sm font-bold">
                {getInitials(activeChat)}
              </div>
              <div>
                <p className="font-semibold text-sm">{getDisplayName(activeChat)}</p>
                <p className="text-xs text-gray-500">{activeChat.customer_phone}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {statusBadge(activeChat)}
              {activeChat.followup_count_today > 0 && (
                <span className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">
                  Follow-up: {activeChat.followup_count_today}/2 terkirim
                </span>
              )}
              <button
                onClick={() => handleToggleAi(activeChat)}
                title={activeChat.ai_active ? 'Alihkan ke Admin (Nonaktifkan AI)' : 'Aktifkan AI kembali'}
                className="p-2 rounded-lg hover:bg-gray-100 text-gray-600"
              >
                <ArrowLeftRight className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Order context bar */}
          {activeOrder && (
            <div className="px-4 py-2 bg-amber-50 border-b border-amber-100 flex items-center justify-between text-xs">
              <span className="font-semibold text-amber-800">
                {activeOrder.gjp_order_id ?? 'Pesanan'} · Rp {activeOrder.total.toLocaleString('id-ID')}
              </span>
              <span className={`px-2 py-0.5 rounded-full font-bold ${
                activeOrder.status === 'PAYMENT_UPLOADED'
                  ? 'bg-amber-200 text-amber-900'
                  : 'bg-blue-100 text-blue-800'
              }`}>
                {activeOrder.status.replace(/_/g, ' ')}
              </span>
            </div>
          )}

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-2 bg-gray-50">
            {activeChat.messages.map(msg => (
              <ChatBubble key={msg.id} msg={msg} />
            ))}
            <div ref={bottomRef} />
          </div>

          {/* Input bar */}
          <div className="border-t bg-white px-4 py-3 flex items-end gap-2">
            <input
              type="file"
              ref={fileInputRef}
              className="hidden"
              accept=".pdf,.png,.jpg,.jpeg,.gif,.xlsx,.xls,.doc,.docx"
              onChange={handleFileChange}
            />
            <button onClick={() => fileInputRef.current?.click()} className="p-2 hover:bg-gray-100 rounded-lg text-gray-500">
              <PlusCircle className="w-5 h-5" />
            </button>
            <input
              className="flex-1 border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Ketik pesan admin..."
              value={inputText}
              onChange={e => setInputText(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && !e.shiftKey && handleSend()}
            />
            <button
              onClick={handleSend}
              disabled={!inputText.trim()}
              className="p-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-40"
            >
              <Send className="w-4 h-4" />
            </button>
          </div>
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center text-gray-400">
          Pilih percakapan untuk mulai
        </div>
      )}
    </div>
  );
}

interface ChatBubbleProps { msg: DbMessage; }
const ChatBubble: React.FC<ChatBubbleProps> = ({ msg }) => {
  const isCustomer = msg.sender === 'customer';
  const isSystem = msg.sender === 'system';

  if (isSystem) {
    return (
      <div className="text-center text-xs text-gray-400 py-1">
        — {msg.text} —
      </div>
    );
  }

  return (
    <div className={`flex ${isCustomer ? 'justify-start' : 'justify-end'}`}>
      <div
        className={`max-w-xs lg:max-w-md px-3 py-2 rounded-2xl text-sm ${
          isCustomer
            ? 'bg-white border text-gray-800 rounded-tl-none'
            : msg.sender === 'admin'
              ? 'bg-green-600 text-white rounded-tr-none'
              : 'bg-blue-600 text-white rounded-tr-none'
        }`}
      >
        {msg.media_url ? (
          <a href={msg.media_url} target="_blank" rel="noreferrer" className="underline">
            [{msg.media_type?.toUpperCase()} attachment]
          </a>
        ) : (
          msg.text
        )}
        <p className="text-xs opacity-60 mt-1 text-right">
          {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </p>
      </div>
    </div>
  );
}
