-- Payment proof: new columns for pelunasan + marketplace + audit metadata
ALTER TABLE kasir_transactions
  ADD COLUMN IF NOT EXISTS pelunasan_proof_url text NULL,
  ADD COLUMN IF NOT EXISTS marketplace_proof_url text NULL,
  ADD COLUMN IF NOT EXISTS proof_source text NULL CHECK (proof_source IS NULL OR proof_source IN ('WA_CALISTA', 'ADMIN_UPLOAD', 'MARKETPLACE_SCREENSHOT')),
  ADD COLUMN IF NOT EXISTS proof_uploaded_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS proof_uploaded_by uuid NULL REFERENCES auth.users(id);

-- Create storage bucket (idempotent via ON CONFLICT)
INSERT INTO storage.buckets (id, name, public)
VALUES ('payment-proofs', 'payment-proofs', false)
ON CONFLICT (id) DO NOTHING;

-- RLS policies for the bucket (drop+create pattern to make idempotent)
DROP POLICY IF EXISTS "Authenticated users can upload payment proofs" ON storage.objects;
CREATE POLICY "Authenticated users can upload payment proofs"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'payment-proofs');

DROP POLICY IF EXISTS "Authenticated users can view payment proofs" ON storage.objects;
CREATE POLICY "Authenticated users can view payment proofs"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'payment-proofs');

COMMENT ON COLUMN kasir_transactions.pelunasan_proof_url IS 'URL of pelunasan (DP balance) proof upload — Stage 3b verify';
COMMENT ON COLUMN kasir_transactions.marketplace_proof_url IS 'URL of marketplace settlement screenshot (Tokopedia/Shopee seller dashboard)';
COMMENT ON COLUMN kasir_transactions.proof_source IS 'Where the latest proof came from: WA_CALISTA | ADMIN_UPLOAD | MARKETPLACE_SCREENSHOT';
