import { supabase } from './supabaseClient';
import { wibDateString } from './format';
import { decodeJwt } from './jwt';
import { getSignedStorageUrl } from './chatMediaSignedUrl';
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

  async fetchByNumber(poNumber: string): Promise<DbPurchaseOrder | null> {
    if (!supabase) throw new Error('Supabase not configured');
    const { data, error } = await supabase
      .from('purchase_orders')
      .select('*, suppliers(*), purchase_order_items(*)')
      .eq('po_number', poNumber)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    return {
      ...(data as any),
      supplier: (data as any).suppliers,
      items: (data as any).purchase_order_items ?? [],
    } as DbPurchaseOrder;
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
    // Idempotency token (slot 312): prevents double-receipt on network retry.
    const idem312 = crypto.randomUUID();
    console.info('[idempotency] receive_purchase_order po=%s key=%s', poId, idem312);
    const { error } = await supabase.rpc('receive_purchase_order', {
      p_po_id: poId,
      p_received_at: params.received_at,
      p_payment_due_at: params.payment_due_at,
      p_invoice_url: params.invoice_url ?? null,
      p_conditions: params.conditions,
      p_idempotency_key: idem312,
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
    // Get tenant_id from JWT for tenant-prefixed path (RLS policy purchase_docs_insert_own_tenant)
    const { data: { session } } = await supabase.auth.getSession();
    const tenantId: string = (session ? (decodeJwt(session.access_token).tenant_id as string | undefined) : undefined) ?? '';
    if (!tenantId) throw new Error('Missing tenant_id in JWT — cannot upload document');
    const ext = file.name.split('.').pop() ?? 'pdf';
    // Path: tenants/{tenant_id}/{caller-path}.{ext}
    const fullPath = `tenants/${tenantId}/${path}.${ext}`;
    const { error } = await supabase.storage
      .from('purchase-documents')
      .upload(fullPath, file, { upsert: true });
    if (error) throw error;
    // Return storage path — callers display via getSignedStorageUrl('purchase-documents', path)
    return fullPath;
  },

  /**
   * Resolve a purchase-documents storage reference to a signed URL.
   * Accepts both legacy full public URLs and new storage paths.
   */
  async getDocumentUrl(pathOrUrl: string): Promise<string | null> {
    return getSignedStorageUrl('purchase-documents', pathOrUrl);
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

};
