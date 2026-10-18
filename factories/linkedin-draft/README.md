# LinkedIn Draft Factory

Status: local MVP. Produces draft artifacts; it does not publish to LinkedIn.

Input contract: `insight@1`

```json
{
  "insightId": "insight_1",
  "campaignId": "campaign_1",
  "sourceText": "...",
  "audience": "independent builders",
  "coreClaim": "...",
  "supportingEvidence": ["..."],
  "targetAction": "Read the notes",
  "destinationUrl": "https://example.com/notes"
}
```

Output contract: `linkedin-draft@1`. The runtime preserves the model metadata, token usage, measured latency, cost, hash, and input lineage in the run/artifact receipt.

The OpenAI-compatible adapter is injected through `OpenAICompatibleDraftGenerator`. Tests use a deterministic transport; a real provider call requires an explicitly configured endpoint and secret outside the repository.

Run the local verification suite from the repository root:

```sh
pnpm validate
```
