import type { KasirItem, RakitServiceType } from '../../../types';
import type { SupabaseStockItem } from '../../../lib/supabaseClient';
import ItemSearchPanel from '../ItemSearchPanel';
import CartRows from '../CartRows';
import RakitButtonsRow from '../RakitButtonsRow';
import RakitInlineForm from '../RakitInlineForm';
import { isPreOrder } from '../../../lib/wizard/validation';

type CartItem = KasirItem & { _key: number };
type RakitLine = {
  id: string;
  type: RakitServiceType;
  description: string;
  estimatedPrice: number;
  hppEstimate: number;
};

interface Props {
  // cart
  cart: CartItem[];
  stocks: SupabaseStockItem[];
  onAddItem: (stock: SupabaseStockItem) => void;
  onQtyChange: (key: number, qty: number) => void;
  onWarehouseChange: (key: number, warehouseId: string) => void;
  onRemoveItem: (key: number) => void;
  subtotal: number;
  // rakit
  rakitLines: RakitLine[];
  rakitFormOpen: boolean;
  rakitFormType: RakitServiceType | null;
  onOpenRakitForm: (t: RakitServiceType) => void;
  onCancelRakitForm: () => void;
  onAddRakitLine: (line: { type: RakitServiceType; description: string; estimatedPrice: number; hppEstimate: number }) => void;
  onRemoveRakitLine: (id: string) => void;
  // pre-order banner
  stockByWarehouseSku: Record<string, number>;
  // misc
  // TODO: prefill_sku honor TBD — handled at orchestrator level (T16) since
  // ItemSearchPanel has no programmatic "add by SKU" API.
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
}

export default function Step2Items(props: Props) {
  const preOrderCount = props.cart
    .filter((it): it is CartItem & { sku: string } => typeof it.sku === 'string' && it.sku.length > 0)
    .filter((it) => isPreOrder(
      { sku: it.sku, qty: it.qty, warehouse_id: it.warehouse_id ?? undefined },
      props.stockByWarehouseSku,
    ))
    .length;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1.7fr_1fr] gap-4 p-6">
      <div>
        <ItemSearchPanel
          stocks={props.stocks}
          cartCount={props.cart.length + props.rakitLines.length}
          cartSubtotal={props.subtotal}
          onAdd={props.onAddItem}
        >
          <CartRows
            items={props.cart}
            stocks={props.stocks}
            onQtyChange={props.onQtyChange}
            onWarehouseChange={props.onWarehouseChange}
            onRemove={props.onRemoveItem}
            rakitLines={props.rakitLines}
            onRemoveRakit={props.onRemoveRakitLine}
          />
        </ItemSearchPanel>
        <div className="mt-3">
          <RakitButtonsRow
            formOpen={props.rakitFormOpen}
            formType={props.rakitFormType}
            onOpen={props.onOpenRakitForm}
          />
        </div>
        {props.rakitFormOpen && props.rakitFormType && (
          <div className="mt-3">
            <RakitInlineForm
              type={props.rakitFormType}
              onAdd={props.onAddRakitLine}
              onCancel={props.onCancelRakitForm}
            />
          </div>
        )}
        {preOrderCount > 0 && (
          <div className="mt-3 px-3 py-2 rounded-lg bg-amber-50 border border-amber-200 text-[11px] text-amber-800 flex items-start gap-2">
            <span>⏳</span>
            <div>
              <strong>{preOrderCount} item pre-order</strong> di pesanan ini — stok minus akan dipenuhi setelah supplier kirim.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
