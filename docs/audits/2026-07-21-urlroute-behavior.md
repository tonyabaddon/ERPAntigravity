# Routing behavior audit — F5-11 investigation

**Date:** 2026-07-21
**Spec claim:** F5-11 "useURLRoute routing race — `?screen=` vs path segment can diverge"
**Verdict:** Race is theoretically possible but no evidence of reproduction. **Refactor DEFERRED pending symptom.**

## Current routing surface

`src/lib/urlRoute.ts` (247 lines) exports:
- `buildHref(screen, params)` — pure href builder (query-string based)
- `parseRoute(pathname, search)` — parses BOTH pathname + query
- `parseScreenFromPath(pathname, search)` — pathname-first with query ignored
- `parseSearch(search)` — query-string only
- `useURLRoute()` — React hook via `useSyncExternalStore`
- `navigate(screen, params)` — pushes history entry
- `replaceRoute(screen, params)` — replaces without history
- `handleSPAClick(...)` — click-interception helper
- `shouldInterceptClick(e)` — modifier-key detection

## Path parsing precedence (parseRoute)

For any URL, `parseRoute` returns the first matching branch:
1. `/admin` or `/admin/*` → `{screen: 'admin', isPlatformAdminArea: true}` — path wins, query ignored
2. `/select-tenant` → path wins
3. `/login` → path wins
4. `/t/<slug>/<screen>` → tenant-scoped, screen extracted from path segment (query ignored via `_search` unused param)
5. Fallback: `parseScreenFromPath(pathname, search)` — path segment wins, query still unused

**Query string is NEVER read by `parseRoute` for the screen name.** The `search` argument is passed to `parseScreenFromPath` but explicitly ignored (`_search: URLSearchParams`).

## Query string parsing (parseSearch)

`parseSearch(search)` reads `?screen=X` and other params — but this returns a `RouteState`, not a `Route`. It's used SEPARATELY from `parseRoute`.

## Where each is called

Grep of production sources (excluding tests):

**parseRoute callers (1 site):**
- `src/App.tsx:156` — initial mount `useSyncExternalStore` getSnapshot

**buildHref callers (3 sites):**
- verified via grep; only 3 non-test callers

**Direct `window.location.href` navigation (10+ sites — bypasses buildHref):**
- `src/App.tsx:1005` → `/login`
- `src/components/SelectTenantScreen.tsx:29,41` → `/t/<slug>/dashboard`
- `src/components/AuthScreen.tsx:107` → post-auth decision href
- `src/components/TenantImpersonationBanner.tsx:53` → `/admin`
- `src/components/admin/AdminLayout.tsx:59,69` → `/login` and `/admin`
- `src/components/admin/TenantsList.tsx:203` → `/t/<slug>/dashboard`
- `src/components/admin/AdminRouteGuard.tsx:87,94` → `/t/<slug>/dashboard?screen=dashboard` and `/dashboard`

## Race analysis

**Is there a race?** The spec's claim is that URL `?screen=X` and path `/t/<slug>/Y` can diverge. Reading the code:

- **parseRoute** ignores the query string for the screen name. If both are present, path wins.
- **parseSearch** reads query, ignores path.

Only if BOTH `parseRoute` AND `parseSearch` results are consumed simultaneously as ground-truth for the current screen could they disagree. Grep for `parseSearch` usage:

```
$ grep -rn 'parseSearch' src --include='*.ts' --include='*.tsx' | grep -v test
src/lib/urlRoute.ts:149:export function parseSearch(search: string): RouteState {
```

Only ONE caller — the declaration itself. `parseSearch` is exported but not consumed anywhere in production code. So no consumer combines both results.

**Actual behavior at time of audit:** path is the sole source of truth for screen (except in query params for filter/detail state). `?screen=` on URLs is never read for navigation decision. So there is NO active race.

## Consistency risk

The 10+ `window.location.href = '/<hardcoded-path>'` sites do bypass `buildHref` + `handleSPAClick`. This means:
- No SPA-mode navigation (full page reload)
- No unified href construction
- If a future change adds `?screen=` reading to `parseRoute`, these hardcoded paths would be `?screen=`-less and could break

## Recommendation

**DEFER refactor.** No race to fix.

If a refactor is done in the future (Wave 3 or later), scope:
1. Migrate all `window.location.href = '/<path>'` sites to `buildHref` + `navigate` for consistency
2. Decide once whether `?screen=` should even be a valid source (currently it's not read)
3. Add a comment lock at top of `urlRoute.ts` stating the source-of-truth invariant

Estimated effort: 4-6h to migrate all sites + regression test the deep-link paths (WA messages, invoice emails, external SSO redirects).

**Do NOT proceed with refactor now:** no user-reported symptom, no test failure, no security risk. Refactor would touch 10+ production nav sites with fan-out risk to deep-linking (WA messages, invoices, admin routes). YAGNI.
