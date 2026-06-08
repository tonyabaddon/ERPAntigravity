package api

import (
	"bytes"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
)

// fakeApprovalStore lets each test wire just the lookups it cares about.
// All hooks default to "succeeded but nothing found" so tests can override
// only the relevant ones — keeps each test case focused on one branch.
type fakeApprovalStore struct {
	isOwnerFn        func(normalizedNumber string) (bool, error)
	firstOwnerIDFn   func() (string, error)
	findByWAMIDFn    func(wamid string) (int64, error)
	latestPendingFn  func() (int64, error)
	decideFn         func(approvalID int64, decision, ownerUserID string) error
	decideRecordedID int64
	decideRecorded   string
	decideRecOwnerID string
}

func (f *fakeApprovalStore) IsActiveOwnerWANumber(num string) (bool, error) {
	if f.isOwnerFn != nil {
		return f.isOwnerFn(num)
	}
	return false, nil
}

func (f *fakeApprovalStore) FirstOwnerAdminUserID() (string, error) {
	if f.firstOwnerIDFn != nil {
		return f.firstOwnerIDFn()
	}
	return "00000000-0000-0000-0000-000000000099", nil
}

func (f *fakeApprovalStore) FindApprovalByWAMessageID(wamid string) (int64, error) {
	if f.findByWAMIDFn != nil {
		return f.findByWAMIDFn(wamid)
	}
	return 0, ErrNoApproval
}

func (f *fakeApprovalStore) LatestPendingApprovalID() (int64, error) {
	if f.latestPendingFn != nil {
		return f.latestPendingFn()
	}
	return 0, ErrNoApproval
}

func (f *fakeApprovalStore) DecideViaWAButton(approvalID int64, decision, ownerUserID string) error {
	f.decideRecordedID = approvalID
	f.decideRecorded = decision
	f.decideRecOwnerID = ownerUserID
	if f.decideFn != nil {
		return f.decideFn(approvalID, decision, ownerUserID)
	}
	return nil
}

func postWebhook(h http.Handler, body map[string]any) *httptest.ResponseRecorder {
	raw, _ := json.Marshal(body)
	req := httptest.NewRequest(http.MethodPost, "/api/approval/wa-webhook", bytes.NewReader(raw))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)
	return w
}

// TestApprovalWebhook_OwnerApproves pins the happy path: an Owner sends "1"
// in reply to the approval card, the webhook resolves the in_reply_to message
// id to an approval, calls decide_via_wa_button with decision='approved' and
// the resolved Owner admin_users.id, and returns 200 + {"status":"approved"}.
func TestApprovalWebhook_OwnerApproves(t *testing.T) {
	store := &fakeApprovalStore{
		isOwnerFn: func(num string) (bool, error) {
			if num != "6281234567890" {
				t.Fatalf("isOwner got %q, want bare digits", num)
			}
			return true, nil
		},
		findByWAMIDFn: func(wamid string) (int64, error) {
			if wamid != "wamid.HBgN-card-1" {
				t.Fatalf("findByWAMID got %q", wamid)
			}
			return 42, nil
		},
	}
	h := NewApprovalWebhookHandler(store)

	w := postWebhook(h, map[string]any{
		"from":        "6281234567890@s.whatsapp.net",
		"text":        "1",
		"in_reply_to": "wamid.HBgN-card-1",
	})

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", w.Code, w.Body.String())
	}
	var got map[string]string
	if err := json.Unmarshal(w.Body.Bytes(), &got); err != nil {
		t.Fatalf("json: %v", err)
	}
	if got["status"] != "approved" {
		t.Fatalf("status field = %q, want approved", got["status"])
	}
	if store.decideRecordedID != 42 {
		t.Fatalf("decided id = %d, want 42", store.decideRecordedID)
	}
	if store.decideRecorded != "approved" {
		t.Fatalf("decision = %q, want approved", store.decideRecorded)
	}
	if store.decideRecOwnerID != "00000000-0000-0000-0000-000000000099" {
		t.Fatalf("owner id = %q, want canonical Owner UUID", store.decideRecOwnerID)
	}
}

// TestApprovalWebhook_OwnerRejects: text='2' maps to "rejected".
func TestApprovalWebhook_OwnerRejects(t *testing.T) {
	store := &fakeApprovalStore{
		isOwnerFn:     func(string) (bool, error) { return true, nil },
		findByWAMIDFn: func(string) (int64, error) { return 7, nil },
	}
	h := NewApprovalWebhookHandler(store)

	w := postWebhook(h, map[string]any{
		"from":        "6281234567890@s.whatsapp.net",
		"text":        "2",
		"in_reply_to": "wamid.HBgN-card-2",
	})

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", w.Code, w.Body.String())
	}
	if store.decideRecorded != "rejected" {
		t.Fatalf("decision = %q, want rejected", store.decideRecorded)
	}
}

