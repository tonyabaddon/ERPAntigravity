-- Allow anon role to SELECT kasir_transactions so dashboard/laporan metrics work
-- without requiring an authenticated Supabase Auth session.
-- Consistent with existing anon_select_orders and anon_select_conversations policies.
CREATE POLICY "anon_select_kasir"
  ON public.kasir_transactions
  FOR SELECT
  TO anon
  USING (true);
