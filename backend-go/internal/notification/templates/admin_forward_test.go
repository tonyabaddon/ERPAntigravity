package templates

import (
	"context"
	"testing"
)

func TestAdminForward_PassthroughText(t *testing.T) {
	af := AdminForward{}
	msg, err := af.Build(context.Background(), map[string]any{"text": "Halo Pak, invoice sudah kami kirim"})
	if err != nil {
		t.Fatal(err)
	}
	if msg != "Halo Pak, invoice sudah kami kirim" {
		t.Errorf("expected passthrough, got: %s", msg)
	}
}

func TestAdminForward_MissingText(t *testing.T) {
	af := AdminForward{}
	_, err := af.Build(context.Background(), map[string]any{})
	if err == nil {
		t.Fatal("expected error for missing 'text' param, got nil")
	}
}

func TestAdminForward_EmptyText(t *testing.T) {
	af := AdminForward{}
	_, err := af.Build(context.Background(), map[string]any{"text": ""})
	if err == nil {
		t.Fatal("expected error for empty 'text' param, got nil")
	}
}

func TestAdminForward_TemplateID(t *testing.T) {
	af := AdminForward{}
	if af.TemplateID() != "admin_forward" {
		t.Errorf("expected TemplateID 'admin_forward', got: %s", af.TemplateID())
	}
}

func TestAdminForward_RequiredParams(t *testing.T) {
	af := AdminForward{}
	params := af.RequiredParams()
	if len(params) != 1 || params[0] != "text" {
		t.Errorf("expected RequiredParams [text], got: %v", params)
	}
}
