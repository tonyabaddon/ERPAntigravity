// CalistaStore implements the llm.CooldownStore, llm.PinStore and
// llm.TelemetryStore interfaces backed by the project's Supabase PostgreSQL
// database. It lives alongside *Client in the db package to share the *sql.DB
// connection, but its methods are scoped to Phase 1A tables only.

package db

import (
	"context"
	"database/sql"
	"time"

	"github.com/username/sinar-elektrik-backend/internal/llm"
)

// CalistaStore is the persistence layer for the llm package.
// Construct via db.NewCalistaStore(client.DB).
type CalistaStore struct {
	db *sql.DB
}

// NewCalistaStore returns a CalistaStore using the shared *sql.DB handle.
func NewCalistaStore(d *sql.DB) *CalistaStore {
	return &CalistaStore{db: d}
}

// --- llm.CooldownStore implementation ---

func (s *CalistaStore) LoadCooldowns() ([]llm.CooldownEntry, error) {
	rows, err := s.db.Query(`
		SELECT model_slug, cooldown_until, last_error, consecutive_failures, updated_at
		FROM public.model_cooldowns
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []llm.CooldownEntry
	for rows.Next() {
		var e llm.CooldownEntry
		var cooldownUntil sql.NullTime
		var lastError sql.NullString
		if err := rows.Scan(&e.ModelSlug, &cooldownUntil, &lastError,
			&e.ConsecutiveFailures, &e.UpdatedAt); err != nil {
			return nil, err
		}
		if cooldownUntil.Valid {
			e.CooldownUntil = cooldownUntil.Time
		}
		if lastError.Valid {
			e.LastError = lastError.String
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

func (s *CalistaStore) SaveCooldown(e llm.CooldownEntry) error {
	var cooldownUntil any
	if !e.CooldownUntil.IsZero() {
		cooldownUntil = e.CooldownUntil
	}
	_, err := s.db.Exec(`
		INSERT INTO public.model_cooldowns
			(model_slug, cooldown_until, last_error, consecutive_failures, updated_at)
		VALUES ($1, $2, $3, $4, $5)
		ON CONFLICT (model_slug) DO UPDATE SET
			cooldown_until       = EXCLUDED.cooldown_until,
			last_error           = EXCLUDED.last_error,
			consecutive_failures = EXCLUDED.consecutive_failures,
			updated_at           = EXCLUDED.updated_at
	`, e.ModelSlug, cooldownUntil, e.LastError, e.ConsecutiveFailures, e.UpdatedAt)
	return err
}

// --- llm.PinStore implementation ---

func (s *CalistaStore) LoadPin(ctx context.Context, convID string) (llm.PinEntry, bool, error) {
	var p llm.PinEntry
	var slug sql.NullString
	var pinnedAt sql.NullTime
	err := s.db.QueryRowContext(ctx, `
		SELECT pinned_model_slug, pinned_at, COALESCE(swap_count, 0)
		FROM public.conversations
		WHERE id = $1
	`, convID).Scan(&slug, &pinnedAt, &p.SwapCount)
	if err == sql.ErrNoRows {
		return p, false, nil
	}
	if err != nil {
		return p, false, err
	}
	if !slug.Valid || slug.String == "" {
		return p, false, nil
	}
	p.ConversationID = convID
	p.ModelSlug = slug.String
	if pinnedAt.Valid {
		p.PinnedAt = pinnedAt.Time
	}
	return p, true, nil
}

func (s *CalistaStore) SavePin(ctx context.Context, p llm.PinEntry) error {
	_, err := s.db.ExecContext(ctx, `
		UPDATE public.conversations
		SET pinned_model_slug = $1,
		    pinned_at = $2,
		    swap_count = $3
		WHERE id = $4
	`, p.ModelSlug, p.PinnedAt, p.SwapCount, p.ConversationID)
	return err
}

func (s *CalistaStore) ClearPin(ctx context.Context, convID string) error {
	_, err := s.db.ExecContext(ctx, `
		UPDATE public.conversations
		SET pinned_model_slug = NULL,
		    pinned_at = NULL,
		    swap_count = 0
		WHERE id = $1
	`, convID)
	return err
}

// --- llm.TelemetryStore implementation ---

func (s *CalistaStore) RecordLLMCall(ctx context.Context, r llm.TelemetryRecord) error {
	if r.CreatedAt.IsZero() {
		r.CreatedAt = time.Now().UTC()
	}
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO public.llm_calls
			(conversation_id, model_slug, tier, was_forced_swap, state_boundary,
			 prompt_tokens, completion_tokens, latency_ms, cost_idr_estimated,
			 status, error_message, created_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
	`,
		r.ConversationID, r.ModelSlug, r.Tier, r.WasForcedSwap, r.StateBoundary,
		r.PromptTokens, r.CompletionTokens, r.LatencyMs, r.CostIDREstimated,
		r.Status, r.ErrorMessage, r.CreatedAt,
	)
	return err
}
