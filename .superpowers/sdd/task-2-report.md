# Task 2 Report
## Status: DONE
## Commits: a9a3f32..9ec4d94
## Test results: landing.js 200 OK; ROI recalc confirmed (1.69jt→2.47jt on staff change); pricing toggle confirmed (419K→509K on 6-month click); scroll reveal confirmed (74 .reveal elements, .in-view applied by IntersectionObserver on scroll); console zero app errors (2 pre-existing 404s for image assets not yet in public/assets/ — unrelated to JS extraction)
## Actions taken:
1. Read task-2-brief.md and located inline script block at lines 2452-2591 of public/index.html (JSON-LD at line 31 correctly identified as keep-inline)
2. Created public/assets/ directory
3. Ran Node one-liner to extract plain `<script>` body → public/assets/landing.js (5704 chars, 138 lines); verified head starts with `(function() {` + `staffEl = document.getElementById('roi-staff')`
4. Ran Node one-liner to replace last `<script>...</script>` block in index.html with `<script defer src="/assets/landing.js"></script>`
5. Verified: `grep -c '<script' public/index.html` = 2 (JSON-LD inline + external reference); no plain `<script>` without attributes remains
6. Started python3 http.server on :8765; curl confirmed index.html (200) and /assets/landing.js (200)
7. Browser smoke via chrome-devtools MCP: all 3 JS features verified working (see Test results)
8. `git add public/index.html public/assets/landing.js && git commit` → 9ec4d94

## Concerns:
- Two 404s in console for `CALEO-logo-horizontal-HD-v2.png` and `caleo-qr.png` — these are pre-existing image asset gaps from Task 1 (images referenced in HTML but not yet copied to public/assets/). Unrelated to JS extraction. Will be addressed in a later task that copies static assets.

## Rollback:
`git revert 9ec4d94` — restores inline script in index.html and removes public/assets/landing.js.
