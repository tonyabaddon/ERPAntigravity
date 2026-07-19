-- B1 fix: wire approval WA card send.
-- Adds sent_wa_card_at dedup column + trigger that fires 'approval_created'
-- NOTIFY on INSERT so the Go backend can broadcast to owner-role recipients.
--
-- Migration slot 401. Idempotent.

ALTER TABLE public.approval_requests
  ADD COLUMN IF NOT EXISTS sent_wa_card_at TIMESTAMPTZ;

-- Trigger function: fires pg_notify('approval_created', ...) on every
-- approval_requests INSERT. The JSON payload carries enough context for the
-- Go handler to render the ApprovalCard template without a second DB query.
-- Note: request_type and payload (JSONB) match the actual column names —
-- the brief draft used 'type'/'details' which would have caused a compile error.
CREATE OR REPLACE FUNCTION public.notify_approval_created()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM pg_notify(
    'approval_created',
    json_build_object(
      'approval_id', NEW.id,
      'tenant_id',   NEW.tenant_id,
      'type',        NEW.request_type,
      'details',     NEW.payload::text
    )::text
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_approval_created_notify ON public.approval_requests;
CREATE TRIGGER trg_approval_created_notify
  AFTER INSERT ON public.approval_requests
  FOR EACH ROW EXECUTE FUNCTION public.notify_approval_created();
