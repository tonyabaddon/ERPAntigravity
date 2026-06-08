-- Stock Fraud Phase 2, Task 15: `stock-evidence` storage bucket.
--
-- Private bucket that holds photo evidence for stock adjustments (rusak,
-- hilang) and opname variance documentation. Files uploaded here MUST be
-- treated as append-only — once an evidence photo is captured and attached
-- to an approval_request, it becomes part of the audit trail and must not
-- be modified or deleted. Hence we mirror the pattern from migration
-- …012_storage_authenticated_policies.sql (payment-proofs) but split the
-- single FOR ALL policy into two narrow policies (SELECT + INSERT only)
-- and deliberately omit UPDATE and DELETE policies. Without those policies,
-- authenticated users cannot mutate or remove their uploads, which is the
-- intended behavior for evidence files.
--
-- Numbering note: T14 took …020 (wa_button_expire). This is T15 at …021.

-- 1. Bucket. public=false so files require a signed URL or authenticated
-- session to download — they may contain reasons/notes about loss/damage
-- that we do not want public.
INSERT INTO storage.buckets (id, name, public)
VALUES ('stock-evidence', 'stock-evidence', false)
ON CONFLICT (id) DO NOTHING;

-- 2. SELECT policy: any authenticated user may read evidence files. Owner
-- needs to review during PIN/WA-button decision; Manager/Kasir need to
-- view their own past submissions in the Approval Inbox.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
    AND policyname = 'authenticated can read stock-evidence'
  ) THEN
    EXECUTE $p$
      CREATE POLICY "authenticated can read stock-evidence"
        ON storage.objects FOR SELECT TO authenticated
        USING (bucket_id = 'stock-evidence');
    $p$;
  END IF;
END $$;

-- 3. INSERT policy: any authenticated user may upload evidence. The frontend
-- request_adjustment / record_opname_count flows upload here before
-- calling the RPC with the resulting object keys.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
    AND policyname = 'authenticated can upload stock-evidence'
  ) THEN
    EXECUTE $p$
      CREATE POLICY "authenticated can upload stock-evidence"
        ON storage.objects FOR INSERT TO authenticated
        WITH CHECK (bucket_id = 'stock-evidence');
    $p$;
  END IF;
END $$;

-- 4. NO UPDATE policy and NO DELETE policy by design. Evidence is
-- append-only — once uploaded and referenced by an approval_request, the
-- file is part of the audit trail. Postgres RLS denies operations that
-- have no matching policy, so authenticated users will receive
-- permission-denied on any UPDATE or DELETE against bucket_id='stock-evidence'.
-- service_role retains full access for backups/admin maintenance, which is
-- the accepted trade-off per Foundational Decision #1.
