---
title: The ingredient pipeline — state of PR 91
date: 2026-08-28
type: state
status: dated-snapshot
# ⚠️ NOT authoritative. This was `status: authoritative` until 2026-09-02, and that is precisely what
# made a reader trust its deployment table against a live account. It is a snapshot of PR 91 taken on
# 2026-08-28; its measurements and judgements stand as OF THAT DATE. For what is deployed, read
# `docs/generated/infrastructure/manifest.json` and the drift check, never this file.
amends: [specs/001-commise-recipe-app, specs/003-usda-food-data]
branch: chore/code-quality-enforcement-phase-1-2
---

# The ingredient pipeline — state of PR 91

**An addendum to features 001 (Commise recipe app) and 003 (USDA food data), simultaneously.**

Those two features were specified apart and have grown together. 001 owns recipes and the ingredient
lines inside them; 003 owns the food catalog those lines resolve against. Every interesting question in
PR 91 — how a line is parsed, what it resolves to, what it costs, where it runs — crosses that seam, and
answering it from either spec alone gives the wrong answer. This document is the single description of
what exists on this branch, and it supersedes the working documents listed in §8 as descriptions of
current state.

---

## 0. ⛔ Local-only is a COST decision, not an architecture

Read this before the rest of the document. (It used to say "read this before §1" — §1's deployment table
was removed on 2026-09-02; see that section for why.)

Everything below runs, or is designed to run, in three places:

| environment            | when it runs                | what it costs                                  |
| ---------------------- | --------------------------- | ---------------------------------------------- |
| **prod**               | on merge to the deploy path | continuously                                   |
| **sandbox / `pr-{N}`** | when explicitly started     | per open PR, ~$8.25/mo per food API task alone |
| **local**              | on demand, for testing      | nothing                                        |

The work in PR 91 was done locally **to avoid paying for a sandbox on every iteration**, not because
anything here is a local-only tool. There is no "local architecture" and no "local mode" in the design:
the local sandbox provisions the same 34 AWS resources from the same CDK source (via LocalStack), runs
the same three service images, and applies the same migrations. Every service and Lambda described here
is intended to run in prod when deployed, and in a sandbox when one is explicitly started.

⚠️ **The corollary is the thing to be honest about.** Because the cheap path was local, several
components have been _exercised_ only locally and _deployed_ never. That is a deployment-timing fact,
not a design fact — but it is a real risk, and §7 lists it rather than burying it.

---

## 1. What runs where, today — REMOVED 2026-09-02, and this is why

⛔ **This section used to be a hand-maintained table headed "What runs where, today", and it was WRONG.**
It marked `verifyLine` and "the 13 other Lambda handlers" as `✅` deployed. Checked against the live
account on 2026-09-02: `kitchensink-recipe-workers-prod` holds exactly SIX Lambdas and was last updated
**2026-08-02** — neither `verifyLine` nor `parseLine` is deployed anywhere. The claim was false on the day
it was written, and it contradicted this document's own §7 gap 6 ("Nothing here has been deployed").

The error is worth naming, because it is easy to repeat: it conflated **"declared in a stack that is
deployed"** with **"deployed"**. `kitchensink-recipe-workers-prod` genuinely exists and is
`UPDATE_COMPLETE`; the deployed REVISION of it simply predates those handlers by a month.

**The replacement is derived, not written.** Two artifacts now cover what this table claimed:

- `docs/generated/infrastructure/manifest.json` — generated from the CDK source, listing every app, stack,
  Lambda handler, queue, alarm, ECS service and SSM parameter. It states in its own `claim` field that it
  describes what a COMMIT DECLARES, never what is deployed, and it carries a regenerate-and-diff staleness
  gate so it cannot rot the way this table did.
- The deployment-drift check (`.github/scripts/verify-deployment.sh drift …`), which reads the git-sha tag
  now stamped on every stack at deploy time and compares declared handlers against RUNNING ones. Before that
  stamp existed, nothing — human or automated — could tell that prod was 600+ commits behind.

