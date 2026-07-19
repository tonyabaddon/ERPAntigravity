// backend-go/internal/notification/recipients_cache.go
package notification

import (
	"context"
	"sync"
	"time"
)

// Recipient is a staff/owner WA number.
type Recipient struct {
	Phone string
	Role  string // "owner" | "admin"
}

// RecipientFilter narrows GetActiveRecipients results.
type RecipientFilter struct {
	Role      string // "" = all, "owner" or "admin" filters
	CritLevel string // "critical" bypasses quiet hours (Sprint 5)
}

// recipientResolver wraps db.GetActiveRecipients for testability.
type recipientResolver interface {
	GetActiveRecipients(ctx context.Context, tenantID string, filter RecipientFilter) ([]Recipient, error)
}

// cachedResolver adds 60-second TTL cache on top of a live recipientResolver.
type cachedResolver struct {
	inner recipientResolver
	cache sync.Map // key: tenantID+"::" +role, val: cachedEntry
}

type cachedEntry struct {
	recipients []Recipient
	expiresAt  time.Time
}

// NewCachedResolver wraps inner with 60s TTL cache. Cache is per (tenantID, role) tuple.
func NewCachedResolver(inner recipientResolver) *cachedResolver {
	return &cachedResolver{inner: inner}
}

func (c *cachedResolver) GetActiveRecipients(ctx context.Context, tenantID string, filter RecipientFilter) ([]Recipient, error) {
	key := tenantID + "::" + filter.Role
	now := time.Now()

	if v, ok := c.cache.Load(key); ok {
		entry := v.(cachedEntry)
		if now.Before(entry.expiresAt) {
			return entry.recipients, nil
		}
	}

	recipients, err := c.inner.GetActiveRecipients(ctx, tenantID, filter)
	if err != nil {
		return nil, err
	}
	c.cache.Store(key, cachedEntry{recipients: recipients, expiresAt: now.Add(60 * time.Second)})
	return recipients, nil
}
