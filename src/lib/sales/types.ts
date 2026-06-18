export type OrderType = 'KOMPONEN' | 'CUSTOM_PANEL' | 'RAKIT_PANEL';
export type FunnelStage = 1 | 2 | 3 | 4 | 5 | 6;
export type FunnelSubStage =
  | '1a'
  | '2a' | '2b' | '2c' | '2d' | '2e'
  | '3a' | '3b' | '3c' | '3d' | '3e' | '3f' | '3g' | '3h'
  | '4a' | '4b' | '4d'
  | '5a'
  | '6a' | '6b';
export type DeliveryMethod = 'PICKUP' | 'DELIVERY' | 'MARKETPLACE_COURIER';
export type PaymentType = 'FULL' | 'DP' | 'TEMPO';
export type ProofSource = 'WA_CALISTA' | 'ADMIN_UPLOAD' | 'MARKETPLACE_SCREENSHOT';

export interface Order {
  id: string;
  customer: string;
  total: number;
  channel: string;
  order_type: OrderType;
  funnel_stage: FunnelStage;
  funnel_sub_stage: FunnelSubStage;
  delivery_method: DeliveryMethod;
  version: number;
  payment_type: PaymentType;
  payment_proof_url?: string;
  pelunasan_proof_url?: string;
  marketplace_proof_url?: string;
  proof_source?: ProofSource;
  estimated_completion_days?: number;
  hari_progress?: number;
  status_label: string;
  time_ago: string;
  stuck: boolean;
  stage_label_override?: string;
}

export interface SalesDashboardStats {
  urgent_count: number;
  tunggu_count: number;
  revenue_pending: number;
  completed_this_month: number;
  revenue_this_month: number;
}
