// backend-go/internal/notification/quiet_hours.go
package notification

import (
	"strconv"
	"strings"
	"time"
)

// isInQuietHours reports whether now falls within the quiet window [start, end).
//
// Supports midnight-crossing windows (e.g. start="22:00" end="07:00"):
//   - Non-crossing (start < end): quiet when nowMin ∈ [startMin, endMin)
//   - Crossing midnight  (start > end): quiet when nowMin ≥ startMin OR nowMin < endMin
//
// Edge: nowMin == endMin is NOT quiet (window is half-open at end).
// Edge: start == end means "never quiet" (zero-width window).
//
// Times are interpreted in whatever timezone the caller already applied to `now`.
func isInQuietHours(now time.Time, start, end string) bool {
	nowMin := now.Hour()*60 + now.Minute()
	startMin := parseHM(start)
	endMin := parseHM(end)

	if startMin == endMin {
		return false // zero-width window → never quiet
	}
	if startMin < endMin {
		// Normal window (e.g. 09:00–17:00): quiet inside [start, end)
		return nowMin >= startMin && nowMin < endMin
	}
	// Midnight-crossing window (e.g. 22:00–07:00):
	// quiet when nowMin ≥ startMin (evening side) OR nowMin < endMin (morning side)
	return nowMin >= startMin || nowMin < endMin
}

// parseHM parses "HH:MM" into total minutes since midnight.
// Returns 0 for malformed input (fail-open: no quiet hours).
func parseHM(hm string) int {
	parts := strings.SplitN(hm, ":", 2)
	if len(parts) != 2 {
		return 0
	}
	h, errH := strconv.Atoi(parts[0])
	m, errM := strconv.Atoi(parts[1])
	if errH != nil || errM != nil {
		return 0
	}
	return h*60 + m
}
