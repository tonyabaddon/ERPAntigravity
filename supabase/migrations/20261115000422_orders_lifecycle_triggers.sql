-- 20261115000422_orders_lifecycle_triggers.sql
-- Sprint 3 Task 3.2: pg_notify on order INSERT (order_created) and on
-- transition to COMPLETED (order_shipped alias).
--
-- STATUS MAPPING DECISION (2026-07-19):
--   Actual orders.status enum (from public.orders): COMPLETED, PAYMENT_VERIFIED,
--   INVOICE_TEMPO, INVOICE_WRITTEN_OFF — plus many intermediate states.
--   There is NO "SHIPPED" status in this DB.
--   'COMPLETED' is the terminal fulfilled state (order done / delivered).
--   Trigger: AFTER UPDATE OF status WHEN NEW.status = 'COMPLETED'.
--   Notification channel kept as 'order_shipped' per the interface spec so
--   consumers are not surprised; template copy says "pesanan selesai diproses"
--   (honest, not "sudah kami kirim").
--   Founder can rename this trigger/channel if a SHIPPED status is added later.
--
-- PAYLOAD NOTES:
--   - orders has no invoice_no column; use SUBSTR(id::text, -8) as short ref.
--   - orders has no amount_due; compute total - COALESCE(piutang_paid_amount, 0).
--   - customers.wa_number is the phone field (not orders.customer_phone which
--     is a denormalized snapshot; customer_id links to customers.id).
--
-- Idempotent: uses CREATE OR REPLACE FUNCTION + DROP TRIGGER IF EXISTS.

-- ─── order_created ───────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.notify_order_created()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM pg_notify(
    'order_created',
    json_build_object(
      'order_id',   NEW.id,
      'tenant_id',  NEW.tenant_id,
      'customer_id', NEW.customer_id,
      'invoice_no', SUBSTR(NEW.id::text, -8),
      'amount',     NEW.total - COALESCE(NEW.piutang_paid_amount, 0),
      'conversation_id', NEW.conversation_id
    )::text
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_order_created ON public.orders;
CREATE TRIGGER trg_order_created
  AFTER INSERT ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.notify_order_created();

-- ─── order_shipped (fires on transition TO COMPLETED) ────────────────────────

CREATE OR REPLACE FUNCTION public.notify_order_shipped()
RETURNS TRIGGER AS $$
BEGIN
  -- Only fire when status changes TO 'COMPLETED' for the first time.
  -- COMPLETED is the terminal fulfilled state in this schema (no SHIPPED status).
  IF NEW.status::text = 'COMPLETED' AND
     (OLD.status IS DISTINCT FROM NEW.status) THEN
    PERFORM pg_notify(
      'order_shipped',
      json_build_object(
        'order_id',   NEW.id,
        'tenant_id',  NEW.tenant_id,
        'customer_id', NEW.customer_id,
        'invoice_no', SUBSTR(NEW.id::text, -8),
        'conversation_id', NEW.conversation_id
      )::text
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_order_shipped ON public.orders;
CREATE TRIGGER trg_order_shipped
  AFTER UPDATE OF status ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.notify_order_shipped();
