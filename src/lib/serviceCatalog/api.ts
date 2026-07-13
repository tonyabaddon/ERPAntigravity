import { supabase } from '../supabaseClient';
import type {
  ServiceCatalogEntry,
  ServiceCatalogSavePayload,
} from './types';

export async function saveServiceCatalog(
  data: ServiceCatalogSavePayload,
): Promise<string> {
  const { data: result, error } = await supabase.rpc('save_service_catalog', {
    p_data: data,
  });
  if (error) throw error;
  return result as string;
}

export async function deactivateServiceCatalog(id: string): Promise<void> {
  const { error } = await supabase.rpc('soft_delete_service_catalog', {
    p_id: id,
  });
  if (error) throw error;
}

export async function listServiceCatalog(): Promise<ServiceCatalogEntry[]> {
  const { data, error } = await supabase
    .from('service_catalog')
    .select(
      `
      *,
      bom:service_catalog_bom (
        id, component_sku, default_qty, notes, sort_order
      )
    `,
    )
    .order('category', { ascending: true })
    .order('name', { ascending: true });
  if (error) throw error;

  const skus = new Set<string>();
  (data ?? []).forEach((s) =>
    ((s as { bom?: { component_sku: string }[] }).bom ?? []).forEach((b) =>
      skus.add(b.component_sku),
    ),
  );
  const { data: stocksData } =
    skus.size > 0
      ? await supabase
          .from('stocks')
          .select('sku, name')
          .in('sku', Array.from(skus))
      : { data: [] as { sku: string; name: string }[] };
  const skuToName = new Map<string, string>();
  (stocksData ?? []).forEach((s) => skuToName.set(s.sku, s.name));

  return (data ?? []).map((s) => ({
    ...(s as ServiceCatalogEntry),
    bom: ((s as { bom?: unknown[] }).bom ?? []).map((b) => ({
      ...(b as ServiceCatalogEntry['bom'][number]),
      component_name: skuToName.get(
        (b as { component_sku: string }).component_sku,
      ),
    })),
  })) as ServiceCatalogEntry[];
}

export interface AttachServiceParams {
  orderId: string;
  serviceCatalogId: string;
  qty: number;
  overrideBom?: Array<{
    component_sku: string;
    qty: number;
    service_catalog_bom_id?: string | null;
  }>;
  overrideLabor?: number;
  finalPrice: number;
  invoiceDisplayOverride?: 'lump_sum' | 'itemized' | null;
}

export async function attachServiceToOrder(
  params: AttachServiceParams,
): Promise<string> {
  const { data, error } = await supabase.rpc('attach_service_to_order', {
    p_order_id: params.orderId,
    p_service_catalog_id: params.serviceCatalogId,
    p_qty: params.qty,
    p_override_bom: params.overrideBom ?? null,
    p_override_labor: params.overrideLabor ?? null,
    p_final_price: params.finalPrice,
    p_invoice_display_override: params.invoiceDisplayOverride ?? null,
  });
  if (error) throw error;
  return data as string;
}
