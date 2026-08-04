import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the supabaseClient module before importing service
vi.mock('./supabaseClient', () => ({
  supabase: {
    rpc: vi.fn(),
    from: vi.fn(),
    auth: {
      getUser: vi.fn(),
    },
  },
}));

import {
  createSalesOrder,
  fetchSalesOrderById,
  fetchSalesOrders,
  markSalesOrderConverted,
  closeSalesOrder,
} from './salesOrderService';
import { supabase } from './supabaseClient';

const rpcMock = supabase.rpc as unknown as ReturnType<typeof vi.fn>;
const fromMock = supabase.from as unknown as ReturnType<typeof vi.fn>;
const getUserMock = supabase.auth.getUser as unknown as ReturnType<typeof vi.fn>;

/** Build a chainable from() mock for admin_users: .select().eq().maybeSingle() */
function mockAdminUsersQuery(name: string | null, error: unknown = null) {
  const maybeSingleMock = vi.fn().mockResolvedValueOnce({ data: name ? { name } : null, error });
  const eqMock = vi.fn().mockReturnValue({ maybeSingle: maybeSingleMock });
  const selectMock = vi.fn().mockReturnValue({ eq: eqMock });
  return { selectMock, eqMock, maybeSingleMock };
}

beforeEach(() => {
  rpcMock.mockReset();
  fromMock.mockReset();
  getUserMock.mockReset();
  // Default: no authenticated user (resolveCreatedByName returns null)
  getUserMock.mockResolvedValue({ data: { user: null }, error: null });
});

describe('createSalesOrder', () => {
  it('calls create_sales_order RPC with payload jsonb', async () => {
    rpcMock.mockResolvedValueOnce({ data: { id: 'so-1', so_number: 'SO-WLK-x' }, error: null });
    const result = await createSalesOrder({
      channel: 'walkin',
      items: [{ sku: 'x', name: 'X', qty: 1, unit_price: 100, hpp_per_unit: 50,
                subtotal: 100, hpp_subtotal: 50, warehouse_id: null, warehouse: null }],
      subtotal: 100,
      customer_id: null,
      customer_name: 'Test',
      customer_phone: '081',
      customer_company: null,
      notes: null,
    });
    expect(rpcMock).toHaveBeenCalledWith('create_sales_order', expect.objectContaining({
      p_payload: expect.objectContaining({ channel: 'walkin', customer_name: 'Test' }),
    }));
    expect(result.id).toBe('so-1');
  });

  it('throws when RPC returns error', async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: { message: 'boom' } });
    await expect(createSalesOrder({
      channel: 'walkin', items: [], subtotal: 0,
      customer_id: null, customer_name: 'x',
      customer_phone: null, customer_company: null, notes: null,
    })).rejects.toThrow('boom');
  });

  it('includes created_by_name and opening_greeting_override in RPC payload (Penawaran)', async () => {
    // Arrange: authenticated user with a matching admin_users row
    getUserMock.mockResolvedValueOnce({ data: { user: { email: 'kasir@toko.com' } }, error: null });
    const { selectMock } = mockAdminUsersQuery('Test User');
    fromMock.mockReturnValueOnce({ select: selectMock });
    rpcMock.mockResolvedValueOnce({ data: { id: 'so-2', so_number: 'SO-WLK-y' }, error: null });

    // Act
    const result = await createSalesOrder({
      channel: 'walkin',
      items: [],
      subtotal: 500,
      customer_id: 'cust-1',
      customer_name: 'PT Maju',
      customer_phone: null,
      customer_company: 'PT Maju',
      notes: null,
      selectedCustomer: {
        id: 'cust-1',
        wa_number: '',
        name: 'PT Maju',
        company: 'PT Maju',
        allows_tempo: false,
        term_days: 0,
        credit_limit: 0,
        created_at: '',
        salutation: 'Bapak',
        contact_person_name: 'Budi Santoso',
      },
      opening_greeting_override: 'Dengan hormat,',
      payment_terms_override: null,
      lead_time_override: '3 hari kerja',
      so_notes_override: null,
      valid_until_override: '2026-08-10',
    });

    // Assert
    expect(fromMock).toHaveBeenCalledWith('admin_users');
    expect(rpcMock).toHaveBeenCalledWith('create_sales_order', expect.objectContaining({
      p_payload: expect.objectContaining({
        created_by_name: 'Test User',
        customer_salutation: 'Bapak',
        customer_contact_person: 'Budi Santoso',
        opening_greeting_override: 'Dengan hormat,',
        payment_terms_override: null,
        lead_time_override: '3 hari kerja',
        so_notes_override: null,
        valid_until_override: '2026-08-10',
      }),
    }));
    expect(result.id).toBe('so-2');
  });

  it('sends created_by_name: null when user has no admin_users row', async () => {
    // Arrange: authenticated user but no matching admin_users row
    getUserMock.mockResolvedValueOnce({ data: { user: { email: 'unknown@toko.com' } }, error: null });
    const { selectMock } = mockAdminUsersQuery(null);
    fromMock.mockReturnValueOnce({ select: selectMock });
    rpcMock.mockResolvedValueOnce({ data: { id: 'so-3', so_number: 'SO-WLK-z' }, error: null });

    await createSalesOrder({
      channel: 'walkin', items: [], subtotal: 0,
      customer_id: null, customer_name: 'x',
      customer_phone: null, customer_company: null, notes: null,
    });

    expect(rpcMock).toHaveBeenCalledWith('create_sales_order', expect.objectContaining({
      p_payload: expect.objectContaining({ created_by_name: null }),
    }));
  });
});

