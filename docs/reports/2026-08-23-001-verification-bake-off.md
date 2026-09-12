# 001 — the LLM verification bake-off, run

**Plan:** [`docs/plans/2026-08-20-001-fix-ingredient-resolution-quality-plan.md`](../plans/2026-08-20-001-fix-ingredient-resolution-quality-plan.md) (U11 / KTD-4, KTD-5)
**ADR:** [`0024-llm-spend-ceiling-reserve-then-settle.md`](../architecture/decisions/0024-llm-spend-ceiling-reserve-then-settle.md) (§4a, the roster)
**Run:** 2026-08-23, `us-east-1`, against live Amazon Bedrock. Measured spend **$0.1502** across three runs (695 + 74,754 + 74,657 micro-dollars).

---

## ⛔⛔ READ THIS FIRST — what this corpus is, and what it is not

U11 sized the bake-off against **a hand-annotated slice of 2,432 lines from public-domain cookbooks**. That
corpus does not exist and was not used. **ADR-0023 forbids anything in this repository from fetching that
material**, and no operator has supplied the file out of band. The owner ruled on 2026-08-23: substitute a
corpus we can generate, and label the results non-comparable.

**What was measured instead: synthetic cook phrasing over REAL catalog rows, with ground truth known BY
CONSTRUCTION.**

|                            |                                                                                                                                                                                             |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **What the corpus is**     | 2,136 `(line, candidate)` pairs derived from the 8,094-row seeded USDA catalog. Each pair is BUILT, so whether it matches is a fact about how it was built.                                 |
| **What it is NOT**         | ⛔ **Not comparable to U1's annotation protocol.** Different lines, different provenance, different labelling method. Do not place these numbers beside U1's.                               |
| **What it DOES prove**     | **Discrimination**: whether a model can separate a correct candidate from a plausibly-wrong one drawn from the same catalog. That IS the decision the gate makes.                           |
| **What it does NOT prove** | **Field accuracy.** The mix of contrasts is CHOSEN, not observed, so every rate here is conditional on a distribution we invented. Nothing here says "the cascade is X% right in the wild". |
| **Who labelled it**        | Nobody. That is the point — U1's own adjudicated accuracy was WITHHELD because one annotator is not a measurement. Construction sidesteps the annotator entirely.                           |
| **Reproducibility**        | Byte-identical from `seed = 20260823` + catalog digest `415472d0…64bf57`. Asserted by an integration test that runs the CLI twice.                                                          |

---

## 1. ⛔ THE BAKE-OFF DID NOT HAPPEN — only one of the two models was reachable

**Claude Haiku 4.5 could not be called from this AWS account, so there is no comparison in this report.**

```
$ aws bedrock-runtime converse --model-id us.anthropic.claude-haiku-4-5-20251001-v1:0 --region us-east-1
ResourceNotFoundException: Model use case details have not been submitted for this account.
Fill out the Anthropic use case details form before using the model.

$ aws bedrock get-use-case-for-model-access --region us-east-1
ResourceNotFoundException: You have not filled out the request form.
```

What was established, and what was not:

| Fact                                | Evidence                                                                                                                                                         |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The model is ACTIVE and exists      | `get-foundation-model` → `status: ACTIVE`, `inferenceTypesSupported: ["INFERENCE_PROFILE"]`                                                                      |
| It is **not** a credentials problem | `anthropic.claude-sonnet-4-5` answers a real `converse` on the same credentials                                                                                  |
| It is **not** a region problem      | Same error in `us-east-1` and `us-west-2`; 15 consecutive failures across both                                                                                   |
| The gate is **flaky, not absolute** | ⚠️ Exactly ONE call succeeded (`us-west-2`, latency 643 ms) out of ~60 attempts, then never again. A subsequent 40-call SDK run in the same region failed 40/40. |
| The remedy                          | Submit the Anthropic use-case form: Bedrock console → **Model access** → Anthropic → _Submit use case details_, or `aws bedrock put-use-case-for-model-access`   |

⚠️ **That single transient success is probably why this run was briefed as "both models answered a real
converse call."** It is not a reliable signal — it did not reproduce.

**I did not submit the form.** Its payload is a company-identity and intended-use attestation on the owner's
AWS account; filling it in with details I would have to invent is a misrepresentation, not a build step. It
needs about two minutes of a human's time, after which `--models anthropic.claude-haiku-4-5-20251001-v1:0`
re-runs the missing half for roughly **$2.20** (projected — see §6).

