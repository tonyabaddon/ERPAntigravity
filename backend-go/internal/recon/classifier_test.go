// backend-go/internal/recon/classifier_test.go
package recon

import "testing"

func TestClassify_CashDeposit(t *testing.T) {
	line := BankLine{Direction: DirectionIn, Description: "SETORAN TUNAI CDM SUNTER"}
	if got := Classify(line, nil, nil); got != KindCashDeposit {
		t.Errorf("got %v, want CASH_DEPOSIT", got)
	}
}

func TestClassify_EDCSettlement(t *testing.T) {
	line := BankLine{Direction: DirectionIn, Description: "SETTLEMENT EDC BCA MERCHANT"}
	if got := Classify(line, nil, nil); got != KindEDCSettlement {
		t.Errorf("got %v, want EDC_SETTLEMENT", got)
	}
}

func TestClassify_BankFee(t *testing.T) {
	line := BankLine{Direction: DirectionOut, Description: "BIAYA ADMIN BULANAN"}
	if got := Classify(line, nil, nil); got != KindBankFee {
		t.Errorf("got %v, want BANK_FEE", got)
	}
}

func TestClassify_OtherIncome_BungaBank(t *testing.T) {
	line := BankLine{Direction: DirectionIn, Description: "BUNGA TABUNGAN"}
	if got := Classify(line, nil, nil); got != KindOtherIncome {
		t.Errorf("got %v, want OTHER_INCOME", got)
	}
}

func TestClassify_InternalTransfer(t *testing.T) {
	accts := []BankAccount{{ID: "a2", BankCode: "MANDIRI", AccountNumber: "5678"}}
	line := BankLine{Direction: DirectionOut, Description: "TRSF KE 5678 GARINDO JAYA"}
	if got := Classify(line, accts, nil); got != KindInternalTransfer {
		t.Errorf("got %v, want INTERNAL_TRANSFER", got)
	}
}

func TestClassify_SupplierPayment(t *testing.T) {
	suppliers := []Supplier{{ID: "s1", Name: "PT Sinar Listrik Sejati"}}
	line := BankLine{Direction: DirectionOut, Counterparty: "SINAR LISTRIK SEJATI PT"}
	if got := Classify(line, nil, suppliers); got != KindSupplierPayment {
		t.Errorf("got %v, want SUPPLIER_PAYMENT", got)
	}
}

func TestClassify_CustomerPayment_DefaultIn(t *testing.T) {
	line := BankLine{Direction: DirectionIn, Counterparty: "BUDI SETIAWAN", Description: "TRSF MASUK"}
	if got := Classify(line, nil, nil); got != KindCustomerPayment {
		t.Errorf("got %v, want CUSTOMER_PAYMENT", got)
	}
}

func TestClassify_Expense_DefaultOut(t *testing.T) {
	line := BankLine{Direction: DirectionOut, Description: "BAYAR INTERNET ABC"}
	if got := Classify(line, nil, nil); got != KindExpense {
		t.Errorf("got %v, want EXPENSE", got)
	}
}
