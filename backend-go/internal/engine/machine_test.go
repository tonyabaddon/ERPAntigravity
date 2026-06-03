package engine

import (
	"context"
	"testing"

	"github.com/username/sinar-elektrik-backend/internal/models"
)

type mockGemini struct{ response string }

func (m *mockGemini) GenerateReply(_ context.Context, _ string) (string, error) {
	return m.response, nil
}

func newTestMachine(response string) *Machine {
	return &Machine{gemini: &mockGemini{response: response}}
}

func TestProcessGreeting(t *testing.T) {
	m := newTestMachine(`{"reply":"Halo!","detected_language":"id"}`)
	conv := &models.Conversation{State: models.StateGreeting, Language: "id"}
	result, err := m.Process(context.Background(), conv, "halo", nil, "")
	if err != nil {
		t.Fatal(err)
	}
	if result.NextState != models.StateCollecting {
		t.Errorf("expected COLLECTING, got %s", result.NextState)
	}
	if result.Language != "id" {
		t.Errorf("expected language id, got %s", result.Language)
	}
}

func TestProcessCollectingMovesToClarifying(t *testing.T) {
	m := newTestMachine(`{"reply":"Terima kasih!","collected":{"name":"Budi","company":"CV Maju","address":"Surabaya","product":"Kabel 40A"},"next_action":"CONTINUE"}`)
	conv := &models.Conversation{
		State:    models.StateCollecting,
		Language: "id",
		CollectedData: models.CollectedData{
			Name: "Budi", Company: "CV Maju", Address: "Surabaya", Product: "Kabel 40A",
		},
	}
	result, err := m.Process(context.Background(), conv, "ya betul", nil, "")
	if err != nil {
		t.Fatal(err)
	}
	if result.NextState != models.StateClarifying {
		t.Errorf("all fields filled → expected CLARIFYING, got %s", result.NextState)
	}
}

func TestProcessEscalate(t *testing.T) {
	m := newTestMachine(`{"reply":"menghubungi admin","collected":{"name":"","company":"","address":"","product":""},"next_action":"ESCALATE"}`)
	conv := &models.Conversation{State: models.StateCollecting, Language: "id"}
	result, err := m.Process(context.Background(), conv, "saya butuh diskon", nil, "")
	if err != nil {
		t.Fatal(err)
	}
	if result.NextState != models.StateEscalatedAdmin {
		t.Errorf("ESCALATE action → expected ESCALATED_ADMIN, got %s", result.NextState)
	}
}

func TestProcessConfirmingBooked(t *testing.T) {
	m := newTestMachine(`{"reply":"Pesanan dikonfirmasi!","confirmed":true,"modification_requested":false}`)
	conv := &models.Conversation{
		State:    models.StateConfirming,
		Language: "id",
		CollectedData: models.CollectedData{
			Name: "Budi", Company: "CV Maju", Address: "Surabaya", Product: "Kabel 40A",
		},
	}
	result, err := m.Process(context.Background(), conv, "OK", nil, "")
	if err != nil {
		t.Fatal(err)
	}
	if result.NextState != models.StateBooked {
		t.Errorf("confirmed → expected BOOKED, got %s", result.NextState)
	}
	if !result.CreateOrder {
		t.Error("CreateOrder should be true on BOOKED")
	}
}

func TestProcessGeminiFallback(t *testing.T) {
	m := newTestMachine("this is not json")
	conv := &models.Conversation{State: models.StateGreeting, Language: "id"}
	result, err := m.Process(context.Background(), conv, "halo", nil, "")
	if err != nil {
		t.Fatal(err)
	}
	if result.NextState != models.StateGreeting {
		t.Errorf("on parse fail, state should stay GREETING, got %s", result.NextState)
	}
	if result.Reply == "" {
		t.Error("fallback reply should not be empty")
	}
}

func TestProcessBookedStateReturnsEmptyReply(t *testing.T) {
	// BOOKED state has no case in the machine switch — it must never reach
	// machine.Process() in production. This test documents that if it does,
	// the machine returns an empty reply (not a fallback error), confirming
	// the handler-level intercept in processMessage() is the correct fix.
	m := newTestMachine(`{"reply":"some response"}`)
	conv := &models.Conversation{State: models.StateBooked, Language: "id"}
	result, err := m.Process(context.Background(), conv, "halo", nil, "")
	if err != nil {
		t.Fatal(err)
	}
	if result.Reply != "" {
		t.Errorf("BOOKED state should produce no reply from machine, got: %s", result.Reply)
	}
	if result.NextState != models.StateBooked {
		t.Errorf("BOOKED state should remain BOOKED, got %s", result.NextState)
	}
}
