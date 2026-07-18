# Load Baseline

Zero-cost load reference for Caleo production. Uses bash + curl only — no k6, JMeter, or paid service. Captures p50/p95/error-rate against `/api/v1/ready` (BE) and `/` (FE) which are safe read-only endpoints. Run monthly OR before any capacity decision.

## How to run

```bash
bash tests/loadtest/baseline.sh
```

Uses env `BE_URL` and `FE_URL` overrides for staging.

## What "good" looks like at current 3-tenant scale

| Metric | Good | Warn | Investigate |
|---|---|---|---|
| BE p50 | <500ms | 500-1000ms | >1000ms |
| BE p95 | <2000ms | 2000-4000ms | >4000ms |
| FE p50 | <500ms | 500-1000ms | >1000ms |
| FE p95 | <2000ms | 2000-4000ms | >4000ms |
| Error rate (100 seq reqs) | 0% | 1-2% | ≥3% |
| 10 parallel BE reqs | <2s wall clock | 2-5s | >5s |

At 10 tenants with active daytime use, expect p95 to roughly double if we stay on scale-to-zero (more cold-start hits during traffic bursts). If p95 crosses "Investigate", bump `min-instances` per [cold-start-policy.md](cold-start-policy.md).

## Baselines captured

### 2026-07-18 12:45 WIB — Initial baseline

Ran from founder laptop (macOS, Homebrew curl, warm services after prior probe).

**BE `/api/v1/ready`** (20 sequential warm requests):
- min=291ms, p50=384ms, p95=1130ms, max=1158ms, avg=478ms
- 100/100 success across 100 sequential requests
- 10 parallel requests: 1s wall clock

**FE `/`** (20 sequential warm requests):
- min=278ms, p50=379ms, p95=700ms, max=912ms, avg=327ms

**Verdict**: PASS. Under all "Good" thresholds. p95=1.1s on BE reflects Cloud Run scale-to-zero occasionally hitting cold-start on the 20-request sample (each cold start ~800-1100ms extra). At 10-tenant scale with active use, expect fewer cold-starts per burst → p95 likely improves as instances warm.

**Capacity headroom**: Cloud Run BE currently at `min-instances=0, max-instances=10` per `cloudbuild.yaml:41`. At 10 tenants each averaging 5 concurrent requests during peak, that's 50 concurrent — well within current cap. No config change needed for onboarding up to 10.

**No errors, no rate limiting, no timeouts observed.** DB pool (via split-pool architecture) has ~200-slot txn pooler headroom. Ready for 10-tenant onboarding at current infra.

## Interpretation guide

- **Cold-start tax**: BE p95 minus BE p50 gives a rough cold-start-per-request cost. If (p95 - p50) > 1000ms consistently, most cold-starts are hitting during warm testing → services aren't holding warm long enough. Consider Uptime Robot pings every 5 min OR min-instances=1.
- **FE always faster than BE**: expected. FE is static nginx behind Cloudflare edge caching; BE hits Go handler + DB. If FE > BE, something is wrong with FE build (huge index.html?) or Cloudflare caching bypassed.
- **10-parallel latency close to sequential latency**: Cloud Run auto-scaling worked; no queueing. If 10-parallel takes >5× sequential, we're hitting cold-start scale-up bottleneck.

## When to run

- **Before onboarding a new paying tenant** — quick sanity check
- **After any Cloud Run runtime bump** (CPU, memory, min/max instances) — before/after comparison
- **After Supabase pool config change** — verify no regression
- **Monthly proactive** — capture drift over time; log entries in this doc's "Baselines captured" section
- **After any alert fires on latency or error rate** — reproduce, capture, compare to last known good

## What we intentionally DON'T load-test

- **Real authenticated endpoints** — would need test-tenant JWT, adds complexity for marginal value at 3-tenant scale. Add when we cross 10 tenants and need end-to-end auth path measurement.
- **Write endpoints** — writes go through SECURITY DEFINER RPCs with idempotency keys; load-testing them creates real data. Verify via unit + integration tests, not load tests, until we have >100 tenants.
- **WhatsApp Business API flow** — real webhook path, would trigger real inbound processing. Use test-mode Twilio credentials + assert-only for e2e.

## Bigger tools we could adopt later

At >100 tenants OR when we need per-user session simulation, migrate to:
- **k6** (Grafana Labs, free OSS) — proper scripted load test, JS-based scenarios
- **Vegeta** (Go) — better for high-throughput single-endpoint testing
- **Playwright + `test.describe.parallel`** — for authenticated user-journey load

Do NOT adopt until scale forces it. The current bash baseline captures what we need to make capacity decisions today.

## Related

- `tests/loadtest/baseline.sh` — the runnable script
- [cold-start-policy.md](cold-start-policy.md) — when to bump min-instances based on latency signals
- Alert 5 (BE latency), Alert 6 (BE error rate) in Cloud Monitoring — fire on real-user regressions
