package engine

import (
	"context"
	"fmt"
	"testing"

	"github.com/username/sinar-elektrik-backend/internal/models"
)

type mockLLM struct{ response string }

func (m *mockLLM) Complete(_ context.Context, _ string, _ CallOpts) (*LLMResult, error) {
	return &LLMResult{Body: m.response, ModelUsed: "mock"}, nil
}

type mockLLMError struct{ err error }

func (m *mockLLMError) Complete(_ context.Context, _ string, _ CallOpts) (*LLMResult, error) {
	return nil, m.err
}

func newTestMachine(response string) *Machine {
	return &Machine{llm: &mockLLM{response: response}}
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

func TestProcessConfirmingMovesToAddMore(t *testing.T) {
	m := newTestMachine(`{"reply":"Pesanan dikonfirmasi! Mau tambah produk lain?","confirmed":true,"modification_requested":false}`)
	conv := &models.Conversation{
		State:    models.StateConfirming,
		Language: "id",
		CollectedData: models.CollectedData{
			Name: "Budi", Company: "CV Maju", Product: "Kabel 40A", Quantity: 2,
		},
	}
	result, err := m.Process(context.Background(), conv, "OK", nil, "")
	if err != nil {
		t.Fatal(err)
	}
	if result.NextState != models.StateAddMore {
		t.Errorf("confirmed → expected ADD_MORE, got %s", result.NextState)
	}
	if result.NewData == nil {
		t.Fatal("NewData should not be nil after confirmation")
	}
	if len(result.NewData.Cart) != 1 {
		t.Errorf("expected 1 item in cart, got %d", len(result.NewData.Cart))
	}
	if result.NewData.Cart[0].Product != "Kabel 40A" {
		t.Errorf("expected cart item Product=Kabel 40A, got %s", result.NewData.Cart[0].Product)
	}
	if result.NewData.Product != "" {
		t.Errorf("Product field should be cleared after push to cart, got %s", result.NewData.Product)
	}
}

func TestProcessConfirmingModificationRequestedMovesClarifying(t *testing.T) {
	m := newTestMachine(`{"reply":"Baik, mari perbaiki pesanan.","confirmed":false,"modification_requested":true}`)
	conv := &models.Conversation{
		State:    models.StateConfirming,
		Language: "id",
		CollectedData: models.CollectedData{
			Name: "Budi", Company: "CV Maju", Product: "Kabel 40A",
		},
	}
	result, err := m.Process(context.Background(), conv, "ganti", nil, "")
	if err != nil {
		t.Fatal(err)
	}
	if result.NextState != models.StateClarifying {
		t.Errorf("modification_requested → expected CLARIFYING, got %s", result.NextState)
	}
}

func TestProcessAddMore_AddAnother(t *testing.T) {
	m := newTestMachine(`{"reply":"Oke, produk apa berikutnya?","add_another":true,"language":"id"}`)
	conv := &models.Conversation{
		State:    models.StateAddMore,
		Language: "id",
		CollectedData: models.CollectedData{
			Cart: []models.CartItem{{Product: "Kabel 40A", Quantity: 2, Specs: "40A"}},
		},
	}
	result, err := m.Process(context.Background(), conv, "tambah", nil, "")
	if err != nil {
		t.Fatal(err)
	}
	if result.NextState != models.StateCollecting {
		t.Errorf("add_another=true → expected COLLECTING, got %s", result.NextState)
	}
}

func TestProcessAddMore_Done(t *testing.T) {
	m := newTestMachine(`{"reply":"Oke, lanjut ke pengiriman.","add_another":false,"language":"id"}`)
	conv := &models.Conversation{
		State:    models.StateAddMore,
		Language: "id",
		CollectedData: models.CollectedData{
			Cart: []models.CartItem{{Product: "Kabel 40A", Quantity: 2, Specs: "40A"}},
		},
	}
	result, err := m.Process(context.Background(), conv, "tidak", nil, "")
	if err != nil {
		t.Fatal(err)
	}
	if result.NextState != models.StateDelivery {
		t.Errorf("add_another=false → expected DELIVERY, got %s", result.NextState)
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

func TestProcessLLMError_SetsLLMErrorField(t *testing.T) {
	m := &Machine{llm: &mockLLMError{err: fmt.Errorf("context deadline exceeded")}}
	conv := &models.Conversation{State: models.StateGreeting, Language: "id"}
	result, err := m.Process(context.Background(), conv, "halo", nil, "")
	if err != nil {
		t.Fatal(err)
	}
	if result.LLMError == nil {
		t.Error("expected LLMError to be set when LLM call fails")
	}
	if result.Reply == "" {
		t.Error("expected fallback reply to still be populated")
	}
}
