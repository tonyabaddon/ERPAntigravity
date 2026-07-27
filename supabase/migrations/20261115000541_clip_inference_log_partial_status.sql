-- 20261115000541_clip_inference_log_partial_status.sql
-- Extend clip_inference_log status CHECK to allow 'partial'.
--
-- IndexPhotos writes status='partial' when SOME photos succeed and SOME
-- fail in the same request (e.g. one bucket download 404s while others
-- work). Pre-fix the CHECK only allowed ('success','error','cold_start_timeout'),
-- so every partial-success run silently violated 23514 check_violation
-- (masked by fire-and-forget error swallow in the old logInference).
-- Post-fix logInference emits slog.WarnContext on INSERT failure, which
-- would spam Cloud Logging with CHECK violations. This migration adds
-- 'partial' as a first-class status so partial-success runs get logged.
--
-- Idempotent: DROP + ADD with the same constraint name.

ALTER TABLE public.clip_inference_log
  DROP CONSTRAINT IF EXISTS clip_inference_log_status_check;

ALTER TABLE public.clip_inference_log
  ADD CONSTRAINT clip_inference_log_status_check
  CHECK (status = ANY (ARRAY['success'::text, 'error'::text, 'cold_start_timeout'::text, 'partial'::text]));
