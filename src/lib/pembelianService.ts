import { supabase } from './supabaseClient';
import { wibDateString } from './format';
import type { DbSupplier, DbPurchaseOrder } from '../types';

export const supplierService = {
  async fetchAll(): Promise<DbSupplier[]> {
    if (!supabase) throw new Error('Supabase not configured');
    const { data, error } = await supabase
      .from('suppliers')
      .select('*')
      .order('name', { ascending: true });
    if (error) throw error;
    return (data ?? []) as DbSupplier[];
  },

  async upsert(supplier: Omit<DbSupplier, 'id' | 'created_at'> & { id?: string }): Promise<void> {
    if (!supabase) throw new Error('Supabase not configured');
    if (supplier.id) {
      const { error } = await supabase
        .from('suppliers')
        .update({ name: supplier.name, contact_name: supplier.contact_name, phone: supplier.phone, payment_term_days: supplier.payment_term_days })
        .eq('id', supplier.id);
      if (error) throw error;
    } else {
      const { error } = await supabase
        .from('suppliers')
        .insert({ name: supplier.name, contact_name: supplier.contact_name, phone: supplier.phone, payment_term_days: supplier.payment_term_days });
      if (error) throw error;
    }
  },

  async remove(id: string): Promise<void> {
    if (!supabase) throw new Error('Supabase not configured');
    const { error } = await supabase.from('suppliers').delete().eq('id', id);
    if (error) throw error;
  },
};

export type PoItemDraft = {
  sku: string;
  product_name: string;
  qty: number;
  unit_cost: number;
  subtotal: number;
};

