// Founder-engineer preview of the Caleo/VOSI Design System.
// Rendered to static HTML by scripts/build-design-system.tsx.
//
// NOT imported by the tenant app entry (App.tsx). Zero prod bundle footprint.
//
// Guidance for edits:
//   - Add a new section by adding to SECTIONS array + creating render fn
//   - Keep this file self-contained (no client-only React hooks) — SSR only
//   - Use inline styles referencing CSS vars from :root (set by build script)

import React from 'react';

interface Token {
  name: string;
  value: string;
}

interface Props {
  tokens: Token[];
}

interface ColorTokenNote {
  match: RegExp;
  usage: string;
}

const COLOR_USAGE: ColorTokenNote[] = [
  { match: /vosi-navy/,     usage: 'Primary text on light bg; app chrome (admin panel)' },
  { match: /vosi-gold/,     usage: 'Callout / warning accent; admin brand mark' },
  { match: /vosi-cream/,    usage: 'Admin panel soft background' },
  { match: /vosi-slate/,    usage: 'Secondary text on light bg' },
  { match: /vosi-muted/,    usage: 'Disabled / placeholder text; low-emphasis borders' },
  { match: /vosi-surface/,  usage: 'Panel background (elevated surfaces on cream)' },
  { match: /vosi-ink/,      usage: 'Body text primary (near-black)' },
  { match: /vosi-success/,  usage: 'Positive state (SUCCESS toast, +delta badges)' },
  { match: /vosi-danger/,   usage: 'Negative state (ERROR toast, danger buttons)' },
  { match: /vosi-info/,     usage: 'Informational (INFO toast, link accent)' },
  { match: /vosi-special/,  usage: 'Special / rare accent (used sparingly)' },
  { match: /color-primary/, usage: 'Tenant app primary — CTAs, active tab, brand chrome' },
  { match: /color-secondary/, usage: 'Tenant app secondary — success actions, positive KPIs' },
  { match: /color-on-surface/, usage: 'Text color on default surface' },
  { match: /color-background-soft/, usage: 'Screen background (soft blue-white)' },
  { match: /channel-walkin/,    usage: 'Sales channel: Walk-in' },
  { match: /channel-grosir/,    usage: 'Sales channel: Grosir (wholesale)' },
  { match: /channel-sales/,     usage: 'Sales channel: Sales Rep' },
  { match: /channel-expo/,      usage: 'Sales channel: Expo / Event' },
  { match: /channel-tokopedia/, usage: 'Marketplace brand: Tokopedia' },
  { match: /channel-shopee/,    usage: 'Marketplace brand: Shopee' },
  { match: /channel-lazada/,    usage: 'Marketplace brand: Lazada' },
  { match: /channel-blibli/,    usage: 'Marketplace brand: Blibli' },
  { match: /channel-bukalapak/, usage: 'Marketplace brand: Bukalapak' },
  { match: /channel-ralali/,    usage: 'Marketplace brand: Ralali' },
  { match: /channel-bhinneka/,  usage: 'Marketplace brand: Bhinneka' },
  { match: /channel-whatsapp/,  usage: 'Sales channel: WhatsApp' },
  { match: /channel-instagram/, usage: 'Sales channel: Instagram' },
  { match: /channel-website/,   usage: 'Sales channel: Website / owned' },
];

function usageFor(tokenName: string): string {
  const hit = COLOR_USAGE.find(n => n.match.test(tokenName));
  return hit ? hit.usage : '—';
}

function isColorToken(t: Token): boolean {
  return t.name.startsWith('--color-');
}
function isRadiusToken(t: Token): boolean {
  return t.name.startsWith('--radius-');
}
function isShadowToken(t: Token): boolean {
  return t.name.startsWith('--shadow-');
}
function isFontToken(t: Token): boolean {
  return t.name.startsWith('--font-');
}
function isChannelColor(t: Token): boolean {
  return t.name.startsWith('--color-channel-');
}
function isCoreColor(t: Token): boolean {
  return isColorToken(t) && !isChannelColor(t);
}

