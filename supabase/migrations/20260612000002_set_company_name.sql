-- E2E audit 2026-06-12 data fix: replace the placeholder "TEST_DO_NOT_SAVE"
-- company name with "Garindo Jaya Panel" so the invoice header (the kasir
-- modal), the daily-report PDF header, the PO PDF header, and the CSV
-- export filename all stop emitting the test marker to actual customers.
--
-- Idempotent: only flips if the current value is the test placeholder.
-- The Pengaturan UI remains the authoritative editor for ongoing changes.

UPDATE public.company_settings
   SET company_name = 'Garindo Jaya Panel',
       updated_at   = now()
 WHERE id = 1
   AND company_name = 'TEST_DO_NOT_SAVE';
