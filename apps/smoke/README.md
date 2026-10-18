# LinkedIn draft smoke runner

This command runs one public-safe insight through the real factory API boundary and saves the run/artifact receipt. It never loads LinkedIn credentials and never invokes publication.

Run with a live OpenAI-compatible provider:

```text
OPENROUTER_API_KEY=... pnpm smoke
```

Optional environment variables:

- `OPENROUTER_MODEL` (default: `anthropic/claude-haiku-5.5`)
- `OPENROUTER_ENDPOINT` (default: `https://openrouter.ai/api/v1`)
- `SMOKE_RECEIPT_PATH` (default: `artifacts/linkedin-draft-smoke-latest.json`)
- `OPENROUTER_INPUT_COST_PER_TOKEN_USD` and `OPENROUTER_OUTPUT_COST_PER_TOKEN_USD` (defaults: the previously recorded Haiku rates, `$0.10/$1M` and `$0.50/$1M`)

The receipt records the run ID, artifact ID/hash, quality decision, model metadata, token usage, cost, latency, and the explicit `publication: disabled` boundary. Provider keys are read from the environment and are never written to the receipt.
