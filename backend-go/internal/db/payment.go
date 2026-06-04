package db

// UpdatePaymentProof stores the full payment proof URL and advances to PAYMENT_UPLOADED.
func (c *Client) UpdatePaymentProof(orderID, url string) error {
	_, err := c.DB.Exec(`
		UPDATE orders SET full_proof_url = $1, status = 'PAYMENT_UPLOADED' WHERE id = $2
	`, url, orderID)
	return err
}

// UpdateDPProof stores the DP proof URL and advances to DP_UPLOADED.
func (c *Client) UpdateDPProof(orderID, url string) error {
	_, err := c.DB.Exec(`
		UPDATE orders SET dp_proof_url = $1, status = 'DP_UPLOADED' WHERE id = $2
	`, url, orderID)
	return err
}

// VerifyDPPayment advances status to DP_VERIFIED. Postgres trigger fires dp_verified NOTIFY.
func (c *Client) VerifyDPPayment(orderID string) error {
	_, err := c.DB.Exec(`
		UPDATE orders SET status = 'DP_VERIFIED' WHERE id = $1
	`, orderID)
	return err
}

// RejectDPProof sets status to DP_PROOF_REJECTED with optional reason.
// Postgres trigger fires dp_proof_rejected NOTIFY; handler resets to WAITING_DP.
func (c *Client) RejectDPProof(orderID, reason string) error {
	if reason == "" {
		_, err := c.DB.Exec(`
			UPDATE orders SET status = 'DP_PROOF_REJECTED', rejection_reason = NULL, dp_proof_url = NULL WHERE id = $1
		`, orderID)
		return err
	}
	_, err := c.DB.Exec(`
		UPDATE orders SET status = 'DP_PROOF_REJECTED', rejection_reason = $1, dp_proof_url = NULL WHERE id = $2
	`, reason, orderID)
	return err
}

// RejectPayment resets status to WAITING_PAYMENT. Used for both FULL and DP full-proof rejection.
func (c *Client) RejectPayment(orderID string) error {
	_, err := c.DB.Exec(`
		UPDATE orders SET status = 'WAITING_PAYMENT', full_proof_url = NULL WHERE id = $1
	`, orderID)
	return err
}

// ResetDPToWaiting is called by handler after dp_proof_rejected is processed.
func (c *Client) ResetDPToWaiting(orderID string) error {
	_, err := c.DB.Exec(`
		UPDATE orders SET status = 'WAITING_DP', rejection_reason = NULL WHERE id = $1
	`, orderID)
	return err
}