⛔ Do not restore a hand-written deployment table here, in this document or any other. A prose list of what
is deployed is a copy of a fact that lives in the account, and this repo has paid for that shape repeatedly
(the ALB listener priorities, the NAT consumer list, ADR-0025's asset guard). If you want to know what is
running, read the manifest and run the drift check.

## 2. The ingredient path, end to end

```
  recipe text
      │
      ▼
  [ segmentation ]  clauseSegmentation.ts        ── shipped, shared pkg
      │
      ▼
  [ PARSE ]  two engines, independent            ── ⚠️ see §3
      │       ├── CRF   (Python Lambda)             declared, never invoked
      │       └── LLM   (Bedrock)                   CLI leg only; gated leg DELETED, §3
      │
      ▼
  [ comparator ]  parseComparator / parseAgreement  ── shipped
      │
      ▼
  [ RESOLUTION cascade ]                          ── ⚠️ 2 of 4 tiers, see §4
      │       ├── curated mappings                  ✅ registered
      │       ├── memo tier                         ✅ registered
      │       ├── lexical tier                      ❌ EMPTY SLOT
      │       └── LLM tier                          ❌ not built
      │
      ▼
  [ food catalog ]  food service                  ── ⚠️ SR Legacy only, see §5
      │
      ▼
  food_id + nutrition summary
```

The seam this document exists to describe sits between the third and fourth boxes: **parse** is 001's
concern, **resolution** and **catalog** are 003's, and the comparator hands one to the other.

---

## 3. There is ONE LLM parse leg, and ADR-0024 §4c is negated on this point

⛔ **`recipe-workers/src/parsing/llmParse.ts` was DELETED on 2026-08-29, along with the whole
`src/parsing/` directory** (`llmParse.ts`, `readParseAnswer.ts`, and both test files). It was dead code:
every reference to `parseLineWithLlm` outside the module lived in its own test file, and it had no
handler, no Lambda, no execution role, and therefore no path to Bedrock. It had never executed outside a
unit test. Typecheck 66/66 and `recipe-workers` 507/507 pass without it.

The only LLM parse leg that exists is **`cookbook-import/src/parsing/llmEngine.ts`** (`createLlmEngine`),
called from `importCookbook.ts:117`. It runs under operator credentials, outside the ceiling, deliberately
— ADR-0024 §4b's own words: _"the runner is an operator script that already sits outside this ceiling by
design."_ That is the leg that produced §6's measured run.

### ⛔ What this NEGATES in ADR-0024

**§4c (owner ruling 2026-08-24, KTD-17)** says the $100/month is one pool _"shared by the verification
gate, **the ingredient parse leg** and 017's capture tiers"_ — three named consumers.

**There is no ingredient parse leg.** Of §4c's three named consumers, exactly one exists: the
verification gate. The parse leg is deleted; 017's capture tiers are specced but unbuilt.

⚠️ **This RESOLVES the inconsistency rather than creating one.** ADR-0024 layer 4b grants
`bedrock:InvokeModel` to exactly one role — `RecipeWorkersStack.ts:817` calls it _"the ONLY
bedrock:InvokeModel grantee"_, and `packages/infra/global/__tests__/llmSpendGuards.test.ts` enumerates
grantees repo-wide and fails with kind `'second-grantee'`. Before the deletion the ADR budgeted for three
consumers while the IAM admitted one. **Now the budget and the grant agree: one consumer, one grantee.**

⛔ **So do not read §4c as describing the system.** It describes an intended future that was not built.
Where §4c and this document disagree about what consumes the pool, this document is correct — and this is
the one place in this file where a state document overrides an ADR's plain text, because the ADR is
describing consumers rather than making a decision that binds.

⚠️ **If a parse leg is ever built, §4c and layer 4b must be reopened TOGETHER.** A parse leg needs a
Bedrock grant, and granting one means either running inside the verification gate's existing role (layer
4b intact, but the gate does two jobs) or adding a second grantee (which trips `llmSpendGuards` by
design). That is a decision nobody has made, and deleting the dead file does not make it. It is now a
future decision rather than a live contradiction.

### The rest of the chain is still unreachable

`parsePipeline.ts` — the orchestrator — is imported only by the shared package and its tests.
`recipe-workers/src/handlers/` holds `accountErasureWorker`, `archiveSweeper`, `erasureOrphanSweeper`,
`erasureSweeper`, `handleSyncWorker`, `verifyLine`, `versionArchiveWorker` — **and no parse handler.** So:

