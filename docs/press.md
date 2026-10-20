# Press conferences

Every factory can hold the same press conference. A configurable press corps asks questions built from the factory's own ledgers, the factory manager answers, and every answer is graded on whether it cites evidence that resolves. The result is a sealed, hash-chained record. Next week's press conference starts by scoring what the manager committed to in this one.

The flow is adapted from the Monday Morning Presser kit: same run of show, same rule that the scoreboard is accountable to reality, now applied to factories instead of one show.

```
dossier (runs, artifacts, objectives, observations, decisions, plans, external evidence, last record)
  → prepare: beats × reporters × lenses → questions with evidence probes   (deterministic ids)
  → hold: manager answers → grade → follow-ups → commitments
  → seal: record hash, previous record hash, hash of every cited item
  → next week: open commitments scored against observations; skeptic carries over undocumented answers
  → audit any time: re-hash the cited evidence against the current ledgers
```

## Beats

Beats are the run of show (`packages/press/press-corps.json`). Each one has a `kind`:

| Beat | Kind | Default reporters | What happens |
|---|---|---|---|
| Opening statement | `statement` | none | Manager's statement, graded like any answer |
| The scoreboard | `questions` | Ari | Last record's commitments, objective progress, yield |
| The tough questions | `questions` | Darius, June, Graham | Unit cost, reach, self-grading, carried-over gaps |
| Film-room breakdown | `questions` | Mara, Nia | Failures, rejections, controller decisions, reproducibility |
| Next week's game plan | `commitments` | none | Manager commits; only measurable commitments are accountable |
| Final question | `final` | Graham | "Which claim would you least want audited next week?" |

## Reporters

A reporter is a persona (config) on top of a lens (code). Recast by editing JSON. Lenses are fixed:

| Lens | Default | Looks at |
|---|---|---|
| `scoreboard` | Ari Chen | Prior commitments, objective progress vs target, yield |
| `film` | Mara Quinn | Worst failed node, rejected runs, non-trivial controller decisions |
| `business` | Darius Cole | Cost per accepted artifact, spend with no output, retries |
| `people` | June Park | Whether accepted artifacts reached anyone, approvals, outside signal |
| `reproducibility` | Nia Brooks | Same input with different outputs, sample size, reused results |
| `skeptic` | Graham Pike | Self-graded quality, unmeasured commitments, last record's undocumented or contradicted answers |

Lens assignments for the Character Bible v1 cast are read from the bible's dialogue. `rights.mayChallenge` lets a reporter follow up on their own question; `rights.challengesOthers` (Graham) lets them follow up on anyone's. A follow-up chain stops when the answer becomes documented, is declined, repeats itself, or the reporter runs out of follow-ups.

A `phrase` hook can reword questions in a reporter's voice (an LLM, say). It changes wording only: question ids and evidence probes stay fixed, so the record stays checkable.

## Grading

Each answer is a list of claims, each citing `EvidenceRef`s (`run`, `node_run`, `artifact`, `objective`, `observation`, `decision`, `plan@version`, `external`, or last record's `exchange` / `commitment`).

- **documented**: every claim cites evidence that resolves in the dossier, and any number a claim states is carried by that evidence
- **partial**: some claims resolve, some don't
- **undocumented**: nothing resolves (including "trust me")
- **contradicted**: a claim states a number (`metric`) and the cited evidence carries a different one
- **declined**: no answer

Documented means checkable, not persuasive. The built-in `ledgerManager` answers by reading back exactly what each question probed, so it documents well and says plainly when nothing is on record. It is a baseline every factory gets for free, not a good spokesperson.

## Commitments and the scoreboard

A commitment is accountable only with a metric, a numeric target, and a due date after the press conference. Next time, each open commitment is scored from observations recorded between the commitment and its due date, at confidence ≥ 0.8, account-level:

- no observation → **unknown** (never a win)
- target met → **achieved**; above zero → **partial**; zero → **missed** (`direction: "down"` for ceilings)
- not yet due → **pending**, carried forward

## Holding it to account later

- The record's `hash` covers everything in it; `previousRecordHash` links it to the last record for that factory.
- `PressLedger.append` refuses a record that doesn't follow the latest one (no forks, no rewriting history) and `verifyChain` reports any record edited after sealing.
- `record.evidence` stores the hash of every item cited or probed at the moment of the press conference. `auditRecord(record, dossier)` reports anything that has since **changed** or gone **missing**.

## CLI

```bash
pnpm press demo                                     # two weeks, two factories, chained records → data/press/demo/
pnpm press prep --dossier dossier.json              # questions + an answers template keyed by question id
pnpm press hold --dossier dossier.json --answers answers.json [--auto]   # --auto: ledger answers anything unscripted
pnpm press hold --dossier dossier.json              # ledger manager answers everything
pnpm press audit --factory linkedin-draft [--dossier dossier.json]
```

`hold` pulls the previous record from the ledger (`data/press/ledger.json` by default) when the dossier doesn't carry one, so last week's commitments always come back. Commit the ledger: git history is an outside timestamp on it.

## Not yet

- Building a dossier straight from the API's run store and the objectives ledgers (today it's a JSON file you assemble)
- Feeding a prepared plan to the OBS presser kit's overlay and director dock
- An LLM `phrase` implementation and an LLM-backed manager
- Live answers transcribed into claims
