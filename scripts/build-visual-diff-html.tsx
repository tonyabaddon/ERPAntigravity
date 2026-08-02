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
