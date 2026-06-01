package engine

import (
	"fmt"
	"strings"

	"github.com/username/sinar-elektrik-backend/internal/models"
)

// BuildPrompt returns the state-specific JSON format instruction for Gemini.
// Calista's persona and product knowledge are already set as the model's
// SystemInstruction — this prompt only provides current state context and
// the required JSON output shape.
func BuildPrompt(
	state models.ConversationState,
	language string,
	data models.CollectedData,
	history []models.Message,
	stockContext string,
) string {
	statePrompt := stateInstructions(state, data, stockContext)
	hist := formatHistory(history)
	return statePrompt + "\n\n## Riwayat percakapan:\n" + hist
}

func stateInstructions(state models.ConversationState, c models.CollectedData, stockCtx string) string {
	switch state {
	case models.StateGreeting:
		return `FASE: GREETING
Pelanggan baru mengirim pesan pertama.

Sambut pelanggan sebagai Calista dari Garindo Jaya Panel (ikuti SOP Fase 1).
Deteksi bahasa: "id" untuk Bahasa Indonesia, "en" untuk English.

Balas HANYA JSON (tidak ada teks lain):
{"reply":"<pesan sambutan WA>","detected_language":"id"}`

	case models.StateCollecting:
		missing := missingFields(c)
		return fmt.Sprintf(`FASE: PENGUMPULAN DATA (COLLECTING)
Data terkumpul sejauh ini:
- Nama       : %s
- Perusahaan : %s
- Alamat     : %s
- Produk     : %s

Data masih dibutuhkan: %s

Ikuti SOP Fase 1 & 1.5. Tanyakan SATU data yang masih kurang dalam 1 pesan.
Jika customer sebut wiring/instalasi/custom/IP rating → next_action: ESCALATE
Jika customer minta diskon/harga khusus → next_action: ESCALATE

Balas HANYA JSON (tidak ada teks lain):
{"reply":"<pesan WA>","collected":{"name":"<isi atau kosong>","company":"<isi atau kosong>","address":"<isi atau kosong>","product":"<isi atau kosong>"},"next_action":"CONTINUE"}`,
			orBelum(c.Name), orBelum(c.Company), orBelum(c.Address), orBelum(c.Product), missing)

	case models.StateClarifying:
		return fmt.Sprintf(`FASE: KLARIFIKASI SPESIFIKASI (CLARIFYING)
Produk yang diminta: %s
Spesifikasi terkumpul sejauh ini:
- Qty    : %d
- Ukuran : %s
- Warna  : %s
- Catatan: %s

Ikuti SOP Fase 1.5 (checklist klarifikasi sesuai material/tipe produk).
Tanyakan SATU spesifikasi yang masih kurang dalam 1 pesan.
Jika spesifikasi sudah cukup → next_action: READY
Jika perlu eskalasi (custom ukuran, IP rating, wiring, dll) → next_action: ESCALATE

Balas HANYA JSON (tidak ada teks lain):
{"reply":"<pesan WA>","specs":{"product":"<isi>","qty":<angka>,"size":"<isi>","color":"<isi>","notes":"<isi>"},"next_action":"CONTINUE","clarification_round":<angka>}`,
			orBelum(c.Product), c.Quantity,
			orBelum(c.Specs.Size), orBelum(c.Specs.Color), orBelum(c.Specs.Notes))

	case models.StateStockCheck:
		qty := c.Quantity
		if qty == 0 {
			qty = 1
		}
		return fmt.Sprintf(`FASE: CEK STOK & PENAWARAN HARGA (STOCK_CHECK)
Produk yang diminta: %s
Qty yang dibutuhkan: %d

Data stok dari sistem:
%s

Ikuti SOP Fase 2 Kategori 1 Skenario 1a/1c. Tampilkan nama produk, harga satuan (Rupiah), qty, subtotal.
Format pesan sesuai template ringkasan pesanan di system prompt.
Jika produk tersedia → next_action: CONFIRM
Jika produk tidak ditemukan atau stok 0 → next_action: ESCALATE

Balas HANYA JSON (tidak ada teks lain):
{"reply":"<pesan WA ringkasan harga>","next_action":"<CONFIRM atau ESCALATE>"}`,
			orBelum(c.Product), qty, stockCtx)

	case models.StateConfirming:
		qty := c.Quantity
		if qty == 0 {
			qty = 1
		}
		return fmt.Sprintf(`FASE: KONFIRMASI PESANAN (CONFIRMING)
Ringkasan pesanan untuk dikonfirmasi:
- Nama       : %s
- Perusahaan : %s
- Produk     : %s
- Qty        : %d
- Ukuran     : %s
- Catatan    : %s

Ikuti SOP Skenario 1a. Tunggu konfirmasi pelanggan.
Jika customer balas OK/Oke/BENAR/Yes/Confirm/setuju/iya → confirmed: true
Jika customer minta ubah/ganti/revisi → modification_requested: true
Jika tidak jelas → minta konfirmasi ulang dengan sopan

Balas HANYA JSON (tidak ada teks lain):
{"reply":"<pesan WA>","confirmed":false,"modification_requested":false}`,
			orBelum(c.Name), orBelum(c.Company), orBelum(c.Product),
			qty, orBelum(c.Specs.Size), orBelum(c.Specs.Notes))

	default:
		return `FASE: TIDAK DIKETAHUI
Balas HANYA JSON: {"reply":"<pesan WA>"}`
	}
}

func orBelum(s string) string {
	if s == "" {
		return "belum diketahui"
	}
	return s
}

func missingFields(c models.CollectedData) string {
	var m []string
	if c.Name == "" {
		m = append(m, "nama lengkap")
	}
	if c.Company == "" {
		m = append(m, "nama perusahaan/instansi")
	}
	if c.Address == "" {
		m = append(m, "alamat pengiriman")
	}
	if c.Product == "" {
		m = append(m, "produk yang dicari")
	}
	if len(m) == 0 {
		return "tidak ada (semua sudah terkumpul)"
	}
	return strings.Join(m, ", ")
}

// formatHistory converts message history to a readable string for the Gemini prompt.
func formatHistory(msgs []models.Message) string {
	if len(msgs) == 0 {
		return "(belum ada pesan)"
	}
	var sb strings.Builder
	for _, m := range msgs {
		sb.WriteString(fmt.Sprintf("[%s]: %s\n", strings.ToUpper(string(m.Sender)), m.Text))
	}
	return sb.String()
}

// StockContextString formats stock items into a compact string for the Gemini prompt.
func StockContextString(items []models.StockItem) string {
	if len(items) == 0 {
		return "(tidak ada produk yang cocok ditemukan di database)"
	}
	var sb strings.Builder
	for _, item := range items {
		sb.WriteString(fmt.Sprintf("- %s (SKU: %s): Rp %.0f/unit, stok: %d\n",
			item.Name, item.SKU, item.Price, item.Stock))
	}
	return sb.String()
}
