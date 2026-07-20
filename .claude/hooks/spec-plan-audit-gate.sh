#!/usr/bin/env bash
# Stop-hook: block session end if any spec/plan file was created/modified this
# turn without the required audit sections (Advisor consulted + I verified +
# Adversarial critique).
#
# Enforces CLAUDE.md "Pre-presentation discipline" — see docs/superpowers/miss-log.md
# entry #1 for the incident that triggered this hook.
#
# Detection: uses `git status --porcelain` to find added/modified spec/plan
# files (staged or unstaged). Files in docs/superpowers/{specs,plans}/*.md.
#
# Bypass (mid-refactor WIP only): `/hooks` to disable for one turn.

set -u

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$REPO_ROOT" || exit 0

# Find spec/plan files STAGED for commit (git diff --cached).
# Rationale: we intercept at commit moment. Untracked WIP files still being
# iterated do not trigger (would create false positives for pre-existing
# founder work). Once file is `git add`'d, it's about to persist → check now.
FILES=$(git diff --cached --name-only \
  | grep -E '^docs/superpowers/(specs|plans)/.*\.md$')

if [ -z "$FILES" ]; then
  # No spec/plan changes this turn — pass
  exit 0
fi

MISSING=""
while IFS= read -r file; do
  [ -z "$file" ] && continue
  # Strip quotes if git added them
  file="${file//\"/}"
  [ ! -f "$file" ] && continue

  missing_sections=""
  if ! grep -q "^## Advisor consulted" "$file" 2>/dev/null; then
    missing_sections="${missing_sections}Advisor consulted, "
  fi
  if ! grep -q "^## I verified" "$file" 2>/dev/null; then
    missing_sections="${missing_sections}I verified, "
  fi
  if ! grep -q "^## Adversarial critique" "$file" 2>/dev/null; then
    missing_sections="${missing_sections}Adversarial critique, "
  fi

  if [ -n "$missing_sections" ]; then
    MISSING="${MISSING}\n  - $file: missing [${missing_sections%, }]"
  fi
done <<< "$FILES"

if [ -n "$MISSING" ]; then
  MSG="Pre-presentation discipline violation — spec/plan file(s) missing required sections:${MISSING}\n\nRequired per CLAUDE.md 'Pre-presentation discipline':\n  ## Advisor consulted — record advisor() output\n  ## I verified — concrete evidence (grep counts, SQL results, file paths)\n  ## Adversarial critique — self-answered 'what could invalidate this?'\n\nAdd these sections before finishing the turn. If mid-refactor with intentional WIP, run /hooks to disable for one turn only.\n\nSee docs/superpowers/miss-log.md entry #1 for why this exists."
  printf '%s' "$MSG" | jq -Rs '{decision:"block", reason:.}'
fi
