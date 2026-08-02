// Founder-engineer preview of the Caleo Design System.
// Rendered to static HTML by scripts/build-design-system.tsx.
//
// NOT imported by the tenant app entry (App.tsx). Zero prod bundle footprint.
//
// Guidance for edits:
//   - Add a new section by adding to SECTIONS array + creating render fn
//   - Keep this file self-contained (no client-only React hooks) — SSR only
//   - Use inline styles referencing CSS vars from :root (set by build script)

import React from 'react';
import * as LucideIcons from 'lucide-react';

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
  { match: /caleo-navy/,     usage: 'Primary text on light bg; app chrome (admin panel)' },
  { match: /caleo-gold/,     usage: 'Callout / warning accent; admin brand mark' },
  { match: /caleo-cream/,    usage: 'Admin panel soft background' },
  { match: /caleo-slate/,    usage: 'Secondary text on light bg' },
  { match: /caleo-muted/,    usage: 'Disabled / placeholder text; low-emphasis borders' },
  { match: /caleo-surface/,  usage: 'Panel background (elevated surfaces on cream)' },
  { match: /caleo-ink/,      usage: 'Body text primary (near-black)' },
  { match: /caleo-success/,  usage: 'Positive state (SUCCESS toast, +delta badges)' },
  { match: /caleo-danger/,   usage: 'Negative state (ERROR toast, danger buttons)' },
  { match: /caleo-info/,     usage: 'Informational (INFO toast, link accent)' },
  { match: /caleo-special/,  usage: 'Special / rare accent (used sparingly)' },
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
      <p>Canonical brand + semantic colors. Reference by CSS var (<code>var(--color-caleo-navy)</code>) or Tailwind arbitrary (<code>text-[#0B2545]</code>). NEW colors need founder approval + entry in this catalog + <code>src/index.css</code>.</p>
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
        Closest is <code>--color-caleo-navy</code> (<code>#0B2545</code>) — slightly darker.
        Decision needed: add <code>--color-caleo-primary: #012749</code> to <code>src/index.css</code> AND
        codemod 650 inline usages, OR retire <code>#012749</code> in favor of <code>caleo-navy</code>.
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
      <p>Three font families. Default is <code>Inter</code> (sans). Admin panel uses <code>Plus Jakarta Sans</code> (caleo). Code/numeric uses <code>JetBrains Mono</code>.</p>
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
                {t.name.includes('caleo') && 'Admin panel chrome (admin.caleo.id) only'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <h3>Size scale (de-facto, from grep)</h3>
      <div className="ds-component-box">
        <div className="ds-type-sample">
          <div style={{ fontSize: '32px', fontWeight: 800, color: 'var(--color-caleo-navy)' }}>Heading 1 — page title</div>
          <div className="ds-type-meta">32px / weight 800 / navy — used on Kasir daily-summary main title</div>
        </div>
        <div className="ds-type-sample">
          <div style={{ fontSize: '24px', fontWeight: 800, color: 'var(--color-caleo-navy)' }}>Heading 2 — section</div>
          <div className="ds-type-meta">24px / weight 800 / navy</div>
        </div>
        <div className="ds-type-sample">
          <div style={{ fontSize: '18px', fontWeight: 700, color: 'var(--color-caleo-navy)' }}>Heading 3 — subsection</div>
          <div className="ds-type-meta">18px / weight 700 / navy</div>
        </div>
        <div className="ds-type-sample">
          <div style={{ fontSize: '16px', fontWeight: 800, color: 'var(--color-caleo-navy)' }}>Heading 4 — card title (base)</div>
          <div className="ds-type-meta">16px / weight 800 (extrabold) — dominant on cards + modals</div>
        </div>
        <div className="ds-type-sample">
          <div style={{ fontSize: '14px', color: 'var(--color-caleo-ink)' }}>Body — default readable text. Contoh: "Kelola daftar kategori yang tampil di dropdown Kasir."</div>
          <div className="ds-type-meta">14px / weight 400 / ink</div>
        </div>
        <div className="ds-type-sample">
          <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--color-caleo-ink)' }}>Body small — form labels, list items</div>
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
          <div style={{ fontSize: '10px', fontWeight: 800, color: 'var(--color-caleo-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Micro — chip / badge label</div>
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
            <div style={{ fontWeight: 800, color: 'var(--color-caleo-navy)', fontSize: 15 }}>{t.name}</div>
            <div style={{ fontSize: 11, color: '#6b7280', marginTop: 4, fontFamily: 'var(--font-mono)' }}>{t.value}</div>
          </div>
        ))}
      </div>
      <div className="ds-note">
        Post-2026-08-02: all radius reduced to 2px (<code>rounded</code>) across app for MSME/Excel aesthetic. Only <code>rounded-full</code> preserved for semantic circular (avatars, pills, badges). Never use raw <code>rounded-lg</code>/<code>rounded-xl</code>/<code>rounded-2xl</code>/<code>rounded-3xl</code> — those visuals are retired.
      </div>
    </section>
  );
}

