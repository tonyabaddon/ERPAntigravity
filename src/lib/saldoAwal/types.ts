export type SaldoAwalStatus = 'draft' | 'posted' | 'reversed';
export type PiutangHutangMode = 'aggregate' | 'detail';

export interface Step1CashAccount {
  cash_account_id: string;
  cash_account_name: string;
  opening_balance: number;
  as_of: string;
}

export interface Step1Cash {
  accounts: Step1CashAccount[];
}

export interface OpeningARDetailLine {
  customer_id: string | null;
  customer_name: string;
  amount: number;
  original_due_date: string | null;
  invoice_ref: string | null;
  notes: string | null;
}

export interface OpeningAPDetailLine {
  supplier_id: string | null;
  supplier_name: string;
  amount: number;
  original_due_date: string | null;
  invoice_ref: string | null;
  notes: string | null;
}

export interface LainLainLine {
  coa_code: string;
  coa_name: string;
  amount: number;
  notes: string;
}

export interface Step2Aktiva {
  piutang: {
    mode: PiutangHutangMode;
    aggregate_amount: number;
    lines?: OpeningARDetailLine[];
  };
  persediaan: {
    auto_computed_amount: number;
    manual_override: boolean;
    final_amount: number;
    override_reason: string | null;
  };
  aktiva_tetap: {
    amount: number;
    notes: string;
  };
  lain_lain: LainLainLine[];
}

export interface Step3Kewajiban {
  hutang_usaha: {
    mode: PiutangHutangMode;
    aggregate_amount: number;
    lines?: OpeningAPDetailLine[];
  };
  lain_lain: LainLainLine[];
}

export interface Step4Ekuitas {
  modal_owner: { amount: number };
  prive: { amount: number };
  laba_ditahan_calculated: number | null;
}

export interface SaldoAwalStepData {
  wizard_version: 1;
  step1_cash: Step1Cash;
  step2_aktiva: Step2Aktiva;
  step3_kewajiban: Step3Kewajiban;
  step4_ekuitas: Step4Ekuitas;
}

export interface SaldoAwalSnapshot {
  id: string;
  cutover_date: string;
  status: SaldoAwalStatus;
  posted_je_id: string | null;
  step_data: SaldoAwalStepData;
  created_at: string;
  updated_at: string;
}

export interface PreviewTotals {
  total_assets: number;
  total_liab: number;
  total_equity: number;
  laba_ditahan_balancing: number;
}

export interface YearEndClosePreview {
  total_revenue: number;
  total_expense: number;
  net_income: number;
}

export const EMPTY_STEP_DATA: SaldoAwalStepData = {
  wizard_version: 1,
  step1_cash: { accounts: [] },
  step2_aktiva: {
    piutang: { mode: 'aggregate', aggregate_amount: 0 },
    persediaan: {
      auto_computed_amount: 0,
      manual_override: false,
      final_amount: 0,
      override_reason: null,
    },
    aktiva_tetap: { amount: 0, notes: '' },
    lain_lain: [],
  },
  step3_kewajiban: {
    hutang_usaha: { mode: 'aggregate', aggregate_amount: 0 },
    lain_lain: [],
  },
  step4_ekuitas: {
    modal_owner: { amount: 0 },
    prive: { amount: 0 },
    laba_ditahan_calculated: null,
  },
};
