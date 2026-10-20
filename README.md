# Internet Factories

Internet Factories is a production runtime for composable, measurable digital factories.

A factory is clocked work under a measurable quality constraint:

`Factory = Schedule + Work + Measurement`

This repository is the v0.1 foundation. It currently contains a typed runtime contract, a durable local job ledger with file-backed recovery, a deterministic execution path, a local HTTP `/jobs` API with run/artifact inspection, webhook outbox delivery, idempotency, a reference factory manifest, a static GitHub Pages landing site, and tests. PostgreSQL, durable object storage, authentication, and production-grade authorization remain deferred.

## Quickstart

```bash
pnpm install
pnpm validate
pnpm build
```

A factory is now also a network endpoint: API/webhook input, measurable production, artifact output, and optional `artifact.accepted` webhook delivery. Downstream factories consume the stable artifact envelope rather than coupling to upstream internals.

The network envelope carries identity and economics while payloads remain in artifact storage:

```json
{"artifact_id":"art_...","factory_id":"fac_...","run_id":"run_...","type":"application/json","uri":"s3://...","sha256":"...","quality":0.93,"cost":0.18,"created_at":"...","schema":"insight-bundle@1"}
```

## Network surface

- `POST /jobs` — submit work to a factory input port
- `GET /runs/:id` — inspect a production run
- `GET /artifacts/:id` — inspect artifact metadata and parent lineage
- `GET /artifacts/:id/content` — retrieve the local artifact payload
- `artifact.accepted` webhook — announce usable output to downstream factories

This is a contract boundary, not a marketplace or automatic trust system. Schema compatibility, authentication, retries, signing, and delivery receipts remain next slices.


- `apps/api` — local HTTP API: `POST /jobs`, `GET /runs/:id`, `GET /artifacts/:id`, and webhook outbox delivery
- `packages/runtime` — factory/function/run/node/artifact contracts and deterministic execution
- `packages/manifest` — manifest contract boundary
- `packages/meter` — metric formulas and raw measurement types
- `packages/press` — press conferences for any factory: evidence lenses, graded answers, scored commitments, hash-chained records; the corps (personas, run of show) is supplied by the creator (see `docs/press.md`)
- `packages/studio` — creative operations: create a reporter, press corps, voice, image or story; portable agent cards; operation receipts with energy (see `docs/studio.md`)
- `apps/press` — `pnpm press prep|hold|audit|demo`
- `packages/scheduler` — scheduler boundary (not yet implemented)
- `packages/database` — persistence boundary (not yet implemented)
- `packages/adapters` — HTTP, LLM, code, shell, and nested-factory adapters (scaffold)
- `factories/research-factory` — reference YAML manifest
- `docs` — architecture, manifest, and metrics notes
- `tests` — executable contract tests

## Current boundary

The first slice is local and deterministic. It proves that a factory run creates node attempts, preserves failed attempts, produces an artifact, and calculates cost/latency/yield. It does not claim PostgreSQL, cron, object storage, external LLM calls, or a browser dashboard yet.
