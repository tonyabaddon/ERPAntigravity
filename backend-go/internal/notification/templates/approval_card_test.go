package templates

import (
	"context"
	"strings"
	"testing"
)

func TestApprovalCard_Build_HappyPath(t *testing.T) {
	c := ApprovalCard{}
	msg, err := c.Build(context.Background(), map[string]any{
		"approval_id": "42",
		"type":        "kasir_discount",
		"details":     `{"discount_value":10}`,
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !strings.Contains(msg, "approve:42") {
		t.Errorf("expected 'approve:42' in output, got: %s", msg)
	}
	if !strings.Contains(msg, "reject:42") {
		t.Errorf("expected 'reject:42' in output, got: %s", msg)
	}
	if !strings.Contains(msg, "kasir_discount") {
		t.Errorf("expected request type in output, got: %s", msg)
	}
}

func TestApprovalCard_Build_MissingParam(t *testing.T) {
	c := ApprovalCard{}
	_, err := c.Build(context.Background(), map[string]any{
		"approval_id": "42",
		// "type" missing
		"details": "some detail",
	})
	if err == nil {
		t.Fatal("expected error for missing 'type' param")
	}
	if !strings.Contains(err.Error(), "type") {
		t.Errorf("error should mention missing key 'type', got: %v", err)
	}
}

func TestApprovalCard_TemplateID(t *testing.T) {
	c := ApprovalCard{}
	if c.TemplateID() != "approval_card" {
		t.Errorf("unexpected TemplateID: %s", c.TemplateID())
	}
}

func TestApprovalCard_RequiredParams(t *testing.T) {
	c := ApprovalCard{}
	params := c.RequiredParams()
	expected := []string{"approval_id", "type", "details"}
	if len(params) != len(expected) {
		t.Fatalf("expected %d required params, got %d", len(expected), len(params))
	}
	for i, p := range expected {
		if params[i] != p {
			t.Errorf("expected param[%d]=%s, got %s", i, p, params[i])
		}
	}
}
