-- supabase/migrations/20260531000000_core_ai_engine.sql
--
-- After applying this migration, create a Supabase Storage bucket named
-- 'chat-media' with Public access enabled.

-- Enums
CREATE TYPE conversation_state AS ENUM (
  'GREETING','COLLECTING','CLARIFYING','STOCK_CHECK','CONFIRMING',
  'BOOKED','TIMEOUT_REMINDER','CANCELLED','APPROVED','COMPLETED',
  'ESCALATED_ADMIN','ESCALATED_WIRING'
);

CREATE TYPE message_sender AS ENUM ('customer','ai','admin','system');
CREATE TYPE order_status AS ENUM ('PENDING','APPROVED','CANCELLED','COMPLETED');
CREATE TYPE wa_number_status AS ENUM ('CONNECTED','DISCONNECTED','PAIRING');

-- whatsapp_numbers
CREATE TABLE IF NOT EXISTS whatsapp_numbers (
  id            text PRIMARY KEY,
  phone_number  text NOT NULL,
  name          text NOT NULL,
  status        wa_number_status NOT NULL DEFAULT 'DISCONNECTED',
  is_enabled    boolean NOT NULL DEFAULT true,
  is_ai_enabled boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- conversations
CREATE TABLE IF NOT EXISTS conversations (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wa_number_id        text NOT NULL REFERENCES whatsapp_numbers(id),
  customer_phone      text NOT NULL,
  state               conversation_state NOT NULL DEFAULT 'GREETING',
  language            text NOT NULL DEFAULT 'id',
  collected_data      jsonb NOT NULL DEFAULT '{}',
  clarification_round int NOT NULL DEFAULT 0,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_conversations_phone ON conversations(customer_phone, wa_number_id);
CREATE INDEX idx_conversations_state ON conversations(state);

-- messages
CREATE TABLE IF NOT EXISTS messages (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES conversations(id),
  sender          message_sender NOT NULL,
  text            text NOT NULL DEFAULT '',
  media_url       text,
  media_type      text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_messages_conversation ON messages(conversation_id, created_at);

-- orders
CREATE TABLE IF NOT EXISTS orders (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id  uuid NOT NULL REFERENCES conversations(id),
  customer_name    text NOT NULL,
  customer_company text NOT NULL,
  customer_address text NOT NULL,
  customer_phone   text NOT NULL,
  items            jsonb NOT NULL DEFAULT '[]',
  subtotal         numeric(15,2) NOT NULL DEFAULT 0,
  shipping_fee     numeric(15,2),
  total            numeric(15,2) NOT NULL DEFAULT 0,
  status           order_status NOT NULL DEFAULT 'PENDING',
  booking_expires_at timestamptz NOT NULL,
  reminder_sent_at   timestamptz,
  approved_at        timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_orders_status ON orders(status);
CREATE INDEX idx_orders_expires ON orders(booking_expires_at) WHERE status = 'PENDING';

-- RLS: enable on all tables
ALTER TABLE whatsapp_numbers ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;

-- whatsapp_numbers: anon can SELECT; service key bypasses RLS
CREATE POLICY "anon_select_wa_numbers" ON whatsapp_numbers
  FOR SELECT TO anon USING (true);

-- conversations: anon SELECT; anon can UPDATE state only to safe values
CREATE POLICY "anon_select_conversations" ON conversations
  FOR SELECT TO anon USING (true);

CREATE POLICY "anon_toggle_conversation_state" ON conversations
  FOR UPDATE TO anon
  USING (true)
  WITH CHECK (state IN ('ESCALATED_ADMIN','COLLECTING'));

-- messages: anon SELECT; anon can INSERT admin messages only
CREATE POLICY "anon_select_messages" ON messages
  FOR SELECT TO anon USING (true);

CREATE POLICY "anon_insert_admin_messages" ON messages
  FOR INSERT TO anon
  WITH CHECK (sender = 'admin');

-- orders: anon SELECT; anon can UPDATE shipping_fee + status only
CREATE POLICY "anon_select_orders" ON orders
  FOR SELECT TO anon USING (true);

CREATE POLICY "anon_approve_orders" ON orders
  FOR UPDATE TO anon
  USING (true)
  WITH CHECK (status IN ('APPROVED'));

-- NOTIFY trigger: fires when React inserts an admin message
CREATE OR REPLACE FUNCTION notify_admin_message()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_notify(
    'admin_messages',
    json_build_object(
      'conversation_id', NEW.conversation_id,
      'text', NEW.text,
      'media_url', NEW.media_url
    )::text
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_admin_message
  AFTER INSERT ON messages
  FOR EACH ROW
  WHEN (NEW.sender = 'admin')
  EXECUTE FUNCTION notify_admin_message();

-- NOTIFY trigger: fires when React approves an order
CREATE OR REPLACE FUNCTION notify_order_approved()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'APPROVED' AND OLD.status != 'APPROVED' THEN
    PERFORM pg_notify(
      'order_approved',
      json_build_object(
        'order_id', NEW.id,
        'conversation_id', NEW.conversation_id,
        'shipping_fee', NEW.shipping_fee
      )::text
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_order_approved
  AFTER UPDATE ON orders
  FOR EACH ROW
  EXECUTE FUNCTION notify_order_approved();

-- Supabase Realtime: enable for all four tables
ALTER PUBLICATION supabase_realtime ADD TABLE whatsapp_numbers;
ALTER PUBLICATION supabase_realtime ADD TABLE conversations;
ALTER PUBLICATION supabase_realtime ADD TABLE messages;
ALTER PUBLICATION supabase_realtime ADD TABLE orders;
