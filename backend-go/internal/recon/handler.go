// backend-go/internal/recon/handler.go
package recon

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"time"

	"github.com/username/sinar-elektrik-backend/internal/db"
	"github.com/username/sinar-elektrik-backend/internal/gemini"
)

type Handler struct {
	DB  *db.Client
	Doc *gemini.DocumentClient
}

func (h *Handler) Upload(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseMultipartForm(20 << 20); err != nil {
		http.Error(w, "file too large", http.StatusBadRequest)
		return
	}
	file, header, err := r.FormFile("file")
	if err != nil {
		http.Error(w, "missing file", http.StatusBadRequest)
		return
	}
	defer file.Close()

	bankAccountID := r.FormValue("bank_account_id")
	if bankAccountID == "" {
		http.Error(w, "missing bank_account_id", http.StatusBadRequest)
		return
	}
	bankCode := r.FormValue("bank_code")
	periodStartStr := r.FormValue("period_start")
	periodEndStr := r.FormValue("period_end")
	periodStart, _ := time.Parse("2006-01-02", periodStartStr)
	periodEnd, _ := time.Parse("2006-01-02", periodEndStr)

	pdfBytes, err := io.ReadAll(file)
	if err != nil {
		http.Error(w, "read fail", http.StatusInternalServerError)
		return
	}

	ctx := r.Context()
	storagePath := "recon/" + bankAccountID + "/" + strconv.FormatInt(time.Now().Unix(), 10) + "_" + header.Filename
	importID, err := h.DB.CreateBankImport(ctx, db.BankImport{
		BankAccountID: bankAccountID,
		PeriodStart:   periodStart,
		PeriodEnd:     periodEnd,
		Filename:      header.Filename,
		StoragePath:   storagePath,
		Status:        "PROCESSING",
	})
	if err != nil {
		http.Error(w, "create import: "+err.Error(), http.StatusInternalServerError)
		return
	}

	extracted, err := h.Doc.ExtractMutasi(ctx, pdfBytes, bankCode)
	if err != nil {
		_ = h.DB.UpdateBankImportFailed(ctx, importID, err.Error())
		http.Error(w, "gemini: "+err.Error(), http.StatusInternalServerError)
		return
	}

	lines := make([]BankLine, 0, len(extracted))
	for _, e := range extracted {
		txnDate, _ := time.Parse("2006-01-02", e.TxnDate)
		hash := sha256Hex(bankAccountID, e.TxnDate, e.Amount, e.Description, e.Balance)
		lineID, err := h.DB.InsertBankLine(ctx, db.BankStatementLine{
			ImportID:      importID,
			BankAccountID: bankAccountID,
			TxnDate:       txnDate,
			Amount:        e.Amount,
			Direction:     e.Direction,
			Description:   e.Description,
			Counterparty:  e.Counterparty,
			LineKind:      "UNKNOWN",
			Lane:          "GRAY",
			DedupHash:     hash,
		})
		if err != nil || lineID == "" {
			// dedup conflicts return empty id with sql.ErrNoRows-like error — skip silently
			continue
		}
		lines = append(lines, BankLine{
			ID:            lineID,
			BankAccountID: bankAccountID,
			TxnDate:       txnDate,
			Amount:        e.Amount,
			Direction:     Direction(e.Direction),
			Description:   e.Description,
			Counterparty:  e.Counterparty,
		})
	}

	matched, err := ProcessLines(ctx, dbAdapter{h.DB}, importID, lines)
	if err != nil {
		_ = h.DB.UpdateBankImportFailed(ctx, importID, err.Error())
		http.Error(w, "process: "+err.Error(), http.StatusInternalServerError)
		return
	}
	_ = h.DB.UpdateBankImportReady(ctx, importID, len(lines), matched, 0, 0)

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"import_id":     importID,
		"line_count":    len(lines),
		"matched_count": matched,
	})
}

func sha256Hex(parts ...interface{}) string {
	h := sha256.New()
	for _, p := range parts {
		fmt.Fprintf(h, "|%v", p)
	}
	return hex.EncodeToString(h.Sum(nil))
}

// dbAdapter bridges *db.Client to the DBPort interface used by ProcessLines.
type dbAdapter struct{ c *db.Client }

func (a dbAdapter) ListBankAccounts(ctx context.Context) ([]db.BankAccount, error) {
	return a.c.ListBankAccounts(ctx)
}
func (a dbAdapter) ListSuppliers(ctx context.Context) ([]db.Supplier, error) {
	return a.c.ListSuppliers(ctx)
}
func (a dbAdapter) ListOpenSlotsForDate(ctx context.Context, txnDate time.Time, back, fwd int) ([]db.PayableSlot, error) {
	return a.c.ListOpenSlotsForDate(ctx, txnDate, back, fwd)
}
func (a dbAdapter) InsertAllocation(ctx context.Context, lineID, slotID string, amount float64) error {
	return a.c.InsertAllocation(ctx, lineID, slotID, amount)
}
func (a dbAdapter) UpdateLineLane(ctx context.Context, lineID, lane, reason string, conf float64) error {
	return a.c.UpdateLineLane(ctx, lineID, lane, reason, conf)
}
func (a dbAdapter) GetSettings(ctx context.Context) (db.Settings, error) {
	return a.c.GetSettings(ctx)
}
