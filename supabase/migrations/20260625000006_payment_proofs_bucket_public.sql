-- Make payment-proofs bucket public so getPublicUrl works.
-- Acceptable trade-off: URLs are random-named (orderId + timestamp + filename) — unguessable in practice.
UPDATE storage.buckets SET public = true WHERE id = 'payment-proofs';