// ── Section: Spacing scale + Layout grid ────────────────────────────────────

interface SpacingEntry {
  token: string;
  tailwind: string;
  value: string;
  usage: string;
}

const SPACING_SCALE: SpacingEntry[] = [
  { token: 'Micro',   tailwind: 'p-1 gap-1',   value: '4px',  usage: 'Icon-text gap, chip inner padding, hairline separators' },
  { token: 'Small',   tailwind: 'p-2 gap-2',   value: '8px',  usage: 'Row cell padding, button vertical padding, dense list spacing' },
  { token: 'Base',    tailwind: 'p-3 gap-3',   value: '12px', usage: 'Modal footer, card inner spacing between items, default gap' },
  { token: 'Card',    tailwind: 'p-4 gap-4',   value: '16px', usage: 'Card outer padding, form field vertical rhythm, default panel padding' },
  { token: 'Section', tailwind: 'p-6 gap-6',   value: '24px', usage: 'Screen section separation, panel outer padding on large surfaces' },
  { token: 'Screen',  tailwind: 'p-8 gap-8',   value: '32px', usage: 'Screen edge padding on wide desktop layouts only' },
];

interface LayoutPattern {
  name: string;
  ascii: string;
  whenToUse: string;
  examples: string;
}

const LAYOUTS: LayoutPattern[] = [
  {
    name: 'List + Detail',
    ascii: [
      '┌────────────┬──────────────────────────┐',
      '│ Row 1  →   │  Detail Card             │',
      '│ Row 2      │                          │',
      '│ Row 3      │  (field, actions, etc.)  │',
      '│ [+ Add]    │                          │',
      '└────────────┴──────────────────────────┘',
    ].join('\n'),
    whenToUse: 'Master-detail workflows: user picks item on left → detail renders on right without navigating away.',
    examples: 'Pembelian → PO list + PO detail; Pelanggan → customer list + profile; Pengaturan → tab list + panel body.',
  },
  {
    name: 'Card Grid + Filter',
    ascii: [
      '┌──────────────────────────────────────┐',
      '│ [ Filter ][ Search ][ + Tambah ]     │',
      '├──────────────────────────────────────┤',
      '│  ┌────┐ ┌────┐ ┌────┐ ┌────┐         │',
      '│  │KPI │ │KPI │ │KPI │ │KPI │         │',
      '│  └────┘ └────┘ └────┘ └────┘         │',
      '│  ┌────────────────────────┐          │',
      '│  │  Chart / large panel   │          │',
      '│  └────────────────────────┘          │',
      '└──────────────────────────────────────┘',
    ].join('\n'),
    whenToUse: 'Overview + browse screens: user scans a set of tiles, filters/sorts, drills into one.',
    examples: 'Dashboard (KPI cards + charts); Produk catalog (grid view); Laporan overview.',
  },
  {
    name: 'Wizard 3-step',
    ascii: [
      '┌──────────────────────────────────────┐',
      '│  [1 Channel] → [2 Items] → [3 Bayar] │',
      '├──────────────────────────────────────┤',
      '│                                      │',
      '│   Step content (form, cart, etc.)    │',
      '│                                      │',
      '├──────────────────────────────────────┤',
      '│ [ ← Kembali ]           [ Lanjut → ] │',
      '└──────────────────────────────────────┘',
    ].join('\n'),
    whenToUse: 'Multi-step data entry where each step depends on the prior: sales flow, onboarding, opname commit.',
    examples: 'Kasir/Penawaran wizard (channel → items → payment); Saldo Awal wizard (kas → aktiva → kewajiban → preview); Stock Opname session.',
  },
];

