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
  "quality": 0.93,
  "cost": 0.18,
  "created_at": "2026-10-15T12:00:00Z",
  "schema": "insight-bundle@1"
}
```

A producer does not name or depend on consumers. Consumers subscribe to `artifact.accepted` and submit the envelope to their own `POST /jobs` input port.

Initial API contract:

- `POST /jobs` creates a run from an input envelope or payload reference.
- `GET /runs/:id` returns production status and trace.
- `GET /artifacts/:id` returns artifact metadata and provenance.
- `artifact.accepted` announces only outputs that passed the factory quality gate.

Implemented locally: HTTP server, `POST /jobs`, `GET /runs/:id`, `GET /artifacts/:id`, in-memory run/artifact persistence, webhook outbox delivery, and idempotency-key deduplication.

Not implemented yet: durable database storage, authentication/signatures, delivery retry receipts beyond the in-memory outbox status, schema registry, and payload authorization.