- the CRF Lambda is declared but nothing sends it an invoke,
- `parsePipeline.ts` is wired to no queue,
- and the gated LLM leg no longer exists at all.

⛔ **And the gap is wider than "the new parser has not replaced the old one", because there is no old
one in the deployed path.** `recipeIngredientInputSchema` (`recipes.schema.ts:75`) takes ingredients
**already structured** — `name`, `quantity`, `unit` as separate fields — so the recipe service never
parses a free-text line at all. Parsing exists only in the operator import CLI.

That has a consequence worth stating plainly: the two-engine pipeline is not an upgrade waiting to be
swapped in. It is infrastructure for a **surface that is not deployed** — free-text ingredient entry.
Whoever builds that surface builds the handler with it, and until then the pipeline's only consumer is
an operator running a CLI against a local stack.

---

## 4. The resolution cascade runs 2 of its 4 tiers

`recipe-service/src/ingredients/ingredients.module.ts:101`:

```ts
return [createCuratedTier(mappings), createMemoTier(mappings)];
```

The lexical tier's slot is empty and the LLM tier is not built. Both were designed; neither is
registered. This is why a line that parses correctly can still resolve to nothing — the two registered
tiers only answer for phrases somebody has already curated or corrected.

⚠️ **A census predicting the lexical tier's yield was run and partly falsified.** It projected 39.4% of
phrases reaching the `head` rung of the rank ladder, but spot-checking showed `pepper` classifying at
`head` against `Pepper, banana, raw` — a confident wrong answer. Per KTD-3 the tier must abstain on
_margin_, not score. Do not build it against the census figure alone.

---

## 5. The catalog is SR Legacy only

7,793 foods, the frozen 2018-04 SR Legacy release. Foundation is not loaded (it is re-issued ~twice a
year, so pinning its filename would rot).

⛔ **A fresh local stack has an EMPTY catalog, and nothing says so.** `local:up` applies migrations and
stops; seeding is a separate explicit step (`npm run local:seed-food`). This was not a hypothetical: an
entire 348-recipe import ran against an empty catalog reporting **success** throughout, because the
recipe service degrades to `catalogAvailability: 'unavailable'` rather than failing a write. An empty
catalog is indistinguishable, from every downstream signal, from a catalog with no match. `foodSeedPlan.ts`
now states the difference up front.

---

## 6. Measured on this branch

Local stack: 5 containers, 34 LocalStack resources from CDK, 7,793 foods, all three services answering
both `/health` and `/health/ready`.

| suite / run                           | result                                        |
| ------------------------------------- | --------------------------------------------- |
| Playwright e2e vs live local services | 144 passed, 1 flaky, 1 skipped                |
| recipe-service integration            | 483 / 483                                     |
| full cookbook import                  | 349 recipes, 1,842 lines through both engines |
| import spend                          | **$2.2937** — ⚠️ off-ledger, see §7           |

Parse quality over 1,808 lines:

| measure                   | value         |
| ------------------------- | ------------- |
| fully clean               | **86%**       |
| carrying a preparation    | 355 (19.6%)   |
| carrying a real `food_id` | **63 (3.5%)** |

⚠️ The gap between 86% parsed and 3.5% resolved is §4 and §5, not the parser. Parsing a line correctly
and finding it in the catalog are different problems, and only the first one is in good shape.

---

## 7. Known gaps, ranked by what they'd cost in prod

1. **The two-engine pipeline has no deployed caller** (§3). The deployed import path is still the old
   parser. This is the headline gap.
2. ⚠️ **Building a parse leg reopens ADR-0024 §4c AND layer 4b together.** Not a live defect — the dead
   gated leg was deleted 2026-08-29, so the pool's budget and the IAM grant now agree on one consumer
   (§3). But whoever builds a real parse leg must first decide where its Bedrock grant lives, and that
   decision is unmade.
3. **The import CLI spends outside ADR-0024's counter.** Tonight's $2.2937 was billed from a laptop,
   under operator credentials, against the shared pool the ceiling is supposed to protect — and the
   counter never saw it. Bounded today only by the operator's judgement.
4. **ADR-0024 model drift.** The verifier still pins `NOVA_MICRO_MODEL_ID` while the importer moved to
   Nova 2 Lite. Two consumers, two models, one ceiling.
