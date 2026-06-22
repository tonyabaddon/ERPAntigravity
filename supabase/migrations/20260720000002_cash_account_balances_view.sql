BEGIN;

CREATE OR REPLACE VIEW public.cash_account_balances AS
SELECT
  ca.id AS cash_account_id,
  ca.internal_label,
  ca.account_type,
  ca.purpose,
  ca.bank_code,
  ca.account_number,
  ca.account_holder,
  ca.provider,
  ca.sort_order,
  ca.is_active,
  ca.tenant_id,
  ca.opening_balance,
  COALESCE(SUM(CASE WHEN jel.status='CLEARED' AND jel.side='DEBIT' THEN jel.amount ELSE 0 END), 0) AS total_debit,
  COALESCE(SUM(CASE WHEN jel.status='CLEARED' AND jel.side='CREDIT' THEN jel.amount ELSE 0 END), 0) AS total_credit,
  COALESCE(SUM(CASE WHEN jel.status='PENDING' AND jel.side='DEBIT' THEN jel.amount ELSE 0 END), 0) AS pending_in,
  ca.opening_balance
    + COALESCE(SUM(CASE WHEN jel.status='CLEARED' AND jel.side='DEBIT' THEN jel.amount ELSE 0 END), 0)
    - COALESCE(SUM(CASE WHEN jel.status='CLEARED' AND jel.side='CREDIT' THEN jel.amount ELSE 0 END), 0) AS current_balance,
  MAX(je.entry_date) AS last_movement_date,
  COUNT(*) FILTER (WHERE je.entry_date >= date_trunc('month', now())) AS movements_this_month
FROM public.cash_accounts ca
LEFT JOIN public.journal_entry_lines jel ON jel.account_id = ca.coa_account_id
LEFT JOIN public.journal_entries je ON je.id = jel.entry_id AND je.is_posted = true
WHERE ca.is_active = true
GROUP BY ca.id, ca.internal_label, ca.account_type, ca.purpose, ca.bank_code, ca.account_number, ca.account_holder, ca.provider, ca.sort_order, ca.is_active, ca.tenant_id, ca.opening_balance;

GRANT SELECT ON public.cash_account_balances TO authenticated;

COMMIT;
