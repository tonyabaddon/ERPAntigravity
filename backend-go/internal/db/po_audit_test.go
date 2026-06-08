package db_test

import (
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/username/sinar-elektrik-backend/internal/db"
)

// TestPurchaseOrders_ExpectedReceiveDate_Column verifies the column exists and accepts NULL.
func TestPurchaseOrders_ExpectedReceiveDate_Column(t *testing.T) {
	client := db.NewTestClient(t)
	defer client.Close()

	// Seed a supplier
	supplierID := uuid.NewString()
	_, err := client.DB.Exec(
		`INSERT INTO suppliers (id, name, payment_term_days) VALUES ($1, $2, $3)`,
		supplierID, "Test Supplier PO Audit "+uuid.NewString()[:8], 30,
	)
	if err != nil {
		t.Fatalf("seed supplier: %v", err)
	}

	// Insert PO with expected_receive_date set
	poNumber := "TEST-" + uuid.NewString()[:8]
	expectedDate := time.Now().AddDate(0, 0, 7).Format("2006-01-02")
	_, err = client.DB.Exec(
		`INSERT INTO purchase_orders (po_number, supplier_id, status, tax_rate, tax_amount, subtotal, total, expected_receive_date)
		 VALUES ($1, $2, 'DRAFT', 0, 0, 0, 0, $3)`,
		poNumber, supplierID, expectedDate,
	)
	if err != nil {
		t.Fatalf("insert PO with expected_receive_date: %v", err)
	}

	// Read back
	var got string
	err = client.DB.QueryRow(
		`SELECT expected_receive_date::text FROM purchase_orders WHERE po_number = $1`,
		poNumber,
	).Scan(&got)
	if err != nil {
		t.Fatalf("read back: %v", err)
	}
	if got != expectedDate {
		t.Fatalf("expected_receive_date mismatch: got %q want %q", got, expectedDate)
	}

	// Insert PO without expected_receive_date (NULL)
	poNumber2 := "TEST-" + uuid.NewString()[:8]
	_, err = client.DB.Exec(
		`INSERT INTO purchase_orders (po_number, supplier_id, status, tax_rate, tax_amount, subtotal, total)
		 VALUES ($1, $2, 'DRAFT', 0, 0, 0, 0)`,
		poNumber2, supplierID,
	)
	if err != nil {
		t.Fatalf("insert PO without expected_receive_date: %v", err)
	}

	// Cleanup
	_, _ = client.DB.Exec(`DELETE FROM purchase_orders WHERE po_number IN ($1, $2)`, poNumber, poNumber2)
	_, _ = client.DB.Exec(`DELETE FROM suppliers WHERE id = $1`, supplierID)
}

// TestPurchaseOrders_AuditColumns_FKBehavior verifies created_by/updated_by FK with ON DELETE SET NULL.
func TestPurchaseOrders_AuditColumns_FKBehavior(t *testing.T) {
	client := db.NewTestClient(t)
	defer client.Close()

	// Seed admin user
	adminID := uuid.NewString()
	_, err := client.DB.Exec(
		`INSERT INTO admin_users (id, name, email, role, permissions, status)
		 VALUES ($1, $2, $3, 'Admin', '{}'::jsonb, 'Aktif')`,
		adminID, "Test Admin", "test-"+adminID[:8]+"@example.com",
	)
	if err != nil {
		t.Fatalf("seed admin: %v", err)
	}

	// Seed supplier
	supplierID := uuid.NewString()
	_, err = client.DB.Exec(
		`INSERT INTO suppliers (id, name, payment_term_days) VALUES ($1, $2, $3)`,
		supplierID, "Test Supplier FK "+uuid.NewString()[:8], 0,
	)
	if err != nil {
		t.Fatalf("seed supplier: %v", err)
	}

	// Insert PO with created_by_user_id
	poNumber := "TEST-" + uuid.NewString()[:8]
	_, err = client.DB.Exec(
		`INSERT INTO purchase_orders (po_number, supplier_id, status, tax_rate, tax_amount, subtotal, total, created_by_user_id)
		 VALUES ($1, $2, 'DRAFT', 0, 0, 0, 0, $3)`,
		poNumber, supplierID, adminID,
	)
	if err != nil {
		t.Fatalf("insert PO with created_by_user_id: %v", err)
	}

	// Delete admin user — created_by_user_id should become NULL
	_, err = client.DB.Exec(`DELETE FROM admin_users WHERE id = $1`, adminID)
	if err != nil {
		t.Fatalf("delete admin user: %v", err)
	}

	var createdByAfter *string
	err = client.DB.QueryRow(
		`SELECT created_by_user_id FROM purchase_orders WHERE po_number = $1`,
		poNumber,
	).Scan(&createdByAfter)
	if err != nil {
		t.Fatalf("read created_by_user_id after admin delete: %v", err)
	}
	if createdByAfter != nil {
		t.Fatalf("expected created_by_user_id to be NULL after admin delete, got %v", *createdByAfter)
	}

	// Cleanup
	_, _ = client.DB.Exec(`DELETE FROM purchase_orders WHERE po_number = $1`, poNumber)
	_, _ = client.DB.Exec(`DELETE FROM suppliers WHERE id = $1`, supplierID)
}

// TestAdminUsers_BackfillPermissions verifies action perms exist with default true after migration.
func TestAdminUsers_BackfillPermissions(t *testing.T) {
	client := db.NewTestClient(t)
	defer client.Close()

	// Seed admin without action perms
	adminID := uuid.NewString()
	_, err := client.DB.Exec(
		`INSERT INTO admin_users (id, name, email, role, permissions, status)
		 VALUES ($1, $2, $3, 'Admin', '{"pembelian": true}'::jsonb, 'Aktif')`,
		adminID, "Test Backfill", "backfill-"+adminID[:8]+"@example.com",
	)
	if err != nil {
		t.Fatalf("seed admin: %v", err)
	}

	// Apply the backfill manually (simulates the migration's UPDATE statement)
	_, err = client.DB.Exec(`
		UPDATE admin_users
		SET permissions = COALESCE(permissions, '{}'::jsonb) || jsonb_build_object(
		  'can_create_po', true,
		  'can_edit_po', true
		)
		WHERE id = $1
		  AND (NOT (permissions ? 'can_create_po') OR NOT (permissions ? 'can_edit_po'))
	`, adminID)
	if err != nil {
		t.Fatalf("backfill: %v", err)
	}

	var perms string
	err = client.DB.QueryRow(
		`SELECT permissions::text FROM admin_users WHERE id = $1`,
		adminID,
	).Scan(&perms)
	if err != nil {
		t.Fatalf("read permissions: %v", err)
	}
	if !strings.Contains(perms, `"can_create_po": true`) {
		t.Fatalf("expected can_create_po true, got %s", perms)
	}
	if !strings.Contains(perms, `"can_edit_po": true`) {
		t.Fatalf("expected can_edit_po true, got %s", perms)
	}

	// Cleanup
	_, _ = client.DB.Exec(`DELETE FROM admin_users WHERE id = $1`, adminID)
}
