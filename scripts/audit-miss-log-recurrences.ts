// Meta-audit: scan miss-log for class-error entries (3+ occurrences of the
// same pattern) and verify each triggered the CLAUDE.md class-fix rule
// (ship codemod + audit script in the same PR that flagged the 3rd hit).
//
// Rule (from CLAUDE.md > "Class-fix rule (anti-pattern with 3+ occurrences)"):
//   When Impact analysis reveals the same anti-pattern in 3+ sites — OR the
//   miss-log records 3+ occurrences of the same class-error — the fix is NOT
//   "patch this site." The fix is a PAIR:
//   1. Retire the debt (codemod / bulk edit removing anti-pattern from every
//      existing site in the same PR)
//   2. Prevent re-drift (scripts/audit-<slug>.ts + npm script + Stop hook
//      wiring)
//
// Enforcement gap:
//   - Historical Entries #4 (SECDEF 3rd instance), #5 (`[object Object]` 3rd
//     occurrence), #8 (SECDEF 4th recurrence) — all had the class-fix rule
//     triggered but shipped audit script only some of the time.
//   - Entry #4 (2026-07-24) SHOULD have shipped audit; deferred until Entry #8
//     (2026-07-28) — 4 days of drift risk in between.
//
// This audit catches future occurrences of that gap.
//
// Heuristic:
//   For each miss-log entry whose title or body contains an occurrence marker
//   (Nth occurrence | Nth recurrence | Nth instance with N >= 3), the same
//   entry MUST also mention at least one class-fix signal:
//     - "audit script" / "audit shipped"
//     - "codemod" / "codemod shipped" / "codemod applied"
//     - "class-fix audit shipped" / literal "class-fix"
//
// If not, flag as violation. Run manually or as pre-release check.
//
// Usage: npm run audit:miss-log-recurrences
// Exit 0 = all class-fix moments were followed. Exit 1 = violations printed.

import { readFileSync } from 'node:fs';

const MISS_LOG = 'docs/superpowers/miss-log.md';
const src = readFileSync(MISS_LOG, 'utf8');

// Split into entries at "## Entry #N — ..." headings. Everything before the
// first heading is preamble (skipped).
const entryRegex = /^## Entry #(\d+)\s+—\s+([^\n]+)([\s\S]*?)(?=^## Entry #\d+|$(?![\r\n]))/gm;
const entries: Array<{ id: number; heading: string; body: string }> = [];
let match: RegExpExecArray | null;
while ((match = entryRegex.exec(src)) !== null) {
  entries.push({
    id: parseInt(match[1], 10),
    heading: match[2].trim(),
    body: match[0], // include heading + body for downstream keyword scan
  });
}

if (entries.length === 0) {
  console.error(`audit:miss-log-recurrences — no entries found in ${MISS_LOG}. Regex mismatch?`);
  process.exit(2);
}

// Match "3rd occurrence", "4th recurrence", "5th instance", etc. Case-insensitive.
// Captures the ordinal number so we can check >= 3.
const occurrenceMarker = /\b(\d+)(?:st|nd|rd|th)\s+(?:occurrence|recurrence|instance)\b/gi;

// Signals that class-fix rule was followed. Any ONE of these being present is enough.
const classFixSignals = [
  /\baudit script\b/i,
  /\baudit shipped\b/i,
  /\bcodemod\b/i,
  /\bclass-fix\b/i,
];

interface Violation {
  entryId: number;
  heading: string;
  occurrenceNum: number;
  reason: string;
}

const violations: Violation[] = [];
const compliantEntries: Array<{ id: number; heading: string; occurrenceNum: number }> = [];

for (const entry of entries) {
  // Reset regex state per entry
  occurrenceMarker.lastIndex = 0;
  let maxOccurrence = 0;
  let m: RegExpExecArray | null;
  while ((m = occurrenceMarker.exec(entry.body)) !== null) {
    const n = parseInt(m[1], 10);
    if (n > maxOccurrence) maxOccurrence = n;
  }

  if (maxOccurrence < 3) continue; // not a class-fix trigger

  const hasSignal = classFixSignals.some(re => re.test(entry.body));
  if (hasSignal) {
    compliantEntries.push({
      id: entry.id,
      heading: entry.heading.slice(0, 80),
      occurrenceNum: maxOccurrence,
    });
  } else {
    violations.push({
      entryId: entry.id,
      heading: entry.heading.slice(0, 80),
      occurrenceNum: maxOccurrence,
      reason:
        `Entry mentions "${maxOccurrence}th occurrence/recurrence/instance" but body ` +
        `contains no class-fix signal (audit script / codemod / class-fix). ` +
        `CLAUDE.md rule: 3+ occurrences must ship codemod + audit in the same PR.`,
    });
  }
}

console.log(`Scanned ${entries.length} miss-log entries; ${compliantEntries.length} class-fix triggers observed.`);
if (compliantEntries.length > 0) {
  console.log('');
  console.log('Compliant class-fix moments (for reference):');
  for (const c of compliantEntries) {
    console.log(`  Entry #${c.id} (${c.occurrenceNum}× occurrence) — ${c.heading}`);
  }
}

if (violations.length === 0) {
  console.log('');
  console.log('✓ clean — all miss-log class-fix triggers have shipped audit / codemod / class-fix.');
  process.exit(0);
}

console.error('');
console.error(`✗ ${violations.length} class-fix rule violation(s):`);
console.error('');
for (const v of violations) {
  console.error(`  Entry #${v.entryId} (${v.occurrenceNum}× occurrence): ${v.heading}`);
  console.error(`    ${v.reason}`);
  console.error('');
}
console.error('Fix: add "audit script" or "codemod" (or reference to `class-fix`) to the entry body,');
console.error('OR actually ship the audit + codemod in a follow-up PR and update the entry.');
process.exit(1);
