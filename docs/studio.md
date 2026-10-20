# Studio: creative operations

Stories live at the creator level. Operations live in the factory. Agents move between them.

Creator APIs (`github.com/leo-guinan/creator-apis`) holds a creator's personas, press corps setups, story templates and approved stories. This package holds the operations a factory runs to make and use them. Every operation is an ordinary factory function, so it gets runs, retries, costs, artifacts, energy readings and a receipt like any other work.

| Operation | Input | Output |
|---|---|---|
| `create-reporter` | creator id + persona draft | `agent-card@1`, born at `factory:<id>` |
| `create-press-corps` | agent cards + beats | `press-corps@1`, validated against the press lenses |
| `create-voice` | agent card + sample text (+ provider voice id) | stored audio asset; the card gains the voice and a version |
| `create-image` | prompt (+ agent card) | stored image asset; the card gains the image if given |
| `create-story` | creator `story-template@1` + sealed `press-record@1` | `story-draft@1` with provenance back to the record |

```ts
const studio = createStudio({ factoryId: "presser", voice, image, assets: new LocalAssetStore("data/assets") });
const { output: card, receipt } = await studio.createReporter({ creatorId: "leo", draft }, { operatorId: "op-leo", hosting: "operator" });
```

Voice and image providers are ports. `OpenAICompatibleVoiceProvider` (`/audio/speech`) and `OpenAICompatibleImageProvider` (`/images/generations`) are included; the fixture providers are deterministic for tests. Binary assets go to an `AssetStore` and are referenced by uri and sha256, never embedded.

## Agents move

An `agent-card@1` carries a custody trail. Each hop records the location (`creator:<id>` or `factory:<id>`), who moved it, when, and the card's content hash on arrival.

- `moveAgent(card, "creator:leo", by)` hands it back to the creator; `moveAgent(card, "factory:presser", by)` sends it to a factory.
- `importAgent(card, factoryId)` refuses a card that isn't addressed to this factory.
- `custodyChanges(card)` shows at which hops the card changed, so a voice added in a factory is visible to the creator.

## Receipts and energy

Every operation emits an `operation-receipt@1`: operation, run, status, operator, creator, `orderRef` (links work to a customer order for settlement), artifact hash, cost, energy, hosting, and a sha256 over the receipt. Creator APIs ingests these to meter compute and to settle operators.

Energy is read per step from `metadata.energy` and totalled by evidence class: `measured`, `provider_reported`, `estimated` (only with a declared method), and unknown steps. Nothing is converted silently. A step with no reading is counted as unknown, and Creator APIs pays no Qi for unknown energy.

`hosting` says who spent the energy: `platform` (Creator APIs compute, billed as metered usage), `operator` (an independent operator's hardware, reimbursed in Qi), or `provider` (a third-party API).

## Not yet

- Measured energy for local compute (RAPL/NVML readers). Today local steps are unknown unless an estimate method is declared.
- Pushing receipts to Creator APIs automatically (today: POST the receipt JSON to its `/v1/receipts` endpoint).
- Asset stores beyond the local filesystem.