export const purchaseOrderService = {
  async fetchAll(): Promise<DbPurchaseOrder[]> {
    if (!supabase) throw new Error('Supabase not configured');
    const { data, error } = await supabase
      .from('purchase_orders')
      .select('*, suppliers(*), purchase_order_items(*)')
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data ?? []).map((row: any) => ({
      ...row,
      supplier: row.suppliers,
      items: row.purchase_order_items ?? [],
    })) as DbPurchaseOrder[];
  },

  async generatePoNumber(): Promise<string> {
    if (!supabase) throw new Error('Supabase not configured');
    const { data, error } = await supabase.rpc('generate_po_number');
    if (error) throw error;
    return data as string;
  },

  async create(po: {
    supplier_id: string;
    notes?: string;
    tax_rate: number;
    tax_amount: number;
    subtotal: number;
    total: number;
    status: 'DRAFT' | 'ORDERED';
    items: PoItemDraft[];
    expected_receive_date?: string | null;
    created_by_user_id?: string | null;
  }): Promise<string> {
    if (!supabase) throw new Error('Supabase not configured');
    const po_number = await purchaseOrderService.generatePoNumber();
    const { data: poData, error: poError } = await supabase
      .from('purchase_orders')
      .insert({
        po_number,
        supplier_id: po.supplier_id,
        notes: po.notes,
        tax_rate: po.tax_rate,
        tax_amount: po.tax_amount,
        subtotal: po.subtotal,
        total: po.total,
        status: po.status,
        expected_receive_date: po.expected_receive_date ?? null,
        created_by_user_id: po.created_by_user_id || null,
        updated_by_user_id: po.created_by_user_id || null,
        ...(po.status === 'ORDERED' ? { ordered_at: new Date().toISOString() } : {}),
      })
      .select('id')
      .single();
    if (poError) throw poError;
    const { error: itemsError } = await supabase
      .from('purchase_order_items')
      .insert(po.items.map(item => ({ ...item, po_id: poData.id })));
    if (itemsError) throw itemsError;
    return poData.id as string;
  },

  async update(poId: string, po: {
    supplier_id: string;
    notes?: string;
    tax_rate: number;
    tax_amount: number;
    subtotal: number;
    total: number;
    items: PoItemDraft[];
    expected_receive_date?: string | null;
    updated_by_user_id?: string | null;
  }): Promise<void> {
    if (!supabase) throw new Error('Supabase not configured');
    const { error: poError } = await supabase
      .from('purchase_orders')
      .update({
        supplier_id: po.supplier_id,
        notes: po.notes,
        tax_rate: po.tax_rate,
        tax_amount: po.tax_amount,
        subtotal: po.subtotal,
        total: po.total,
        expected_receive_date: po.expected_receive_date ?? null,
        updated_by_user_id: po.updated_by_user_id || null,
      })
      .eq('id', poId);
    if (poError) throw poError;
    await supabase.from('purchase_order_items').delete().eq('po_id', poId);
    const { error: itemsError } = await supabase
      .from('purchase_order_items')
      .insert(po.items.map(item => ({ ...item, po_id: poId })));
    if (itemsError) throw itemsError;
  },

  async markOrdered(poId: string): Promise<void> {
    if (!supabase) throw new Error('Supabase not configured');
    const { error } = await supabase
      .from('purchase_orders')
      .update({ status: 'ORDERED', ordered_at: new Date().toISOString() })
      .eq('id', poId);
    if (error) throw error;
  },

  async receiveGoods(poId: string, params: {
    received_at: string;
    payment_due_at: string;
    invoice_url?: string;
    /** Per-line conditions keyed by po_item.id. Each entry must include
     *  warehouse_id (uuid) so the 5-arg receive_purchase_order RPC can route
     *  stock to the correct warehouse. */
    conditions: Record<string, { warehouse_id: string; qty_received: number; qty_damaged: number; damage_notes?: string }>;
  }): Promise<void> {
    if (!supabase) throw new Error('Supabase not configured');
    const { error } = await supabase.rpc('receive_purchase_order', {
      p_po_id: poId,
      p_received_at: params.received_at,
      p_payment_due_at: params.payment_due_at,
      p_invoice_url: params.invoice_url ?? null,
      p_conditions: params.conditions,
    });
    if (error) throw error;
  },

  async transferWarehouse(sku: string, fromId: string, toId: string, qty: number): Promise<void> {
    if (!supabase) throw new Error('Supabase not configured');
    const { error } = await supabase.rpc('transfer_warehouse', {
      p_sku: sku,
      p_from_warehouse_id: fromId,
      p_to_warehouse_id: toId,
      p_qty: qty,
    });
    if (error) throw error;
  },

  async markPaid(poId: string, paymentProofUrl?: string): Promise<void> {
    if (!supabase) throw new Error('Supabase not configured');
    const { error } = await supabase
      .from('purchase_orders')
      .update({ status: 'PAID', paid_at: new Date().toISOString(), payment_proof_url: paymentProofUrl })
      .eq('id', poId);
    if (error) throw error;
  },

  async updateDamageStatus(itemId: string, damageStatus: string): Promise<void> {
    if (!supabase) throw new Error('Supabase not configured');
    const { error } = await supabase
      .from('purchase_order_items')
      .update({ damage_status: damageStatus })
      .eq('id', itemId);
    if (error) throw error;
  },

  async receiveReplacement(itemId: string): Promise<void> {
    if (!supabase) throw new Error('Supabase not configured');
    const { error } = await supabase.rpc('receive_replacement', { p_item_id: itemId });
    if (error) throw error;
  },

  async uploadDocument(file: File, path: string): Promise<string> {
    if (!supabase) throw new Error('Supabase not configured');
    const ext = file.name.split('.').pop() ?? 'pdf';
    const fullPath = `${path}.${ext}`;
    const { error } = await supabase.storage
      .from('purchase-documents')
      .upload(fullPath, file, { upsert: true });
    if (error) throw error;
    const { data } = supabase.storage.from('purchase-documents').getPublicUrl(fullPath);
    return data.publicUrl;
  },

  async delete(poId: string): Promise<void> {
    if (!supabase) throw new Error('Supabase not configured');
    const { error } = await supabase.from('purchase_orders').delete().eq('id', poId);
    if (error) throw error;
  },

  async deductFifo(sku: string, qty: number): Promise<number> {
    if (!supabase) throw new Error('Supabase not configured');
    const { data, error } = await supabase.rpc('deduct_stock_fifo', { p_sku: sku, p_qty: qty });
    if (error) throw error;
    return Number(data ?? 0);
  },

  async fetchSummary(): Promise<{ totalMtd: number; dueMtd: number; overdueAmount: number; countMtd: number }> {
    if (!supabase) return { totalMtd: 0, dueMtd: 0, overdueAmount: 0, countMtd: 0 };
    const { data } = await supabase
      .from('purchase_orders')
      .select('total, status, payment_due_at, created_at');
    const rows = (data ?? []) as Array<{ total: number; status: string; payment_due_at?: string; created_at: string }>;
    const now = new Date();
    const todayDate = wibDateString(now);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const monthEndDate = wibDateString(new Date(now.getFullYear(), now.getMonth() + 1, 0));
    const monthStartDate = monthStart.slice(0, 10);
    const totalMtd = rows.filter(r => r.created_at >= monthStart).reduce((s, r) => s + Number(r.total), 0);
    const countMtd = rows.filter(r => r.created_at >= monthStart).length;
    const dueMtd = rows
      .filter(r => r.status === 'RECEIVED' && r.payment_due_at && r.payment_due_at >= monthStartDate && r.payment_due_at <= monthEndDate)
      .reduce((s, r) => s + Number(r.total), 0);
    const overdueAmount = rows
      .filter(r => r.status === 'RECEIVED' && r.payment_due_at && r.payment_due_at < todayDate)
      .reduce((s, r) => s + Number(r.total), 0);
    return { totalMtd, dueMtd, overdueAmount, countMtd };
  },
};
