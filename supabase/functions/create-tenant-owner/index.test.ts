import { assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { RESERVED_SLUGS, SLUG_RE } from "./blocklist.ts";

// ── SLUG_RE format tests ──────────────────────────────────────────────────────

Deno.test('SLUG_RE accepts valid slugs', () => {
  const valid = ['toko-abc', 'a1b2c3', 'my-tenant-name', 'abc', 'tenant123', 'garindo-jaya'];
  for (const s of valid) {
    assert(SLUG_RE.test(s), `Expected '${s}' to be valid`);
  }
});

Deno.test('SLUG_RE rejects slugs shorter than 3 chars', () => {
  const tooShort = ['', 'a', 'ab'];
  for (const s of tooShort) {
    assert(!SLUG_RE.test(s), `Expected '${s}' to be rejected (too short)`);
  }
});

Deno.test('SLUG_RE rejects slugs longer than 30 chars', () => {
  const tooLong = 'a'.repeat(31);
  assert(!SLUG_RE.test(tooLong), `Expected slug of 31 chars to be rejected`);
});

Deno.test('SLUG_RE rejects slugs starting with dash', () => {
  assert(!SLUG_RE.test('-toko'), `Expected '-toko' to be rejected`);
});

Deno.test('SLUG_RE rejects uppercase letters', () => {
  const invalid = ['Toko-Abc', 'TOKO', 'MyTenant'];
  for (const s of invalid) {
    assert(!SLUG_RE.test(s), `Expected '${s}' to be rejected (uppercase)`);
  }
});

Deno.test('SLUG_RE rejects underscores', () => {
  assert(!SLUG_RE.test('toko_abc'), `Expected 'toko_abc' to be rejected (underscore)`);
});

Deno.test('SLUG_RE rejects spaces and special chars', () => {
  const invalid = ['toko abc', 'toko.abc', 'toko@abc'];
  for (const s of invalid) {
    assert(!SLUG_RE.test(s), `Expected '${s}' to be rejected (special char)`);
  }
});

Deno.test('SLUG_RE accepts slug of exactly 30 chars', () => {
  // 1 leading char + 29 more = 30 total (max allowed)
  const maxSlug = 'a' + 'b'.repeat(29);
  assert(SLUG_RE.test(maxSlug), `Expected 30-char slug to be valid`);
});

// ── RESERVED_SLUGS tests ──────────────────────────────────────────────────────

Deno.test('RESERVED_SLUGS includes admin', () => {
  assert(RESERVED_SLUGS.includes('admin'), `'admin' must be reserved`);
});

Deno.test('RESERVED_SLUGS includes platform routes', () => {
  const mustBeReserved = ['api', 'auth', 'login', 'logout', 'register', 'signup', 'signin'];
  for (const s of mustBeReserved) {
    assert(RESERVED_SLUGS.includes(s), `'${s}' must be in RESERVED_SLUGS`);
  }
});

Deno.test('RESERVED_SLUGS includes app-specific slugs', () => {
  const appSpecific = ['t', 'select-tenant', 'onboarding', 'billing', 'settings'];
  for (const s of appSpecific) {
    assert(RESERVED_SLUGS.includes(s), `'${s}' must be in RESERVED_SLUGS`);
  }
});

Deno.test('RESERVED_SLUGS does not contain empty string', () => {
  assert(!RESERVED_SLUGS.includes(''), `Empty string must not be in RESERVED_SLUGS`);
});

Deno.test('RESERVED_SLUGS does not block arbitrary valid slugs', () => {
  const notReserved = ['toko-abc', 'tenant-baru', 'garindo-jaya', 'abc123'];
  for (const s of notReserved) {
    assert(!RESERVED_SLUGS.includes(s), `'${s}' should NOT be in RESERVED_SLUGS`);
  }
});
