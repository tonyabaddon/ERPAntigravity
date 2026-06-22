BEGIN;

CREATE OR REPLACE VIEW public.trial_balance AS
SELECT
  coa.id AS account_id,
  coa.account_code,
  coa.account_name,
  coa.account_type,
  coa.account_subtype,
  coa.normal_balance,
  coa.tenant_id,
  COALESCE(SUM(CASE WHEN jel.side = 'DEBIT' THEN jel.amount ELSE 0 END), 0) AS total_debit,
  COALESCE(SUM(CASE WHEN jel.side = 'CREDIT' THEN jel.amount ELSE 0 END), 0) AS total_credit,
  CASE coa.normal_balance
    WHEN 'DEBIT' THEN
      COALESCE(SUM(CASE WHEN jel.side = 'DEBIT' THEN jel.amount ELSE 0 END), 0)
      - COALESCE(SUM(CASE WHEN jel.side = 'CREDIT' THEN jel.amount ELSE 0 END), 0)
    WHEN 'CREDIT' THEN
      COALESCE(SUM(CASE WHEN jel.side = 'CREDIT' THEN jel.amount ELSE 0 END), 0)
      - COALESCE(SUM(CASE WHEN jel.side = 'DEBIT' THEN jel.amount ELSE 0 END), 0)
  END AS balance
FROM public.chart_of_accounts coa
LEFT JOIN public.journal_entry_lines jel ON jel.account_id = coa.id
LEFT JOIN public.journal_entries je ON je.id = jel.entry_id AND je.is_posted = true
WHERE coa.is_active = true
GROUP BY coa.id, coa.account_code, coa.account_name, coa.account_type, coa.account_subtype, coa.normal_balance, coa.tenant_id
ORDER BY coa.account_code;

CREATE OR REPLACE VIEW public.general_ledger AS
SELECT
  jel.account_id,
  coa.account_code,
  coa.account_name,
  coa.normal_balance,
  je.id AS entry_id,
  je.entry_number,
  je.entry_date,
  je.posted_at,
  je.description AS entry_description,
  jel.description AS line_description,
  jel.side,
  jel.amount,
  CASE WHEN jel.side = 'DEBIT' THEN jel.amount ELSE 0 END AS debit,
  CASE WHEN jel.side = 'CREDIT' THEN jel.amount ELSE 0 END AS credit,
  jel.counterparty_type,
  jel.counterparty_id,
  jel.status,
  jel.reconciled_at,
  je.source_type,
  je.source_ref_table,
  je.source_ref_id,
  CASE coa.normal_balance
    WHEN 'DEBIT' THEN
      SUM(CASE WHEN jel.side = 'DEBIT' THEN jel.amount ELSE -jel.amount END)
      OVER (PARTITION BY jel.account_id ORDER BY je.entry_date, je.posted_at, jel.line_number)
    WHEN 'CREDIT' THEN
      SUM(CASE WHEN jel.side = 'CREDIT' THEN jel.amount ELSE -jel.amount END)
      OVER (PARTITION BY jel.account_id ORDER BY je.entry_date, je.posted_at, jel.line_number)
  END AS running_balance,
  je.tenant_id
FROM public.journal_entry_lines jel
JOIN public.journal_entries je ON je.id = jel.entry_id
JOIN public.chart_of_accounts coa ON coa.id = jel.account_id
WHERE je.is_posted = true;

GRANT SELECT ON public.trial_balance TO authenticated;
GRANT SELECT ON public.general_ledger TO authenticated;

COMMIT;
