# 002 — the ingredient-line PARSE comparison

**Harness:** [`packages/tools/cookbook-import/src/parseComparison/`](../../packages/tools/cookbook-import/src/parseComparison) + [`scripts/parseModelComparison.ts`](../../packages/tools/cookbook-import/scripts/parseModelComparison.ts)
**Run:** 2026-08-23, `us-east-1`, live Amazon Bedrock. 2,584 corpus lines × 3 models × 2 passes.
**Measured spend:** **$0.7048** for the reported run (`$0.6938` pass 1 + `$0.0110` the repeat pass). Roughly **$1.40** all-in including a first, discarded run — see §7.
**Prior report:** [`2026-08-23-001-verification-bake-off.md`](./2026-08-23-001-verification-bake-off.md). ⛔ **None of its numbers carry over.**

---

## ⛔⛔ READ THIS FIRST — the task changed, and the corpus is two populations

**Report 001 asked a VERIFICATION question.** It showed the model our candidate food and our parsed
quantity and asked whether they matched. That anchors the answer: a model that would have read the line
differently is pulled toward agreeing with what it was shown, and every figure in that report is measured
through the bias. **This report asks the model to PARSE the line independently, seeing nothing of ours.**
Different task, different prompt, different corpus. Do not tabulate the two together.

The prompt is fixed at 511 bytes, `temperature: 0`, `maxTokens: 200`, and is pinned by a unit test. The
model answers `{"measure":string,"foods":[{"name":string,"prep":string|null}]}` and nothing else.

### What the corpus is

|                             |                                                                                                                                                                                                                                                                                                               |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Source**                  | _The International Jewish Cook Book_, Florence Kreisler Greenbaum, 1919 — Project Gutenberg #12350, public domain. An **operator-downloaded file** passed with `--book`; nothing in this repository fetches Gutenberg (ADR-0023), and the licence header is re-checked against the actual bytes on every run. |
| **How lines were obtained** | By running **our own importer's** extractor over the book: `stripGutenbergBoilerplate` → `segmentCookbook` → `toCandidateRecipe`. A line is a `sourceText` — the clause exactly as the book printed it. Nothing is authored, paraphrased or generated.                                                        |
| **Size**                    | 1,499 blocks → 351 accepted → 3,122 extracted clauses → **2,584 distinct lines** after trimming and exact de-duplication.                                                                                                                                                                                     |
| **⛔ Two populations**      | **1,392 `ingredient` lines** (clauses the extractor accepted as ingredients) and **1,192 `dropped` clauses** (clauses it refused: "named something but carried no usable quantity").                                                                                                                          |

### ⛔ The dropped half is mostly NOT ingredient lines, and that decides how to read every table below

Read verbatim from the corpus: `"Let stand a few days before using"`, `"CAVIAR CANAPÉS Cut the bread about
one-quarter of an inch thick"`, `"Serve on a heated platter"`, `"See that you have a good fire"`. The
CRF parser reads **no amount at all** on **1,056 of the 1,192** dropped clauses, against **79 of 1,392**
ingredient lines.

They are kept, because they are what the pipeline really submits and dropping them would curate the corpus
to flatter every parser. But **a rate blended across both halves is a rate about a population nobody meant
to ask about**, so every figure below is reported per half and the blended number is never the headline.

### What it is NOT

- **Not what a modern cook types.** 1900s prose: number words, no ingredient list, instruction clauses. A
  typed line carries brands, percentages, ampersands and typos.
- **Not unbiased by our own parser.** 1,148 blocks were skipped whole and contribute nothing — 673 for
  `too_few_ingredients`, which is _precisely_ the prose our quantity reader could not read, so the loss is
  directional. **Read every agreement rate as an upper bound** over the book's full ingredient prose.
  Harvesting the dropped clauses narrows the gap; it does not close it.
- **Not ground truth.** Nothing here is labelled. Where the two parsers differ, **neither is declared
  correct.** §3 sizes and names the disagreement; it does not adjudicate it.
- **One book, one prompt, one day.** Every rate is conditional on all three.

---

## 1. Contract compliance — the headline