describe('markSalesOrderConverted', () => {
  it('calls RPC with kasir_tx_id when kasirTxId provided', async () => {
    rpcMock.mockResolvedValueOnce({ data: { id: 'so-1' }, error: null });
    await markSalesOrderConverted('so-1', { kasirTxId: 'kt-9' });
    expect(rpcMock).toHaveBeenCalledWith('mark_sales_order_converted', {
      p_so_id: 'so-1',
      p_target_kasir_tx_id: 'kt-9',
      p_target_order_id: null,
    });
  });

  it('calls RPC with order_id when orderId provided', async () => {
    rpcMock.mockResolvedValueOnce({ data: { id: 'so-1' }, error: null });
    await markSalesOrderConverted('so-1', { orderId: 'o-7' });
    expect(rpcMock).toHaveBeenCalledWith('mark_sales_order_converted', {
      p_so_id: 'so-1',
      p_target_kasir_tx_id: null,
      p_target_order_id: 'o-7',
    });
  });

  it('throws if neither target provided', async () => {
    await expect(markSalesOrderConverted('so-1', {}))
      .rejects.toThrow(/exactly one/i);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it('throws if both targets provided', async () => {
    await expect(markSalesOrderConverted('so-1', { kasirTxId: 'kt', orderId: 'o' }))
      .rejects.toThrow(/exactly one/i);
    expect(rpcMock).not.toHaveBeenCalled();
  });
});

describe('closeSalesOrder', () => {
  it('calls RPC with id + reason', async () => {
    rpcMock.mockResolvedValueOnce({ data: { id: 'so-1' }, error: null });
    await closeSalesOrder('so-1', 'Lost deal');
    expect(rpcMock).toHaveBeenCalledWith('close_sales_order', {
      p_so_id: 'so-1',
      p_reason: 'Lost deal',
    });
  });

  it('throws on empty reason client-side', async () => {
    await expect(closeSalesOrder('so-1', '   ')).rejects.toThrow(/reason/i);
    expect(rpcMock).not.toHaveBeenCalled();
  });
});

describe('fetchSalesOrderById', () => {
  it('returns null when not found', async () => {
    const maybeSingleMock = vi.fn().mockResolvedValueOnce({ data: null, error: null });
    const eqMock = vi.fn().mockReturnValue({ maybeSingle: maybeSingleMock });
    const selectMock = vi.fn().mockReturnValue({ eq: eqMock });
    fromMock.mockReturnValue({ select: selectMock });

    const result = await fetchSalesOrderById('missing');
    expect(result).toBeNull();
    expect(fromMock).toHaveBeenCalledWith('sales_orders');
    expect(eqMock).toHaveBeenCalledWith('id', 'missing');
  });

  it('returns the row when found', async () => {
    const so = { id: 'so-1', so_number: 'SO-X' };
    const maybeSingleMock = vi.fn().mockResolvedValueOnce({ data: so, error: null });
    const eqMock = vi.fn().mockReturnValue({ maybeSingle: maybeSingleMock });
    const selectMock = vi.fn().mockReturnValue({ eq: eqMock });
    fromMock.mockReturnValue({ select: selectMock });

    const result = await fetchSalesOrderById('so-1');
    expect(result).toEqual(so);
  });
});

describe('fetchSalesOrders', () => {
  it('filters by status when provided', async () => {
    const orderMock = vi.fn().mockResolvedValueOnce({ data: [], error: null });
    const eqMock = vi.fn().mockReturnValue({ order: orderMock });
    const selectMock = vi.fn().mockReturnValue({ eq: eqMock, order: orderMock });
    fromMock.mockReturnValue({ select: selectMock });

    await fetchSalesOrders({ status: 'OPEN' });
    expect(eqMock).toHaveBeenCalledWith('status', 'OPEN');
  });

  it('fetches all when no filter', async () => {
    const orderMock = vi.fn().mockResolvedValueOnce({ data: [], error: null });
    const selectMock = vi.fn().mockReturnValue({ order: orderMock });
    fromMock.mockReturnValue({ select: selectMock });

    await fetchSalesOrders();
    expect(orderMock).toHaveBeenCalledWith('created_at', { ascending: false });
  });
});
