# Instruction lines must never reach the parser

**Status:** DECIDED and BUILT. The owner ruled on 2026-10-01: _"Cookbook import only."_ The classifier
`readsAsInstruction` moved from `recipe-import-core` to `cookbook-import`. It is now in
`src/parsing/lineAdmission.ts`, with `instructionLexicon.ts`. `runImport.ts` sends no skipped clause to either parse
engine. The paste path (recipe-service parse jobs) did not change. Every pasted line still goes to the queue.
recipe-service has no dependency on `recipe-import-core`. No skipped line becomes a recipe step.
`recipe-import-core` exports neither file. It now exports `lastWordOf`, so the moved lexicon reads a word the same
way as `notAFoodLexicon.ts`. §6's free measurement is `docs/reports/2026-09-30/instructionGateMeasurement.md`. The
rule skips 0 of 179,207 NYT rows. It skips 151 of 2,490 clauses in the 1919 corpus, with no false refusal.

⚠️ Measured on 2026-10-01: the import itself skips **0** of the book's 1,842 accepted lines. The extractor drops all
151 skipped clauses before the import. The import never sends a dropped clause to an engine. An accepted clause
starts at its amount, and the gate needs a verb first. An accepted clause can still be skipped when the extractor
misreads a verb as an amount: `runImport.test.ts` pins the constructed case `drop in 2 pans`, where `parse-ingredient`
reads the verb `drop` as a unit. No accepted line in this book is such a case. The 151 clauses reach an engine
only in the paid corpus runs (`scripts/validatorCorpusDiff.ts` and `scripts/parseModelComparison.ts`). Those runs
send the whole corpus, and the gate does not filter them. A filter there changes the 2,490-clause count that their
reports use. The owner ruled on 2026-10-01 to keep the gate where it is and leave the paid runs unfiltered.

**Scope:** how an extracted cookbook clause gets to the parse engines. This plan does NOT change the clause
segmenter (`clauseSegmentation.ts`). It is a different layer, and it works as designed. This plan does NOT change
the paste path. The owner ruled it out of scope.

## 1. The measured problem

The 2026-09-19 corpus run (`docs/reports/2026-09-19/validatorLoopCorpusDiff.md`) found **645 of 2,490
lines (25.9%) returned no food at all**, against 73 lines where a validator disputed a name — a ratio of
**7.6 : 1**. On 511 of the 557 `no-food-returned` lines the first attempt also named nothing, so the
foodness judge never ran; **1,355 of 3,475 attempts (39.0%)** were spent on lines that ended with no food.
In a 25-line random sample, **24 were cooking instructions** (`rub to a cream`, `put on a platter`, `set
in a cool place`) and one was a truncated ingredient.

## 2. ⛔ It reaches production, and the route is ordinary

The earlier reading — that this is an artifact of parsing a 1919 prose cookbook — is **wrong**, and the
route is one a user takes by default:

- `parseJobs.schema.ts` documents the create-job body as _"The pasted text. Split on newlines; lines are
  trimmed and blank lines dropped."_
- `parseJobs.service.ts`'s create path runs `splitParseJobLines(text)` and then enqueues **one message per
  line**. There is no content filter of any kind between the split and the queue.

So a cook who pastes **a whole recipe** rather than only its ingredient list sends every method line to
both engines. Each costs a CRF invocation, an LLM parse, a foodness judge per name, a measurement judge,
and up to three retries — and under the 2026-09-19 no-cache-failures ruling **a line that binds nothing is
never remembered, so it is re-paid on every submission**. It also lands `unparseable`, which puts it in
front of the cook as something to fix.

⚠️ Unmeasured: what share of real pastes are whole recipes rather than ingredient lists. The corpus cannot
answer it. Every figure above comes from one 1919 book. The owner ruled the paste path out of scope on
2026-10-01. This plan does not need the figure now. This section records why the plan looked at the paste route.

## 3. Why the fix is not in the segmenter

`clauseSegmentation.ts` operates on _"the suffix of a clause that read as a quantified ingredient"_. Its
job is to cut an instruction TAIL off an ingredient span. These 645 lines are instructions **end to end**;
there is no ingredient span to take a suffix of. Sending them to a better segmenter cannot help, and
loosening the segmenter to catch them would re-open defects it already records as measured and disproved.

## 4. Options

**Decided by the owner on 2026-10-01: none of these options runs on the paste path.** The gate runs only in the
cookbook import, in `runImport.ts`, before the parse pipeline. A skipped clause keeps the extractor's reading. The
options below record what the plan considered for the paste path.

1. **Do nothing.** The cost is real but currently unpaid — prod deploys no parse Lambda. Rejected only if
   §2's unmeasured share turns out material.
2. **Refuse the line at admission** — do not create it. ⛔ Rejected: it silently deletes text the cook
   pasted, and a false positive is then invisible to them. This is the direction U11 ranks unacceptable.
