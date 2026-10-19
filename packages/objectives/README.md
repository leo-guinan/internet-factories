# Outcome Controller v0.1

This package is a shadow-mode, objective-driven control boundary. It accepts observations, maintains an idempotent durable ledger, stores immutable versioned plan revisions, and produces explainable `hold`, `release`, `replan`, or `observe` decisions.

It does not execute actions, publish to LinkedIn, forecast outcomes, or make provider calls.

Observation semantics:

- `cumulative_snapshot`: latest snapshot is authoritative; snapshots are never summed.
- `window_total`: totals may be accumulated for the current evidence set.
- `increment`: increments are accumulated after the latest cumulative snapshot.

The controller treats missing, stale, or low-confidence evidence conservatively and returns `observe`. Decisions include the objective, plan version, evidence IDs, reason, and optional candidate ID.
