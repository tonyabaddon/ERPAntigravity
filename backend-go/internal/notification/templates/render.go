package templates

import (
	"errors"
	"fmt"
	"strings"
)

// renderSimple performs {key} substitution across all keys in params.
// Returns an error if any key in required is absent from params.
// Used by all Sprint 3+ lifecycle event templates (order_created, order_shipped, …).
func renderSimple(tmpl string, params map[string]any, required []string) (string, error) {
	for _, k := range required {
		if _, ok := params[k]; !ok {
			return "", fmt.Errorf("template: missing required param %q: %w", k, errors.New("missing param"))
		}
	}
	rendered := tmpl
	for k, v := range params {
		rendered = strings.ReplaceAll(rendered, "{"+k+"}", fmt.Sprint(v))
	}
	return rendered, nil
}
