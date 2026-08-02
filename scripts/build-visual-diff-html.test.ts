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