5. **The resolution cascade is half-built** (§4) — and the obvious build order is the falsified one.
6. **Nothing here has been deployed.** The CRF Lambda's arm64 / CPython 3.13 wheels have never been
   loaded by a Python 3.13 interpreter on ARM (ADR-0025 records this same risk).
7. **CI has no equivalent of the local stack.** The suites that prove this work run against live local
   services; GitHub runners currently have no path to that, and runner capacity is an open question.

---

## 8. Documents this supersedes

⚠️ **Superseded as descriptions of CURRENT STATE only** — and note these were never ten peers: the
planning documents had already collapsed into one on 2026-08-25, and that collapse is itself part of what
made the doc set hard to read.

⚠️ **Superseded as descriptions of CURRENT STATE only.** Each remains valid as the record of the decision
it captured, and none of them should be deleted — several carry reasoning that is still load-bearing.
Where one contradicts this document about what exists today, **this document wins.**

| document                                                                      | what it still holds                                                                                                                                                                                                                        |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `docs/brainstorms/2026-06-21-source-agnostic-food-data-model-requirements.md` | the source-agnostic data model; still the shape 003 implements                                                                                                                                                                             |
| `docs/brainstorms/2026-07-03-food-api-load-test-requirements.md`              | load-test goals; harness shipped                                                                                                                                                                                                           |
| `docs/brainstorms/2026-08-19-ingredient-resolution-quality-requirements.md`   | the owner rulings behind the cascade design                                                                                                                                                                                                |
| `docs/plans/2026-07-03-001-feat-food-api-load-test-plan.md`                   | shipped                                                                                                                                                                                                                                    |
| `docs/plans/2026-07-26-ingredient-search-usda-blended-autocomplete.md`        | `proposed`; the blend/on-demand tiers are §4's unbuilt half                                                                                                                                                                                |
| `docs/plans/2026-08-09-001-feat-resolution-push-notification-plan.md`         | unbuilt; depends on a working cascade                                                                                                                                                                                                      |
| `docs/plans/2026-08-19-001-fix-ingredient-resolution-quality-plan.md`         | superseded the next day by the 08-20 plan — same work, wider title                                                                                                                                                                         |
| `docs/plans/2026-08-20-001-fix-ingredient-resolution-quality-plan.md`         | ⚠️ **the live consolidated PLAN.** Its own frontmatter declares it supersedes the 08-19 plan and both 08-23 plans (consolidated 2026-08-25). It remains the authority on _what to build_; this addendum is the authority on _what exists_. |
| `docs/plans/2026-08-23-001-fix-bedrock-invocation-id-and-iam-plan.md`         | already self-marked `SUPERSEDED 2026-08-25`; folded into the 08-20 plan                                                                                                                                                                    |
| `docs/plans/2026-08-23-002-feat-ingredient-parse-pipeline-plan.md`            | folded into the 08-20 plan; retains the parse-pipeline unit breakdown (U18, U22, U22a…)                                                                                                                                                    |

⛔ **ADRs are NOT superseded by this document — with ONE stated exception.** ADR-0023 through ADR-0027
are binding decisions, and this document describes a state that must conform to them, not the reverse.
Where this document and an ADR disagree, the ADR is the authority and the disagreement is a bug in the
code or in this file.

⚠️ **The exception is ADR-0024 §4c's consumer list, negated in §3** (owner directive, 2026-08-29). That
clause enumerates who spends from the pool; two of its three named consumers do not exist, and one of them
has now been deleted. It is a description of an intended future, not a decision that binds — which is why
it can be negated by observation. **No other part of ADR-0024 is affected**: the reserve-then-settle
mechanism, the $100 ceiling, the prod-only ruling and layer 4b's single grantee all stand unchanged.

---

## 9. What 001 and 003 should each take from this

**Feature 001** — the parse half is built and measured (86% clean) but has no deployed runtime; its
delivery gap is a queue handler, not more parser work.

**Feature 003** — the catalog is loaded but shallow (SR Legacy only), and the cascade that reads it is
half-registered; its delivery gap is the lexical tier, built against margin rather than the census figure.

Neither feature can show a working ingredient resolution on its own. The 3.5% figure in §6 is the number
they jointly own.
