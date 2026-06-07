// src/hooks/useRekonsiliasi.ts
import { useEffect, useState, useCallback } from 'react';
import { reconciliationService } from '../lib/supabaseClient';
import type { BankAccount, BankStatementLine, PayableSlot, CashDepositBatch } from '../types';

interface OrderRow {
  id: string;
  customer_name: string;
  total: number;
  payment_type: 'FULL' | 'DP';
  dp_amount: number;
  channel: 'whatsapp' | 'tokopedia' | 'walkin' | 'grosir';
  status: string;
  created_at: string;
  booking_expires_at: string;
  slots: PayableSlot[];
}

interface State {
  loading: boolean;
  accounts: BankAccount[];
  orders: OrderRow[];
  bankLines: BankStatementLine[];
  cashBatches: CashDepositBatch[];
}

export function useRekonsiliasi(year: number, month: number) {
  const [state, setState] = useState<State>({
    loading: true, accounts: [], orders: [], bankLines: [], cashBatches: [],
  });

  const refresh = useCallback(async () => {
    setState(s => ({ ...s, loading: true }));
    const [accounts, ordersRaw, bankLines, cashBatches] = await Promise.all([
      reconciliationService.listBankAccounts(),
      reconciliationService.listOrdersForPeriod(year, month),
      reconciliationService.listBankLinesForPeriod(year, month),
      reconciliationService.listCashBatches(),
    ]);
    const slots = await reconciliationService.listPayableSlotsForOrders(ordersRaw.map(o => o.id));
    const slotsByOrder = new Map<string, PayableSlot[]>();
    for (const s of slots) {
      const arr = slotsByOrder.get(s.order_id) ?? [];
      arr.push(s);
      slotsByOrder.set(s.order_id, arr);
    }
    const orders: OrderRow[] = ordersRaw.map(o => ({
      ...(o as any),
      slots: slotsByOrder.get(o.id) ?? [],
    }));
    setState({ loading: false, accounts, orders, bankLines, cashBatches });
  }, [year, month]);

  useEffect(() => { refresh(); }, [refresh]);

  return { ...state, refresh };
}
