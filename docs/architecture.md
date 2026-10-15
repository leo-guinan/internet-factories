# Architecture

The v0.1 boundary is intentionally small:

Cron/manual trigger -> run record -> runtime -> function adapters -> node runs -> artifacts/evaluations -> metrics.

The runtime owns scheduling concerns, retries, provenance, and accounting. Functions only receive input plus an immutable execution context and return output/usage/cost. Meters observe executions without changing semantic output.

The first implementation is local and deterministic. PostgreSQL, object storage, queue workers, and HTTP/API surfaces are boundaries to add after the local contract is stable.
