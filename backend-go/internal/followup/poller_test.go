package followup

import (
	"testing"
	"time"

	"github.com/username/sinar-elektrik-backend/internal/models"
)

func TestBuildFollowupMessage_StandardID(t *testing.T) {
	conv := &models.Conversation{
		State:    models.StateCollecting,
		Language: "id",
		CollectedData: models.CollectedData{Name: "Budi"},
	}
	msg1 := buildFollowupMessage(conv, 1)
	msg2 := buildFollowupMessage(conv, 2)

	if msg1 == "" {
		t.Fatal("expected non-empty message for count=1")
	}
	if msg2 == "" {
		t.Fatal("expected non-empty message for count=2")
	}
	if msg1 == msg2 {
		t.Error("count=1 and count=2 messages should differ")
	}
	if !containsString(msg1, "Budi") {
		t.Errorf("message 1 should contain customer name, got: %s", msg1)
	}
	if !containsString(msg2, "Budi") {
		t.Errorf("message 2 should contain customer name, got: %s", msg2)
	}
}

func TestBuildFollowupMessage_StandardEN(t *testing.T) {
	conv := &models.Conversation{
		State:    models.StateConfirming,
		Language: "en",
		CollectedData: models.CollectedData{Name: "John"},
	}
	msg1 := buildFollowupMessage(conv, 1)
	msg2 := buildFollowupMessage(conv, 2)

	if !containsString(msg1, "John") {
		t.Errorf("EN message 1 should contain name, got: %s", msg1)
	}
	if !containsString(msg2, "John") {
		t.Errorf("EN message 2 should contain name, got: %s", msg2)
	}
	if containsString(msg1, "Bapak/Ibu") {
		t.Errorf("EN message should not contain 'Bapak/Ibu', got: %s", msg1)
	}
}

func TestBuildFollowupMessage_BookedID(t *testing.T) {
	conv := &models.Conversation{
		State:    models.StateBooked,
		Language: "id",
		CollectedData: models.CollectedData{Name: "Sari"},
	}
	msg1 := buildFollowupMessage(conv, 1)
	msg2 := buildFollowupMessage(conv, 2)

	if !containsString(msg1, "Sari") {
		t.Errorf("BOOKED message 1 should contain name, got: %s", msg1)
	}
	if !containsString(msg2, "Sari") {
		t.Errorf("BOOKED message 2 should contain name, got: %s", msg2)
	}
	if !containsString(msg1, "pembayaran") && !containsString(msg1, "dikonfirmasi") {
		t.Errorf("BOOKED message 1 should reference payment/confirmation, got: %s", msg1)
	}
}

func TestBuildFollowupMessage_BookedEN(t *testing.T) {
	conv := &models.Conversation{
		State:    models.StateBooked,
		Language: "en",
		CollectedData: models.CollectedData{Name: "Alice"},
	}
	msg1 := buildFollowupMessage(conv, 1)
	msg2 := buildFollowupMessage(conv, 2)

	if !containsString(msg1, "Alice") {
		t.Errorf("BOOKED EN message 1 should contain name, got: %s", msg1)
	}
	if !containsString(msg1, "payment") && !containsString(msg1, "confirmed") {
		t.Errorf("BOOKED EN message 1 should reference payment, got: %s", msg1)
	}
	if !containsString(msg2, "Alice") {
		t.Errorf("BOOKED EN message 2 should contain name, got: %s", msg2)
	}
	if !containsString(msg2, "payment") && !containsString(msg2, "reminder") {
		t.Errorf("BOOKED EN message 2 should reference payment/reminder, got: %s", msg2)
	}
	if msg1 == msg2 {
		t.Error("BOOKED EN count=1 and count=2 messages should differ")
	}
}

func TestIsNewWIBDay_NilIsNewDay(t *testing.T) {
	if !isNewWIBDay(nil) {
		t.Error("nil last_followup_date should be treated as new day")
	}
}

func TestIsNewWIBDay_YesterdayIsNewDay(t *testing.T) {
	yesterday := time.Now().UTC().Add(-24 * time.Hour)
	d := time.Date(yesterday.Year(), yesterday.Month(), yesterday.Day(), 0, 0, 0, 0, time.UTC)
	if !isNewWIBDay(&d) {
		t.Error("yesterday's date should be treated as new day")
	}
}

func TestIsNewWIBDay_FarFutureIsNotNewDay(t *testing.T) {
	future := time.Now().UTC().Add(100 * 365 * 24 * time.Hour)
	d := time.Date(future.Year(), future.Month(), future.Day(), 0, 0, 0, 0, time.UTC)
	if isNewWIBDay(&d) {
		t.Error("future date should not be treated as a new day")
	}
}

func containsString(s, substr string) bool {
	return len(s) >= len(substr) && (s == substr || len(substr) == 0 ||
		func() bool {
			for i := 0; i <= len(s)-len(substr); i++ {
				if s[i:i+len(substr)] == substr {
					return true
				}
			}
			return false
		}())
}