3. **Admit the line, land it terminally, ask no engine** (recommended by the PLANNING review, not chosen). The
   line is created so the cook
   still sees their own text and can edit it into an ingredient, but it is never enqueued. Needs a status
   distinct from `unparseable`: today's set is `['pending', 'parsed', 'unparseable', 'failed_retryable']`,
   and `unparseable` means _the parser tried and could not read it_ — which would be a lie here, and would
   also make it copy-forward-eligible under a future widening of `COPYABLE_LINE_STATUSES`.
    - The new terminal status reaches every surface that holds the line status today:
        - an expand-first migration widening `recipe_parse_job_lines_status_check` (0039)
        - `PARSE_JOB_LINE_STATUSES`
        - `ParseJobsDal.lineStatusOf`, which throws on an unknown value and so would make `createJob` and `getJob`
          answer 500
        - a third decision kind beside `CopyForwardDecision` in `NewParseJobLine.decision`, which `createJob`'s
          pending count must exclude
        - the service wire enum and the regenerated `@kitchensink/schema-recipe` copy
        - `presentStatus` and `toParseJobProgress.settled` in `features/recipes`, which today counts only parsed
          and unparseable lines
        - the localized status copy on web and mobile
        - whether `editLine` re-applies the gate
    - "Never enqueued" is true only at the producer. That needed two things: a subpath export on
      `recipe-import-core`, and a `recipe-service` dependency on it (owner question 3 in the measurement report).
      The ruling refused both. Without them, the gate must run in the worker, and there the line IS enqueued.
4. **Classify after the CRF, before the LLM.** Cheaper to build, saves only the LLM half, and makes the
   decision depend on an engine answer. Rejected: the signal wanted is a property of the LINE.

## 5. The classifier, and the two ways it can be wrong

The vocabulary already exists and must be REUSED, not re-invented: `notAFoodLexicon.ts` exports
`measuresNoSubstance`, `namesEquipment` and `namesNoFood`, and `clauseSegmentation.ts` already consumes
all three. ⛔ Do not write a second vocabulary; ⛔ do not reach for a POS tagger — this repo measured NLTK
contradicting its own KTD-11b ruling on 7 of 25 words, and a lexicon is a definition, not a claim about
English. The verbs that open an instruction and the function words it holds are knowledge no existing lexicon
owns, so they live in a sibling lexicon (`cookbook-import`'s `instructionLexicon.ts`) that repeats no vessel and no
measure.

- **False refusal (severe):** a real ingredient never parsed. In the import, the line keeps only the extractor's
  reading. No engine checks it. Every candidate rule must be measured against the corpus for this before it ships.
- **False admission (benign):** an instruction still reaches the parser — exactly today's behaviour. The
  gate is therefore allowed to be conservative and must be.

**Candidate signal, to be tested and not assumed:** a line whose first word is an imperative cooking verb
and which states no quantity. ⚠️ A verb list overlaps real ingredient entries — `cream`, `butter`, `salt`,
`flour`, `line`, `slice` all head genuine 1919 ingredient lines (`Butter, size of an egg`) — so verb-alone
over-counts. The 2026-09-30 measurement (`docs/reports/2026-09-30/instructionGateMeasurement.md`) settled it:
a verb-first rule with no quantity of a food skipped **529** clauses in the 1919 book and refused **25**
labelled NYT ingredient lines, so it failed the ship gate. The closed-world rule that shipped skips 151 clauses
and refuses no ingredient.

## 6. Verification this owes

⛔ A unit suite CANNOT settle this — ADR-0026's recorded lesson is that three food losses were found only
by a corpus-wide diff. Any candidate rule is measured over the full corpus **before** it ships, reporting:
lines refused, and of those, how many named a food under today's pipeline (each of which is a false
refusal). A rule with any false refusal is not shipped.

✅ The ship gate is met (2026-09-30, `docs/reports/2026-09-30/instructionGateMeasurement.md`). Run 1 (NYT)
skipped none of 179,207 labelled rows, and run 2 (the 1919 book) skipped 151 clauses, every one read by hand,
with no false refusal. That is the zero adjudicated false refusals `instructionGateCorpusDiff.ts` defines as the
gate. The paid run with the CRF enabled is not a ship precondition. It is only the before-baseline for sizing
the saving, so it runs once, when the saving is measured.

✅ The corpus diff for the wiring (2026-10-01) cost nothing. It imported the whole book through `runImport` two
times: once before the gate and once after it. Each run used the real local CRF, no model, and a fake API that
recorded every create. Both runs created the same 350 recipes and 1,809 ingredient lines. Every create body was
identical, byte for byte. No name, quantity or unit changed. The gate skipped 0 of 1,842 accepted lines.

## 7. Not in scope

Intermediate products (109 mentions of `dough`/`cream`/`batter` stored as inputs) are a different class —
those lines DO name a food and the foodness judge passes them correctly. They are scoped separately.