// TestApprovalWebhook_NonOwner: sender not in wa_recipients role=owner → 403,
// and decide_via_wa_button is NEVER called (defence-in-depth: we don't even
// reach the RPC, so the SQL-side role check is the second gate not the first).
func TestApprovalWebhook_NonOwner(t *testing.T) {
	store := &fakeApprovalStore{
		isOwnerFn: func(string) (bool, error) { return false, nil },
	}
	h := NewApprovalWebhookHandler(store)

	w := postWebhook(h, map[string]any{
		"from":        "6289999999999@s.whatsapp.net",
		"text":        "1",
		"in_reply_to": "wamid.X",
	})

	if w.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403", w.Code)
	}
	if store.decideRecorded != "" {
		t.Fatalf("decide must not be called when sender is not an Owner; got %q", store.decideRecorded)
	}
}

// TestApprovalWebhook_AmbiguousText: text that doesn't parse to approve/reject
// returns 400 BEFORE any approval lookup. Pinning this stops Owner-typed
// chatter from incidentally flipping the most recent pending approval.
func TestApprovalWebhook_AmbiguousText(t *testing.T) {
	store := &fakeApprovalStore{
		isOwnerFn: func(string) (bool, error) { return true, nil },
	}
	h := NewApprovalWebhookHandler(store)

	w := postWebhook(h, map[string]any{
		"from": "6281234567890@s.whatsapp.net",
		"text": "halo apa kabar",
	})

	if w.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", w.Code)
	}
	if store.decideRecorded != "" {
		t.Fatalf("decide must not be called on ambiguous text; got %q", store.decideRecorded)
	}
}

// TestApprovalWebhook_NoMatchingApproval: no in_reply_to AND no pending
// approval exists → 404. Without this the webhook would silently no-op and
// the Owner would think their tap worked.
func TestApprovalWebhook_NoMatchingApproval(t *testing.T) {
	store := &fakeApprovalStore{
		isOwnerFn:       func(string) (bool, error) { return true, nil },
		latestPendingFn: func() (int64, error) { return 0, ErrNoApproval },
	}
	h := NewApprovalWebhookHandler(store)

	w := postWebhook(h, map[string]any{
		"from": "6281234567890@s.whatsapp.net",
		"text": "setuju",
	})

	if w.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", w.Code)
	}
}

// TestApprovalWebhook_AlreadyDecided: RPC raises 'approval_requests % is not
// pending or does not exist' for a settled row. The webhook must surface that
// as 409, not 500 — the Owner needs to know their tap was a duplicate, not
// a server fault.
func TestApprovalWebhook_AlreadyDecided(t *testing.T) {
	store := &fakeApprovalStore{
		isOwnerFn:     func(string) (bool, error) { return true, nil },
		findByWAMIDFn: func(string) (int64, error) { return 99, nil },
		decideFn: func(int64, string, string) error {
			return errors.New("pq: approval_requests 99 is not pending or does not exist")
		},
	}
	h := NewApprovalWebhookHandler(store)

	w := postWebhook(h, map[string]any{
		"from":        "6281234567890@s.whatsapp.net",
		"text":        "1",
		"in_reply_to": "wamid.HBgN-already",
	})

	if w.Code != http.StatusConflict {
		t.Fatalf("status = %d, want 409", w.Code)
	}
}

// TestApprovalWebhook_FallbackToLatestPending: missing in_reply_to → webhook
// uses LatestPendingApprovalID. Pinned so we don't regress to "404 unless the
// reply quotes the card" — most casual Owner replies omit the quote.
func TestApprovalWebhook_FallbackToLatestPending(t *testing.T) {
	store := &fakeApprovalStore{
		isOwnerFn:       func(string) (bool, error) { return true, nil },
		latestPendingFn: func() (int64, error) { return 77, nil },
	}
	h := NewApprovalWebhookHandler(store)

	w := postWebhook(h, map[string]any{
		"from": "6281234567890@s.whatsapp.net",
		"text": "setuju",
	})

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", w.Code, w.Body.String())
	}
	if store.decideRecordedID != 77 {
		t.Fatalf("decided id = %d, want 77", store.decideRecordedID)
	}
}