function SpacingLayoutSection() {
  return (
    <section id="spacing-layout">
      <h2>5. Spacing Scale &amp; Layout Grid</h2>
      <p>Single source of truth for padding/gap sizes AND canonical screen layouts. Every new screen picks ONE layout — never invent a 4th without founder approval.</p>

      <h3>Spacing scale (6 sizes, all multiples of 4)</h3>
      <table>
        <thead><tr><th>Token</th><th>Tailwind</th><th>Value</th><th>Use case</th></tr></thead>
        <tbody>
          {SPACING_SCALE.map(s => (
            <tr key={s.token}>
              <td><strong>{s.token}</strong></td>
              <td><code>{s.tailwind}</code></td>
              <td><code>{s.value}</code></td>
              <td>{s.usage}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="ds-note">
        <strong>Rule:</strong> Never use in-between values (10px, 14px, 20px, 28px). <code>p-5</code> (20px) is <em>off-scale</em> — currently 84 refs in codebase; treat as tech debt to migrate to <code>p-4</code> or <code>p-6</code>. Any new intentional in-between value → promote to scale + document here.
      </div>

      <h3>Canonical screen layouts (pick ONE per screen)</h3>
      {LAYOUTS.map(l => (
        <div key={l.name} className="ds-component-box" style={{ padding: 20, marginBottom: 12 }}>
          <div style={{ fontWeight: 800, color: 'var(--color-caleo-navy)', fontSize: 15, marginBottom: 8 }}>{l.name}</div>
          <pre style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            background: '#f8f9ff',
            padding: 12,
            border: '1px solid #e5eeff',
            borderRadius: 2,
            margin: '4px 0 10px',
            lineHeight: 1.35,
            color: '#012749',
            overflow: 'auto',
          }}>{l.ascii}</pre>
          <div style={{ fontSize: 12, color: '#374151', marginBottom: 4 }}><strong>When to use:</strong> {l.whenToUse}</div>
          <div style={{ fontSize: 12, color: '#6b7280', fontStyle: 'italic' }}>Examples: {l.examples}</div>
        </div>
      ))}

      <h3>Layout DON'Ts</h3>
      <table>
        <thead><tr><th>❌ Don&#x27;t</th><th>✅ Do</th><th>Why</th></tr></thead>
        <tbody>
          <tr>
            <td><span className="ds-anti-bad">Invent a 4th layout because &quot;this screen is special&quot;</span></td>
            <td><span className="ds-anti-good">Adapt one of the 3 canonical layouts + document divergence in PR</span></td>
            <td>Each new layout = cognitive load for MSME. 3 is memorable, 10 is chaos.</td>
          </tr>
          <tr>
            <td><span className="ds-anti-bad">Mix spacing scales in one screen (some p-4, some p-6, some p-8)</span></td>
            <td><span className="ds-anti-good">One outer padding per screen. Nested cards can step down (screen p-6 → card p-4 → row p-2)</span></td>
            <td>Consistent spacing = perceived quality. Mixed = amateur.</td>
          </tr>
          <tr>
            <td><span className="ds-anti-bad">Raw values <code>p-[13px]</code> or <code>gap-[7px]</code></span></td>
            <td><span className="ds-anti-good">Pick nearest scale token (p-3, gap-2) OR promote value + document here</span></td>
            <td>Off-scale values leak into copy-paste, then everywhere. Guardrail via future audit script.</td>
          </tr>
        </tbody>
      </table>
      <div className="ds-note">
        <strong>Follow-up (not shipped):</strong> <code>scripts/audit-spacing-off-scale.ts</code> to grep for off-scale values (<code>p-5</code>, <code>p-7</code>, <code>p-9</code>, <code>p-10</code>, <code>p-11</code>, <code>p-13</code>, <code>p-14</code>) and fail if new usages appear. Currently 84 <code>p-5</code> refs exist as inherited debt.
      </div>
    </section>
  );
}

// ── Section: State templates (Empty / Loading / Error) ─────────────────────

function StateTemplatesSection() {
  return (
    <section id="states">
      <h2>6. State Templates (Empty / Loading / Error)</h2>
      <p>Three shared components at <code>src/components/ui/</code> for the three universal "not-content" states. Consistent visual + Bahasa copy across app. Never inline your own "Belum ada" / "Memuat…" / "Gagal" text.</p>

      <table>
        <thead><tr><th>State</th><th>Component</th><th>Default label</th><th>Variants</th></tr></thead>
        <tbody>
          <tr>
            <td><strong>Empty</strong> (no data yet)</td>
            <td><code>&lt;EmptyState /&gt;</code></td>
            <td>required — Bahasa; e.g. "Belum ada transaksi."</td>
            <td><code>default</code> (centered), <code>inline</code> (dropdown/row)</td>
          </tr>
          <tr>
            <td><strong>Loading</strong> (waiting query)</td>
            <td><code>&lt;LoadingState /&gt;</code></td>
            <td>"Memuat…"</td>
            <td><code>default</code>, <code>inline</code> (button/header), <code>overlay</code> (modal mutation)</td>
          </tr>
          <tr>
            <td><strong>Error</strong> (fetch/render failed)</td>
            <td><code>&lt;ErrorState /&gt;</code></td>
            <td>"Gagal memuat data." + <code>Coba lagi</code> button</td>
            <td><code>default</code>, <code>inline</code></td>
          </tr>
        </tbody>
      </table>

      <h3>MSME copy rules</h3>
      <ul style={{ paddingLeft: 20, lineHeight: 1.7 }}>
        <li><strong>Bahasa Indonesia always.</strong> Never "No data" or "Loading" — always "Belum ada" / "Memuat…"</li>
        <li><strong>Empty state MUST include hint or CTA.</strong> Never dead-end. Example: "Belum ada kategori. Tambah kategori pertama di Pengaturan → 💵 Kategori Kasir." Or button [+ Tambah].</li>
        <li><strong>Error state MUST offer next action.</strong> Retry button or clear step. Never just say "Gagal" and stop.</li>
        <li><strong>Loading state overlay ONLY for mutations.</strong> Never for initial fetch (blocks whole screen). Use default variant instead.</li>
      </ul>

      <h3>Anti-patterns (what NOT to do)</h3>
      <table>
        <thead><tr><th>❌ Don&#x27;t</th><th>✅ Do</th></tr></thead>
        <tbody>
          <tr>
            <td><span className="ds-anti-bad">&lt;p className="text-xs text-gray-400"&gt;Belum ada transaksi.&lt;/p&gt;</span></td>
            <td><span className="ds-anti-good">&lt;EmptyState message="Belum ada transaksi." /&gt;</span></td>
          </tr>
          <tr>
            <td><span className="ds-anti-bad">&lt;p&gt;Loading...&lt;/p&gt;</span></td>
            <td><span className="ds-anti-good">&lt;LoadingState /&gt;</span></td>
          </tr>
          <tr>
            <td><span className="ds-anti-bad">&lt;div className="text-red-600"&gt;&#123;err.message&#125;&lt;/div&gt;</span></td>
            <td><span className="ds-anti-good">&lt;ErrorState message=&#123;extractErrorMessage(err)&#125; onRetry=&#123;refetch&#125; /&gt;</span></td>
          </tr>
          <tr>
            <td><span className="ds-anti-bad">Empty state without next-step CTA (dead-end)</span></td>
            <td><span className="ds-anti-good">Empty state with hint OR action button telling MSME how to add first item</span></td>
          </tr>
        </tbody>
      </table>

      <div className="ds-note">
        <strong>Follow-up:</strong> <code>audit:hardcoded-empty-state</code> script scans JSX for inline "Belum ada" / "Tidak ada" text outside these components. Currently ~30 sites flagged as inherited debt.
      </div>
    </section>
  );
}

// ── Section: Form patterns ─────────────────────────────────────────────────

function FormPatternsSection() {
  return (
    <section id="forms">
      <h2>7. Form Patterns</h2>
      <p>Every field on every form follows the same visual conventions. Consistency &gt; creativity for MSME non-tech users.</p>

      <h3>Field anatomy</h3>
      <div className="ds-component-box" style={{ padding: 20 }}>
        <div style={{ maxWidth: 320, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <label style={{ fontSize: 10, fontWeight: 800, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Nama Kategori <span style={{ color: '#dc2626' }}>*</span>
          </label>
          <input
            style={{ padding: '8px 12px', border: '1px solid #cbd5e1', borderRadius: 2, fontSize: 13, fontFamily: 'var(--font-sans)' }}
            defaultValue="Sewa Gudang"
            readOnly
          />
          <div style={{ fontSize: 11, color: '#6b7280', fontStyle: 'italic' }}>
            3–40 karakter. Bebas huruf besar/kecil.
          </div>
        </div>
      </div>

      <table>
        <thead><tr><th>Part</th><th>Class / rule</th><th>Why</th></tr></thead>
        <tbody>
          <tr>
            <td><strong>Label</strong> (above input)</td>
            <td><code>text-[10px] font-extrabold text-gray-500 uppercase tracking-widest block mb-1</code></td>
            <td>Always above (never inline-left). MSME users scan top-down. Uppercase + tracking = clear field boundary.</td>
          </tr>
          <tr>
            <td><strong>Required marker</strong></td>
            <td><code>&lt;span className="text-red-600"&gt;*&lt;/span&gt;</code></td>
            <td>Universal convention. Never use the word "wajib" — takes too much space + inconsistent placement.</td>
          </tr>
          <tr>
            <td><strong>Input</strong></td>
            <td><code>px-3 py-2 border border-slate-300 rounded text-xs font-semibold text-slate-800 outline-none focus:ring-1 focus:ring-[#012749]</code></td>
            <td>Focus ring = clear focus state (accessibility). rounded = MSME/Excel aesthetic.</td>
          </tr>
          <tr>
            <td><strong>Help text</strong> (below input, muted)</td>
            <td><code>text-[11px] text-slate-500 italic mt-1</code></td>
            <td>Below input, italic, muted. Never above — MSME reads label first, help after they see the field.</td>
          </tr>
          <tr>
            <td><strong>Error message</strong></td>
            <td><code>text-[11px] text-red-600 mt-1</code></td>
            <td>Same position as help text, red instead of muted. Never as toast for inline validation — user needs to see WHICH field.</td>
          </tr>
          <tr>
            <td><strong>Disabled state</strong></td>
            <td><code>opacity-50 cursor-not-allowed</code></td>
            <td>Grayed + no-click cursor. Never hide the field entirely (MSME needs to see it exists but is locked).</td>
          </tr>
        </tbody>
      </table>

      <h3>Layout rules</h3>
      <ul style={{ paddingLeft: 20, lineHeight: 1.7 }}>
        <li><strong>One field per row on mobile</strong> — never side-by-side unless clearly related (e.g. from-to date).</li>
        <li><strong>Group related fields</strong> — visual space (gap-4 or divider) between logical groups.</li>
        <li><strong>Submit button ALWAYS at bottom</strong> — never floating, never fixed to viewport. Standard: right-aligned with Cancel to the left.</li>
        <li><strong>Bahasa Indonesia label</strong> — "Nama", "Alamat", "Telepon" — never "Name", "Address", "Phone".</li>
      </ul>

      <h3>Anti-patterns</h3>
      <table>
        <thead><tr><th>❌ Don&#x27;t</th><th>✅ Do</th></tr></thead>
        <tbody>
          <tr>
            <td><span className="ds-anti-bad">Inline label to the LEFT of input</span></td>
            <td><span className="ds-anti-good">Label ABOVE input (MSME reads top-down)</span></td>
          </tr>
          <tr>
            <td><span className="ds-anti-bad">"wajib" or "(required)" text</span></td>
            <td><span className="ds-anti-good">Red <code>*</code> only</span></td>
          </tr>
          <tr>
            <td><span className="ds-anti-bad">Placeholder as label (input empty = label disappears)</span></td>
            <td><span className="ds-anti-good">Real <code>&lt;label&gt;</code> element always visible + placeholder for example</span></td>
          </tr>
          <tr>
            <td><span className="ds-anti-bad">Toast for inline validation error</span></td>
            <td><span className="ds-anti-good">Inline red text below the specific field</span></td>
          </tr>
          <tr>
            <td><span className="ds-anti-bad">Hide disabled field entirely</span></td>
            <td><span className="ds-anti-good">Show grayed + disabled — MSME sees what's not accessible + why</span></td>
          </tr>
        </tbody>
      </table>
    </section>
  );
}

// ── Section: Interaction patterns ──────────────────────────────────────────

function InteractionPatternsSection() {
  return (
    <section id="interactions">
      <h2>8. Interaction Patterns</h2>
      <p>Hover, click, focus, disabled — canonical class recipes for every interactive element.</p>

      <table>
        <thead><tr><th>State</th><th>Class recipe</th><th>Why</th></tr></thead>
        <tbody>
          <tr>
            <td><strong>Row hover</strong> (list items)</td>
            <td><code>hover:bg-slate-50</code></td>
            <td>Subtle. MSME hovers to indicate "I'm about to click this row".</td>
          </tr>
          <tr>
            <td><strong>Button hover</strong> (primary)</td>
            <td><code>hover:opacity-90</code> OR <code>hover:bg-[#1e3d60]</code> (darker shade)</td>
            <td>Fast visual feedback. Never use scale/translate transforms (feels flashy for MSME).</td>
          </tr>
          <tr>
            <td><strong>Button hover</strong> (secondary/outline)</td>
            <td><code>hover:bg-slate-100</code></td>
            <td>Subtle fill on outline. Confirms clickability.</td>
          </tr>
          <tr>
            <td><strong>Link hover</strong></td>
            <td><code>hover:underline</code></td>
            <td>Classic. MSME familiar with hyperlink underline convention.</td>
          </tr>
          <tr>
            <td><strong>Focus ring</strong> (keyboard nav)</td>
            <td><code>focus:outline-none focus:ring-2 focus:ring-[#012749] focus:ring-offset-1</code></td>
            <td>Accessibility — keyboard users see WHERE focus is. Never remove outline without adding ring.</td>
          </tr>
          <tr>
            <td><strong>Active/pressed</strong></td>
            <td><code>active:opacity-80</code></td>
            <td>Instant "I just clicked" feedback. Prevents double-click confusion.</td>
          </tr>
          <tr>
            <td><strong>Disabled</strong></td>
            <td><code>disabled:opacity-50 disabled:cursor-not-allowed</code></td>
            <td>Universal disabled affordance. Never opacity-30/40/60 — pick one value.</td>
          </tr>
          <tr>
            <td><strong>Loading (during mutation)</strong></td>
            <td>Button label swap to <code>&lt;LoadingState inline label="Menyimpan…" /&gt;</code> + disabled</td>
            <td>MSME sees action in progress, can't double-submit.</td>
          </tr>
        </tbody>
      </table>

      <h3>Keyboard shortcuts (existing, not exhaustive)</h3>
      <table>
        <thead><tr><th>Key</th><th>Action</th><th>Where</th></tr></thead>
        <tbody>
          <tr><td><code>Enter</code></td><td>Submit form / confirm inline edit</td><td>All forms + KasirExpenseCategoriesPanel inline edit</td></tr>
          <tr><td><code>Esc</code></td><td>Cancel inline edit / close modal</td><td>All modals + inline edits</td></tr>
          <tr><td><code>Space</code></td><td>Toggle checkbox / grab drag handle (dnd-kit)</td><td>Native + Pengaturan drag-reorder</td></tr>
          <tr><td><code>Arrows</code></td><td>Move dragged item / navigate select options</td><td>Native + dnd-kit keyboard nav</td></tr>
        </tbody>
      </table>

      <h3>Anti-patterns</h3>
      <table>
        <thead><tr><th>❌ Don&#x27;t</th><th>✅ Do</th></tr></thead>
        <tbody>
          <tr>
            <td><span className="ds-anti-bad">Mixed disabled opacities (opacity-30, opacity-40, opacity-60 sprinkled across app)</span></td>
            <td><span className="ds-anti-good">Standardize on opacity-50</span></td>
          </tr>
          <tr>
            <td><span className="ds-anti-bad">focus:outline-none WITHOUT replacement focus:ring</span></td>
            <td><span className="ds-anti-good">Always pair — keyboard users need visible focus</span></td>
          </tr>
          <tr>
            <td><span className="ds-anti-bad">hover:scale-105 / hover:translate transforms</span></td>
            <td><span className="ds-anti-good">Opacity or bg-color change only — MSME finds motion "flashy" / distrust-inducing</span></td>
          </tr>
          <tr>
            <td><span className="ds-anti-bad">Button without loading feedback during async action</span></td>
            <td><span className="ds-anti-good">Swap label to "Menyimpan…" + disable to prevent double-click</span></td>
          </tr>
        </tbody>
      </table>
    </section>
  );
}

// ── Section: Shared components catalog ──────────────────────────────────────

function SharedComponentsSection() {
  return (
    <section id="components">
      <h2>9. Shared Components (src/components/ui/)</h2>
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

// ── Section: Icons (MSME-friendly vocabulary) ───────────────────────────────

interface IconEntry {
  action: string;
  icon: string;        // lucide-react component name
  usage: string;
  wrong?: string;      // common mistake to avoid
}

// Icon-to-action canonical mapping. Every action MUST use the same icon
// throughout the app so MSME users learn once, recognize everywhere.
const ICON_MAP: IconEntry[] = [
  // ── CRUD ──────────────────────────────────────────────────────────────────
  { action: 'Tambah / Buat baru',       icon: 'Plus',          usage: 'Tombol "+ Tambah kategori", "+ Customer Baru", "+ PO"', wrong: 'PlusCircle (too decorative)' },
  { action: 'Simpan',                   icon: 'Save',          usage: 'Tombol "Simpan" pada form yang butuh save state (draft)' },
  { action: 'Edit / Ubah',              icon: 'Pencil',        usage: 'Icon inline pada row untuk edit', wrong: 'Edit (Edit is more abstract, Pencil is universally recognized)' },
  { action: 'Hapus / Delete',           icon: 'Trash2',        usage: 'Delete permanent atau soft-delete', wrong: 'Trash (v1 icon has thinner lines, Trash2 is bolder + clearer)' },
  { action: 'Batal / Cancel',           icon: 'X',             usage: 'Close modal, cancel action, dismiss toast' },
  { action: 'Konfirmasi / OK',          icon: 'Check',         usage: 'Small confirm indicator (checkbox, checked state)' },
  { action: 'Berhasil',                 icon: 'CheckCircle',   usage: 'Success state (toast, badge)', wrong: 'CheckCircle2 (visually near-identical, causes drift)' },
  { action: 'Error / Gagal',            icon: 'AlertCircle',   usage: 'Error toast, invalid field marker', wrong: 'XCircle (too aggressive), AlertTriangle (reserved for warnings)' },
  { action: 'Peringatan',               icon: 'AlertTriangle', usage: 'Warning banner, danger action confirmation' },
  { action: 'Info / Bantuan',           icon: 'Info',          usage: 'Tooltip trigger, informational banner' },

  // ── Navigation ────────────────────────────────────────────────────────────
  { action: 'Kembali',                  icon: 'ArrowLeft',     usage: 'Modal back button, wizard step back' },
  { action: 'Lanjut',                   icon: 'ArrowRight',    usage: 'Wizard step forward, "Lihat selengkapnya" link' },
  { action: 'Expand row / Detail',      icon: 'ChevronRight',  usage: 'Row expand, sub-menu indicator (collapsed state)' },
  { action: 'Collapse row',             icon: 'ChevronDown',   usage: 'Row expand indicator (expanded state), select dropdown' },
  { action: 'Cari / Search',            icon: 'Search',        usage: 'Search input prefix, search modal trigger' },

  // ── MSME Business Actions ─────────────────────────────────────────────────
  { action: 'Cetak / Print',            icon: 'Printer',       usage: 'Print PDF button (Sales Order, Invoice, Struk)' },
  { action: 'Download / Unduh',         icon: 'Download',      usage: 'Download PDF file, CSV export' },
  { action: 'Upload / Unggah',          icon: 'Upload',        usage: 'Bukti pembayaran, foto produk, avatar' },
  { action: 'Kirim / Delivery',         icon: 'Truck',         usage: 'Surat Jalan, "Kirim Barang", Warehouse Transfer', wrong: 'Send (Send looks like paper airplane — not for physical delivery)' },
  { action: 'Bayar / Pembayaran',       icon: 'CreditCard',    usage: 'Payment button, tab "Pembayaran"' },
  { action: 'Stok / Produk',            icon: 'Package',       usage: 'Inventory nav, "Stok Habis" indicator', wrong: 'Box (Package has clearer commerce association)' },
  { action: 'Pelanggan / Customer',     icon: 'Users',         usage: 'Customer list nav, "Total Pelanggan" KPI', wrong: 'User (singular; customer DB is always plural context)' },
  { action: 'Toko / Store',             icon: 'Store',         usage: 'Store settings, tenant switcher' },
  { action: 'Penjualan / Sales',        icon: 'ShoppingCart',  usage: 'POS nav, active sales flow' },
  { action: 'Rekonsiliasi / Uang',      icon: 'Banknote',      usage: 'Rekonsiliasi Kas, cash transaction', wrong: 'DollarSign ($ is US-specific; Banknote is universal)' },
  { action: 'Laporan',                  icon: 'FileText',      usage: 'Report list, PDF preview' },
  { action: 'Waktu / Riwayat',          icon: 'Clock',         usage: 'Order history timestamp, activity log' },

  // ── State Indicators ──────────────────────────────────────────────────────
  { action: 'Loading',                  icon: 'Loader2',       usage: 'Spinner animation (Loader2 rotates smoothly, Loader has hard stops)', wrong: 'Loader (older icon, less smooth animation)' },
  { action: 'Locked / Protected',       icon: 'Lock',          usage: 'Owner-only feature indicator, PIN-gated action' },
  { action: 'Approved / Verified',      icon: 'ShieldCheck',   usage: 'Owner-approved badge, verified payment' },
  { action: 'Toggle ON',                icon: 'ToggleRight',   usage: 'Feature/modul enabled state' },
  { action: 'Toggle OFF',               icon: 'ToggleLeft',    usage: 'Feature/modul disabled state' },
  { action: 'Trend UP / Naik',          icon: 'TrendingUp',    usage: 'KPI positive delta, sales up' },

  // ── Communication ─────────────────────────────────────────────────────────
  { action: 'WhatsApp',                 icon: 'MessageSquare', usage: 'Send WA to customer, WA session status' },
  { action: 'Notifikasi',               icon: 'Bell',          usage: 'Notification bell, alert center' },
];

function IconRenderer({ name, size = 24, color = '#012749' }: { name: string; size?: number; color?: string }) {
  // Render actual lucide-react icon via SSR. lucide-react components render
  // to inline SVG which is fully SSR-safe (verified via renderToStaticMarkup).
  // Fall back to a mono-text placeholder if the named export is missing so
  // typos in the icon vocabulary catalog surface visibly in the preview.
  const Icon = (LucideIcons as unknown as Record<string, React.ComponentType<{ size?: number; color?: string; strokeWidth?: number }>>)[name];
  const boxStyle: React.CSSProperties = {
    width: size + 16,
    height: size + 16,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: '#f8f9ff',
    border: '1px solid #e5eeff',
    borderRadius: 2,
  };
  if (!Icon) {
    return (
      <div style={{ ...boxStyle, fontSize: 9, fontFamily: 'var(--font-mono)', color: '#7f1d1d', fontWeight: 700 }}>
        ?{name}
      </div>
    );
  }
  return (
    <div style={boxStyle}>
      <Icon size={size} color={color} strokeWidth={2} />
    </div>
  );
}

function IconsSection() {
  return (
    <section id="icons">
      <h2>10. Icons (MSME-friendly vocabulary)</h2>
      <p>Dari <code>lucide-react</code>. Every action has ONE canonical icon — MSME users learn once, recognize everywhere. Mixing icons for the same action = anti-pattern (confuses non-tech users).</p>
      <div className="ds-note">
        <strong>MSME rules:</strong> (1) Every button MUST have icon + label — never icon-only. (2) Prefer literal-meaning icons (Truck for kirim, not Send). (3) When multiple lucide icons exist for same concept, pick the boldest/clearest variant (Trash2 not Trash, CheckCircle not CheckCircle2).
      </div>
      <table>
        <thead><tr><th>Icon</th><th>Component</th><th>Action / Use case</th><th>Common mistake</th></tr></thead>
        <tbody>
          {ICON_MAP.map(entry => (
            <tr key={entry.action}>
              <td><IconRenderer name={entry.icon} /></td>
              <td><code>{entry.icon}</code></td>
              <td><strong>{entry.action}</strong><br /><span style={{ fontSize: 12, color: '#6b7280' }}>{entry.usage}</span></td>
              <td>{entry.wrong ? <code style={{ color: '#7f1d1d' }}>{entry.wrong}</code> : <span style={{ color: '#6b7280' }}>—</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="ds-note">
        <strong>Never add a new icon without checking this table first.</strong> If a concept isn't covered here, propose adding a row (same PR that adds the code using it).
      </div>
    </section>
  );
}

// ── Section: Anti-patterns ──────────────────────────────────────────────────

function AntiPatternsSection() {
  return (
    <section id="anti-patterns">
      <h2>11. Anti-patterns</h2>
      <p>Common drift patterns to reject during code review. Each has a shorter, better form.</p>
      <table>
        <thead><tr><th>❌ Don't</th><th>✅ Do</th><th>Why</th></tr></thead>
        <tbody>
          <tr>
            <td><span className="ds-anti-bad">&lt;input type="number" onChange=&#123;e =&gt; {'Number(e·target·value)'}&#125;/&gt;</span></td>
            <td><span className="ds-anti-good">&lt;NumberInput value onChange /&gt;</span></td>
            <td>Blocked by <code>audit:numinput</code>. Raw Number() returns NaN for empty strings.</td>
          </tr>
          <tr>
            <td><span className="ds-anti-bad">catch (err) &#123; msg = err instanceof Error ? err{'·'}message : String(err); &#125;</span></td>
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
            <td><span className="ds-anti-bad">rounded, rounded, rounded mixed within one card</span></td>
            <td><span className="ds-anti-good">One radius per surface hierarchy — parent 24px (rounded), children 12px (rounded), pills full</span></td>
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
      <h2>12. How to Extend</h2>
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
        <a href="#spacing-layout">Spacing & Layout</a>
        <a href="#states">States</a>
        <a href="#forms">Forms</a>
        <a href="#interactions">Interactions</a>
        <a href="#components">Components</a>
        <a href="#icons">Icons</a>
        <a href="#anti-patterns">Anti-patterns</a>
        <a href="#extend">How to Extend</a>
      </nav>

      <PaletteSection tokens={tokens} />
      <ChannelPaletteSection tokens={tokens} />
      <TypographySection tokens={tokens} />
      <RadiusShadowSection tokens={tokens} />
      <SpacingLayoutSection />
      <StateTemplatesSection />
      <FormPatternsSection />
      <InteractionPatternsSection />
      <SharedComponentsSection />
      <IconsSection />
      <AntiPatternsSection />
      <ExtendSection />
    </div>
  );
}
