// Build a standalone `public/design-system.html` — founder-engineer preview
// of the Caleo/VOSI Design System. NOT part of the tenant app bundle.
//
// Usage:
//   npm run build:design-system
//   open public/design-system.html    # macOS
//
// The output is a single HTML file with all styling inlined (Tailwind classes
// resolved via a minimal utility CSS extract + brand CSS vars from
// src/index.css). Zero client JS — pure static markup. Re-run when tokens or
// components change.
//
// Rationale:
//   - Founder wants to review the de-facto design system BEFORE Phase 2 audit
//   - Preview is a design-standard reference, NOT a user feature — must not
//     live in app.caleo.id (tenant app) or add to prod bundle
//   - Static HTML file on disk = zero prod footprint, opens in any browser

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { DesignSystemPage } from '../src/components/designSystem/DesignSystemPage.tsx';

const CSS_SRC = 'src/index.css';
const OUT_PATH = 'public/design-system.html';

if (!existsSync('public')) mkdirSync('public');

// Extract the @theme block from index.css so tokens stay a single source of truth.
const rawCss = readFileSync(CSS_SRC, 'utf8');
const themeMatch = rawCss.match(/@theme\s*\{([\s\S]*?)\}/);
if (!themeMatch) {
  console.error('build:design-system — could not find @theme { ... } in src/index.css');
  process.exit(2);
}
const themeBlock = themeMatch[1];

// Parse `--token-name: value;` pairs (skip comments)
const tokens: Array<{ name: string; value: string }> = [];
for (const line of themeBlock.split('\n')) {
  const m = line.match(/^\s*(--[a-z0-9-]+)\s*:\s*([^;]+);/i);
  if (m) tokens.push({ name: m[1], value: m[2].trim() });
}

const bodyMarkup = renderToStaticMarkup(<DesignSystemPage tokens={tokens} />);

// Inline a minimal CSS: the extracted @theme vars as :root vars + a few utility
// classes we use in the preview (Tailwind isn't run here — we hand-roll what we
// need). Real app uses Tailwind's @theme + arbitrary values; this preview just
// needs enough to render swatches, headings, and card layouts.
const inlineCss = `
:root {
${tokens.map(t => `  ${t.name}: ${t.value};`).join('\n')}
}
* { box-sizing: border-box; }
body {
  margin: 0;
  padding: 0;
  font-family: var(--font-sans);
  color: var(--color-caleo-ink);
  background: #fafbff;
  -webkit-font-smoothing: antialiased;
}
h1, h2, h3, h4, h5, h6 { margin: 0; font-weight: 800; color: var(--color-caleo-navy); }
h1 { font-size: 32px; letter-spacing: -0.02em; }
h2 { font-size: 24px; margin-top: 32px; padding-bottom: 8px; border-bottom: 1px solid #e5eeff; }
h3 { font-size: 18px; margin-top: 20px; }
p  { margin: 0 0 12px; line-height: 1.5; }
code { font-family: var(--font-mono); font-size: 13px; background: #f3f4f6; padding: 2px 6px; border-radius: 4px; color: #012749; }
table { width: 100%; border-collapse: collapse; margin: 8px 0 20px; font-size: 13px; }
th, td { text-align: left; padding: 8px 12px; border-bottom: 1px solid #e5eeff; vertical-align: top; }
th { background: #f8f9ff; font-weight: 700; color: var(--color-caleo-navy); text-transform: uppercase; font-size: 11px; letter-spacing: 0.05em; }
.ds-container { max-width: 1100px; margin: 0 auto; padding: 40px 32px 80px; }
.ds-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
.ds-header .ds-meta { font-size: 12px; color: #6b7280; font-weight: 600; text-align: right; }
.ds-swatch-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 12px; margin: 16px 0 24px; }
.ds-swatch { border-radius: 12px; overflow: hidden; box-shadow: 0 2px 8px rgba(11,37,69,0.06); background: white; }
.ds-swatch-color { height: 72px; border-bottom: 1px solid rgba(0,0,0,0.05); }
.ds-swatch-meta { padding: 10px 12px; font-size: 12px; }
.ds-swatch-meta .name { font-weight: 700; color: var(--color-caleo-navy); font-family: var(--font-mono); font-size: 11px; word-break: break-all; }
.ds-swatch-meta .hex { color: #6b7280; margin-top: 2px; font-family: var(--font-mono); font-size: 11px; }
.ds-swatch-meta .use { color: #6b7280; margin-top: 4px; font-size: 11px; font-style: italic; }
.ds-radius-grid { display: flex; gap: 16px; flex-wrap: wrap; margin: 16px 0 24px; }
.ds-radius-item { display: flex; flex-direction: column; align-items: center; gap: 8px; }
.ds-radius-box { width: 100px; height: 100px; background: linear-gradient(135deg, var(--color-caleo-navy), var(--color-primary)); }
.ds-radius-label { font-family: var(--font-mono); font-size: 11px; color: #6b7280; text-align: center; }
.ds-shadow-grid { display: flex; gap: 24px; flex-wrap: wrap; margin: 16px 0 24px; }
.ds-shadow-item { flex: 1; min-width: 240px; padding: 24px; background: white; border-radius: var(--radius-default); text-align: center; }
.ds-type-sample { padding: 12px 0; border-bottom: 1px dashed #e5eeff; }
.ds-type-sample:last-child { border-bottom: none; }
.ds-type-meta { font-family: var(--font-mono); font-size: 11px; color: #6b7280; margin-top: 4px; }
.ds-component-box { padding: 32px; background: white; border-radius: 20px; box-shadow: 0 2px 12px rgba(11,37,69,0.06); margin: 16px 0 24px; }
.ds-anti-good, .ds-anti-bad { padding: 4px 8px; border-radius: 6px; font-family: var(--font-mono); font-size: 12px; }
.ds-anti-good { background: #dcfce7; color: #14532d; }
.ds-anti-bad  { background: #fee2e2; color: #7f1d1d; text-decoration: line-through; }
.ds-toc { display: flex; gap: 16px; flex-wrap: wrap; padding: 16px 20px; background: white; border-radius: 12px; box-shadow: 0 2px 8px rgba(11,37,69,0.06); margin: 16px 0 32px; }
.ds-toc a { color: var(--color-primary); font-weight: 700; font-size: 13px; text-decoration: none; padding: 6px 12px; border-radius: 6px; background: #f8f9ff; }
.ds-toc a:hover { background: var(--color-primary); color: white; }
.ds-note { padding: 12px 16px; border-left: 4px solid var(--color-caleo-gold); background: #fffbeb; border-radius: 0 8px 8px 0; font-size: 13px; color: #78350f; margin: 12px 0 16px; }
`;

const html = `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Caleo Design System — Founder Preview</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet" />
  <style>${inlineCss}</style>
</head>
<body>
${bodyMarkup}
</body>
</html>
`;

writeFileSync(OUT_PATH, html);
console.log(`built ${OUT_PATH} (${(html.length / 1024).toFixed(1)} KB)`);
console.log(`  ${tokens.length} tokens extracted from ${CSS_SRC}`);
console.log(`  open with: open public/design-system.html`);
