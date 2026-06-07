// backend-go/internal/recon/closer.go
package recon

import (
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/username/sinar-elektrik-backend/internal/db"
)

type CloserHandler struct {
	DB *db.Client
}

type CloseReq struct {
	Year  int `json:"year"`
	Month int `json:"month"`
}

type CloseResp struct {
	OK     bool   `json:"ok"`
	Reason string `json:"reason,omitempty"`
}

func (h *CloserHandler) Close(w http.ResponseWriter, r *http.Request) {
	var req CloseReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	ctx := r.Context()

	// Validate: no RED lanes in period, no PENDING batches, no OPEN slots in period
	var redCount, pendBatch, openSlots int
	err := h.DB.DB.QueryRowContext(ctx, `
		SELECT
		  (SELECT COUNT(*) FROM bank_statement_lines WHERE EXTRACT(YEAR FROM txn_date)=$1 AND EXTRACT(MONTH FROM txn_date)=$2 AND lane='RED'),
		  (SELECT COUNT(*) FROM cash_deposit_batches WHERE status='PENDING'),
		  (SELECT COUNT(*) FROM payable_slots ps JOIN orders o ON o.id=ps.order_id WHERE ps.status='OPEN' AND EXTRACT(YEAR FROM o.created_at)=$1 AND EXTRACT(MONTH FROM o.created_at)=$2)
	`, req.Year, req.Month).Scan(&redCount, &pendBatch, &openSlots)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	enc := json.NewEncoder(w)

	if redCount > 0 || pendBatch > 0 || openSlots > 0 {
		_ = enc.Encode(CloseResp{
			OK:     false,
			Reason: fmt.Sprintf("blocked: red=%d pendingBatch=%d openSlot=%d", redCount, pendBatch, openSlots),
		})
		return
	}

	// Insert period as CLOSED with minimal summary
	summary := map[string]any{"closed_at": "now", "year": req.Year, "month": req.Month}
	summaryJSON, _ := json.Marshal(summary)
	_, err = h.DB.DB.ExecContext(ctx, `
		INSERT INTO reconciliation_periods (year, month, status, closed_at, summary)
		VALUES ($1,$2,'CLOSED',now(),$3::jsonb)
		ON CONFLICT (year, month) DO UPDATE SET status='CLOSED', closed_at=now(), summary=EXCLUDED.summary
	`, req.Year, req.Month, string(summaryJSON))
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	_ = enc.Encode(CloseResp{OK: true})
}