⛔ **Everything below therefore SELECTS NOTHING.** Nova Micro is characterised, not chosen.

⚠️ **SUPERSEDED IN PART — see §9.** A three-way Nova ladder (Micro vs Lite vs Pro) ran later the same day on the same corpus and DOES select: Nova Micro ships. The Anthropic half of the roster remains unmeasured for the reason given in this section.

---

## 2. A defect the run found in its own corpus, and why both sets of numbers are printed

The corpus was generated, run, and then the false disagreements were **read**, line by line. Two thirds of
them were not model errors — they were phrasing defects that made the `correct` label FALSE:

| Defect                                                                                                                                                                                | Example                                                                                                      | Effect                                                                        |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| **The head noun could be deleted.** First-wins de-duplication plus a "drop the head when a descriptor names it" rule matched `Rice mix`'s last word against the descriptor `dry mix`. | `Rice mix, cheese flavor, dry mix, unprepared` → **"6 dry mix cheese flavor"** — the line never says _rice_. | The candidate genuinely does not match the line. Label was wrong.             |
| **Descriptors were truncated to the two most identifying.**                                                                                                                           | `Peppers, sweet, green, sauteed` → **"200 grams green sweet peppers"** — the line omits _sauteed_.           | A model contradicting it was RIGHT; the corpus scored it as a false disagree. |

Both were fixed (generator **v1.1.0**: last-wins de-duplication, no head-drop rule, every descriptor carried),
the corpus was regenerated on the same seed, and the run was repeated.

|                                           | v1.0.0 (defective corpus) | **v1.1.0 (corrected)** |
| ----------------------------------------- | ------------------------- | ---------------------- |
| `falseDisagreeRate`                       | 7.06 %                    | **2.32 %**             |
| Correct lines contradicted in BOTH orders | 28 / 608 (4.61 %)         | **8 / 608 (1.32 %)**   |
| `falseAgreeRate` (full)                   | 27.71 %                   | 29.29 %                |
| `inconclusiveRate` (full)                 | 4.92 %                    | 4.63 %                 |

⚠️ **Both are printed deliberately.** Reporting only the post-fix figure, having seen the pre-fix figure,
would be selective reporting. The fixes were made because they made the LABEL true, not because they made the
model look better — but the reader should not have to take that on trust, so the size of the correction is on
the page. The corrected number is the one that stands; the pre-fix number is what a corpus nobody read the
output of would have reported.

⛔ **This is the strongest argument in this document for reading the actual lines of any generated corpus
before believing any rate computed from it.**

---

## 3. The corpus (generator v1.1.0)

```
npx tsx src/scripts/generateBakeOffCorpus.ts \
  --catalog-url postgresql://…/food_load --seed 20260823 --size 2432 --out corpus.jsonl
```

