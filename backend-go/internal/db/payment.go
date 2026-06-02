package db

// UpdatePaymentProof stores the proof URL and advances the order to PAYMENT_UPLOADED.
// url may be empty if the Supabase Storage upload failed — the status still advances.
func (c *Client) UpdatePaymentProof(orderID, url string) error {
	_, err := c.DB.Exec(`
		UPDATE orders
		SET payment_proof_url = $1, status = 'PAYMENT_UPLOADED'
		WHERE id = $2
	`, url, orderID)
	return err
}

// RejectPayment resets the order status from PAYMENT_REJECTED back to WAITING_PAYMENT.
// Called by the daemon after sending the rejection WA message to the customer.
func (c *Client) RejectPayment(orderID string) error {
	_, err := c.DB.Exec(`
		UPDATE orders SET status = 'WAITING_PAYMENT' WHERE id = $1
	`, orderID)
	return err
}
