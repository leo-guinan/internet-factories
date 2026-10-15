# Metrics

Raw counts remain primary: attempted runs, completed runs, accepted artifacts, rejected runs, total cost, and total latency.

Derived metrics:

- yield = accepted artifacts / attempted runs
- cost per accepted artifact = total cost / accepted artifacts
- throughput = accepted artifacts / interval

No universal factory score is hard-coded in v0.1. Quality, cost, latency, retry, and failure values remain independently inspectable.
