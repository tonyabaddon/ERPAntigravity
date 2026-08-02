# Visual Approval Gate — Design Spec

**Date:** 2026-08-02
**Status:** Awaiting founder approval
**Author:** Claude (autonomous SDD session, on founder direction)
**Blast radius:** Adds one gate to every FE PR. No prod behavior change.
**Reversibility:** Reversible / tactical — remove the script + config, delete gate policy.

---

## 1. Context

Founder is rolling out the tokenized design system across all app.caleo.id modules — 3 cross-cutting codemods (focus-ring, typography, semantic color) plus 13 per-module deep sweeps. Prior codemod incidents (miss-log Entry #10 — CSS `var()` in jsPDF broke every PDF; radius reversal 2px → 4px after founder visual review) showed that **mechanical semantic-equivalence is not sufficient — visual equivalence must be confirmed before prod.**

Current safety net:
- Cloud Build → 0% traffic → tag URL smoke — verifies HTTP 200 only, no visual content
- Manual promote-to-prod (HARD RULE per memory `manual_prod_gate_after_real_tenant`) — founder decides when to promote
- Audit scripts + Stop hook — catch drift additions, not visual regressions

Gap: **no automated visual-content comparison between candidate branch and current prod before merge.** Founder wants "show me HTML before-vs-after dulu, saya setuju dulu, baru diimplement."

## 2. Decision

Add a **visual-approval gate** to every FE PR in the design-system rollout (and later, extendable to any FE PR). Gate consists of:

1. **A lightweight helper script** — `scripts/build-visual-diff-html.tsx` — generates a side-by-side `public/visual-diff-<slug>.html` from a screenshot manifest.
2. **A config file** — `.claude/visual-diff.config.json` — declares module → path mappings.
3. **A protocol** — I (Claude) take screenshots via chrome-devtools MCP each session, save them, generate the HTML, present the file path in chat, wait for founder approval, then merge + promote.
4. **A gitignore rule** — `public/visual-diff/` and `public/visual-diff-*.html` are ephemeral, not committed.

**Non-goals** (deferred to v2):
- CI-driven visual regression (Playwright/Puppeteer) — not needed for the rollout, adds ~50MB dev dep
- Pixel-diff or perceptual-diff highlighting (Reg-Suit, Percy) — human visual review is fine at this scale
- Auto-approval on ≥N% pixel match — humans catch subtle semantic drift automated diff misses

## 3. Alternatives considered

### Alternative A: Playwright-based CI automation

Add `playwright` dev dependency (~50MB, browser bundle). Script logs in as Toko Jaya Makmur test tenant, navigates + screenshots configured paths on both baseline (prod tag URL) and candidate (branch tag URL) with a single `npm run visual-diff -- --module=X` command.

**Rejected because:**
- Chosen approach achieves same output at a fraction of the setup cost (MCP is already in-session)
- Playwright adds ~50MB + browser download + CI complexity
- No CI need yet — the gate is human-review-only for the rollout
- Portability to v2 remains open: swap the screenshot source from MCP to Playwright without changing the HTML-generator or config schema

### Alternative B: Ad-hoc manual screenshots + Google Drive links

I use chrome-devtools MCP each PR, upload screenshots to Google Drive, share the folder link with a text summary. Founder reviews out-of-band.

**Rejected because:**
- Coordination overhead (Google Drive folder per PR)
- Loses the side-by-side HTML layout that makes drift obvious
- No local artifact — nothing to reference later when reviewing "why did we approve X?"

### Alternative C: Just use the tag URL (no HTML report)

Every merge already lands on a Cloud Run tag URL at 0% traffic. Founder can open the tag URL directly and click around. No new tooling.

**Rejected because:**
- No side-by-side against baseline (founder has to open 2 tabs and switch)
- Founder has to know which paths to visit per module
- Missing content drift is likely at scale — founder scrolls through the app, one drift on screen #7 gets missed
- Doesn't address the "before I implement" ask — this only works post-merge, so founder is reviewing AFTER code is on main

## 4. Consequences

### Positive
- Every visual change is inspected by founder before it reaches prod
- Post-hoc audit trail: `public/visual-diff-*.html` files (locally) show what was reviewed and approved for each PR
- Consistent format: one glance shows every affected screen, side-by-side
- Enforces the "show me before implement" discipline systematically

### Negative
- Adds 15-20 min of founder review time per PR (~3-5h across the 13-19 PR rollout)
- I have to remember to run the tool each time (mitigation: add step to CLAUDE.md pre-merge checklist)
- Requires Toko Jaya Makmur test tenant to be in a stable state (mitigation: it's already the persistent seed tenant)
- Screenshots depend on chrome-devtools MCP being available in-session (mitigation: fallback to `npm run dev` local screenshots if MCP unavailable)

### Blast radius
- No prod code touched by this spec
- Adds one script, one config file, updates `.gitignore` and `CLAUDE.md`
- Reversible: delete files + revert CLAUDE.md edit

## 5. Scale-ceiling check

This is a **process spec**, not a runtime spec. Scale-ceiling questions are not applicable in the traditional sense. Adapted:

1. **Ceiling at 10× rollout scale:** 13-19 PRs currently → 130-190 PRs in a hypothetical "second rebrand". At that scale, tool-driven Playwright automation (Alternative A) becomes worth the ~50MB investment. Current scale doesn't warrant it.
2. **Hot path:** the HTML generator itself — runs at ~1 KB in / ~100 KB out per module, sub-second.
3. **Partition-readiness:** N/A — no data storage.
4. **Idempotency:** re-running the tool overwrites the previous HTML report — safe. No side-effects.
5. **Long ops:** screenshot-taking is the bottleneck (~5-10s per screen via MCP). For a 5-screen module = ~1 min. Fine for a synchronous session tool.
6. **Cost curve:** zero infra cost. Screenshots stored gitignored locally, ephemeral.

## 6. Architecture

### 6.1 Config schema — `.claude/visual-diff.config.json`

```json
{
  "baselineUrl": "https://app.caleo.id",
  "candidateUrlHint": "https://c<BRANCH_SHA>---garindo-jaya-panel-msme-erp-frontend-xnrhcw7onq-as.a.run.app",
  "authTenant": {
    "slug": "toko-jaya-makmur",
    "loginPath": "/login",
    "note": "Toko Jaya Makmur — the persistent prod-testing tenant (memory production-testing-tenant)"
  },
  "modules": {
    "dashboard": {
      "paths": ["/t/toko-jaya-makmur/dashboard"],
      "description": "Owner landing screen"
    },
    "kasir": {
      "paths": [
        "/t/toko-jaya-makmur/kasir",
        "/t/toko-jaya-makmur/kasir/checkout"
      ],
      "description": "Point-of-sale flow"
    },
    "penjualan": {
      "paths": [
        "/t/toko-jaya-makmur/pesanan",
        "/t/toko-jaya-makmur/pesanan/baru"
      ],
      "description": "Sales order create/edit"
    },
    "laporan": {
      "paths": [
        "/t/toko-jaya-makmur/laporan/laba-rugi",
        "/t/toko-jaya-makmur/laporan/neraca"
      ],
      "description": "Owner financial reports"
    },
    "pembelian": {
      "paths": [
        "/t/toko-jaya-makmur/pembelian/po",
        "/t/toko-jaya-makmur/pembelian/tagihan",
        "/t/toko-jaya-makmur/pembelian/pembayaran"
      ],
      "description": "Purchase order + AP flow"
    },
    "admin": {
      "paths": [
        "/admin/dashboard",
        "/admin/users"
      ],
      "description": "Platform admin panel (admin.caleo.id host)"
    },
    "designSystemPreview": {
      "paths": ["/design-system.html"],
      "description": "Design system static preview (Track A codemod verification)"
    }
  },
  "trackA_sample": [
    "dashboard",
    "kasir",
    "penjualan",
    "laporan",
    "designSystemPreview"
  ],
  "trackA_note": "Track A cross-cutting codemods sample the top-traffic modules — no need to screenshot all 13 modules for a mechanical codemod. If sample looks identical, ship."
}
```

### 6.2 Helper script — `scripts/build-visual-diff-html.tsx`

**Input:**
- `--slug` — kebab-case identifier (e.g., `focus-ring-fix`, `dashboard-sweep`)
- `--module` — module key from config (e.g., `dashboard`) OR `--track=A` (samples via `trackA_sample` list)
- `--manifest` — JSON path listing screenshot pairs already saved (see below)

**Behavior:**
1. Read config
2. Read manifest of pre-taken screenshots (format below)
3. Generate `public/visual-diff-<slug>.html` — self-contained, no runtime deps
4. Print the absolute file path so founder can `open` it

**Manifest format** — `public/visual-diff/<slug>/manifest.json`:
```json
{
  "slug": "focus-ring-fix",
  "title": "Focus-ring standardization",
  "module": "dashboard",
  "prSummary": "Codemod focus:ring-* → focus-visible:ring-caleo-gold across 536 sites",
  "baselineSha": "7765fcc",
  "candidateSha": "abc1234",
  "generatedAt": "2026-08-02T14:30:00+07:00",
  "pairs": [
    {
      "path": "/t/toko-jaya-makmur/dashboard",
      "label": "Dashboard — overview",
      "beforePng": "public/visual-diff/focus-ring-fix/before/dashboard-overview.png",
      "afterPng": "public/visual-diff/focus-ring-fix/after/dashboard-overview.png",
      "notes": ""
    }
  ]
}
```

**Output HTML layout:**
```
┌────────────────────────────────────────────────────────┐
│  Visual diff: Focus-ring standardization               │
│  PR: Codemod focus:ring-* → focus-visible:ring-caleo-  │
│  Baseline: 7765fcc  |  Candidate: abc1234              │
│  Generated: 2026-08-02 14:30 WIB                       │
├────────────────────────────────────────────────────────┤
│  Screen 1 of 5: Dashboard — overview                   │
│  ┌──────────────────┬──────────────────┐               │
│  │  BEFORE          │  AFTER           │               │
│  │  (7765fcc)       │  (abc1234)       │               │
│  │  [image]         │  [image]         │               │
│  └──────────────────┴──────────────────┘               │
│  [ ] same  [ ] different  [ ] reject                   │
│                                                        │
│  Screen 2 of 5: …                                      │
└────────────────────────────────────────────────────────┘
```

Self-contained HTML: inline CSS, no external assets except the `<img src="visual-diff/...">` refs.

### 6.3 Screenshot-taking protocol

I (Claude) execute in-session:

1. Create output dirs: `public/visual-diff/<slug>/before/` and `.../after/`
2. **Baseline pass** — for each path in the module:
   - `mcp__…__new_page` → prod URL + path
   - Log in as Toko Jaya Makmur (fill credentials once, reuse session)
   - `mcp__…__wait_for` on a stable content selector (e.g., a known header text or a `[data-testid]` element on the target page) — never a fixed sleep
   - `mcp__…__take_screenshot` → save as `before/<pathslug>.png`
3. **Candidate pass** — for each path in the module:
   - Navigate to candidate URL + path (same session, different origin)
   - `mcp__…__take_screenshot` → save as `after/<pathslug>.png`
4. Write manifest JSON to `public/visual-diff/<slug>/manifest.json`
5. Run `npx tsx scripts/build-visual-diff-html.tsx --slug=<slug>`
6. Chat: "Visual diff ready. `open public/visual-diff-<slug>.html` — reply 'go' or 'adjust X'"

### 6.4 Merge gate protocol

Added to CLAUDE.md pre-merge checklist:

> **FE PR touching >5 files or any user-visible surface** → MUST generate visual-diff HTML and receive founder "go" before merging. Bootstrap exception: the visual-diff-tool PR itself (this spec's implementation) uses ad-hoc screenshot review since the tool doesn't exist yet.

Bypass conditions (documented, not routine):
- Genuine production incident (rollback path) — skip gate + note in progress.md, founder reviews post-hoc
- Non-visual change (README-only, backend-only, config-only) — no gate needed

### 6.5 Auth handling

- Toko Jaya Makmur credentials stored in `.env.local` (gitignored) or session cookie captured on first login
- Chrome-devtools MCP session persists cookies across navigations within one session
- If session expires mid-run, I re-login and continue (idempotent screenshot output)

### 6.6 Gitignore additions

```
# Visual diff ephemeral artifacts — regenerated per PR
public/visual-diff/
public/visual-diff-*.html
```

## 7. Follow-up work

Tasks spawned by this spec (owner: Claude, timing: per rollout PR):

1. **Build spec implementation:**
   - Create `scripts/build-visual-diff-html.tsx`
   - Create `.claude/visual-diff.config.json` with initial module paths
   - Update `.gitignore`
   - Update `CLAUDE.md` — add merge-gate rule + reference to this spec
   - Bootstrap: this PR itself uses ad-hoc screenshots (no tool yet)

2. **Per-rollout-PR usage:**
   - Focus-ring standardization PR — first tool user
   - Typography PR — second tool user
   - Semantic color PR — third tool user
   - Per-module sweep PRs (13 of them) — main tool consumers

3. **v2 (deferred, revisit when needed):**
   - Playwright integration for CI-driven visual regression
   - Perceptual diff highlighting (Reg-Suit or similar)
   - Auto-approval on ≥N% pixel match

## 8. Success criteria

- Every FE PR from this point forward that touches user-visible surface generates a `public/visual-diff-<slug>.html`
- Founder approves (or requests iteration) BEFORE merge, not after
- Zero visual regressions land on prod because founder catches drift in the diff report
- Rollback rate on prod promotes drops (indirect measure — count promotes-with-rollback per month before/after)

## 9. Miss-log alignment

This spec addresses:
- **Entry #10 (jsPDF CSS var codemod)** — the visual gate would have shown "PDF preview rendering weird" in the visual-diff report; founder would have caught it pre-merge instead of Cloud Build catching post-push
- **Radius reversal 2px → 4px** — the visual-diff report would have shown the flat 2px on all buttons/cards; founder would have said "adjust to 4px" before it shipped, saving one revert cycle

## 10. I verified

- **[VERIFIED]** Chrome-devtools MCP tools listed in current session: `new_page`, `navigate_page`, `take_screenshot`, `fill`, `click`, `wait_for` — sufficient for the screenshot workflow
- **[VERIFIED]** `public/` directory writable — `public/design-system.html` (69.7 KB) already lives there, same generator pattern
- **[VERIFIED]** `.gitignore` mechanism works (existing entries confirm)
- **[REASONED]** Toko Jaya Makmur usable as auth tenant per memory `production-testing-tenant`
- **[REASONED]** Tag-URL pattern `c<SHORT_SHA>---<service>-xnrhcw7onq-as.a.run.app` per `scripts/promote-to-prod.sh:11-13`
- **[ASSUMED]** MCP session cookie persistence across navigations — needs empirical confirmation on first run; if not, re-login per candidate URL

## 11. Adversarial critique

- **What if MCP session dies mid-run?** — I re-invoke `new_page` and re-login; screenshot output is idempotent (overwrites the file)
- **What if the branch's Cloud Build hasn't finished when I want to screenshot the candidate?** — Wait or use local `npm run dev` fallback (documented in 6.3)
- **What if founder's review latency stalls the rollout?** — Non-critical work waits; that's the point. Genuine incidents bypass per 6.4.
- **What if the config file gets stale as modules evolve?** — Add "update config" to per-module-sweep PR checklist. Reviewer catches missing paths.
- **What if screenshots leak sensitive data?** — Only Toko Jaya Makmur (empty test tenant) is used; no real customer data
- **What if HTML report is inaccessible (weird file:// permissions)?** — Print instructions clearly, offer fallback of opening screenshots individually
- **What if the tool becomes a bottleneck when parallelizing multiple PRs?** — Each PR uses a unique `<slug>` — no shared state, safe to run in parallel
- **Founder-fatigue: 13-19 PRs × 15 min = 3-5h of review — will fatigue cause skipped approvals?** — Small batches, one module at a time, spread over 3-4 weeks. Fatigue mitigation: found could give "batch approval" ("approve dashboard + kasir + laporan together after quick scroll") when confident.

## 12. Timeline

- **This spec:** written 2026-08-02, awaiting founder approval
- **Tool implementation:** if approved, 1 focused session (~2-3h) — this is the FIRST PR using ad-hoc screenshots as bootstrap
- **First tool consumer:** focus-ring standardization PR (previously approved design)
- **Full rollout:** 3-4 weeks (13-19 PRs total, each gated)
