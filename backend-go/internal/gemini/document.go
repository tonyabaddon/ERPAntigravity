package gemini

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/google/generative-ai-go/genai"
	"google.golang.org/api/option"
)

type DocumentClient struct {
	client *genai.Client
	model  *genai.GenerativeModel
}

type ExtractedLine struct {
	TxnDate      string  `json:"txn_date"`
	Description  string  `json:"description"`
	Counterparty string  `json:"counterparty"`
	Amount       float64 `json:"amount"`
	Direction    string  `json:"direction"`
	Balance      float64 `json:"balance"`
}

func NewDocumentClient(ctx context.Context, apiKey string) (*DocumentClient, error) {
	c, err := genai.NewClient(ctx, option.WithAPIKey(apiKey))
	if err != nil {
		return nil, err
	}
	m := c.GenerativeModel("gemini-3.5-flash")
	m.ResponseMIMEType = "application/json"
	return &DocumentClient{client: c, model: m}, nil
}

func (d *DocumentClient) Close() error { return d.client.Close() }

func (d *DocumentClient) ExtractMutasi(ctx context.Context, pdfBytes []byte, bankCode string) ([]ExtractedLine, error) {
	prompt := fmt.Sprintf(`Ekstrak SEMUA transaksi dari laporan mutasi rekening %s ini.
Setiap transaksi jadikan 1 object di array JSON dengan field:
  txn_date     (string YYYY-MM-DD)
  description  (string, deskripsi mentah dari statement)
  counterparty (string, nama pengirim/penerima — kosong jika tidak ada)
  amount       (number positif tanpa pemisah ribuan)
  direction    ("IN" untuk MASUK / kredit, "OUT" untuk KELUAR / debit)
  balance      (number saldo setelah transaksi)
HANYA baris transaksi (jangan masukkan header/footer/saldo awal).
Output JSON array murni, no markdown wrapper.`, bankCode)

	resp, err := d.model.GenerateContent(ctx,
		genai.Blob{MIMEType: "application/pdf", Data: pdfBytes},
		genai.Text(prompt),
	)
	if err != nil {
		return nil, fmt.Errorf("gemini generate: %w", err)
	}
	if len(resp.Candidates) == 0 || len(resp.Candidates[0].Content.Parts) == 0 {
		return nil, fmt.Errorf("gemini empty response")
	}
	text := ""
	for _, p := range resp.Candidates[0].Content.Parts {
		if t, ok := p.(genai.Text); ok {
			text += string(t)
		}
	}
	text = strings.TrimSpace(text)
	var lines []ExtractedLine
	if err := json.Unmarshal([]byte(text), &lines); err != nil {
		return nil, fmt.Errorf("parse Gemini JSON: %w (got first 200 chars: %s)", err, safeFirst(text, 200))
	}
	return lines, nil
}

func safeFirst(s string, n int) string {
	if len(s) < n {
		return s
	}
	return s[:n]
}
