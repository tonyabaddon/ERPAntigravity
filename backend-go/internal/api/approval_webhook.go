// Package api hosts HTTP handlers for backend-internal control-plane
// endpoints — currently just the WhatsApp approval webhook (Phase 2 T18).
// Kept separate from internal/whatsapp/ because the handler has no whatsmeow
// dependency: it's a plain JSON-over-HTTP endpoint invoked by the WA bridge
// daemon (which lives outside this Go binary) when an Owner taps "Setujui"
// or "Tolak" on the approval card.
package api

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"
)

// ErrNoApproval is the sentinel returned by ApprovalStore lookups when no
// matching approval exists. The handler maps it to 404 — callers (real *db
// implementations) should wrap or return this value rather than sql.ErrNoRows
// so we don't leak the SQL driver detail into the HTTP layer.
var ErrNoApproval = errors.New("no matching approval request")

// ApprovalStore is the seam between the handler and the database. Kept as a
// narrow interface (vs. taking *db.Client directly) so the test suite injects
// a fakeApprovalStore and the handler can be exercised without standing up
// Postgres. Real wiring lives in main.go (Task 20).
type ApprovalStore interface {
	// IsActiveOwnerWANumber returns true iff num matches an active wa_recipients
	// row with role='owner'. num is the bare phone digits (caller normalises
	// the JID suffix off before invoking).
	IsActiveOwnerWANumber(num string) (bool, error)

	// FirstOwnerAdminUserID returns the canonical Owner admin_users.id. MSME
	// deployments are single-Owner; this returns LIMIT 1 deterministically.
	// Used as p_decided_by_user_id in the RPC call.
	FirstOwnerAdminUserID() (string, error)

	// FindApprovalByWAMessageID resolves the WA in_reply_to message id to the
	// approval_requests.id whose wa_message_id matches. Returns ErrNoApproval
	// when there is no match.
	FindApprovalByWAMessageID(wamid string) (int64, error)

	// LatestPendingApprovalID returns the id of the most recently requested
	// pending approval (any owner). Used when the Owner replies without
	// quoting the card. Returns ErrNoApproval when the queue is empty.
	LatestPendingApprovalID() (int64, error)

	// DecideViaWAButton invokes the decide_via_wa_button RPC. Returns the
	// underlying error verbatim; the handler maps the 'is not pending or does
	// not exist' substring to 409 and 'not authorized' to 403.
	DecideViaWAButton(approvalID int64, decision, ownerUserID string) error
}

// approvalWebhookRequest is the JSON payload posted by the WA bridge daemon.
// in_reply_to is optional: when the Owner taps the in-chat button WhatsApp
// includes the quoted message id, but a casual typed reply ("setuju") often
// omits it — the handler falls back to LatestPendingApprovalID in that case.
type approvalWebhookRequest struct {
	From      string `json:"from"`
	Text      string `json:"text"`
	InReplyTo string `json:"in_reply_to,omitempty"`
}

type approvalWebhookHandler struct {
	store ApprovalStore
}

// NewApprovalWebhookHandler builds the http.Handler for POST
// /api/approval/wa-webhook. Returned as http.Handler (not *struct) so the
// caller can mount it with mux.Handle("/api/approval/wa-webhook", h).
func NewApprovalWebhookHandler(store ApprovalStore) http.Handler {
	return &approvalWebhookHandler{store: store}
}

// parseDecision maps the Owner's free-text reply to the canonical RPC
// decision string. Returns "" when the text is ambiguous. The accepted
// vocabulary is deliberately small — adding looser matches risks silently
// flipping the wrong gate when the Owner is chatting casually.
//
// Indonesian (primary) and English (secondary, for international SI integrators)
// are both covered. "1" / "2" are the literal button labels Calista shows
// underneath the card so the Owner can reply with a single keystroke.
func parseDecision(text string) string {
	t := strings.ToLower(strings.TrimSpace(text))
	switch t {
	case "1", "setuju", "approve", "approved", "ya", "ok":
		return "approved"
	case "2", "tolak", "reject", "rejected", "tidak", "no":
		return "rejected"
	}
	return ""
}

// normaliseWANumber strips the @s.whatsapp.net suffix (and any @ variant) so
// the bare-digits string can be compared against wa_recipients.wa_number,
// which is stored without a suffix. Whitespace is also trimmed defensively.
func normaliseWANumber(from string) string {
	s := strings.TrimSpace(from)
	if i := strings.Index(s, "@"); i >= 0 {
		s = s[:i]
	}
	return s
}

func (h *approvalWebhookHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req approvalWebhookRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid json", http.StatusBadRequest)
		return
	}
	if req.From == "" {
		http.Error(w, "missing from", http.StatusBadRequest)
		return
	}

	// 1. Owner gate — defence-in-depth before any RPC call. The RPC has its
	//    own role check (admin_users.role='Owner') but we bounce non-Owners
	//    here so we never expose RPC error strings to a non-authorised JID.
	num := normaliseWANumber(req.From)
	isOwner, err := h.store.IsActiveOwnerWANumber(num)
	if err != nil {
		http.Error(w, "owner check failed", http.StatusInternalServerError)
		return
	}
	if !isOwner {
		http.Error(w, "sender is not an active Owner", http.StatusForbidden)
		return
	}

	// 2. Decide BEFORE looking up the approval. An ambiguous text shouldn't
	//    consume the latest-pending fallback — silently parsing "halo" as
	//    "approved" would be a security bug.
	decision := parseDecision(req.Text)
	if decision == "" {
		http.Error(w, "ambiguous decision text", http.StatusBadRequest)
		return
	}

	// 3. Resolve approval id: prefer the quoted message id when present, fall
	//    back to the latest pending row otherwise.
	var approvalID int64
	if req.InReplyTo != "" {
		approvalID, err = h.store.FindApprovalByWAMessageID(req.InReplyTo)
	} else {
		approvalID, err = h.store.LatestPendingApprovalID()
	}
	if errors.Is(err, ErrNoApproval) {
		http.Error(w, "no matching approval", http.StatusNotFound)
		return
	}
	if err != nil {
		http.Error(w, "approval lookup failed", http.StatusInternalServerError)
		return
	}

	// 4. Resolve the canonical Owner admin_users.id. Single-Owner MSME
	//    deployments: take the first Owner row. Multi-Owner is a Phase 3
	//    concern.
	ownerUserID, err := h.store.FirstOwnerAdminUserID()
	if err != nil {
		http.Error(w, "owner lookup failed", http.StatusInternalServerError)
		return
	}

	// 5. Fire the RPC. Map the two RPC error families to specific status
	//    codes so the client (and the WA bridge daemon's retry policy) can
	//    distinguish "already decided" (don't retry, surface "duplicate tap"
	//    to Owner) from a generic server fault.
	if err := h.store.DecideViaWAButton(approvalID, decision, ownerUserID); err != nil {
		msg := err.Error()
		if strings.Contains(msg, "is not pending or does not exist") {
			http.Error(w, "approval already decided", http.StatusConflict)
			return
		}
		if strings.Contains(msg, "not authorized") {
			http.Error(w, "not authorized", http.StatusForbidden)
			return
		}
		http.Error(w, "rpc failed", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(map[string]string{"status": decision})
}
