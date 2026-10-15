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

Not implemented yet: HTTP server, webhook dispatcher, authentication/signatures, delivery retry receipts, schema registry, and payload authorization. The envelope types are implemented locally so those surfaces have a stable seam.
