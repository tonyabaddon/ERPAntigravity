export type InvoiceDisplay = 'lump_sum' | 'itemized';

export interface ServiceCatalogBOMItem {
  id?: string;
  component_sku: string;
  component_name?: string;
  default_qty: number;
  notes?: string | null;
  sort_order?: number;
}

export interface ServiceCatalogEntry {
  id: string;
  tenant_id: string;
  name: string;
  description: string | null;
  category: string | null;
  default_labor_amount: number;
  default_include_material: boolean;
  invoice_display: InvoiceDisplay;
  revenue_coa_code: string;
  labor_cost_coa_code: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  bom: ServiceCatalogBOMItem[];
}

export type ServiceCatalogSavePayload = Omit<
  ServiceCatalogEntry,
  'id' | 'tenant_id' | 'created_at' | 'updated_at'
> & { id?: string | null };
