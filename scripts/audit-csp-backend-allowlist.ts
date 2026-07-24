// Verify every backend hostname the frontend actually calls is listed in
// serve.json's CSP `connect-src`. When the frontend backend URL was
// refactored to the `<service>-<project_number>.<region>.run.app` shape but
// CSP kept only the `<service>-<hash>-<region>.a.run.app` shape (both are
// valid Cloud Run aliases for the same service), the browser silently
// blocked every `getBackendUrl()` fetch on `app.caleo.id` from 2026-07-18
// (CSP flip Report-Only → enforce) until Cari by Foto users reported it
// as "tidak bisa upload foto".
//
// Usage: npm run audit:csp-backend-allowlist
// Exit 0 = every backend host is allowlisted, exit 1 = mismatch (prints them).

import { readFileSync } from 'node:fs';

const SERVE_JSON = 'serve.json';
const BACKEND_URL_TS = 'src/lib/backendUrl.ts';

type ServeJson = { headers?: Array<{ headers?: Array<{ key?: string; value?: string }> }> };

function loadCspConnectSrcHosts(): Set<string> {
  const serve = JSON.parse(readFileSync(SERVE_JSON, 'utf8')) as ServeJson;
  let csp = '';
  for (const block of serve.headers ?? []) {
    for (const h of block.headers ?? []) {
      if (h.key === 'Content-Security-Policy' && typeof h.value === 'string') {
        csp = h.value;
        break;
      }
    }
    if (csp) break;
  }
  if (!csp) {
    console.error(`✗ ${SERVE_JSON}: no Content-Security-Policy header found`);
    process.exit(1);
  }
  const match = csp.match(/connect-src\s+([^;]+)/i);
  if (!match) {
    console.error(`✗ ${SERVE_JSON}: no connect-src directive in CSP`);
    process.exit(1);
  }
  const hosts = new Set<string>();
  for (const token of match[1].trim().split(/\s+/)) {
    if (token.startsWith('http://') || token.startsWith('https://') || token.startsWith('wss://') || token.startsWith('ws://')) {
      try {
        // URL requires a path; add / if the token has none.
        const u = new URL(token);
        hosts.add(u.hostname);
      } catch {
        // ignore malformed tokens
      }
    }
  }
  return hosts;
}

function loadBackendHosts(): Set<string> {
  const src = readFileSync(BACKEND_URL_TS, 'utf8');
  const hosts = new Set<string>();
  // Match any 'https://<host>...' string literal in the file. This assumes
  // backend URLs live inline as full-URL literals. If a future refactor
  // switches to base-host + path construction (e.g. `'https://' + BE_HOST`),
  // this regex will miss the hostname and the audit will silently pass —
  // update the extraction here if that pattern lands.
  for (const m of src.matchAll(/['"`]https:\/\/([^'"`\/\s]+)/g)) {
    hosts.add(m[1]);
  }
  return hosts;
}

function isAllowedByCsp(cspHosts: Set<string>, host: string): boolean {
  if (cspHosts.has(host)) return true;
  // Wildcard suffix support: `*.example.com` in CSP allows any subdomain.
  for (const allowed of cspHosts) {
    if (allowed.startsWith('*.')) {
      const suffix = allowed.slice(1); // ".example.com"
      if (host.endsWith(suffix)) return true;
    }
  }
  return false;
}

const cspHosts = loadCspConnectSrcHosts();
const backendHosts = loadBackendHosts();

const missing: string[] = [];
for (const host of backendHosts) {
  if (!isAllowedByCsp(cspHosts, host)) missing.push(host);
}

if (missing.length === 0) {
  console.log(`✓ clean — every backend host in ${BACKEND_URL_TS} is allowlisted in ${SERVE_JSON} CSP connect-src (${backendHosts.size} hosts checked)`);
  process.exit(0);
}

console.error(`✗ ${missing.length} backend host(s) in ${BACKEND_URL_TS} missing from ${SERVE_JSON} CSP connect-src:`);
for (const h of missing) console.error(`  ${h}`);
console.error(`\nFix: add https://<host> to the connect-src directive in ${SERVE_JSON}. Browser blocks any fetch to a hostname absent from connect-src.`);
process.exit(1);
