// backend-go/internal/recon/classifier.go
package recon

import "strings"

var cashDepositKeywords = []string{"SETORAN TUNAI", "CDM", "ATM SETORAN", "AUTO TELLER MACH"}
var edcKeywords = []string{"SETTLEMENT EDC", "SETLM EDC", "MERCHANT BCA", "MERCHANT MANDIRI", "EDC SETTLEMENT"}
var feeKeywords = []string{"BIAYA ADMIN", "BIAYA TRF", "ADM E-BANKING", "BIAYA SMS"}
var otherIncomeKeywords = []string{"BUNGA", "CASHBACK", "REWARD"}

func anyContains(s string, words []string) bool {
	for _, w := range words {
		if strings.Contains(s, w) {
			return true
		}
	}
	return false
}

func Classify(line BankLine, accounts []BankAccount, suppliers []Supplier) LineKind {
	d := strings.ToUpper(line.Description)

	if anyContains(d, otherIncomeKeywords) {
		return KindOtherIncome
	}
	if anyContains(d, cashDepositKeywords) {
		return KindCashDeposit
	}
	if anyContains(d, edcKeywords) {
		return KindEDCSettlement
	}
	if anyContains(d, feeKeywords) {
		return KindBankFee
	}
	// Internal transfer: description contains a known own-account number
	for _, acct := range accounts {
		if acct.AccountNumber != "" && strings.Contains(d, acct.AccountNumber) {
			return KindInternalTransfer
		}
	}
	// Supplier payment (OUT only)
	if line.Direction == DirectionOut {
		for _, sup := range suppliers {
			if sup.Name != "" && NameSimilarity(line.Counterparty, sup.Name) >= 0.85 {
				return KindSupplierPayment
			}
		}
		return KindExpense
	}
	return KindCustomerPayment
}
