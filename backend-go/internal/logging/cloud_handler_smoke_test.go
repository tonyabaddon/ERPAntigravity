package logging

import (
	"bytes"
	"context"
	"encoding/json"
	"log/slog"
	"strings"
	"testing"
)

func TestCloudHandlerJSONShape(t *testing.T) {
	var buf bytes.Buffer
	h := NewCloudHandler(&buf, nil)
	logger := slog.New(h)

	ctx := WithTenantID(context.Background(), "tenant-abc")
	ctx = WithUserID(ctx, "user-xyz")
	ctx = WithRequestID(ctx, "req-123")

	logger.InfoContext(ctx, "hello world", slog.String("foo", "bar"))

	line := strings.TrimSpace(buf.String())
	var m map[string]interface{}
	if err := json.Unmarshal([]byte(line), &m); err != nil {
		t.Fatalf("not valid JSON: %v\nraw: %s", err, line)
	}
	for _, field := range []string{"severity", "message", "timestamp", "tenant_id", "user_id", "request_id"} {
		if _, ok := m[field]; !ok {
			t.Errorf("missing field %q in output: %s", field, line)
		}
	}
	if m["severity"] != "INFO" {
		t.Errorf("severity = %v, want INFO", m["severity"])
	}
	if m["message"] != "hello world" {
		t.Errorf("message = %v, want 'hello world'", m["message"])
	}
	if m["tenant_id"] != "tenant-abc" {
		t.Errorf("tenant_id = %v, want 'tenant-abc'", m["tenant_id"])
	}
	if _, ok := m["level"]; ok {
		t.Errorf("should NOT have 'level' field (should be 'severity')")
	}
	if _, ok := m["msg"]; ok {
		t.Errorf("should NOT have 'msg' field (should be 'message')")
	}
	t.Logf("emitted JSON: %s", line)
}

func TestCloudHandlerWarnSeverity(t *testing.T) {
	var buf bytes.Buffer
	h := NewCloudHandler(&buf, nil)
	logger := slog.New(h)
	logger.Warn("warn test")
	var m map[string]interface{}
	json.Unmarshal(buf.Bytes(), &m)
	if m["severity"] != "WARNING" {
		t.Errorf("severity = %v, want WARNING (WARN→WARNING mapping)", m["severity"])
	}
}

func TestCloudHandlerNoEmptyContextFields(t *testing.T) {
	var buf bytes.Buffer
	h := NewCloudHandler(&buf, nil)
	logger := slog.New(h)
	// background ctx — no tenant/user/request ID set
	logger.Info("background msg")
	var m map[string]interface{}
	json.Unmarshal(buf.Bytes(), &m)
	for _, field := range []string{"tenant_id", "user_id", "request_id"} {
		if _, ok := m[field]; ok {
			t.Errorf("field %q should NOT appear when not set, but got: %v", field, m[field])
		}
	}
}
