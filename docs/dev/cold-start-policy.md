# Cold-start Policy — Cloud Run

**TL;DR**: Both frontend and backend Cloud Run services run at `min-instances=0` (scale-to-zero). This is the zero-cost default. First request after idle triggers a ~2-5s cold start. At current 3-tenant scale with sparse traffic this is acceptable. Bump to `min-instances=1` per service when we cross the "one paying tenant with 8am–10pm daily active use" bar.

## Current policy — scale-to-zero

Both services:

| Service | min-instances | max-instances | Cold-start impact |
|---|---:|---:|---|
| `garindo-jaya-panel-msme-erp` (backend) | 0 | 10 | ~3-5s first request (Go binary + DB pool init) |
| `garindo-jaya-panel-msme-erp-frontend` | 0 | 5 | ~2-3s first request (nginx boot) |

Set in:
- `cloudbuild.yaml:41` — backend
- `cloudbuild.frontend.yaml:102` — frontend

Rationale: at 3 tenants with the founder's own business (Garindo Jaya Panel) + two prod-testing tenants, real request volume is 5-50 requests/day per service. Scaled-to-zero saves 100% of vCPU-hour spend during idle. Trade-off is a slow first request every ~15 min of idle (Cloud Run auto-terminates idle instances after 15 min).

## When to bump min-instances

Move to `min-instances=1` on the affected service when ANY of these become true:

| Signal | Trigger threshold | Action |
|---|---|---|
| Real user complaints about slow first load | >2/week | BE + FE → min=1 |
| P95 latency alert firing on cold starts | >5s in 1h window | Just the impacted service → min=1 |
| One tenant hitting the app between 8am–10pm daily | Confirmed via `tenant_activity_daily` last 7 days | BE → min=1 (BE cold starts hurt every API call, FE cold start only hurts first page load) |
| Kasir/POS live in a real store during business hours | Verified via founder | BE + FE → min=1 |
| Sentry captures multi-second Time-to-Interactive events | Recurring pattern | Investigate; may point to FE min-instances OR bundle bloat |

**Do NOT preemptively bump** because "it'll feel nicer" without a real signal. Cost math below.

## Cost math (why zero-cost matters here)

Cloud Run per-instance idle cost (asia-southeast1, ~1 vCPU + 512 MiB):

- Backend: ~$0.024/hour = **~$18/month per min-instance idle** (before Cloud Run always-free allowance)
- Frontend: ~$0.010/hour = **~$7/month per min-instance idle**

At `min-instances=1` on both: ~$25/month burn even during idle. That is meaningful at 3-tenant free-tier scale (25% of a $99 Supabase Pro tier cost).

Cloud Run always-free allowance covers ~180K vCPU-seconds/month = enough for ~2 warm hours/day per service. If we go min=1, most of that free allowance is consumed just holding warm state, leaving less headroom for actual traffic bursts.

**Conclusion**: stay at min=0 until a real signal justifies the burn.

## Cold-start mitigation without min-instances

Zero-cost ways to reduce cold-start pain BEFORE resorting to min-instances=1:

### Backend

1. **Faster Go binary start**: current Go binary is ~40 MB, boots in ~1s. `slog` + config init another ~1s. DB pool init another ~1-2s. Total ~3-5s. Cutting DB pool init by lazy-connecting on first query would drop cold start ~1-2s. Trade-off: first real request is slower. Not worth today.
2. **Uptime Robot warmer**: our existing UptimeRobot ping every 5 min keeps BE warm during high-traffic windows. Verify ping hits `/api/v1/ready` (a real request, not a health-check that bypasses handler init).
3. **CPU always allocated**: Cloud Run has an option `--cpu-throttling=false` — CPU stays allocated when handling requests. Doesn't fix cold start but reduces per-request slowness. Costs 2-3× as much. Skip.

### Frontend

1. **Static asset caching**: Cloudflare already caches FE static assets globally. First HTML request hits Cloud Run; subsequent asset requests hit CF edge. If FE cold start is >3s, add Cloudflare caching for the HTML too via a Page Rule (5min edge TTL).
2. **Preconnect hints**: FE HTML should include `<link rel="preconnect" href="https://<supabase-host>">` — reduces Supabase auth roundtrip by ~200ms on first login. Cheap to add.
3. **Smaller bundle**: check `dist/assets/index-*.js` size on next FE build. If >800KB gzip, code-split more aggressively.

## Rehearsal

Once a quarter (or after any Cloud Run runtime bump), rehearse:

1. Note current min-instances setting.
2. Wait 20 min for services to idle out.
3. Hit `curl -w "%{time_total}\n" -o /dev/null -s https://app.caleo.id/` → measure cold-start FE time.
4. Hit `curl -w "%{time_total}\n" -o /dev/null -s https://garindo-jaya-panel-msme-erp-xnrhcw7onq-as.a.run.app/api/v1/ready` → measure cold-start BE time.
5. Log measurements in this doc's history section below.

## History

**2026-07-18** — Initial policy documented. Both services at min=0. Founder mission is zero-cost until real 10-tenant load justifies bump.

Next rehearsal: 2026-10-18.

## Related

- `cloudbuild.yaml` — backend deploy config (line 41 sets min-instances)
- `cloudbuild.frontend.yaml` — frontend deploy config (line 102 sets min-instances)
- Memory `production-testing-tenant` — traffic patterns to expect at current scale
- `docs/runbooks/rollback-procedures.md` — if a min-instances change breaks something, revert path is `gcloud run services update <svc> --min-instances=<prior>`
