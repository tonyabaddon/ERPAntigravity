# Task 4 Report: Hand-convert legal MDs to HTML + shared legal.css (Phase 3 Landing)

**Date:** 2026-07-19
**Commit SHA:** 2a41122
**Status:** DONE

---

## What Was Implemented

### Files Created

**`public/assets/legal.css`** (49 lines)
- CSS custom properties: `--navy: #0B2545`, `--slate: #5A6472`, `--gold: #F59E0B`, `--border`, `--bg-alt`
- Matches Inter/navy/gold palette from landing mockup
- Shared by both `privacy.html` and `terms.html`
- Covers: `nav.legal-nav`, `main`, headings (h1/h2/h3), tables, blockquote with gold left border, footer

**`public/privacy.html`** (321 lines)
- Converted from `docs/legal/kebijakan-privasi.md` (231 lines) via pandoc 3.10
- pandoc flag: `-f markdown+pipe_tables` to ensure pipe tables → `<table>` HTML
- Contains: h1 "Kebijakan Privasi Caleo", TL;DR section, 2 HTML tables (sub-processor + data retention), all 16 sections
- Nav: `← Kembali ke Beranda` href="/"
- Footer: WA + halo@caleo.id + link to `/terms.html`

**`public/terms.html`** (451 lines)
- Converted from `docs/legal/syarat-ketentuan.md` (423 lines) via pandoc 3.10
- Contains: h1 "Syarat & Ketentuan Layanan Caleo", TL;DR section, SLA severity table (Kritis/Tinggi/Sedang/Rendah), all 19 sections
- Nav: `← Kembali ke Beranda` href="/"
- Footer: WA + halo@caleo.id + link to `/privacy.html`

---

## Steps Executed

1. **pandoc install**: Not found → `brew install pandoc` → pandoc 3.10 installed
2. **legal.css**: Written verbatim from brief spec to `public/assets/legal.css`
3. **privacy.html**: pandoc conversion via template file at `/tmp/privacy-template.html`
4. **terms.html**: pandoc conversion via template file at `/tmp/terms-template.html`
5. **Browser smoke** (localhost:8765 via MCP chrome-devtools): both pages verified

---

## Verification

### Browser smoke — localhost:8765

| Check | privacy.html | terms.html |
|---|---|---|
| Page loads, correct `<title>` | PASS | PASS |
| h1 text | "Kebijakan Privasi Caleo" | "Syarat & Ketentuan Layanan Caleo" |
| TL;DR heading renders | PASS | PASS |
| Tables render as `<table>` (not raw pipe text) | 2 tables | 1 table |
| Sub-processor / SLA table content | Supabase Inc. present | Kritis row present |
| Nav "← Kembali ke Beranda" href | "/" | "/" |
| Footer reciprocal link | → /terms.html | → /privacy.html |
| Footer WA + halo@caleo.id | PASS | PASS |
| Logo renders (CALEO-logo-horizontal-HD-v2.png) | PASS | PASS |

### JS evaluation output (MCP chrome-devtools evaluate_script)

**privacy.html:**
```json
{
  "tableCount": 2,
  "h1": "Kebijakan Privasi Caleo",
  "navBackLink": "/",
  "footerLinks": [
    {"href": "https://wa.me/6285264787775", "text": "0852-6478-7775"},
    {"href": "mailto:halo@caleo.id", "text": "halo@caleo.id"},
    {"href": "/", "text": "Beranda"},
    {"href": "/terms.html", "text": "Syarat & Ketentuan"}
  ]
}
```

**terms.html:**
```json
{
  "tableCount": 1,
  "h1": "Syarat & Ketentuan Layanan\nCaleo",
  "tldr": "TL;DR untuk pemilik toko",
  "navBackLink": "/",
  "kritisInTable": true,
  "footerLinks": [
    {"href": "https://wa.me/6285264787775", "text": "0852-6478-7775"},
    {"href": "mailto:halo@caleo.id", "text": "halo@caleo.id"},
    {"href": "/", "text": "Beranda"},
    {"href": "/privacy.html", "text": "Kebijakan Privasi"}
  ]
}
```

---

## Design Decisions

1. **Template file vs heredoc**: Used `/tmp/privacy-template.html` and `/tmp/terms-template.html` as separate template files rather than piping a heredoc via `--template=-`. More reliable across zsh/bash and avoids escaping issues with `$body$` and `$lang$` pandoc variables.

2. **`-f markdown+pipe_tables` flag**: Added explicitly to ensure pandoc treats `|col|col|` syntax as pipe tables → `<table>` HTML. Without this flag, pandoc can silently render them as raw text depending on default reader settings.

3. **Content faithfulness**: Zero re-authoring — pandoc converts MD structure to HTML only. All legal wording identical to source `.md` files.

---

## Rollback Plan

`git revert 2a41122` — removes all 3 files. Source MDs in `docs/legal/` are untouched and remain the source of truth for regeneration.

---

## Concerns

None blocking.

- `h1` in terms.html shows a line break (`"Syarat & Ketentuan Layanan\nCaleo"`) because pandoc wraps long headings. Visually it renders correctly as a single heading line in the browser — the `\n` is just whitespace in the DOM text content, not a visible break. Not a defect.
- pandoc 3.10 installed globally via brew — not pinned. If pandoc is upgraded and template syntax changes, re-run the conversion commands from this brief.
