# Runbooks

Operational runbooks for Caleo ERP prod incidents, recovery, and scheduled maintenance. Every runbook here has been **either used in prod OR rehearsed** — nothing speculative. Update after each use.

## Index

### Recovery
- [rollback-procedures.md](rollback-procedures.md) — Cloud Run FE/BE traffic revert, migration revert, DNS revert. **Primary FE recovery = `gcloud run services update-traffic` (10s)**, Cloud Build re-run is fallback.
- [restore-from-backup.md](restore-from-backup.md) — pg_restore from daily GCS backup. Three scenarios: single-table, single-tenant, full nuclear. Rehearsal history + drill reports linked.
- [secret-rotation.md](secret-rotation.md) — Per-secret rotation flow for all 8 production secrets: source, blast radius, verification, revert-on-fail.

### Deploy
- [../cloud-run-promote-runbook.md](../cloud-run-promote-runbook.md) — Post-merge FE traffic promotion (legacy — mostly automated via `cloudbuild.frontend.yaml` tag-URL smoke pipeline).
- [../tenant-onboarding-runbook.md](../tenant-onboarding-runbook.md) — New tenant provisioning.

## When to use which

| Situation | Runbook |
|---|---|
| Bad code in prod (FE or BE) | [rollback-procedures.md § 1 or 2](rollback-procedures.md) — traffic revert (10s) |
| Migration broke schema/RPC | [rollback-procedures.md § 3](rollback-procedures.md) — write revert migration, claim next slot |
| Data corrupted or deleted | [restore-from-backup.md](restore-from-backup.md) — restore-scope-appropriate scenario (A/B/C) |
| Secret leaked | [secret-rotation.md](secret-rotation.md) — per-secret detail |
| DNS misconfigured | [rollback-procedures.md § 6](rollback-procedures.md) — Cloudflare revert |
| Tenant offboarding | [rollback-procedures.md § 5](rollback-procedures.md) — deprovision RPC + cleanup |

## Meta-conventions

1. **Traffic revert first, root-cause second.** Prod stability > investigative purity. See recent worked examples in `rollback-procedures.md § Recent worked examples`.
2. **Never delete a bad revision.** Keep it live for post-mortem via its per-commit tag URL.
3. **Every prod incident gets a file** at `docs/incidents/YYYY-MM-DD-<slug>.md`. Timeline, root cause, remediation, prevention.
4. **Every runbook use** — capture what happened (timings, deviations) in the runbook itself.
5. **Rehearsal cadence**: rollback quarterly dry-run against `Toko Jaya Makmur` (prod-testing-tenant), backup restore quarterly per `infra/backup/README.md § Re-drill cadence`.

## Related

- Incident log: `docs/incidents/`
- Backup infra: `infra/backup/README.md`
- Migration slots: memory `migration_slot_allocation`
- Prod-testing tenant policy: memory `production-testing-tenant`
