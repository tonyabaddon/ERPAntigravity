import { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { conversationService, orderService } from '../lib/supabaseClient';
import type { DbConversation, DbMessage, DbOrder } from '../types';

export interface ConversationWithMessages extends DbConversation {
  messages: DbMessage[];
}

export function useRealtimeConversations() {
  const [conversations, setConversations] = useState<ConversationWithMessages[]>([]);
  const [orders, setOrders] = useState<DbOrder[]>([]);
  const [paymentUploadedOrders, setPaymentUploadedOrders] = useState<DbOrder[]>([]);
  const [loading, setLoading] = useState(true);

  const loadedConvIds = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!supabase) { setLoading(false); return; }

    let mounted = true;

    async function load() {
      const [convs, pendingOrders, paymentOrders] = await Promise.all([
        conversationService.fetchConversations(),
        orderService.fetchPendingOrders(),
        orderService.fetchPaymentUploadedOrders(),
      ]);
      if (!mounted) return;

      const withMessages: ConversationWithMessages[] = await Promise.all(
        convs.slice(0, 20).map(async (conv) => {
          const msgs = await conversationService.fetchMessages(conv.id);
          loadedConvIds.current.add(conv.id);
          return { ...conv, messages: msgs };
        })
      );

      setConversations(withMessages);
      setOrders(pendingOrders);
      setPaymentUploadedOrders(paymentOrders);
    }

    load()
      .catch(console.error)
      .finally(() => { if (mounted) setLoading(false); });

    // Realtime: messages INSERT
    const msgSub = supabase
      .channel('messages-insert')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' },
        (payload) => {
          const newMsg = payload.new as DbMessage;
          setConversations(prev =>
            prev.map(conv =>
              conv.id === newMsg.conversation_id
                ? { ...conv, messages: [...conv.messages, newMsg] }
                : conv
            )
          );
        })
      .subscribe();

    // Realtime: conversations UPDATE (state changes)
    const convSub = supabase
      .channel('conversations-update')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'conversations' },
        (payload) => {
          const updated = payload.new as DbConversation;
          setConversations(prev =>
            prev.map(conv =>
              conv.id === updated.id
                ? { ...conv, ...updated }
                : conv
            )
          );
        })
      .subscribe();

    // Realtime: conversations INSERT (new conversation)
    const newConvSub = supabase
      .channel('conversations-insert')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'conversations' },
        async (payload) => {
          const newConv = payload.new as DbConversation;
          const msgs = await conversationService.fetchMessages(newConv.id);
          loadedConvIds.current.add(newConv.id);
          setConversations(prev => [{ ...newConv, messages: msgs }, ...prev]);
        })
      .subscribe();

    // Realtime: orders INSERT/UPDATE
    const orderSub = supabase
      .channel('orders-changes')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'orders' },
        (payload) => {
          const newOrder = payload.new as DbOrder;
          if (newOrder.status === 'PENDING_ADMIN_CONFIRMATION') {
            setOrders(prev => [...prev, newOrder]);
          } else if (newOrder.status === 'PAYMENT_UPLOADED') {
            setPaymentUploadedOrders(prev => [...prev, newOrder]);
          }
        })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'orders' },
        (payload) => {
          const updatedOrder = payload.new as DbOrder;
          // Manage pending-approval list
          if (updatedOrder.status === 'PENDING_ADMIN_CONFIRMATION') {
            setOrders(prev => prev.map(o => o.id === updatedOrder.id ? updatedOrder : o));
          } else {
            setOrders(prev => prev.filter(o => o.id !== updatedOrder.id));
          }
          // Manage payment-uploaded list
          if (updatedOrder.status === 'PAYMENT_UPLOADED') {
            setPaymentUploadedOrders(prev =>
              prev.some(o => o.id === updatedOrder.id)
                ? prev.map(o => o.id === updatedOrder.id ? updatedOrder : o)
                : [...prev, updatedOrder]
            );
          } else {
            setPaymentUploadedOrders(prev => prev.filter(o => o.id !== updatedOrder.id));
          }
        })
      .subscribe();

    return () => {
      mounted = false;
      supabase.removeChannel(msgSub);
      supabase.removeChannel(convSub);
      supabase.removeChannel(newConvSub);
      supabase.removeChannel(orderSub);
    };
  }, []);

  const sendAdminMessage = async (conversationId: string, text: string) => {
    await conversationService.insertAdminMessage(conversationId, text);
  };

  const sendAdminMedia = async (conversationId: string, file: File) => {
    const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
    const typeMap: Record<string, string> = {
      pdf: 'pdf', jpg: 'image', jpeg: 'image', png: 'image', gif: 'image',
      xlsx: 'excel', xls: 'excel', doc: 'word', docx: 'word',
    };
    const mediaType = typeMap[ext] ?? 'file';
    const url = await conversationService.uploadChatMedia(file);
    await conversationService.insertAdminMediaMessage(conversationId, url, mediaType);
  };

  const toggleAiControl = async (conversationId: string, makeActive: boolean): Promise<void> => {
    await conversationService.toggleAiControl(conversationId, makeActive);
  };

  const approveOrder = async (orderId: string, shippingFee: number) => {
    await orderService.approveOrder(orderId, shippingFee);
  };

  const verifyPayment = async (orderId: string): Promise<void> => {
    await orderService.verifyPayment(orderId);
  };

  const rejectPayment = async (orderId: string): Promise<void> => {
    await orderService.rejectPayment(orderId);
  };

  return {
    conversations,
    orders,
    paymentUploadedOrders,
    loading,
    sendAdminMessage,
    sendAdminMedia,
    toggleAiControl,
    approveOrder,
    verifyPayment,
    rejectPayment,
  };
}
