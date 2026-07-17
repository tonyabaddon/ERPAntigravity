#!/usr/bin/env bash
# FP-1: Apply a single migration file to a target Supabase project.
#
# Usage:
#   SUPABASE_PROJECT_REF=<ref> ./scripts/apply-migration.sh <slot>
#
# Examples:
#   # Apply migration 316 to prod
#   SUPABASE_PROJECT_REF=ekhhojaezdfjfwuxyjkl ./scripts/apply-migration.sh 316
#
#   # Apply migration 316 to a staging project
#   SUPABASE_PROJECT_REF=<staging-ref> ./scripts/apply-migration.sh 316
#
# Required env vars:
#   SUPABASE_PROJECT_REF   — Supabase project reference (from dashboard URL)
#   SUPABASE_ACCESS_TOKEN  — Supabase Management API PAT
#
# Source .env first if needed:
#   source .env && SUPABASE_PROJECT_REF=... ./scripts/apply-migration.sh 316
#
# Notes:
#   - Matches the first file under supabase/migrations/ whose name contains <slot>
#   - Applies via Supabase Management API /v1/projects/{ref}/database/query
#   - Idempotent: migration SQL must be written idempotently (DROP IF EXISTS, etc.)
#   - Exits non-zero on error; prints full API response to stderr

set -euo pipefail

SLOT="${1:?Usage: $0 <migration-slot>}"
PROJECT_REF="${SUPABASE_PROJECT_REF:?SUPABASE_PROJECT_REF env var required}"
PAT="${SUPABASE_ACCESS_TOKEN:?SUPABASE_ACCESS_TOKEN env var required (source .env or export)}"

# Resolve to repo root (script may be called from any directory)
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Find migration file matching slot
MIGRATION_FILE=$(ls "${REPO_ROOT}/supabase/migrations/"*"${SLOT}"*.sql 2>/dev/null | head -1)
if [ -z "$MIGRATION_FILE" ]; then
  echo "ERROR: no migration file found for slot ${SLOT} in ${REPO_ROOT}/supabase/migrations/" >&2
  exit 1
fi

echo "Applying: $(basename "$MIGRATION_FILE")"
echo "Project:  ${PROJECT_REF}"
echo ""

# Read SQL and encode as JSON string
SQL_JSON=$(python3 -c "import sys,json; print(json.dumps(open('$MIGRATION_FILE').read()))")

# POST to Supabase Management API
RESULT=$(curl -sS -X POST \
  -H "Authorization: Bearer ${PAT}" \
  -H "Content-Type: application/json" \
  "https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query" \
  --data "{\"query\": ${SQL_JSON}}")

# Detect error in response
if echo "${RESULT}" | python3 -c "import sys,json; d=json.load(sys.stdin); sys.exit(0 if 'error' not in str(d).lower() or isinstance(d, list) else 1)" 2>/dev/null; then
  echo "SUCCESS: migration applied to ${PROJECT_REF}"
else
  echo "MIGRATION FAILED:" >&2
  echo "${RESULT}" | python3 -m json.tool 2>/dev/null || echo "${RESULT}" >&2
  exit 1
fi
