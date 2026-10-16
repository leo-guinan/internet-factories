# Factory network contract

A factory exposes explicit ports:

```text
API/webhook in -> trigger + function graph + meter -> artifact out
```

The v0.1 network contract is deliberately reference-based. A downstream factory receives an artifact envelope, not an upstream payload copy:

```json
{
  "artifact_id": "art_...",
  "factory_id": "fac_...",
  "run_id": "run_...",
  "type": "application/json",
  "uri": "s3://internet-factories/...",
  "sha256": "...",
  "quality": 0.93,
  "cost": 0.18,
  "created_at": "2026-10-15T12:00:00Z",
  "schema": "insight-bundle@1"
}
```

The envelope also carries reconciled economics:

```json
"economics": {
  "local_cost": 0.07,
  "upstream_cost": 0.11,
  "total_cost": 0.18
}
```

Artifact IDs, run IDs, node-run IDs, and outbox IDs are UUID-backed. Artifact payloads are SHA-256 hashed before publication. Parent references preserve the production DAG across network boundaries.

A producer does not name or depend on consumers. Consumers subscribe to `artifact.accepted` and submit the envelope to their own `POST /jobs` input port.

Initial API contract:

- `POST /jobs` creates a run from an input envelope or payload reference.
- `GET /runs/:id` returns production status and trace.
- `GET /artifacts/:id/content` returns the artifact payload through the local content boundary.
- `artifact.accepted` announces only outputs that passed the factory quality gate.

Implemented locally: HTTP server, `POST /jobs` acceptance into a persisted queued job, recovery of queued/running jobs on restart, `GET /runs/:id`, `GET /artifacts/:id`, `GET /artifacts/:id/content`, file-backed run/artifact/content/outbox/idempotency persistence via `storagePath`, webhook outbox delivery, and idempotency-key deduplication.

Completed node receipts now retain input/output hashes and the output value for local recovery. Each receipt still exposes `executionId` and a stable per-job/node/attempt `idempotencyKey` through `ExecutionContext`, and the HTTP adapter forwards that key as `Idempotency-Key`. When the same node input hash and function graph are encountered on restart, the runtime reuses the recorded result instead of executing the node again; reused work is marked on the receipt and its prior cost remains visible.

Not implemented yet: durable database storage, authentication/signatures, delivery retry receipts beyond the in-memory outbox status, schema registry, and payload authorization.