// ── Section: Palette (core, non-channel) ────────────────────────────────────

function PaletteSection({ tokens }: { tokens: Token[] }) {
  const core = tokens.filter(isCoreColor);
  return (
    <section id="palette">
      <h2>1. Palette (core)</h2>
      <p>Canonical brand + semantic colors. Reference by CSS var (<code>var(--color-vosi-navy)</code>) or Tailwind arbitrary (<code>text-[#0B2545]</code>). NEW colors need founder approval + entry in this catalog + <code>src/index.css</code>.</p>
      <div className="ds-swatch-grid">
        {core.map(t => (
          <div key={t.name} className="ds-swatch">
            <div className="ds-swatch-color" style={{ background: t.value }} />
            <div className="ds-swatch-meta">
              <div className="name">{t.name}</div>
              <div className="hex">{t.value}</div>
              <div className="use">{usageFor(t.name)}</div>
            </div>
          </div>
        ))}
      </div>
      <div className="ds-note">
        ⚠ De-facto usage note: <code>#012749</code> (used 650× inline) does NOT map to any token above.
        Closest is <code>--color-vosi-navy</code> (<code>#0B2545</code>) — slightly darker.
        Decision needed: add <code>--color-caleo-primary: #012749</code> to <code>src/index.css</code> AND
        codemod 650 inline usages, OR retire <code>#012749</code> in favor of <code>vosi-navy</code>.
      </div>
    </section>
  );
}

// ── Section: Channel brand palette ──────────────────────────────────────────

function ChannelPaletteSection({ tokens }: { tokens: Token[] }) {
  const channels = tokens.filter(isChannelColor);
  return (
    <section id="channels">
      <h2>2. Sales Channel Brands</h2>
      <p>Per-channel brand colors — used for icon backgrounds, chart segments, pill borders. Never used for text or background of large surfaces.</p>
      <div className="ds-swatch-grid">
        {channels.map(t => (
          <div key={t.name} className="ds-swatch">
            <div className="ds-swatch-color" style={{ background: t.value }} />
            <div className="ds-swatch-meta">
              <div className="name">{t.name}</div>
              <div className="hex">{t.value}</div>
              <div className="use">{usageFor(t.name)}</div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

// ── Section: Typography ─────────────────────────────────────────────────────

function TypographySection({ tokens }: { tokens: Token[] }) {
  const fonts = tokens.filter(isFontToken);
  return (
    <section id="typography">
      <h2>3. Typography</h2>
      <p>Three font families. Default is <code>Inter</code> (sans). Admin panel uses <code>Plus Jakarta Sans</code> (vosi). Code/numeric uses <code>JetBrains Mono</code>.</p>
      <table>
        <thead><tr><th>Token</th><th>Family</th><th>Usage</th></tr></thead>
        <tbody>
          {fonts.map(t => (
            <tr key={t.name}>
              <td><code>{t.name}</code></td>
              <td>{t.value}</td>
              <td>
                {t.name.includes('sans') && 'Tenant app default — all screens'}
                {t.name.includes('mono') && 'Numbers, IDs, code samples'}
                {t.name.includes('vosi') && 'Admin panel chrome (admin.caleo.id) only'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <h3>Size scale (de-facto, from grep)</h3>
      <div className="ds-component-box">
        <div className="ds-type-sample">
          <div style={{ fontSize: '32px', fontWeight: 800, color: 'var(--color-vosi-navy)' }}>Heading 1 — page title</div>
          <div className="ds-type-meta">32px / weight 800 / navy — used on Kasir daily-summary main title</div>
        </div>
        <div className="ds-type-sample">
          <div style={{ fontSize: '24px', fontWeight: 800, color: 'var(--color-vosi-navy)' }}>Heading 2 — section</div>
          <div className="ds-type-meta">24px / weight 800 / navy</div>
        </div>
        <div className="ds-type-sample">
          <div style={{ fontSize: '18px', fontWeight: 700, color: 'var(--color-vosi-navy)' }}>Heading 3 — subsection</div>
          <div className="ds-type-meta">18px / weight 700 / navy</div>
        </div>
        <div className="ds-type-sample">
          <div style={{ fontSize: '16px', fontWeight: 800, color: 'var(--color-vosi-navy)' }}>Heading 4 — card title (base)</div>
          <div className="ds-type-meta">16px / weight 800 (extrabold) — dominant on cards + modals</div>
        </div>
        <div className="ds-type-sample">
          <div style={{ fontSize: '14px', color: 'var(--color-vosi-ink)' }}>Body — default readable text. Contoh: "Kelola daftar kategori yang tampil di dropdown Kasir."</div>
          <div className="ds-type-meta">14px / weight 400 / ink</div>
        </div>
        <div className="ds-type-sample">
          <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--color-vosi-ink)' }}>Body small — form labels, list items</div>
          <div className="ds-type-meta">13px / weight 600</div>
        </div>
        <div className="ds-type-sample">
          <div style={{ fontSize: '12px', color: '#6b7280' }}>Caption — helper text, footnotes</div>
          <div className="ds-type-meta">12px / weight 400 / slate</div>
        </div>
        <div className="ds-type-sample">
          <div style={{ fontSize: '11px', fontWeight: 800, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Overline — section labels</div>
          <div className="ds-type-meta">11px / weight 800 / uppercase / letter-spacing 0.05em</div>
        </div>
        <div className="ds-type-sample">
          <div style={{ fontSize: '10px', fontWeight: 800, color: 'var(--color-vosi-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Micro — chip / badge label</div>
          <div className="ds-type-meta">10px / weight 800 / uppercase — used on pills + timestamp chips</div>
        </div>
      </div>
      <div className="ds-note">
        MSME UX rule (per <code>feedback_font_sizing</code> memory): base body sizes never below 13px on tenant app.
        11–12px reserved for overlines/captions/timestamps. 10px only in tight chips where truncation risk is zero.
      </div>
    </section>
  );
}

// ── Section: Radius + shadow ────────────────────────────────────────────────

function RadiusShadowSection({ tokens }: { tokens: Token[] }) {
  const radii = tokens.filter(isRadiusToken);
  const shadows = tokens.filter(isShadowToken);
  return (
    <section id="radius-shadow">
      <h2>4. Border Radius &amp; Shadow</h2>
      <h3>Radius tokens</h3>
      <div className="ds-radius-grid">
        {radii.map(t => (
          <div key={t.name} className="ds-radius-item">
            <div className="ds-radius-box" style={{ borderRadius: t.value }} />
            <div className="ds-radius-label"><code>{t.name}</code><br />{t.value}</div>
          </div>
        ))}
      </div>
      <h3>Shadow tokens</h3>
      <div className="ds-shadow-grid">
        {shadows.map(t => (
          <div key={t.name} className="ds-shadow-item" style={{ boxShadow: t.value }}>
            <div style={{ fontWeight: 800, color: 'var(--color-vosi-navy)', fontSize: 15 }}>{t.name}</div>
            <div style={{ fontSize: 11, color: '#6b7280', marginTop: 4, fontFamily: 'var(--font-mono)' }}>{t.value}</div>
          </div>
        ))}
      </div>
      <div className="ds-note">
        Additional in-use radii (de-facto, not tokenized): <code>rounded-lg</code> (8px), <code>rounded-xl</code> (12px), <code>rounded-2xl</code> (16px), <code>rounded-3xl</code> (24px), <code>rounded-full</code>. Most cards use 24px (<code>rounded-3xl</code>). Decision: promote these to tokens or keep Tailwind classes as canonical? Recommend keep classes — 4 radius levels is manageable without token names.
      </div>
    </section>
  );
}

// ── Section: Shared components catalog ──────────────────────────────────────

function SharedComponentsSection() {
  return (
    <section id="components">
      <h2>5. Shared Components (src/components/ui/)</h2>
      <p>Reusable primitives. Prefer these over rolling one-off implementations. Adding a new primitive requires founder approval + entry in this catalog.</p>
      <table>
        <thead><tr><th>Component</th><th>Purpose</th><th>Key props</th><th>Where to use</th></tr></thead>
        <tbody>
          <tr>
            <td><code>AvatarBadge</code></td>
            <td>User/tenant avatar with gender-aware fallback (SVG init) or Google avatar (img)</td>
            <td><code>name, gender, avatarUrl, size</code></td>
            <td>Sidebar, admin lists, comment threads</td>
          </tr>
          <tr>
            <td><code>KpiCard</code></td>
            <td>Metric summary card with icon, value, delta badge</td>
            <td><code>icon, iconBg, badge, label, value, sub, alarming</code></td>
            <td>Kasir daily summary, Dashboard, Laporan overview</td>
          </tr>
          <tr>
            <td><code>NumberInput</code></td>
            <td>Numeric-only input with parse safety (blocks NaN, formats IDR optionally)</td>
            <td><code>value, onChange, allowDecimal, emptyAs</code></td>
            <td>Every numeric field (qty, price, discount, budget). Never use raw <code>&lt;input type="number"&gt;</code>.</td>
          </tr>
          <tr>
            <td><code>PinPad</code></td>
            <td>6-digit PIN modal for owner approvals + verify_owner_pin RPC integration</td>
            <td><code>title, onSubmit, onCancel</code></td>
            <td>Approval flows (stock adjustment, refund, price override)</td>
          </tr>
          <tr>
            <td><code>StorageImage</code></td>
            <td>Signed URL wrapper for Supabase storage images — handles auth + loading state</td>
            <td><code>bucket, path, alt, className</code></td>
            <td>Product photos, payment proofs, avatars</td>
          </tr>
          <tr>
            <td><code>StorageLink</code></td>
            <td>Signed URL wrapper for downloading storage files (PDF, receipts)</td>
            <td><code>bucket, path, children</code></td>
            <td>Invoice PDF links, uploaded proof download</td>
          </tr>
          <tr>
            <td><code>TabBar</code></td>
            <td>Generic tab strip with type-safe active id</td>
            <td><code>tabs, active, onChange</code></td>
            <td>Pengaturan sub-tabs, Laporan tabs, admin panels</td>
          </tr>
        </tbody>
      </table>
      <div className="ds-note">
        Interactive components (NumberInput, PinPad) render "visual-dead" in this preview — see them live in the app.
      </div>
    </section>
  );
}

// ── Section: Anti-patterns ──────────────────────────────────────────────────

function AntiPatternsSection() {
  return (
    <section id="anti-patterns">
      <h2>6. Anti-patterns</h2>
      <p>Common drift patterns to reject during code review. Each has a shorter, better form.</p>
      <table>
        <thead><tr><th>❌ Don't</th><th>✅ Do</th><th>Why</th></tr></thead>
        <tbody>
          <tr>
            <td><span className="ds-anti-bad">&lt;input type="number" onChange=&#123;e =&gt; Number(e.target.value)&#125;/&gt;</span></td>
            <td><span className="ds-anti-good">&lt;NumberInput value onChange /&gt;</span></td>
            <td>Blocked by <code>audit:numinput</code>. Raw Number() returns NaN for empty strings.</td>
          </tr>
          <tr>
            <td><span className="ds-anti-bad">catch (err) &#123; msg = err instanceof Error ? err.message : String(err); &#125;</span></td>
            <td><span className="ds-anti-good">catch (err) &#123; msg = extractErrorMessage(err); &#125;</span></td>
            <td>Blocked by <code>audit:no-string-err-fallback</code>. String(PostgrestError) = "[object Object]".</td>
          </tr>
          <tr>
            <td><span className="ds-anti-bad">bg-[#3b82f6]</span> (random blue)</td>
            <td><span className="ds-anti-good">bg-[var(--color-primary)]</span> or <code>bg-blue-600</code> from Tailwind default</td>
            <td>New hex colors need founder approval + entry in Palette section.</td>
          </tr>
          <tr>
            <td><span className="ds-anti-bad">Custom avatar SVG per screen</span></td>
            <td><span className="ds-anti-good">&lt;AvatarBadge name gender /&gt;</span></td>
            <td>Consistency + gender-aware fallback logic centralized.</td>
          </tr>
          <tr>
            <td><span className="ds-anti-bad">rounded-md, rounded-sm, rounded-2xl mixed within one card</span></td>
            <td><span className="ds-anti-good">One radius per surface hierarchy — parent 24px (rounded-3xl), children 12px (rounded-xl), pills full</span></td>
            <td>Consistency + reduced cognitive load.</td>
          </tr>
          <tr>
            <td><span className="ds-anti-bad">Custom Text/Heading font weight combos</span></td>
            <td><span className="ds-anti-good">Match Typography scale above (only 4 weights in use: 400/600/700/800)</span></td>
            <td>Weight sprawl = visual noise + accessibility drift.</td>
          </tr>
        </tbody>
      </table>
    </section>
  );
}

// ── Section: How to extend ──────────────────────────────────────────────────

function ExtendSection() {
  return (
    <section id="extend">
      <h2>7. How to Extend</h2>
      <ol style={{ paddingLeft: 20, lineHeight: 1.7 }}>
        <li><strong>Propose in a design brief</strong> — describe the need + why existing token/component doesn't cover it. Show a mockup or reference (per CLAUDE.md FE UI/UX approval protocol).</li>
        <li><strong>Founder approves</strong> — "go", "approved", "lock it", or iteration comment. Assumptions of approval = violation per CLAUDE.md.</li>
        <li><strong>Add token / component</strong> — for tokens: edit <code>src/index.css</code> @theme block. For components: add to <code>src/components/ui/</code>.</li>
        <li><strong>Update this catalog</strong> — add row in the relevant section table + brief usage guidance. Both changes ship in the SAME PR.</li>
        <li><strong>Re-run preview</strong> — <code>npm run build:design-system</code> regenerates <code>public/design-system.html</code>. Verify swatch/component renders correctly.</li>
      </ol>
      <div className="ds-note">
        Never ship an ad-hoc style that forks the design system. If a screen needs something outside the catalog, either extend the catalog (above) OR justify the divergence in the PR description.
      </div>
    </section>
  );
}

// ── Page shell ──────────────────────────────────────────────────────────────

export function DesignSystemPage({ tokens }: Props) {
  return (
    <div className="ds-container">
      <div className="ds-header">
        <div>
          <h1>Caleo Design System</h1>
          <p style={{ color: '#6b7280', marginTop: 4, fontSize: 14 }}>Founder-engineer preview — de-facto tokens + components extracted from tenant app codebase.</p>
        </div>
        <div className="ds-meta">
          v0.1 (draft)<br />
          Generated: <span style={{ fontFamily: 'var(--font-mono)' }}>preview</span><br />
          Tokens: {tokens.length}
        </div>
      </div>

      <nav className="ds-toc">
        <a href="#palette">Palette</a>
        <a href="#channels">Channel Brands</a>
        <a href="#typography">Typography</a>
        <a href="#radius-shadow">Radius & Shadow</a>
        <a href="#components">Components</a>
        <a href="#anti-patterns">Anti-patterns</a>
        <a href="#extend">How to Extend</a>
      </nav>

      <PaletteSection tokens={tokens} />
      <ChannelPaletteSection tokens={tokens} />
      <TypographySection tokens={tokens} />
      <RadiusShadowSection tokens={tokens} />
      <SharedComponentsSection />
      <AntiPatternsSection />
      <ExtendSection />
    </div>
  );
}