| Manifest field       | Value                                                                   |
| -------------------- | ----------------------------------------------------------------------- |
| `catalogRowCount`    | 8,094 (U12's reseed; `docs/reports/2026-08-22-…-measurement.md` §1)     |
| `invertibleRowCount` | **2,153** — the rows that can be phrased as a cook line at all (26.6 %) |
| `catalogDigest`      | `415472d0f6f402c63314cb6d07fc3889a5ee0c95d2192e01d2f19c325764bf57`      |
| `seed`               | 20260823                                                                |
| Lines emitted        | **2,136** against a target of 2,432                                     |

### Class balance (achieved / requested 608 each)

| Class               | Lines   | `parseIsCorrect` | What it is                                                                                              |
| ------------------- | ------- | ---------------- | ------------------------------------------------------------------------------------------------------- |
| `correct`           | **608** | `true`           | The candidate IS the row the phrasing came from.                                                        |
| `nearMissIdentity`  | **608** | `false`          | A sibling row sharing the head term (`Lentils, dry` against _"100 grams raw pink or red lentils"_).     |
| `wrongFormIdentity` | **312** | `false`          | Same substance, nutrition-changing state (`Wild rice, raw` against _"3 tablespoons cooked wild rice"_). |
| `quantityUnitError` | **608** | `false`          | Right food, corrupted amount or unit (_"1 pound … fish sauce"_ parsed as `1 gram`).                     |

⚠️ **`wrongFormIdentity` fell 296 lines short, and was not padded.** Only 312 of the 2,153 invertible rows
have a catalog sibling that differs _only_ on a form segment. Re-using a pair with a different quantity would
have inflated the denominator without adding information. The scarce class is allocated FIRST for the same
reason — every class draws from one pool, and taking the plentiful ones first starves it.

⚠️ **The full corpus is therefore 28.5 % correct / 71.5 % incorrect.** That is a chosen mix. `falseAgreeRate`
over the full corpus has ~2.4× the denominator of `falseDisagreeRate`, and neither is a field rate.

### The residual slice, defined

**Residual = the `nearMissIdentity` lines plus their matching `correct` lines** — 1,216 lines, 2,432 trials,
exactly 50/50 by ground truth. They are emitted as **pairs**: the same source row, the same phrasing, the same
quantity, and only the candidate differs. That isolation is the point — the earlier cascade tiers terminate on
the easy cases, so the gate sees a systematically harder, identity-shaped distribution, and a threshold
calibrated on the full corpus would be calibrated on lines the gate never sees.

The residual is a SUBSET of the same trials, so both slices come from one run at no extra spend.

---

## 4. Results — Amazon Nova Micro (`amazon.nova-micro-v1:0`)

```
AWS_REGION=us-east-1 npx tsx src/scripts/verificationBakeOff.ts \
  --corpus corpus.jsonl --concurrency 8 --models amazon.nova-micro-v1:0 --trials-out trials.jsonl
```

### ⚠️ Read `inconclusiveRate` first

**4.63 % full / 5.88 % residual.** Nova was evaluated on **95 % of the corpus**; the two error rates below
describe nearly all of it, not a flattering fraction. For contrast, a model abstaining on half the corpus
would have had half its behaviour unmeasured whatever its other rates said.

### The numbers

| Metric                            | **Full corpus**           | **Residual slice**        |
| --------------------------------- | ------------------------- | ------------------------- |
| Lines / trials                    | 2,136 / **4,272**         | 1,216 / **2,432**         |
| ⛔ **`falseDisagreeRate`**        | **2.32 %** (28/1,206)     | **2.32 %** (28/1,206)     |
| `falseAgreeRate`                  | 29.29 % (840/2,868)       | 13.94 % (151/1,083)       |
| `inconclusiveRate`                | 4.63 % (198/4,272)        | 5.88 % (143/2,432)        |
| `swapPairs` / `swapDisagreements` | 2,136 / **353 (16.53 %)** | 1,216 / **147 (12.09 %)** |
| Measured cost                     | **$0.0747**               | $0.0424 (of the same run) |
| Mean cost per call                | **17.48 µ$**              | 17.42 µ$                  |

⛔ `falseDisagreeRate` is identical on both slices because every `correct` line in this corpus is, by
construction, also a residual line — the residual class is _defined_ as the near misses plus their twins.

**95 % Wilson CI on the false-disagree rate: 1.4 % – 3.9 %**, computed at **n = 608 lines**, not n = 1,206
trials. The two swap variants of a line are not independent observations, and using the trial count would
quote a confidence the data does not support.

### Stop-reason census (KTD-4's open risk, measured)

| `stopReason`           | Count      | Reading                                                                                                                                                                |
| ---------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `end_turn`             | **4,270**  | The only reason from which a verdict may be believed.                                                                                                                  |
| `BedrockClientError`   | 2 (0.05 %) | Transient, unclassified. Scored `inconclusive`, which publishes.                                                                                                       |
| `max_tokens`           | **0**      | `VERIFICATION_MAX_OUTPUT_TOKENS = 200` is comfortable; the model does not run away.                                                                                    |
| `ThrottlingException`  | **0**      | ⚠️ At `--concurrency 8`. The run is NOT degraded by throttling, so the rates stand.                                                                                    |
| Malformed / unreadable | **0**      | ⛔ Every one of the 4,270 responses that ARRIVED parsed into a well-formed verdict. Structured-output failure — KTD-4's named open risk — did not occur once for Nova. |

### Behaviour per constructed contrast (full corpus, trials)

| Class               | `verified`  | `contradicted` | `inconclusive` | Reading                                                                       |
| ------------------- | ----------- | -------------- | -------------- | ----------------------------------------------------------------------------- |
| `correct`           | **96.88 %** | 2.30 %         | 0.82 %         | Nova passes correct parses almost always. This is the safe direction working. |
| `nearMissIdentity`  | 12.42 %     | **76.64 %**    | 10.94 %        | Catches three quarters of plausible wrong foods.                              |
| `wrongFormIdentity` | 26.60 %     | **69.23 %**    | 4.17 %         | Catches raw-vs-cooked reasonably; one in four slips through.                  |
| `quantityUnitError` | 43.01 %     | **54.61 %**    | 2.38 %         | ⚠️ **The weakest column.** Nearly half of corrupted amounts are passed.       |

⚠️ **Nova is a decent identity checker and a poor arithmetic checker.** A `cup` parsed as a `gram`, or `2`
parsed as `8`, gets through 43 % of the time. That is the tolerable error direction, but it bounds what the
gate can be claimed to do.

### Position bias, measured rather than asserted

**353 of 2,136 lines (16.53 %) flipped band when the two aspects were presented in the other order** — at the
just ABOVE U11's predicted 10–15 % band, so the plan under-estimated position bias rather than over-estimated it. It is not uniform:

| Class               | Lines | Flipped | Rate        |
| ------------------- | ----- | ------- | ----------- |
| `quantityUnitError` | 608   | 143     | **23.52 %** |
| `nearMissIdentity`  | 608   | 109     | 17.93 %     |
| `wrongFormIdentity` | 312   | 34      | 10.90 %     |
| `correct`           | 608   | 31      | **5.10 %**  |

Nova is most order-sensitive exactly where it is weakest (quantity) and least order-sensitive where the answer
is easy (a correct candidate). Directionally, asking `identity` first yields more false disagreements
(2.64 % vs 2.00 %) and far more false agreements (34.12 % vs 24.40 %).

⛔ **The shipped gate does not swap.** It asks one ordering, so it inherits roughly this much presentation
variance on any single line. Swap augmentation is a MEASUREMENT technique here, not a shipped mitigation, and
nothing in this run makes it one.

---

## 5. Proposed confidence-band thresholds — **PROPOSED, NOT COMMITTED**

⛔ No threshold change is included in this branch. `packages/shared/recipe-core/src/resolution/confidence.ts`
is untouched. This section is a recommendation for the owner to take or reject.

### The evidence: verdict × certainty, on the residual slice

| Cell                  | Parse correct | Parse wrong | Total     | P(parse correct \| cell) |
| --------------------- | ------------- | ----------- | --------- | ------------------------ |
| `agree` / `high`      | 1,178         | 151         | **1,329** | 88.64 %                  |
| `disagree` / `high`   | 26            | 915         | **941**   | **2.76 %**               |
| `disagree` / `medium` | 2             | 17          | 19        | 10.53 %                  |
| `abstain` / `low`     | 10            | 77          | 87        | 11.49 %                  |
| `abstain` / `medium`  | 0             | 51          | 51        | 0.00 %                   |
| `abstain` / `high`    | 0             | 4           | 4         | 0.00 %                   |
| transport failure     | 0             | 1           | 1         | —                        |

Three findings fall straight out of that table, and together they say something the brief did not anticipate.

1. ⛔ **Nova NEVER emits `agree`/`low` or `disagree`/`low`.** Zero observations in 2,432 trials. The
   `certainty === 'low'` early return in `bandFor` — the hedge-honouring branch, described in its own docstring
   as the thing that stops a manufactured wrong-DISAGREE — **is dead code against this model.** It is not
   wrong, and it must NOT be deleted (it is the guard for a model that does hedge, and Haiku is unmeasured),
   but nobody should believe it is doing work today.
2. **`disagree`/`high` is a strong signal**: 97.2 % of contradictions at that rung are real errors.
3. ⛔ **And that is exactly the problem. 26 of the 28 false disagreements sit in `disagree`/`high`.** There is
   no rung above `high`, so **no certainty threshold can reach them.** The only cell a threshold CAN move is
   `disagree`/`medium` — 19 trials, 0.78 % of the slice.

### What each candidate certainty mapping would have done, on the residual

| Mapping                                                                      | `falseDisagreeRate` | `falseAgreeRate` | `inconclusiveRate` | Wrong-parse trials contradicted |
| ---------------------------------------------------------------------------- | ------------------- | ---------------- | ------------------ | ------------------------------- |
| **A — shipped today** (`low` hedges; else the verdict decides)               | 2.32 %              | 13.94 %          | 5.88 %             | 932 / 1,216                     |
| **B — a contradiction requires `high`** (`disagree`/`medium` → inconclusive) | 2.16 %              | 14.17 %          | 6.66 %             | 915 / 1,216                     |
| C — no hedge honoured at all                                                 | 2.32 %              | 13.94 %          | 5.88 %             | 932 / 1,216                     |
| D — every verdict requires `high`                                            | 2.16 %              | 14.17 %          | 6.66 %             | 915 / 1,216                     |

A and C are byte-identical, which is finding 1 restated as a measurement. B and D are identical for the same
reason.

### ⛔ Recommendation 1 — CHANGE NOTHING in `confidence.ts`

**Keep mapping A as it ships.** B is the only alternative the data can even express, and its trade is
**2 avoided wrong withholdings against 17 real errors that would then publish** — 8.5 uncaught errors per
false disagree avoided, on a cell of 19 trials, for a 0.16-point move whose confidence interval is swamped by
the headline CI of ±1.3 points. That is not a calibration; it is noise with a direction.

⚠️ The brief asked for proposed thresholds. The honest answer the measurement gives is that **the
false-disagree rate on this model is not threshold-addressable**, because 93 % of it is at the top rung.
Committing a threshold change here would be motion, not improvement.

### ⚠️ Recommendation 2 — the lever that IS measured to work: require BOTH orderings to contradict

Swap augmentation was built as a measurement technique. The trial data shows it is also the only mitigation in
reach. Judging each line **twice** and withholding only when both orderings contradict (line-level, residual
slice, 1,216 lines):

| Decision rule                     | `falseDisagreeRate` | `falseAgreeRate` | `inconclusiveRate` | Errors caught |
| --------------------------------- | ------------------- | ---------------- | ------------------ | ------------- |
| Single ordering, `identity` first | 2.64 % (16/605)     | 14.42 %          | 5.76 %             | 463 / 608     |
| Single ordering, `quantity` first | 2.00 % (12/601)     | 13.47 %          | 6.00 %             | 469 / 608     |
| **BOTH must contradict**          | **1.36 % (8/589)**  | 11.76 %          | 13.82 %            | 405 / 608     |
| EITHER contradicts                | 3.29 % (20/607)     | 10.37 %          | 1.73 %             | 527 / 608     |

**Both-must-contradict roughly HALVES the false-disagree rate** (2.00–2.64 % → 1.36 %) and lowers the
false-agree rate as well, at the cost of 8 points of `inconclusiveRate` — and `inconclusive` publishes, so
that cost is bounded to "the gate behaves as though it had not run". It catches ~60 fewer errors of 608.

Its real price is **2× the calls**: ≈ $0.28/month against ADR-0024's $100 ceiling — still ~350× headroom — and
2× the latency and the reserved spend per line. ⛔ It is a change to `verifyLine`'s shape and to ADR-0024's
per-line reservation arithmetic, not a threshold, so it belongs in a design decision rather than in this
report. Recording it here because the data to justify it exists exactly once and cost real money to get.

⛔ **Do NOT calibrate on the full corpus.** `falseAgreeRate` there is 29.29 % against the residual's 13.94 %,
purely because the full corpus carries two extra error classes at a mix we chose. Any threshold tuned to that
number is tuned to an invented distribution.

⛔ **Do NOT delete the `certainty === 'low'` branch** on the strength of finding 1. It is unexercised by Nova,
not proven unnecessary — and the model it might matter for is the one that could not be run.

---

## 6. Spend

| Run                                                   | Calls | Measured           |
| ----------------------------------------------------- | ----- | ------------------ |
| Smoke (Nova, 20 lines)                                | 40    | $0.0007            |
| Full corpus v1.0.0 (Nova)                             | 4,272 | $0.0748            |
| Full corpus v1.1.0 (Nova) — **the run that stands**   | 4,272 | **$0.0747**        |
| Haiku smoke (failed, 40× `ResourceNotFoundException`) | 40    | $0.0000 (unbilled) |
| **Total**                                             |       | **$0.1502**        |

Authorised: ~$0.09 (Nova) + ~$2.70 (Haiku). **Under budget, because the Haiku half did not run.**

**Mean cost per call: 17.48 µ$.** Projected against ADR-0024 §3's ~8,000 calls/month, the gate on Nova costs
**≈ $0.14/month** — roughly half the ADR's $0.27 estimate, because the assembled prompt is smaller than the
~660-token figure that estimate assumed. The $100 monthly ceiling is ~700× that.

**Projected Haiku cost for the same run: ≈ $2.20** (rate table ratio ≈ 29× Nova). ⚠️ Computed from ADR-0024's
`priceVerified: false` entry for Claude Haiku 4.5 — its Bedrock price still has not been read from a primary
source, so this figure carries that caveat and so would any Haiku cost column.

---

## 7. Residual risk — what these numbers do not establish

1. ⛔ **There is no winner, because there was no contest.** One model ran. Nova Micro is what ADR-0024 already
   ships; this run characterises it, it does not select it.
2. ⛔ **Not comparable to U1.** Different corpus, different provenance, different labelling. Never quote these
   beside U1's retrieval figures.
3. ⚠️ **The remaining false disagreements are dominated by an unfixed corpus artefact: implausible
   quantity-for-food pairings.** Of the 8 correct lines Nova contradicted in both orders, six are shapes like
   _"3 raw spinach"_, _"1/2 teaspoon pork beer salami beerwurst"_, _"1 nutmeg butter oil"_. The parse genuinely
   matches the line, so the label is correct by construction — but the model appears to be answering "is this a
   sensible amount of this food?", which is not the question asked. That is **both** a real model behaviour
   worth knowing and a corpus limitation, and it means **the true false-disagree rate on realistic lines is
   likely BELOW 2.32 %**. The bias runs in the safe direction.
4. ⚠️ **The phrasing is stilted in places** — _"2 cups and olive peanut corn oil"_, _"cooked tilapia fish"_.
   A harder-to-read line inflates disagreement, so again the bias is conservative on the number that decides.
5. ⚠️ **Only 26.6 % of the catalog is invertible.** Branded rows, category heads and parentheticals are
   excluded. The corpus is drawn from plain generic USDA descriptions, which is a subset of what the cascade
   really resolves against.
6. ⚠️ **`wrongFormIdentity` has 312 lines, not 608**, so its column carries half the sample of the others.
7. ⚠️ **`swapDisagreements` measures presentation variance; it does not correct for it.** The shipped gate asks
   one ordering.
8. ⚠️ **Ground truth by construction is not the same as ground truth.** Some near-miss siblings are arguably
   closer to the line than the construction assumes (`Beef, chuck …` against `Beef, round …`), which inflates
   `falseAgreeRate` for pairs a human might also pass. The direction is unfavourable to the model, not to us.
9. ⛔ **A latent defect in the SHIPPED gate, found while writing the runner.** Claude Haiku 4.5 supports
   `INFERENCE_PROFILE` only — the bare model id fails with `ValidationException: Invocation of model ID … with
on-demand throughput isn't supported`. `verifyLine` resolves ONE model id from SSM and passes it to both
   `rateFor` (which keys on the bare id, per ADR-0024's rate table) and `converse` (which needs the
   `us.`-prefixed profile). **Pointing the SSM parameter at Haiku today would fail every call.** The bake-off
   runner keeps the two apart in a local `INVOCATION_IDS` map; the shipped path does not, and closing that is
   ADR territory rather than a change to make from a script.

---

## 8. Reproducing this

```bash
export PATH="$HOME/.nvm/versions/node/v24.4.1/bin:$PATH"
cd packages/services/recipe-workers

# 1. the corpus (deterministic; do NOT commit the output)
npx tsx src/scripts/generateBakeOffCorpus.ts \
  --catalog-url postgresql://…/food_load --seed 20260823 --size 2432 --out /tmp/corpus.jsonl

# 2. the run (both slices, one pass; ~4 minutes at --concurrency 8)
AWS_REGION=us-east-1 npx tsx src/scripts/verificationBakeOff.ts \
  --corpus /tmp/corpus.jsonl --concurrency 8 --trials-out /tmp/trials.jsonl

# 3. the missing half, once the Anthropic use-case form is submitted
AWS_REGION=us-east-1 npx tsx src/scripts/verificationBakeOff.ts \
  --corpus /tmp/corpus.jsonl --concurrency 8 --trials-out /tmp/haiku-trials.jsonl \
  --models anthropic.claude-haiku-4-5-20251001-v1:0
```

`--trials-out` writes one JSON object per call carrying the raw `verdict` and `certainty`, which is what makes
§5's contingency table derivable **without re-spending the run**. The threshold tables are a pivot of that
file over `verdict × certainty × parseIsCorrect`, restricted to `contrastClass ∈ {correct, nearMissIdentity}`.

---

## 9. Update (2026-08-23) — the Nova ladder, and the decision it settles

§1 records that the planned roster could not run: Claude Haiku 4.5 is unreachable on this account without an
Anthropic use-case attestation. Rather than pay that attestation blind, a **Nova ladder** ran instead —
Micro vs Lite vs Pro, all reachable today — on the identical corpus (digest `415472d0…64bf57`, 2,136 lines,
generator v1.1.0), the same harness, the same prompt, `us-east-1`. Nova Micro was re-run as a control so all
three columns come from one session.

**Owner ruling: the bake-off is DONE.** Its result informs which model ships and nothing else. It is not a
standing capability, and no future decision should turn on the harness.

### The decision

**Nova Micro ships.** Neither alternative wins on the number that decides, and this is a null result — which
is the useful kind, because it produces **no case for paying the Anthropic attestation**.

### Read `inconclusiveRate` first, and note it means opposite things per model

|                           | Micro | Lite        | Pro   |
| ------------------------- | ----- | ----------- | ----- |
| `inconclusiveRate`        | 4.35% | **13.20%**  | 0.05% |
| — of which malformed JSON | **0** | **281/286** | 0     |
| — of which true abstain   | 140   | 2           | 0     |

⛔ Lite's figure is **not abstention — it is broken JSON**: a correct verdict object with a stray `]`, or a
`"`-opened `reason` closed with `'`. Two syntactic defects, reproduced 7/40 on a re-probe. This is KTD-4's
named structured-output risk actually occurring, and because `inconclusive` publishes, ~13% of lines would
silently bypass the gate on Lite.

### Three-way results

| Metric                     | Micro           | Lite            | Pro              |
| -------------------------- | --------------- | --------------- | ---------------- |
| `falseDisagreeRate` (full) | 2.98%           | **1.50%**       | **39.31%**       |
| `falseAgreeRate` (full)    | 28.48%          | 28.57%          | 1.44%            |
| `swapDisagreements`        | 15.12%          | 27.01%          | 5.71%            |
| Both-order false disagree  | 6/608           | 4/608           | **190/608**      |
| 95% Wilson CI (n=608)      | 1.88–4.63%      | 0.78–2.79%      | 35.51–43.25%     |
| Cost / mean µ$ per call    | $0.0747 / 17.47 | $0.1102 / 25.80 | $1.7000 / 397.94 |

### Errors caught, by contrast class — the question the ladder was run to answer

| Class                                 | Micro      | Lite       | Pro          |
| ------------------------------------- | ---------- | ---------- | ------------ |
| `nearMissIdentity`                    | 77.38%     | 75.00%     | **98.93%**   |
| `wrongFormIdentity`                   | 70.19%     | 57.69%     | **95.99%**   |
| **`quantityUnitError`**               | **55.92%** | **50.66%** | **99.34%**   |
| _correct parses wrongly contradicted_ | _2.96%_    | _1.32%_    | **_39.31%_** |

**The quantity/unit weakness is NOT a family trait.** It is a capability gap, and Pro closes it completely.
But Pro closes it by contradicting nearly everything — 39.31% of _correct_ parses, the direction U11 names as
unacceptable — and the gap does not close monotonically: Lite is worse than Micro at every class.

⚠️ Pro's false-disagree rate is **not** explained by the corpus artifact §8 predicted. 166 of its 190
both-order false disagreements are on lines Micro fully verified, and on the cleanest slice (has a unit, no
trailing modifier, n=389) it is Micro 1.42% vs Pro 30.21% — a 21× gap. No threshold reaches it either: Pro's
`disagree`/`high` cell is 28.5% real errors against Micro's 3.4%, and there is no rung above `high`.

**Cost is not why Micro wins.** At ADR-0024 §3's ~8,000 calls/month all three are 30×+ under the ceiling —
Micro $0.14, Lite $0.21, Pro $3.18. Quality is the reason.

### Three findings worth acting on separately

1. ⚠️ **The rate table's derived cache rates are wrong for Nova, in the unsafe direction.** Published: cache
   reads cost **0.25×** input (not the assumed 0.1×) and cache writes are **free** (not 1.25×). The read rate
   is an UNDER-count, so `worstCaseMicros` is not the true bound it claims to be. Recorded in the table's
   docstring rather than silently narrowing a shipped reservation — that is an ADR-0024 call.
2. ⚠️ **Nova Pro's on-demand quota is 250 RPM against 2,000 for Micro and Lite.** The first Pro run came back
   **83.6% throttled** (3,571/4,272) and produced entirely fictitious rates, because the runner pins
   `maxAttempts: 1`. It was discarded ($0.28) and re-run at `--concurrency 2`. Any future run against a large
   model must check the quota first.
3. ✅ **ADR-0024 §5's "cache fields are always zero" now has evidence.** It reasoned from Haiku's 4,096-token
   minimum, while Nova documents _automatic_ caching for all prompts. Measured zero across all 9,474+ calls.

Also: **Nova Lite and Pro are both `ON_DEMAND`** — no `us.` inference profile, so the bare id works and the
rate table prices it exactly. Claude Haiku 4.5 remains the only roster model that needs the profile split.

### Adjudicated after the fact — were the contradicted lines actually correct?

⛔ The right question to ask of a synthetic corpus, and it has been wrong here before (§2). Pro's 190
both-order contradictions of `correct`-labelled lines were adjudicated by inspection on 2026-08-23, against
the corpus records rather than against the model's reasoning.

**The labels hold.** In every sampled case the parse names exactly the catalog row the line was generated
from — `Spices, oregano, dried` from "2 pounds dried oregano spices", `Bulgur, cooked` from "3 to 4 cooked
bulgur". The gate asks whether our parse matches the line, and it does. Pro is wrong as a verifier of this
task.

**But a real corpus defect surfaced, and it is not §2's.** 84 of the 608 `correct` lines — **13.8%** — carry
**no unit at all**. "3 to 4 cooked bulgur" is not a line any cook writes. Pro contradicts 50.0% of that slice
against 28.2% of lines that have a unit, so the defect inflates its rate materially.

**It does not explain the rate.** On lines with a correct identity AND a real unit, Pro still contradicts
28.2% where Micro contradicts 0.8% — a 35× gap the artifact cannot account for.

| slice                | n   | Pro   | Micro |
| -------------------- | --- | ----- | ----- |
| no unit              | 84  | 50.0% | 2.4%  |
| has a unit           | 524 | 28.2% | 0.8%  |
| bulk mass of a spice | 12  | 16.7% | 0.0%  |
| all `correct`        | 608 | 31.2% | 1.0%  |

⚠️ One hypothesis formed from the sample and DISPROVED: implausible bulk quantities of spices ("2 pounds
dried oregano") looked like the driver and are not — that slice runs _below_ Pro's average. Recorded because
it would otherwise read as an obvious explanation to the next person.

**What this changes.** Pro is not contradicting at random; it appears to answer "would a cook write this?"
rather than "does the parse match?". That makes it worse for this task, not better — a model answering a
different question is less useful than one answering the right question imprecisely — so the ruling stands.
⛔ What it does change is confidence in the _corpus_: 13.8% unitless lines is a generator defect that touches
every model's column, including Micro's `quantityUnitError` figure, since corrupting the unit of a line that
has no unit is degenerate. Fix the generator before any of these numbers is re-used to decide something else.

### What this does not establish

- **Haiku is still unmeasured.** Cross-vendor diversity is untested; no attestation was submitted.
- **The corpus is synthetic** and not comparable to U1's annotation protocol. Every rate is conditional on a
  chosen class mix.
- **Run-to-run variance is real.** The Micro control against the published run, same corpus and model:
  `falseDisagreeRate` 2.98% vs 2.32%, quantity/unit 55.92% vs 54.61%. ⛔ Treat sub-1.5-point differences as
  noise — which makes Lite's 1.50% against Micro's 2.98% suggestive, not established.
- The scoring reducer was audited during this run (lineId collisions, band and stop-reason censuses, swap
  pairing) and **no defect was found**.