Is the response a **bare JSON document of the declared shape**? Our reader takes whole documents, so
anything else is a line that got no answer, however good the parse inside it is.

Denominated in responses that **arrived** (a call that never arrived is our transport, not the model).

| model                    | responses |          **valid** | prose wrapper | wrong shape | malformed | truncated | calls failed |
| ------------------------ | --------: | -----------------: | ------------: | ----------: | --------: | --------: | -----------: |
| `amazon.nova-micro-v1:0` |     2,583 | **2,075 (80.33%)** |             0 |         508 |         0 |         0 |            1 |
| `amazon.nova-lite-v1:0`  |     2,584 |   **564 (21.83%)** |     **2,009** |           1 |        10 |         0 |            0 |
| `amazon.nova-pro-v1:0`   |     2,582 | **2,306 (89.31%)** |             0 |         268 |         8 |         0 |            2 |

**Zero throttles.** Three `BedrockClientError` calls total across 7,752 attempts; the stop-reason census is
otherwise `end_turn` throughout. Nova Pro ran at concurrency 2 against its 250 RPM on-demand quota
deliberately — the sibling harness that ignored that came back 83.6% throttled. **No truncation at all**, so
`maxTokens: 200` is not a confound.

### ⛔ Split by corpus half, the picture inverts

| model        | compliance on **ingredient lines** (n=1,392) | compliance on **dropped clauses** (n≈1,191) |
| ------------ | -------------------------------------------: | ------------------------------------------: |
| `nova-micro` |                                   **99.07%** |                                      58.44% |
| `nova-lite`  |                                   **28.74%** |                                      13.76% |
| `nova-pro`   |                                   **99.64%** |                                      77.23% |

**Micro's and Pro's non-compliance is almost entirely on text that is not an ingredient line.** Of Micro's
508 wrong-shape responses, **495 are on dropped clauses and 13 on ingredient lines**. For Pro: 267 and 1.

### The two failure modes, named

**Nova Micro and Nova Pro: one systematic behaviour, not noise.** 503 of Micro's 508 and 267 of Pro's 268
shape failures are the identical issue — `"measure": null` where the declared shape says `string`:

```
line     "Let stand a few days before using"
response {"measure": null, "foods": [{"name": "Let stand", "prep": "a few days before using"}]}
```

The model is signalling "this line states no measure" with `null` rather than `""`. It is a genuine contract
break — the reader would refuse it — and it is a **one-line prompt or schema change away** from being
compliant. It fires almost exclusively where there really is no measure, which is why it collapses to 0.9%
on ingredient lines.

**Nova Lite: a markdown fence, 2,009 times.** 77.7% of its responses are the right JSON wrapped in
` ```json … ``` `. A conformant parse was recoverable from **2,008 of the 2,009**, so:

| model        | compliance | **compliance if the reader unwrapped** |
| ------------ | ---------: | -------------------------------------: |
| `nova-micro` |     80.33% |                                 80.33% |
| `nova-lite`  | **21.83%** |                             **99.54%** |
| `nova-pro`   |     89.31% |                                 89.31% |

That gap is the most actionable number in this report — and it is reported **beside** the headline, never
instead of it, because the shipped reader does not unwrap.

