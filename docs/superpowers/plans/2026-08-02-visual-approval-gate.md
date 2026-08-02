# Visual Approval Gate — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a lightweight visual-approval gate — helper script + config + gitignore + CLAUDE.md rule — so every downstream FE PR generates `public/visual-diff-<slug>.html` for founder review before merge.

**Architecture:** Node/tsx script reads a JSON manifest of pre-taken screenshot pairs and emits a self-contained HTML report (inline CSS, no external assets except image `<img>` refs). Screenshots themselves are taken by Claude in-session via `chrome-devtools` MCP tools. No new npm dependencies. Bootstrap PR uses ad-hoc screenshot review (tool doesn't exist yet).

**Tech Stack:** TypeScript (existing `tsx` runner), vitest (existing test framework), Node stdlib (`fs`, `path`).

## Global Constraints

- Self-contained HTML: inline CSS, no external assets except `<img src>` refs to screenshot PNGs.
- No new npm dependencies (no Playwright — MCP is the screenshot source).
- Config file `.claude/visual-diff.config.json` — committed to repo (source of truth for module → paths mapping).
- Ephemeral outputs `public/visual-diff/` and `public/visual-diff-*.html` — gitignored.
- Manifest schema locked per spec §6.2 (`slug`, `title`, `module`, `prSummary`, `baselineSha`, `candidateSha`, `generatedAt`, `pairs[]`).
- Auth tenant: Toko Jaya Makmur (per memory `production-testing-tenant`).
- Bootstrap: this PR uses ad-hoc screenshots — Claude runs `chrome-devtools` MCP live during review; no automation.
- Reversibility: full revert = `git revert` the PR (deletes script, config, gitignore entries, CLAUDE.md edit).

---

## File Structure

| File | Purpose | Ownership |
|---|---|---|
| `scripts/build-visual-diff-html.tsx` | Pure renderer + CLI main. Reads manifest JSON, emits self-contained HTML. | Task 2 |
| `scripts/build-visual-diff-html.test.ts` | vitest tests for the pure renderer function. | Task 2 |
| `.claude/visual-diff.config.json` | Module → paths config (seed with 7 modules per spec §6.1). | Task 1 |
| `.gitignore` (modify) | Add `public/visual-diff/` and `public/visual-diff-*.html`. | Task 1 |
| `package.json` (modify) | Add `"visual-diff:build": "tsx scripts/build-visual-diff-html.tsx"` npm script. | Task 1 |
| `CLAUDE.md` (modify) | Add "Protocol: Visual approval gate" section referencing spec + tool. | Task 4 |

---

### Task 1: Config file, gitignore, npm script scaffolding

**Files:**
- Create: `.claude/visual-diff.config.json`
- Modify: `.gitignore`
- Modify: `package.json`

**Interfaces:**
- Consumes: nothing (first task)
- Produces: `visual-diff:build` npm script name (Task 2 will implement the script that this points to); `.claude/visual-diff.config.json` schema loaded by future users

- [ ] **Step 1: Create the config file**

Create `.claude/visual-diff.config.json` with this exact content (copied verbatim from spec §6.1):

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

- [ ] **Step 2: Verify JSON parses correctly**

Run: `node -e "JSON.parse(require('fs').readFileSync('.claude/visual-diff.config.json','utf8')); console.log('valid')"`
Expected: `valid`

- [ ] **Step 3: Add gitignore entries**

Edit `.gitignore` — append these two lines at the bottom (or in a fitting section — check where similar entries live):

```
# Visual approval gate — ephemeral screenshots + HTML reports (per docs/superpowers/specs/2026-08-02-visual-approval-gate-design.md)
public/visual-diff/
public/visual-diff-*.html
```

- [ ] **Step 4: Verify gitignore takes effect**

Run: `mkdir -p public/visual-diff && touch public/visual-diff/test.png public/visual-diff-test.html && git status --short public/visual-diff/ public/visual-diff-test.html`
Expected: empty output (files are ignored)
Cleanup: `rm -rf public/visual-diff public/visual-diff-test.html`

- [ ] **Step 5: Add npm script**

Edit `package.json` — inside the `"scripts"` object, add this entry between `"audit:slog-any-error"` and `"build:design-system"`:

```json
    "visual-diff:build": "tsx scripts/build-visual-diff-html.tsx",
```

- [ ] **Step 6: Verify npm script placeholder works**

Run: `npm run visual-diff:build 2>&1 | head -5`
Expected: fails with "no such file or directory" pointing to `scripts/build-visual-diff-html.tsx` (script doesn't exist yet — expected until Task 2)

- [ ] **Step 7: Commit**

```bash
git add .claude/visual-diff.config.json .gitignore package.json
git commit -m "chore(visual-diff): add config + gitignore + npm script scaffolding

Scaffolding for the visual-approval gate (see spec
docs/superpowers/specs/2026-08-02-visual-approval-gate-design.md).

Config seeds 7 modules with paths per Toko Jaya Makmur (prod-testing tenant).
gitignore covers ephemeral screenshots + HTML reports.
npm script placeholder points to script implemented in Task 2 of the plan."
```

---

### Task 2: HTML renderer (TDD)

**Files:**
- Create: `scripts/build-visual-diff-html.tsx`
- Create: `scripts/build-visual-diff-html.test.ts`

**Interfaces:**
- Consumes: manifest JSON schema per spec §6.2 (see Manifest interface below)
- Produces:
  - Exported pure function `renderVisualDiffHtml(manifest: Manifest): string` — takes a validated manifest, returns a self-contained HTML string
  - CLI `main()` — reads `--manifest=<path>` arg, calls renderer, writes to `public/visual-diff-<slug>.html`, prints absolute output path
  - Manifest type interface (exported for reuse by future orchestration if needed):
    ```ts
    interface ScreenPair {
      path: string;         // e.g. "/t/toko-jaya-makmur/dashboard"
      label: string;        // human-readable header, e.g. "Dashboard — overview"
      beforePng: string;    // repo-relative path to before screenshot
      afterPng: string;     // repo-relative path to after screenshot
      notes: string;        // optional annotator note (may be empty string)
    }
    interface Manifest {
      slug: string;
      title: string;
      module: string;
      prSummary: string;
      baselineSha: string;
      candidateSha: string;
      generatedAt: string;  // ISO 8601 with timezone, e.g. "2026-08-02T14:30:00+07:00"
      pairs: ScreenPair[];
    }
    ```

- [ ] **Step 1: Write the failing test**

Create `scripts/build-visual-diff-html.test.ts` with this exact content:

```ts
import { describe, it, expect } from 'vitest';
import { renderVisualDiffHtml, type Manifest } from './build-visual-diff-html';

const sampleManifest: Manifest = {
  slug: 'test-slug',
  title: 'Test PR title',
  module: 'dashboard',
  prSummary: 'Codemod X → Y across N sites',
  baselineSha: '7765fcc',
  candidateSha: 'abc1234',
  generatedAt: '2026-08-02T14:30:00+07:00',
  pairs: [
    {
      path: '/t/toko-jaya-makmur/dashboard',
      label: 'Dashboard — overview',
      beforePng: 'public/visual-diff/test-slug/before/dashboard-overview.png',
      afterPng: 'public/visual-diff/test-slug/after/dashboard-overview.png',
      notes: '',
    },
    {
      path: '/t/toko-jaya-makmur/dashboard/kpi',
      label: 'Dashboard — KPI section',
      beforePng: 'public/visual-diff/test-slug/before/dashboard-kpi.png',
      afterPng: 'public/visual-diff/test-slug/after/dashboard-kpi.png',
      notes: 'Watch for shadow rendering on the revenue tile',
    },
  ],
};

describe('renderVisualDiffHtml', () => {
  it('emits an HTML document with <!DOCTYPE html>', () => {
    const html = renderVisualDiffHtml(sampleManifest);
    expect(html).toMatch(/^<!DOCTYPE html>/i);
  });

  it('includes the title, PR summary, and both SHAs in the header', () => {
    const html = renderVisualDiffHtml(sampleManifest);
    expect(html).toContain('Test PR title');
    expect(html).toContain('Codemod X → Y across N sites');
    expect(html).toContain('7765fcc');
    expect(html).toContain('abc1234');
  });

  it('renders one section per pair with the label and both image refs', () => {
    const html = renderVisualDiffHtml(sampleManifest);
    // Both labels must appear
    expect(html).toContain('Dashboard — overview');
    expect(html).toContain('Dashboard — KPI section');
    // Both before + after image paths must appear as src attributes
    expect(html).toContain('src="visual-diff/test-slug/before/dashboard-overview.png"');
    expect(html).toContain('src="visual-diff/test-slug/after/dashboard-overview.png"');
    expect(html).toContain('src="visual-diff/test-slug/before/dashboard-kpi.png"');
    expect(html).toContain('src="visual-diff/test-slug/after/dashboard-kpi.png"');
  });

  it('shows the notes when present, and hides the notes container when empty', () => {
    const html = renderVisualDiffHtml(sampleManifest);
    expect(html).toContain('Watch for shadow rendering on the revenue tile');
    // First pair has empty notes — its section should not contain a stray "Notes:" label with empty content
    const sections = html.split('<section');
    const firstPairSection = sections[1] ?? '';
    // Either the notes block is absent, or if present it does not contain "Notes:" label
    // (implementation choice; the assertion locks in "no empty notes label").
    if (firstPairSection.includes('class="notes"')) {
      throw new Error('First pair has empty notes — should not render an empty notes block');
    }
  });

  it('escapes HTML in user-supplied fields to prevent injection', () => {
    const dangerous: Manifest = {
      ...sampleManifest,
      title: '<script>alert(1)</script>',
      pairs: [
        {
          path: '/x',
          label: '"><img src=x onerror=alert(1)>',
          beforePng: 'a.png',
          afterPng: 'b.png',
          notes: '<b>bold</b>',
        },
      ],
    };
    const html = renderVisualDiffHtml(dangerous);
    // Raw <script> and unquoted <img onerror must be escaped
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).not.toContain('<img src=x onerror=alert(1)>');
    expect(html).not.toContain('<b>bold</b>');
    // Escaped forms should be present instead
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&lt;b&gt;bold&lt;/b&gt;');
  });

  it('is self-contained — no external stylesheet or script <link>/<script src="…">', () => {
    const html = renderVisualDiffHtml(sampleManifest);
    // No linked external stylesheet
    expect(html).not.toMatch(/<link[^>]+rel=["']stylesheet["']/i);
    // No external script src
    expect(html).not.toMatch(/<script[^>]+src=["']/i);
    // Must have inline <style> block
    expect(html).toMatch(/<style>[\s\S]+<\/style>/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run scripts/build-visual-diff-html.test.ts 2>&1 | tail -15`
Expected: FAIL with "Cannot find module './build-visual-diff-html'" or similar — implementation file doesn't exist yet

- [ ] **Step 3: Implement the renderer + CLI**

Create `scripts/build-visual-diff-html.tsx` with this exact content:

```ts
// Visual approval gate — HTML report generator.
// Reads a manifest JSON of screenshot pairs and emits a self-contained HTML
// report (inline CSS, no external assets except <img src> refs). See spec at
// docs/superpowers/specs/2026-08-02-visual-approval-gate-design.md.
//
// Usage: tsx scripts/build-visual-diff-html.tsx --manifest=public/visual-diff/<slug>/manifest.json
// Or via npm: npm run visual-diff:build -- --manifest=<path>

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve, relative } from 'node:path';

export interface ScreenPair {
  path: string;
  label: string;
  beforePng: string;
  afterPng: string;
  notes: string;
}

export interface Manifest {
  slug: string;
  title: string;
  module: string;
  prSummary: string;
  baselineSha: string;
  candidateSha: string;
  generatedAt: string;
  pairs: ScreenPair[];
}

// Minimal HTML escaping — prevents injection from user-supplied manifest
// fields (title, label, notes) rendering as raw HTML in the report.
function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Convert a repo-relative screenshot path (e.g. "public/visual-diff/slug/before/x.png")
// into a value usable as <img src> from an HTML file located at "public/visual-diff-<slug>.html".
// Both live under public/, so we strip the leading "public/" segment.
function toImgSrc(repoPath: string): string {
  return repoPath.replace(/^public\//, '');
}

export function renderVisualDiffHtml(m: Manifest): string {
  const pairs = m.pairs
    .map((p, i) => {
      const notesBlock = p.notes.trim() === ''
        ? ''
        : `      <p class="notes"><strong>Notes:</strong> ${esc(p.notes)}</p>\n`;
      return `    <section class="pair">
      <h2>Screen ${i + 1} of ${m.pairs.length}: ${esc(p.label)}</h2>
      <p class="path"><code>${esc(p.path)}</code></p>
      <div class="split">
        <figure>
          <figcaption>BEFORE (${esc(m.baselineSha)})</figcaption>
          <img src="${esc(toImgSrc(p.beforePng))}" alt="Baseline: ${esc(p.label)}" loading="lazy">
        </figure>
        <figure>
          <figcaption>AFTER (${esc(m.candidateSha)})</figcaption>
          <img src="${esc(toImgSrc(p.afterPng))}" alt="Candidate: ${esc(p.label)}" loading="lazy">
        </figure>
      </div>
${notesBlock}    </section>`;
    })
    .join('\n');

  return `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <title>Visual diff: ${esc(m.title)}</title>
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: 'Inter', system-ui, -apple-system, sans-serif;
      margin: 0;
      padding: 0;
      background: #f4f6fa;
      color: #14161B;
    }
    header {
      background: #012749;
      color: #FAF7F0;
      padding: 24px 32px;
      border-bottom: 4px solid #F9B233;
    }
    header h1 { margin: 0 0 8px 0; font-size: 22px; }
    header p { margin: 4px 0; font-size: 13px; opacity: 0.9; }
    header code {
      background: rgba(255,255,255,0.15);
      padding: 2px 6px;
      border-radius: 4px;
      font-family: 'JetBrains Mono', monospace;
      font-size: 12px;
    }
    main { max-width: 1600px; margin: 0 auto; padding: 24px; }
    .pair {
      background: #ffffff;
      border: 1px solid #e5eeff;
      border-radius: 4px;
      padding: 20px;
      margin-bottom: 24px;
      box-shadow: 0 4px 12px rgba(11,37,69,0.06);
    }
    .pair h2 { margin: 0 0 6px 0; font-size: 16px; color: #0B2545; }
    .path {
      margin: 0 0 16px 0;
      font-size: 12px;
      color: #5A6472;
    }
    .path code {
      font-family: 'JetBrains Mono', monospace;
      background: #eff4ff;
      padding: 2px 6px;
      border-radius: 4px;
    }
    .split {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 16px;
    }
    figure { margin: 0; }
    figcaption {
      font-size: 11px;
      font-weight: 700;
      color: #5A6472;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 6px;
    }
    img {
      width: 100%;
      height: auto;
      display: block;
      border: 1px solid #c7d7f5;
      border-radius: 4px;
      background: #ffffff;
    }
    .notes {
      margin: 16px 0 0 0;
      padding: 12px 16px;
      background: #fff8e1;
      border-left: 4px solid #F9B233;
      border-radius: 4px;
      font-size: 13px;
    }
    footer {
      max-width: 1600px;
      margin: 0 auto;
      padding: 16px 32px 32px;
      font-size: 11px;
      color: #5A6472;
      text-align: center;
    }
  </style>
</head>
<body>
  <header>
    <h1>Visual diff: ${esc(m.title)}</h1>
    <p><strong>Module:</strong> ${esc(m.module)} &middot; <strong>Screens:</strong> ${m.pairs.length}</p>
    <p><strong>PR:</strong> ${esc(m.prSummary)}</p>
    <p><strong>Baseline:</strong> <code>${esc(m.baselineSha)}</code> &middot; <strong>Candidate:</strong> <code>${esc(m.candidateSha)}</code></p>
    <p><strong>Generated:</strong> ${esc(m.generatedAt)}</p>
  </header>
  <main>
${pairs}
  </main>
  <footer>Visual approval gate &middot; per docs/superpowers/specs/2026-08-02-visual-approval-gate-design.md</footer>
</body>
</html>`;
}

function parseArgs(argv: string[]): { manifest: string } {
  const arg = argv.find((a) => a.startsWith('--manifest='));
  if (!arg) {
    console.error('Usage: tsx scripts/build-visual-diff-html.tsx --manifest=<path-to-manifest.json>');
    process.exit(2);
  }
  return { manifest: arg.slice('--manifest='.length) };
}

function main(): void {
  const { manifest: manifestPath } = parseArgs(process.argv.slice(2));
  const raw = readFileSync(manifestPath, 'utf8');
  const m: Manifest = JSON.parse(raw);
  if (!m.slug) {
    console.error('Manifest missing "slug" field');
    process.exit(2);
  }
  const html = renderVisualDiffHtml(m);
  const outPath = resolve(process.cwd(), `public/visual-diff-${m.slug}.html`);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, html, 'utf8');
  console.log(outPath);
}

// Only run main() when invoked directly (not when imported by tests).
// import.meta.url comparison works under tsx / Node ESM.
const invokedDirectly = process.argv[1] &&
  resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname);
if (invokedDirectly) {
  main();
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run scripts/build-visual-diff-html.test.ts 2>&1 | tail -15`
Expected: `6 passed` (all 6 tests green)

- [ ] **Step 5: Verify CLI errors gracefully when manifest missing**

Run: `npm run visual-diff:build 2>&1 | head -5`
Expected: prints `Usage: tsx scripts/build-visual-diff-html.tsx --manifest=<path-to-manifest.json>` and exits non-zero

- [ ] **Step 6: Verify CLI accepts a manifest and writes output**

Create a temp manifest and invoke:
```bash
mkdir -p /tmp/vd && cat > /tmp/vd/manifest.json <<'EOF'
{
  "slug": "smoke-test",
  "title": "Smoke test manifest",
  "module": "test",
  "prSummary": "sanity check the tool CLI",
  "baselineSha": "0000000",
  "candidateSha": "1111111",
  "generatedAt": "2026-08-02T00:00:00+07:00",
  "pairs": []
}
EOF
npm run visual-diff:build -- --manifest=/tmp/vd/manifest.json 2>&1 | tail -3
```
Expected: last line prints an absolute path ending in `public/visual-diff-smoke-test.html`. Cleanup: `rm /tmp/vd/manifest.json && rm public/visual-diff-smoke-test.html`

- [ ] **Step 7: Verify lint (tsc) passes**

Run: `npm run lint 2>&1 | tail -3`
Expected: no errors from `scripts/build-visual-diff-html.tsx` or `.test.ts`

- [ ] **Step 8: Commit**

```bash
git add scripts/build-visual-diff-html.tsx scripts/build-visual-diff-html.test.ts
git commit -m "feat(visual-diff): HTML renderer + CLI + tests

Pure renderVisualDiffHtml(manifest) function emits self-contained HTML
report (inline CSS + <img> refs). CLI wrapper reads manifest JSON and
writes public/visual-diff-<slug>.html.

Tests (6): DOCTYPE, header fields, per-pair rendering, notes handling
(empty vs present), HTML escaping (XSS prevention), self-contained
(no external stylesheet/script)."
```

---

### Task 3: Bootstrap end-to-end validation (ad-hoc MCP screenshots)

**Files:**
- Create: `public/visual-diff/bootstrap-test/before/design-system.png` (temporary, gitignored)
- Create: `public/visual-diff/bootstrap-test/after/design-system.png` (temporary, gitignored)
- Create: `public/visual-diff/bootstrap-test/manifest.json` (temporary, gitignored)
- Produces: `public/visual-diff-bootstrap-test.html` (temporary, gitignored)

**Interfaces:**
- Consumes: `renderVisualDiffHtml` + CLI from Task 2, config from Task 1

**Purpose:** Prove the end-to-end flow works before Task 4 ships the CLAUDE.md rule. Uses the design-system.html static file as both baseline and candidate (identical images) — simplest possible "before vs after" pair. No prod URLs needed for bootstrap.

- [ ] **Step 1: Rebuild the design system preview so it exists**

Run: `npm run build:design-system 2>&1 | tail -3`
Expected: `built public/design-system.html (~70 KB)`

- [ ] **Step 2: Take a "before" screenshot via chrome-devtools MCP**

Open the design-system.html preview in a browser tab via MCP:
```
mcp__plugin_chrome-devtools-mcp_chrome-devtools__new_page
  url: file:///Users/tonywei/IdeaProjects/ERPAntigravity/public/design-system.html
```
Wait for stable content:
```
mcp__plugin_chrome-devtools-mcp_chrome-devtools__wait_for
  text: "Design System"
```
Then screenshot to disk:
```
mcp__plugin_chrome-devtools-mcp_chrome-devtools__take_screenshot
  filePath: /Users/tonywei/IdeaProjects/ERPAntigravity/public/visual-diff/bootstrap-test/before/design-system.png
  fullPage: true
```
Expected: screenshot file exists at that path.

(Note: prior to this step, `mkdir -p public/visual-diff/bootstrap-test/before` may be required if MCP does not auto-create parent dirs. Run it if the screenshot step errors.)

- [ ] **Step 3: Take an "after" screenshot (same page, same content — bootstrap smoke test only)**

For bootstrap, the "after" is identical to "before" — we're testing the tool, not a real code change:
```bash
mkdir -p public/visual-diff/bootstrap-test/after
cp public/visual-diff/bootstrap-test/before/design-system.png public/visual-diff/bootstrap-test/after/design-system.png
```
Expected: after PNG exists at the mirror path.

- [ ] **Step 4: Write the manifest JSON**

Create `public/visual-diff/bootstrap-test/manifest.json` with this content:

```json
{
  "slug": "bootstrap-test",
  "title": "Visual diff tool — bootstrap smoke test",
  "module": "designSystemPreview",
  "prSummary": "Bootstrap: no real code change — verify the tool renders end-to-end",
  "baselineSha": "aaaaaaa",
  "candidateSha": "aaaaaaa",
  "generatedAt": "2026-08-02T15:00:00+07:00",
  "pairs": [
    {
      "path": "/design-system.html",
      "label": "Design system preview — full page",
      "beforePng": "public/visual-diff/bootstrap-test/before/design-system.png",
      "afterPng": "public/visual-diff/bootstrap-test/after/design-system.png",
      "notes": "Baseline and candidate are identical (bootstrap sanity check — nothing changed)."
    }
  ]
}
```

- [ ] **Step 5: Run the CLI**

Run: `npm run visual-diff:build -- --manifest=public/visual-diff/bootstrap-test/manifest.json`
Expected: last line prints absolute path to `public/visual-diff-bootstrap-test.html`.

- [ ] **Step 6: Verify HTML output structure**

Run:
```bash
[ -f public/visual-diff-bootstrap-test.html ] && \
  grep -c 'Design system preview — full page' public/visual-diff-bootstrap-test.html && \
  grep -c 'src="visual-diff/bootstrap-test/before/design-system.png"' public/visual-diff-bootstrap-test.html && \
  grep -c 'src="visual-diff/bootstrap-test/after/design-system.png"' public/visual-diff-bootstrap-test.html
```
Expected: three lines, each printing `1` (file exists, label present, both image refs present).

- [ ] **Step 7: Open the report and eyeball it**

Run: `open public/visual-diff-bootstrap-test.html`
Expected: browser opens showing header (navy background, gold border), single "Screen 1 of 1" section with two identical images side-by-side, notes block visible. Layout should be readable, images should render (no broken-image icons).

If images do NOT render (broken-image icons), the `toImgSrc` logic is off — inspect the actual `<img src>` values in view-source and confirm they resolve relative to `public/`.

- [ ] **Step 8: Verify the artifacts are gitignored**

Run: `git status --short public/visual-diff-bootstrap-test.html public/visual-diff/bootstrap-test/`
Expected: empty output (all artifacts ignored).

- [ ] **Step 9: Cleanup + commit nothing**

Bootstrap-test artifacts are ephemeral — leave in place if you want to keep as reference, or remove:
```bash
rm -rf public/visual-diff/bootstrap-test public/visual-diff-bootstrap-test.html
```

No commit for this task — it's a validation-only task. Move to Task 4.

---

### Task 4: CLAUDE.md merge-gate rule + PR

**Files:**
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: Task 1-2 deliverables (config exists, tool works)
- Produces: durable rule that future PRs must generate visual-diff HTML before merge

- [ ] **Step 1: Read CLAUDE.md to find the right insertion point**

Run: `grep -n '^## ' CLAUDE.md | head -20`

Locate the section "Ship & verify — staged flow". The new "Protocol: Visual approval gate" section should sit immediately before "## Ship & verify" so it precedes deployment in the mental model (visual approval → deploy).

- [ ] **Step 2: Add the merge-gate rule**

Insert a new section immediately BEFORE the `## Ship & verify — staged flow` heading. Content:

```markdown
## Protocol: Visual approval gate (FE PRs)

Any PR that:
- Touches >5 files under `src/`, OR
- Touches ANY user-visible surface (component, page, style, token, layout)

MUST generate a visual-diff HTML report and receive founder "go" BEFORE merge.

### Flow

1. Implement on a branch (or worktree). Take screenshots via `chrome-devtools`
   MCP:
   - Baseline: current prod (`app.caleo.id`) as Toko Jaya Makmur test tenant
   - Candidate: local `npm run dev` OR your branch's Cloud Run tag URL
2. Save pairs to `public/visual-diff/<slug>/{before,after}/<screenname>.png`.
3. Write manifest: `public/visual-diff/<slug>/manifest.json` (schema per spec
   `docs/superpowers/specs/2026-08-02-visual-approval-gate-design.md` §6.2).
4. Generate report: `npm run visual-diff:build -- --manifest=public/visual-diff/<slug>/manifest.json`.
5. Present the printed absolute path in chat with "open this and reply
   go / adjust X / reject".
6. On "go" → open PR, merge, promote per Ship & verify below.
7. On "adjust" → iterate on branch, regenerate report, re-present.
8. Bypass conditions (documented, not routine):
   - Genuine prod incident (rollback path) — skip gate, note in `progress.md`.
   - Non-visual change (backend-only, config-only, docs-only) — no gate needed.

### Module → path config

Screenshot targets are declared in `.claude/visual-diff.config.json`. Add
new module paths as you sweep them; keep the file in sync with the modules
you own.

### Reference
- Spec: `docs/superpowers/specs/2026-08-02-visual-approval-gate-design.md`
- Tool: `scripts/build-visual-diff-html.tsx`
- Related discipline: manual promote-to-prod (memory
  `manual_prod_gate_after_real_tenant`) — visual gate is upstream of that.

---

```

- [ ] **Step 3: Verify the insertion is well-formed markdown**

Run: `grep -B1 -A3 '## Protocol: Visual approval gate' CLAUDE.md | head -20`
Expected: the new section is present with clean `##` boundary and no accidental duplicate `## Ship & verify`.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs(claude-md): add visual approval gate merge protocol

Per spec docs/superpowers/specs/2026-08-02-visual-approval-gate-design.md.

Any FE PR touching >5 files or user-visible surface must generate
public/visual-diff-<slug>.html and receive founder 'go' before merge.
Tool: scripts/build-visual-diff-html.tsx. Config: .claude/visual-diff.config.json.

Bypass documented for genuine incidents (rollback path) and non-visual
changes (backend/config/docs)."
```

- [ ] **Step 5: Verify Stage 1 gates green (all audits + lint + vitest --changed)**

Run: `npm run lint 2>&1 | tail -3`
Expected: no errors.

Run: `npx vitest run --changed 2>&1 | tail -5`
Expected: all changed-file tests pass.

- [ ] **Step 6: Push the branch**

```bash
git push -u origin fix/visual-approval-gate
```
Expected: branch pushed to remote; PR create URL printed.

- [ ] **Step 7: Open the PR with the ad-hoc bootstrap review artifact**

Since this PR IS the tool-building PR, we cannot use the tool on itself.
Instead, take ad-hoc screenshots showing the tool works end-to-end (bootstrap
test from Task 3) and include the screenshot inline in the PR body OR
attach the generated `visual-diff-bootstrap-test.html` (regenerate first
if you cleaned it up in Task 3 Step 9).

```bash
gh pr create --title 'feat(visual-diff): visual approval gate — helper script + config + CLAUDE.md rule' --body "$(cat <<'EOF'
## Summary

Bootstraps the **visual approval gate** per spec
\`docs/superpowers/specs/2026-08-02-visual-approval-gate-design.md\`.

Ships: helper script + config + gitignore + CLAUDE.md merge-gate rule.

## What's added

- \`scripts/build-visual-diff-html.tsx\` — pure \`renderVisualDiffHtml(manifest)\`
  function + CLI wrapper. Emits self-contained HTML (inline CSS, no external
  assets except <img> refs). 6 vitest tests cover DOCTYPE, header, per-pair
  rendering, empty-notes handling, XSS escaping, self-containedness.
- \`.claude/visual-diff.config.json\` — module → paths mapping (7 seed modules).
- \`.gitignore\` — ephemeral outputs (\`public/visual-diff/\`, \`public/visual-diff-*.html\`).
- \`package.json\` — \`visual-diff:build\` npm script.
- \`CLAUDE.md\` — Protocol: Visual approval gate section.

## Ad-hoc bootstrap review (this PR only)

The tool cannot review its own PR (chicken-and-egg). Instead, ran the
end-to-end bootstrap test from the plan (Task 3): screenshotted
\`public/design-system.html\`, generated \`public/visual-diff-bootstrap-test.html\`,
opened locally, verified layout renders + images display + no broken refs.

## Test plan

- [ ] Cloud Build passes
- [ ] Merge (bootstrap-approved via ad-hoc; all downstream PRs use tool)
- [ ] First real consumer: focus-ring standardization PR (next in queue)

## I verified

- \`npx vitest run scripts/build-visual-diff-html.test.ts\` = 6 passed
- \`npm run lint\` clean
- \`npm run visual-diff:build\` errors gracefully without \`--manifest\`
- End-to-end bootstrap: manifest → CLI → HTML → open in browser = readable

## Adversarial critique

- **Chicken-and-egg**: this PR can't gate itself. Bootstrap review pattern
  documented; downstream PRs get real gate. Acceptable one-time exception.
- **MCP session cookie persistence**: needs empirical confirmation on first
  real consumer PR. If breaks, re-login per candidate URL.
- **HTML escaping**: XSS test locks in \`esc()\` behavior. Malicious manifest
  cannot inject scripts.

Refs spec: \`docs/superpowers/specs/2026-08-02-visual-approval-gate-design.md\`.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```
Expected: prints PR URL. Report it in chat.

- [ ] **Step 8: Wait for Cloud Build + merge on green + no promote needed**

Cloud Build for this PR touches no runtime code (script + config + docs only),
so build should succeed quickly. Verify:
```bash
sleep 60 && gcloud builds list --limit=2 --format='value(id,status,substitutions.SHORT_SHA)' | head -2
```
Expected: SUCCESS.

Once green, merge via `gh pr merge <PR#> --squash --admin`.

**No promote-to-prod needed** — this PR ships no runtime code that reaches
customer instances. Verify: `git diff main..HEAD -- 'src/**' 'backend-go/**'`
should be empty (only \`scripts/\`, \`docs/\`, \`.claude/\`, \`.gitignore\`,
\`package.json\`, \`CLAUDE.md\` modified).

- [ ] **Step 9: Update progress.md**

Append a bullet under today's date in `progress.md`:

```markdown
- **PR #<N>** (`<SHA>`): visual approval gate infra shipped. Helper script
  `scripts/build-visual-diff-html.tsx` + config `.claude/visual-diff.config.json`
  + CLAUDE.md rule. All downstream FE PRs (design-system rollout) will
  generate `public/visual-diff-<slug>.html` for founder review before merge.
  Bootstrap PR used ad-hoc screenshot review (tool cannot gate itself).
  Spec: `docs/superpowers/specs/2026-08-02-visual-approval-gate-design.md`.
```

Commit + push:
```bash
git add progress.md
git commit -m "docs(progress): visual approval gate infra shipped (PR #<N>)"
git push
```

---

## Self-Review

### Spec coverage check

Walked each spec section:
- §1 Context — Task 4's CLAUDE.md rule addresses gap directly.
- §2 Decision (4 items) — Task 2 (script), Task 1 (config), Task 4 (protocol), Task 1 (gitignore). All four covered.
- §3 Alternatives — not implementation-relevant (design memo).
- §4 Consequences — implicit in the plan; no new task needed.
- §5 Scale-ceiling — process spec, no implementation.
- §6.1 Config schema — Task 1 Step 1 uses verbatim JSON.
- §6.2 Helper script — Task 2 implements `renderVisualDiffHtml` + `Manifest` interface.
- §6.3 Screenshot protocol — Task 3 walks through it as bootstrap; Task 4 CLAUDE.md documents it durably.
- §6.4 Merge-gate protocol — Task 4 Step 2 adds rule to CLAUDE.md.
- §6.5 Auth — config file's `authTenant` block (Task 1) + CLAUDE.md text (Task 4).
- §6.6 Gitignore — Task 1 Step 3.
- §7 Follow-up — the tool implementation itself; downstream PR consumers are separate future work.

Coverage: complete for the tool-building scope. Downstream consumer PRs (focus-ring, typography, etc.) are separate plans.

### Placeholder scan

- No "TBD" / "TODO" / "implement later" in the plan body.
- All code blocks are complete and copyable.
- All commands have expected output stated.
- File paths are absolute or exact repo-relative.

### Type consistency

- `Manifest` and `ScreenPair` interfaces defined once in Task 2 Step 1 (test file imports from the implementation file) and reused in the CLI + tests.
- `--manifest=<path>` arg convention consistent across Task 2 Step 5-6 (CLI usage) and Task 3 Step 5 (real invocation).
- `slug` field used consistently as output filename component: `public/visual-diff-<slug>.html`.
- Repo-relative screenshot path convention: `public/visual-diff/<slug>/{before,after}/<screenname>.png` used consistently in Task 3 and CLAUDE.md.
- `toImgSrc(p)` strips leading `public/` — image src becomes relative to the HTML file at `public/visual-diff-<slug>.html`.

Consistent.