Lite's 10 malformed responses are its own distinct failure: it emits **two JSON documents** for a line
naming two amounts (`{…},{…}`), and once refused in prose (_"Sorry, but the provided ingredient line does not
contain any information about measurements or foods"_).

---

## 2. Determinism at `temperature: 0`

40 lines, evenly spaced across the corpus, sent twice. `temperature: 0` is a request, not a guarantee — no
provider promises determinism — so a non-zero rate here is a measurement, not a defect.

| model        | pairs | byte-identical | comparable | **answers differed** | fields that moved             |
| ------------ | ----: | -------------: | ---------: | -------------------: | ----------------------------- |
| `nova-micro` |    40 |          92.5% |         37 |     **8.11%** (3/37) | prep ×3                       |
| `nova-lite`  |    40 |          72.5% |         40 |     **7.50%** (3/40) | foods ×3, prep ×1             |
| `nova-pro`   |    40 |          82.5% |         37 |    **10.81%** (4/37) | prep ×4, foods ×2, measure ×1 |

Two numbers, deliberately. **Byte-identical** is the strictest reading. **Differed** is measured on the
folded parses, over the pairs where both passes were readable — a pair where one pass was unwrapped-able but
the other was not is not evidence about stability. n = 37–40; these intervals are wide.

**`prep` is where it moves**, on all three models. Verbatim, Nova Micro, same line, consecutive calls:

```
line  "one tablespoon of butter to a generous pint of the cooked vegetable"
1st   {"measure":"one tablespoon","foods":[{"name":"butter","prep":"to a generous pint of the cooked vegetable"},
                                           {"name":"cooked vegetable","prep":null}]}
2nd   {"measure":"one tablespoon","foods":[{"name":"butter","prep":null},
                                           {"name":"cooked vegetable","prep":"to a generous pint"}]}
```

```
line  "then roll out on a well-floured board"
1st   {"measure":"","foods":[{"name":"flour","prep":"floured board"}]}
2nd   {"measure":"","foods":[{"name":"flour","prep":"roll out on a well-floured board"}]}
```

Nothing here contradicts a 3–11% flip rate being ordinary at `temperature: 0`; it is simply not zero, and a
pipeline that assumes replay-identical answers would be assuming something untrue.

---

## 3. Agreement with the CRF parser

`ingredient-parser-nlp==2.3.0` (`parse_ingredient`) parsed every line too. Compared field by field, on
**compliant responses only** — a refused response has no reading to compare, and comparing it would fold §1
into §3 and report one defect twice.

### How both sides were normalised — state this before reading any number

Both sides go through **one** fold, and exactly this much is folded:

| fold                                                                                           | why it is not a real difference                                                                                                              |
| ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| case, whitespace, diacritics                                                                   | `Brown Sugar` / `brown sugar`; `purée` / `puree`                                                                                             |
| plural                                                                                         | the two parsers differ on whether they print the singular                                                                                    |
| punctuation (names only)                                                                       | a trailing comma is a boundary marker                                                                                                        |
| **number words → exact rationals**                                                             | the book writes `one-half`, the CRF prints `1/2`; folded **throughout**, not only at the head, so `two to three cups` and `2 to 3 cups` meet |
| measure function words (`of`, `a`, `the`) and hedges (`about`, `scant`, `level`)               | grammar; no parser calls them a unit                                                                                                         |
| unit aliases (`teaspoonful` → `teaspoon`) applied to **both** the unit and the food-name words | without this, the historical-unit detector compared `teaspoon` against `teaspoonful` and answered _no_ — see §6                              |

⛔ **Nothing culinary is folded.** `sweet butter` does not fold to `butter`. A fold reaching into food
identity would manufacture the agreement it is supposed to measure.

### Results

| model                                               | compared | all three fields agree | measure | food names | preparation |
| --------------------------------------------------- | -------: | ---------------------: | ------: | ---------: | ----------: |
| **On ingredient lines only**                        |          |                        |         |            |             |
| `nova-micro`                                        |    1,379 |             **49.17%** |   75.6% |      63.3% |       69.0% |
| `nova-lite`                                         |      400 |             **39.25%** |   68.8% |      54.8% |       69.0% |
| `nova-pro`                                          |    1,387 |             **49.53%** |   76.6% |      62.6% |       70.0% |
| **Blended over the whole corpus** _(read §0 first)_ |          |                        |         |            |             |
| `nova-micro`                                        |    2,075 |                 33.54% |   57.4% |      46.0% |       53.1% |
| `nova-lite`                                         |      564 |                 28.90% |   56.9% |      42.6% |       59.8% |
| `nova-pro`                                          |    2,306 |                 30.49% |   56.5% |      41.3% |       49.4% |

**On dropped clauses the two parsers agree ~2% of the time** (Micro 2.59%, Pro 1.74%, Lite 3.66%). That is
not a finding about the models: it is two parsers being asked to read `"See that you have a good fire"` as
an ingredient line, and disagreeing about text that is not one.

⚠️ Lite's row is measured on the 400 of 1,392 ingredient lines it answered compliantly — a different, and
possibly non-random, slice. Do not read 39.25% as directly comparable to the other two.

### The disagreements, characterised (ingredient lines, Nova Micro, n = 1,379)

| shape                |   n | what it is                                                                 |
| -------------------- | --: | -------------------------------------------------------------------------- |
| `differ`             | 354 | name disagreement with no recognised structure — **the adjudication list** |
| `quantityDiffers`    | 114 | units agree, numbers do not                                                |
| `amountCountDiffers` |  92 | the two read a different NUMBER of amounts from one line                   |
| `unitDiffers`        |  81 | genuine unit disagreement                                                  |
| `crfUnitInName`      |  25 | the CRF swallowed the unit into the food name                              |
| `crfSizeField`       |  24 | the CRF routed `large`/`small` to a field our shape has no slot for        |
| `modelSplitsFoods`   |   7 | the model named several foods where the CRF named one                      |
| `modelPrepInCrfName` |   4 | a state word sits in the name on one side, the prep on the other           |

Nova Pro's distribution is similar with more `quantityDiffers` (163) and fewer `amountCountDiffers` (58).

**Examples — neither side is declared correct.**

`crfUnitInName` — the CRF has no vocabulary for the quantifier and takes it into the food:

```
line   "a little vinegar"
model  {"measure":"a little","foods":[{"name":"vinegar","prep":null}]}
CRF    measure "" · names ["a little vinegar"]
```

`quantityDiffers` — the CRF reads no count from the indefinite article; we read `a` as one:

```
line   "a sprig of parsley"
model  {"measure":"a sprig","foods":[{"name":"parsley","prep":null}]}
CRF    measure "sprig" · names ["parsley"]
```

`crfSizeField` — a shape mismatch between two designs, an error by neither:

```
line   "a large potato"
model  {"measure":"large","foods":[{"name":"potato","prep":null}]}
CRF    measure "" · size "large" · names ["potato"]
```

`modelPrepInCrfName` — the state word that moves a nutrition-table row:

```
line   "one cup of chopped meat"
model  {"measure":"one cup","foods":[{"name":"chopped meat","prep":"chopped"}]}
CRF    measure "1 cup" · names ["chopped meat"] · prep null
```

Note the model puts `chopped` in **both** name and prep — a recurring behaviour, and a real question for a
downstream consumer.

`differ`, the largest bucket — a genuine, undecidable split:

```
line   "three tablespoons of chicken or goose fat"
model  two foods: "chicken fat", "goose fat"
CRF    two names: "chicken", "goose fat"
```

**The candidate list for human adjudication is the `differ` + `unitDiffers` residue — roughly 435 lines per
model on the ingredient half.** It is meant to be read, not explained away.

---

## 4. Cost

Pass 1 only (2,584 calls per model); the repeat pass adds $0.0110 across all three.

| model        |   total | mean/call | per 1,000 lines |  vs Micro |
| ------------ | ------: | --------: | --------------: | --------: |
| `nova-micro` | $0.0295 |  11.40 µ$ |     **$0.0114** |        1× |
| `nova-lite`  | $0.0480 |  18.58 µ$ |         $0.0186 |      1.6× |
| `nova-pro`   | $0.6163 | 238.52 µ$ |         $0.2385 | **20.9×** |

Micro's measured per-line cost matches the $0.000011 brief exactly.

---

## 5. Recommendation

**Ship Nova Micro. Add `null` to the accepted spelling of an absent measure, or say `""` in the prompt.**

- On the population that matters — real ingredient lines — Micro is **99.07% compliant** against Pro's
  99.64%. That 0.57-point gap costs **21× the money**.
- Their CRF agreement on ingredient lines is a **statistical tie**: 49.17% vs 49.53% over ~1,380 lines.
- Micro is the **most stable** of the three (8.1% divergence vs Pro's 10.8%), though n = 37 and the three
  intervals overlap heavily.
- Nova Lite is **not shippable as-is**: 21.83% compliance. But its failure is a markdown fence and nothing
  else — unwrap it and it is 99.54%, the highest of the three, at 1.6× Micro. It is the right answer only if
  the reader is changed, and changing the reader to strip fences weakens the contract for every model.

### What would change my mind

| finding                                                                                           | verdict                                                                                                                                               |
| ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| The `differ`/`unitDiffers` residue is adjudicated and Pro is **materially more right** than Micro | Reopens it. This report sizes the disagreement (~435 lines/model) and deliberately does not resolve it. 21× is a large budget for a real quality gap. |
| The real workload is **user-typed** lines, not 1919 prose                                         | Reopens everything. This corpus does not measure that, and the two distributions differ in shape.                                                     |
| Determinism matters and a bigger sample separates the models                                      | n = 37–40 here. A 400-line repeat pass costs about $0.10 and would settle it.                                                                         |
| The reader gains a fence-stripping step for another reason                                        | Nova Lite becomes the accuracy leader at 1.6× Micro's cost.                                                                                           |
| **Claude Haiku 4.5 becomes callable**                                                             | It is unmeasured, not rejected: the account has no Anthropic use-case attestation (report 001 §1). Whether it beats Micro here is simply unknown.     |
| Cost stops binding                                                                                | Pro's 89.31% blended compliance is genuinely the best, and on the messy half (77.23% vs 58.44%) it is far more robust.                                |

---

## 6. What the harness got wrong before this run, and what it means for report 001

An **earlier run of this same harness was discarded** after review found defects that moved published
numbers. Recording them, because they are the failure modes a measurement harness has:

| defect                                                                                                    | effect on the discarded run                                                                                                          |
| --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `crfUnitInName` compared an alias-canonicalised unit (`teaspoon`) against a raw name fold (`teaspoonful`) | The historical-unit detector **could not fire for the corpus's own spelling**. Micro's count moved 281 → 302.                        |
| Number words folded only at the head of a measure                                                         | `two to three cups` vs `2 to 3 cups` scored as a unit disagreement. Introduced `amountCountDiffers`, which now holds 92 lines/model. |
| A pair where one pass was unreadable was scored as diverging on all three fields                          | Nova Lite's divergence read **25%**; it is **7.5%**.                                                                                 |
| The repeat pass's spend was computed and thrown away                                                      | Under-reported total spend by ~$0.011 (two thirds of a small run).                                                                   |
| Two failed calls compared as `'' === ''`                                                                  | Would have counted as perfect byte-identity.                                                                                         |
| An unreadable envelope was costed at **zero** and blamed on the model                                     | Under-counts spend and depresses the model's headline.                                                                               |

⚠️ **Report 001 shares none of this code**, so nothing here invalidates it — but it is the same class of
harness, and the two defects that mattered most (a detector that could not detect its own subject; a
denominator that mixed transport failures with model behaviour) are worth checking for there too.

---

## 7. Residual risk, and what I could not verify

- **Total spend across both runs is ≈$1.40**, not $0.70. The discarded run cost ~$0.69 by its own
  (under-counting) arithmetic, plus ~$0.01 it failed to count, plus a few cents of smoke runs.
- **The corpus is filtered by our own extractor** and the loss is directional (673 blocks lost to
  `too_few_ingredients`). Agreement rates are upper bounds.
- **The fold is part of the measurement.** It is documented above and in
  `parseComparison/parseNormalization.ts`, and it can be wrong in ways this report cannot see. The
  `amountCountDiffers` bucket exists precisely because one such error was found and named rather than left
  inside `unitDiffers`.
- **Nova Lite's agreement row rests on a self-selected 29% slice** of the ingredient lines.
- **n travels with every rate.** Determinism is n = 37–40. Treat those three numbers as indistinguishable.
- **The CRF version is pinned** (`2.3.0`) because its model file ships in the package: an unpinned upgrade
  would move every agreement figure with no change to our code.
- **Not run:** any test that calls Bedrock (it would spend money in CI and be non-deterministic), and the
  `--book`-dependent path in CI (the book is operator-supplied by design).
- **Not verified:** that `ParsedIngredient.sentence` is always the raw input. The harness now **asserts** the
  echo per row rather than trusting it, so a desynchronised stream fails loudly instead of silently
  mispairing every agreement figure — but that assertion has only been exercised against this book.
- **Untested by construction:** the runner script's own orchestration. Its four measurement decisions
  (corpus harvesting, determinism pairing, planned-call arithmetic, model resolution) were moved into pure,
  unit-tested modules for exactly this reason; what remains is `readFileSync`, `spawn`, `converse` and
  `write`.

---

## Reproducing

```bash
pip3 install --user 'ingredient-parser-nlp==2.3.0'
curl -fL -o /tmp/pg12350.txt https://www.gutenberg.org/cache/epub/12350/pg12350.txt   # by hand, once

AWS_REGION=us-east-1 npm run parse-comparison --workspace=@kitchensink/cookbook-import -- \
  --book /tmp/pg12350.txt --limit 20          # read the printed worst-case estimate first
```

⛔ It spends real money on developer credentials, outside ADR-0024's counter. ⛔ Corpus dumps and raw
response logs are **not committed**; `--out` writes to a scratch path.

---

## 8. Claude Haiku 4.5 — measured off Bedrock, and it ties Nova Micro

§7 recorded Haiku 4.5 as **unmeasured, not rejected**: Bedrock refuses it on this account
(`ResourceNotFoundException: Model use case details have not been submitted`). It has now been measured by
a different route, on the identical 1,392 ingredient lines, against the identical CRF baseline, and scored
by the identical shipped code (`classifyParseResponse`, `compareParses`).

⛔ **Read §8.2 before putting any figure here beside a Nova row.** The serving path is not the same, and one
difference plausibly flatters Haiku.

### 8.1 Results

|                                      | contract compliance | all three agree | measure | food names | preparation |
| ------------------------------------ | ------------------: | --------------: | ------: | ---------: | ----------: |
| `nova-micro` (Bedrock)               |              99.07% |      **49.17%** |   75.6% |      63.3% |       69.0% |
| `nova-pro` (Bedrock)                 |              99.64% |      **49.53%** |   76.6% |      62.6% |       70.0% |
| **`claude-haiku-4-5` (off Bedrock)** |          **98.78%** |      **48.80%** |  74.76% |     62.91% |      70.69% |

n = 1,392 answers, 1,375 compared. **Every figure is within roughly one point of Nova Micro** — a tie on
this corpus, not a ranking.

All 17 non-compliant answers were **explicit refusals**, not malformed output: the model declined the shape
rather than guessing, and each was recorded as a null with the id. That is arguably better behaviour than a
confident wrong parse, but it is still 17 lines needing a fallback.

Disagreement shapes, against Nova Micro's:

| shape                | Haiku 4.5 | Nova Micro |
| -------------------- | --------: | ---------: |
| `differ`             |       357 |        354 |
| `quantityDiffers`    |       134 |        114 |
| `amountCountDiffers` |        68 |         92 |
| `unitDiffers`        |        63 |         81 |
| **`crfSizeField`**   |    **57** |     **24** |
| `crfUnitInName`      |        25 |         25 |
| `modelSplitsFoods`   |         0 |          7 |

⚠️ **`crfSizeField` more than doubles.** The CRF routes `large`/`small` to a field our answer shape has no
slot for, and Haiku collides with it on 4.1% of lines against Micro's 1.7%. That is not a model defect —
it is the same missing member, showing up more clearly. It strengthens the case that the size qualifier
needs modelling rather than dropping.

### 8.2 What this measurement is not

- **It did not go through Bedrock.** No `Converse` call, no `inferenceConfig.maxTokens`, no temperature
  control, and no ADR-0024 reservation. Contract compliance here is the model's tendency, not the shipped
  path's behaviour.
- **⛔ It was batched, not per-line.** Each of six workers saw ~230 lines in one context, where every Nova
  call saw exactly one. The model could normalize across lines, and it was instructed not to — but the
  instruction is not the same guarantee as an independent call. **This confound points toward flattering
  Haiku**, which is why a tie is a safe conclusion from it and a win would not have been.
- **The model carried an assistant system prompt** the Nova calls never had.
- **Determinism was not measured.** No repeat pass.

### 8.3 Cost, and the conclusion

From the rate table (`spendArithmetic.ts`): Haiku 4.5 is **$1.00/1M input and $5.00/1M output** against Nova
Micro's **$0.035 and $0.14** — 28.6× and 35.7×. At this prompt's token mix that is ≈**29× Nova Micro**, or
roughly **$0.33 per 1,000 lines** against Micro's measured $0.0114. _(Derived from the rate table, not
billed — this run did not go through Bedrock.)_ It is also ≈1.4× Nova Pro.

**Conclusion: Haiku 4.5 does not displace Nova Micro.** It ties on every measured dimension, at ~29× the
cost, through a path that if anything favoured it. §5's recommendation stands, and the Bedrock enablement
request is no longer on the critical path for model selection — only for measuring Haiku _as deployed_,
which nothing now depends on.

---

## 9. U22a — the extractor was inflating every rate above, and by how much (measured 2026-08-25)

⛔ **Nothing above is restated or corrected in place.** Every figure in §§1–8 was measured on the corpus
this section describes as it stood on 2026-08-23, and it stays exactly as it was recorded. What follows is
the **delta**: what the extractor now hands the two engines, and how much of the old input was text nobody
meant to parse. The plan is explicit that the deltas are recorded rather than the old figures quietly
replaced, because _the size of the inflation is the finding_.

### 9.1 What changed

KTD-11a read the 354 `differ` cases and found that a large share of them were never a model disagreement at
all: `one tablespoon of butter in a frying-pan`, `one pint of milk for five minutes`,
`four tablespoons of flour to it`, and `a large preserving kettle`, which is equipment. A clause of 1919
prose routinely carries an ingredient **and** an instruction, and `proseRecipe.ts` bounded the span at its
START (`suffixStarts`) and never at its END — so the instruction rode along into both engines. The CRF
folds it into the name, the LLM files it as prep, and the comparator scores a disagreement.

U22a moved the "where does an ingredient END" knowledge into `recipe-import-core`'s `segmentClause`
(`src/domain/clauseSegmentation.ts`), and `proseRecipe.ts` became its caller.

### 9.2 The corpus, before and after — same book, same extractor, no engine calls

Measured over the identical input (`pg12350.txt`, 1,499 blocks) with the identical harvest path
(`harvestSourceTexts` → `buildParseCorpus`). **The 2,584 figure reproduces exactly**, which is what makes
the two columns comparable.

| quantity                                          | before (as §1 measured it) | after U22a |           delta |
| ------------------------------------------------- | -------------------------: | ---------: | --------------: |
| Blocks accepted as recipes                        |                        351 |    **351** |           **0** |
| Ingredient clauses harvested                      |                      1,860 |  **1,846** |    −14 (−0.75%) |
| Distinct corpus lines (the billed population)     |                  **2,584** |  **2,502** |    −82 (−3.17%) |
| Characters of ingredient text sent to the engines |                     57,948 | **52,164** | −5,784 (−9.98%) |

**≈10% of every character the two engines were asked to parse was instruction residue.** That is the
inflation, and it fell on `differ` disproportionately, because residue is precisely what the two engines
disagree about.

### 9.3 Which lines moved

**287 spans were bounded; 273 came back shortened; 14 were removed entirely.** Every one of the 14 is
equipment, and none is a food:

```
a large platter        ×6      a large kettle          ×2
a large preserving kettle      a large earthen jar
a large stone jar              a large salad bowl with lettuce leaves
a large colander to drain      a large platter to dry
one large mould
```

⚠️ `a large preserving kettle` is KTD-11a's own example, in the corpus, verbatim. It parses to
`1 large :: preserving kettle` — a quantity, a "unit" and a name — so every structural gate the extractor
had passed it through to both engines.

Representative boundings, all from the real book, including four of KTD-11a's five named cases:

| before                                         | after                             |
| ---------------------------------------------- | --------------------------------- |
| `one tablespoon of the fat in a frying pan`    | `one tablespoon of the fat`       |
| `one pint of milk for five minutes`            | `one pint of milk`                |
| `three cups of milk for twenty minutes`        | `three cups of milk`              |
| `four tablespoons of flour to it`              | `four tablespoons of flour`       |
| `one quart of flour into a deep bowl`          | `one quart of flour`              |
| `two tablespoons of fresh butter in a spider`  | `two tablespoons of fresh butter` |
| `two cups of lentils over night in cold water` | `two cups of lentils`             |

The last two rows matter twice: `spider` and `overnight` are two of the words KTD-11b found the two
engines contesting as though they were food modifiers. They were never modifiers.

### 9.4 What did NOT change — and the three ways the first implementations broke it

⛔ **No recipe was lost** (351 accepted, before and after) and **no food was deleted.** The cut is REFUSED
whenever the tail names a food of its own; the whole span survives for `ParsedLine.foods` — which holds
many — to carry.

⚠️ Getting that guard right took three corrections, each found by MEASURING rather than by reading, and
each is worth recording because the wrong version looked right:

1. **"Refuse when the tail contains a quantity phrase"** — the obvious form, and wrong on this corpus:
   `five minutes` and `twenty minutes` are quantity phrases and are KTD-11a's own residue examples.
2. **"Refuse when the tail states a UNIT"** — wrong in _both_ directions, and it deleted real food twice.
   `two eggs` parses to `{quantity: 2, unit: null, name: 'eggs'}` — the normal form of every count
   ingredient — so `one cup of milk with two eggs` lost its eggs with `droppedLines` **empty**. And
   `a large frying-pan` parses to `1 large :: frying-pan`, so a vessel counted as a food, refused a cut,
   and `Melt one tablespoon of butter in a large frying-pan` lost its butter.
3. **"A span whose noun is not a food is an instruction"** — right for the tail, wrong for the span.
   `Sift one cup of flour three times` ends on `times`, and classifying the whole span by that dropped a
   real cup of flour; two recipes (`SUNSHINE CAKE`, `KIDNEY BEANS WITH BROWN SAUCE`) fell below the
   minimum ingredient count as a result.

The settled rule is two questions with two vocabularies: _is this span an ingredient at all?_ — only a
**vessel** says no; _would cutting this tail delete a food?_ — a vessel **or** a duration says no.

⛔ **The check that caught all three is a corpus-wide diff of every name, quantity and unit the extractor
produces over the whole book.** It is the check any future change to this module owes; no unit test found
any of them.

### 9.5 The new review reason, and whether it is a signal

`instruction_text_dropped` is raised when a tail is cut. **273 of 1,846 ingredient lines (14.8%)** carry
it. It is deliberately NOT in `VALUE_CORRUPTING_REVIEW_REASONS`: the amount and unit reported are exactly
what the source stated for the food that was kept, and membership would make `cookbook-import` discard a
line it can read.

⚠️ A clause that was _entirely_ an instruction raises **no** reason at all — it is dropped, as it always
was. Flagging it would fire the reason on text nobody meant to parse, which is the muted-signal failure
KTD-11 rules against. The text that WAS cut is reported verbatim in the candidate's `droppedInstructions`,
which is kept separate from `droppedLines` (clauses that yielded no ingredient at all) so neither list
stops meaning what it says.

### 9.6 ⛔ What is NOT measured here

- **The engines were not re-run.** Re-measuring `differ` needs live Bedrock (billed, and no ADR-0024
  reservation guards a script) plus a full CRF pass over 2,502 lines. **No new agreement, determinism or
  cost figure is claimed, and none of §§1–8's rates has been recomputed.** They remain the last measured
  values and they remain inflated by the residue quantified in §9.2.
- **The direction is inferable but not proven.** Removing residue can only remove disagreements it caused
  — segmentation only ever removes a **suffix**, and every emitted span is a strict prefix of what was
  emitted before (asserted over the corpus by `tests/clauseSegmentation.integration.test.ts`). ⚠️ It does
  not follow that the rate can only fall: a prefix is a different input, and two engines can disagree on
  it where they agreed on the whole. The _magnitude_, and its sign, are unmeasured.
- **U19's normalization and KTD-11b's ruling are not in these numbers.** The plan expects the adjudication
  list to land near ~130 after all three; this section accounts for one of them.

**The re-run of §§1–3 remains owed, and it must happen before U23's oracle reads the residual list.**
