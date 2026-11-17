# Tasks: Public Versions of Imported Recipes

**Input**: `specs/003B-public-rewrite/` (spec.md, plan.md, research.md, data-model.md, contracts/publicVersion.api.md,
quickstart.md, agentNotes.md) and `specs/027-rewritten-steps/` (agentNotes.md, plan.md, spec.md FR-035 to FR-046).
**Prerequisites**: plan.md, spec.md.

**Status**: Planned, not built. Nothing here runs until Phase 0 is done.

## How to read this list

- **Test-first is law.** In every phase the failing tests come first, in every tier the change touches. Run them and
  watch them fail before the code they cover. A test task that has never failed is not done.
- **Tiers.** Non-UI code gets unit and integration (database mocked). The migration and the publish transaction get a
  LOCAL e2e on a real database. The service gets a service e2e and a k6 scenario (k6 runs by hand only). Every UI
  state gets a vitest component test. Every user story gets a Playwright spec (web) and a Maestro flow (mobile).
- **Run only impacted e2e.** Use `npm run e2e:plan -- --base origin/main` and the root doors (`test:e2e:web`,
  `test:e2e:mobile`). Never start `playwright test` or `maestro test` by hand.
- **Format**: `- [ ] Tnnn {slice} [P?] [Story?] Description with path`. The `{slice}` tag names the PR the task ships in: A1 to A7 (engine), B1 to B5 (paste and link import), P0 to P10 (server), P3b (age assurance), P11 (editor routes, after #322), D0 (docs and ADRs), C2a and C2b (paste screens), U0 to U7 (choice UI), L0 and L1 (seed and launch) and L2 (after launch). `done` marks work already in the tree. `[P]` means a different file with no open dependency.
- **Owner rulings that override the docs**: no Anthropic model anywhere (Bedrock non-Anthropic only); no facts cards;
  no caps of any kind; a link import fetches on the device first and the server second, and the server never fetches
  a known paid site (the cook is asked to paste); one public version per source page; one import allowance for every
  user-facing import; publishing needs age 16 or over.
- **Not in this list**: any edit to `packages/shared/page-reader`. Another agent owns it. Tasks that need it wait for it.
- **Dependency on PR #301** (not merged): the evidence table `recipe_source_evidence`, statement attestations,
  ADR-0095, and "imports save private only". Tasks marked `(needs #301)` touch those interfaces and wait for it.
- **Paths**: `RS` is `packages/services/recipe-service/src`, `RW` is `packages/services/recipe-workers/src`, `RC` is
  `packages/shared/recipe-core/src`, `FR` is `packages/apps/commise/features/recipes/src`. File names follow
  `docs/CODING_STANDARDS.md` §1. `plan.md` carries the final names (BLUEPRINT done).

## User stories

| Story | Priority | Short name                                                 |
| ----- | -------- | ---------------------------------------------------------- |
| US1   | P1       | Share a public version (For everyone, Both)                |
| US2   | P1       | Keep it just for me (including paid held back)             |
| US3   | P2       | The public version cannot be written now (failure, budget) |
| US4   | P2       | No private spots and no public version (dead end, Pro)     |
| US5   | P2       | A public version stays honest after publish                |
| US6   | P3       | Sources shown as they are (open sources)                   |
| US7   | P3       | Bulk import (items save Just for me)                       |

## Phase 0: Prerequisites (before any code)

**Purpose**: the decisions and gates the spec says come first. Nothing below is built until these are done.

- [ ] T001 {D0} Confirm PR #301 (evidence table, statement attestations, ADR-0095, private-only imports) is merged, and note the final table and column names in `plan.md` "Unmerged dependencies". Phases 2, 3 and 6 wait for it.
- [x] T002 {D0} Run `staff-architect` BLUEPRINT (opus) for 003B, including the C1 and C2 phases. Record the exact files, contracts and pattern register in `plan.md`.
- [ ] T003 {D0} Run `staff-ux-engineer` SPECIFY (opus) for the choice, writing, review, flags, blocked, failed, budget, dead-end and Pro screens, web and mobile, with the §3.6 translation. Record the result in `docs/design/` and keep every owner screen decision.
- [ ] T004 {D0} Write the paste and link import ADR and the feature ADR (public versions). The feature ADR covers the three one-way doors (rights label "Steps written by Commise", licence `cc-by-sa-4.0`, the provenance pair for a public version), the fingerprint format and key custody, and the ADR-0024 §3 third no-retry path. Put the amendments to 010 (US6 scenario 2, FR-042c) in the same PR.
- [x] T005 {D0} Confirm with 027 owners that 003B builds the engine first, and make the edits to 027 that the plan lists (FR-045 wording, shingle SETS API, FR-032 no gate, FR-044 one banned-word module, FR-043 no credit key of its own) in `specs/027-rewritten-steps/`.
- [ ] T006 {A6} Assemble the private evaluation set for the bake-off (200 or more recipes, never committed) outside the repo.

## Phase 1: Engine core and fingerprint (027's engine, built once)

**Purpose**: `RC/stepWriting/` with no mode flag. 003B code builds the title, not the engine. Blocks every later phase.

### Tests first (all must fail before the implementation below)

- [ ] T007 {A2} [P] Unit test: fact sheet extraction per category (order, actions from a fixed list, amounts, temperatures, times, ingredient names, equipment, the seven safety categories of 027-FR-041) in `RC/stepWriting/__tests__/factsSheet.test.ts`. The duration reader is injected, because `cooking` already depends on `recipe-core` and the reverse edge would be a cycle. The integration test that runs the real duration reader lives in `packages/shared/cooking`, not in `recipe-core`.
- [ ] T008 {A3} [P] Unit test: `buildStepPrompt(sheet)` arity pinned in invariant position, and the system prompt pinned by length and SHA-256, in `RC/stepWriting/__tests__/stepPrompt.test.ts`.
- [ ] T009 {A3} [P] Unit test: answer parser refuses unreadable text, text outside the step list, and more steps than the cap, in `RC/stepWriting/__tests__/stepAnswer.test.ts`.
- [ ] T010 {A4} [P] Unit test: two-way fact check with mutants (drop one amount, add one, change a duration, drop a safety line, add an allergen, merge and split steps stay valid; rejects output where two tied amounts are swapped between ingredients) in `RC/stepWriting/__tests__/factCheck.test.ts`.
- [ ] T011 {A1} [P] Unit test: `fingerprint(text, size, hash)` returns `{ formatVersion, hashes }` with an injected keyed hash, the same set from the same text, format version pinned; `jaccard` and `containment` (the per-sentence check is containment); mutants: one shingle changed, order changed, in `RC/stepWriting/__tests__/wordShingles.test.ts`.
- [ ] T012 {P7} [P] Unit test: title builder never returns the source title, uses only facts, and the title check (normalised equality, 2-word shingles) in `RS/import/publicVersion/__tests__/titleBuilder.test.ts`.
- [ ] T013 {A4} [P] Unit test: `rewriteSteps(sheet, writer, wording)` outcomes (ok, checkRefused with a category, unreadable) with a fake writer, and no fetch in the engine, in `RC/stepWriting/__tests__/rewriteSteps.test.ts`.
- [ ] T014 {A1} [P] Unit test: content digest is stable across whitespace and order in `RC/stepWriting/__tests__/contentDigest.test.ts`.
- [ ] T015 {A5} [P] Unit test: the banned-word module is the only list, and a copy guard over `importMessages.choice.*` and `recipes.flowSteps.*` imports it, in `packages/tools/repoGuards/__tests__/bannedWordsCopy.test.ts` (fails until the strings exist, so start it with the module itself).

### Implementation

- [ ] T016 {A2} Implement `RC/stepWriting/factsSheet.ts` with closed verb, equipment and safety lexicons.
- [ ] T017 {A3} Implement `RC/stepWriting/stepPrompt.ts` (pure, arity pinned).
- [ ] T018 {A3} Implement `RC/stepWriting/stepAnswer.ts` (zod, data only).
- [ ] T019 {A4} Implement `RC/stepWriting/factCheck.ts` (multiset, whole recipe, no model judge).
- [ ] T020 {A1} Implement `RC/stepWriting/wordShingles.ts`: keyed versioned hash, sets API, `jaccard`, `containment`. Each consumer owns its threshold.
- [ ] T021 {A4} Implement `RC/stepWriting/contentDigest.ts` and `RC/stepWriting/rewriteSteps.ts`.
- [ ] T022 {A5} Implement `RC/copy/bannedWords.ts` and move the comment beside `editor.source.rightsLabel` in `FR/editor/messages.ts` to import it.
- [ ] T023 {A1-A4} Add subpath exports for each engine module in `RC/../package.json` (as `parsing/parse-prompt` does). No barrel files.
- [ ] T024 {A4} Run the mutation suite over the fact check, fingerprint and measure. Record the surviving mutants and kill them.
- [ ] T025 {A4} Integration test (the engine has no database): a round trip with a stub writer proves no source wording reaches the prompt, in `packages/shared/recipe-core/tests/engineRoundTrip.integration.test.ts`. The package has no integration tier yet, so the task adds its `vitest.integration.config.ts` and `test:integration` script.

**Checkpoint**: engine green. Phases 2 and 3 may start in parallel.

## Phase 2: Migration and LOCAL e2e

**Purpose**: the one migration pair (expand-only, ADR-0035). Blocks Phases 3 and 4.

- [ ] T026 {P1} LOCAL e2e (write first, watch it fail): migrated schema has `recipe_source_records` and `public_version_jobs`, the new columns on `recipes` and the import item, and the widened CHECKs, in `packages/services/recipe-service/tests/e2e/publicVersionMigration.e2e.test.ts`. (needs #301)
- [ ] T027 {P1} LOCAL e2e: partial `UNIQUE (source_page_key)` rejects a second public version of one page; `UNIQUE (page_key)` on live jobs rejects a second live job; the key is released on delete, 020 rejection and opt-out, and held while hidden by a report, in the same file.
- [ ] T028 {P1} LOCAL e2e: `recipe_source_records` is append-only for every role (trigger), has no cook id, and survives deletion of the recipe; the job table cascades and is covered by erasure, in the same file.
- [ ] T029 {P0} Write migration `00NN_public_versions.sql`: `recipe_source_records`, `public_version_jobs`, `recipes.source_record_id` and `recipes.source_page_key`, import item `choice`, the provenance pair CHECK, new licence value, new label value. CHECKs inline only on new tables, `NOT VALID` on existing ones. In `RS/database/migrations/`.
- [ ] T030 {P1} Write the `_validate` twin migration with the matching `VALIDATE CONSTRAINT` statements.
- [ ] T031 {P1} Add Drizzle schema files `RS/database/schema/recipeSourceRecords.ts` and `RS/database/schema/publicVersionJobs.ts`, and the new `recipes` columns.
- [ ] T032 {P1} Add `public_version_jobs` to `erasureSweepCoverage`, and `recipe_source_records` to `RETAINED_BY_RULING` with its reason. Add the job table to the test-principal purge and the 7-day retention sweeper (`RW/handlers/retentionSweeper.ts`).
- [ ] T033 {P1} Add `NOT VALID` then `VALIDATE` pair and the `importSchemaParity` update for the item `choice` column. Run the guards (`npm run test` for repoGuards) and fix any parity failure.

## Phase 3: recipe-service (classifier, job API, Publish, wording guard)

**Purpose**: the server side of US1, US2, US3, US5, US6. Depends on Phases 1 and 2.

### Tests first

- [ ] T034 {P3} [P] [US6] Unit test: `classifySource` allowlist (own claimed site with a live claim, honoured licence read from structured data, curator public domain, listed US federal publisher), every unknown input reads closed, CC BY-NC is not open, `.gov` alone is not open, an aggregator is third-party, in `RS/import/domain/__tests__/sourceClassification.test.ts`.
- [ ] T035 {P3} [P] [US2] Unit test: `paidPublicEligibility` (publisher opt-out, signature recipe, age against `PAID_CONTENT_HOLD_MONTHS`, undated page counted from the first import), returns `allowed` or one reason, with boundary cases at the hold edge, in `RS/import/domain/__tests__/paidPublicEligibility.test.ts`.
- [ ] T036 {P3} [P] [US1] Unit test: the offer Specification maps every case of the contract's `offer` union (choice free and paid, each `privateOnly` reason with `holdEndsOn` only for a known `paidRecent` date, `publicExists` with status `published`, `writing` and `inReview`, `publicOnly`, `deadEnd` `paid` and `noWrite`) and the server alone computes it, in `RS/import/publicVersion/__tests__/offer.test.ts`.
- [ ] T037 {P8} [P] [US5] Unit test: wording guard decides on a stored fingerprint; stale key version re-checks with the old key, then a missing key version answers `checkUnavailable` and raises an alarm; a save that makes the version private runs no check; at Publish a missing key version gives `rewriteNeeded` (`rewriteNeeded.body`); title equality and 2-word shingles, in `RS/recipes/domain/__tests__/publicVersionWordingGuard.test.ts`.
- [ ] T038 {P6} [P] [US1] Unit test: job state transitions of the data model (every edge, and no write outside `pending` or `writing` after `cancelled`), in `RS/import/publicVersion/__tests__/jobState.test.ts`.
- [ ] T039 {P6} [US1] Integration test (database mocked): choice to job; a second call returns the same job; `409 publicExists`; `409 offerChanged` when the sent `shownOffer` differs from the offer computed now on the fields the contract compares per kind (not `holdEndsOn`, not `recipeId`), on start and on publish; the offer excludes the caller's own live job; `409 publicExists` wins over `offerChanged` when another cook's version holds the page; `429 importAllowance`; 404 for another cook's job, in `packages/services/recipe-service/tests/publicVersion.integration.test.ts`.
- [ ] T040 {P7} [US1] Integration test: Publish runs the server fact check and the wording check, double publish returns one recipe (`200` on replay), `422 flags`, `422 tooSimilar`, `422 rewriteNeeded`, `409 privateCopyChanged` on Both, in the same file.
- [ ] T041 {P7} [P] [US1] Integration test: Both path saves the private copy first and uses one slot; "For everyone" keeps no private copy and no pasted text; the public version uses no slot; the 020 hold applies and a not-approved version becomes private over the limit where need be, in the same file.
- [ ] T042 {P7} [P] [US2] Integration test: no steps gets private only; paid held back (recent, signature, opt-out) gets `privateOnly`; a paid private copy is never shared or exported, and the household sees only the public version, in the same file.
- [ ] T043 {P8} [P] [US5] Integration test: wording guard on `PATCH` and on version restore (ADR-0058) refuses with `422 tooSimilar`; a missing key version answers `503 checkUnavailable`; a save that makes the version private runs no check; the check runs inside the recipe write, in the same file.
- [ ] T044 {P8} [P] [US1] Integration test: page key release and hold (delete, 020 rejection, opt-out; hidden by report keeps the key), in the same file.
- [ ] T045 {P6} [P] [US3] Integration test: AI opt-out page and spent budget hint give private only with no writer call; cancel is idempotent, in the same file.
- [ ] T046 {P7} [P] [US1] Integration test: a public version cannot earn rewards (015) and cannot be offered for sale (018), in the same file.
- [ ] T047 {P7} LOCAL e2e: the Publish transaction on a real database (server fact check, wording check, insert under the unique key; two concurrent Publish calls give one recipe; a rollback leaves the job `ready`), in `packages/services/recipe-service/tests/e2e/publicVersionPublish.e2e.test.ts`.

### Implementation

- [ ] T048 {P3} Implement `RS/import/domain/sourceClassification.ts` (`classifySource`, `paidPublicEligibility`, pure, fail closed). The paid list, honoured-licence list and federal-publisher list are injected as data ports. `@pattern Specification`.
- [ ] T049 {P3} Implement the one `PAID_CONTENT_HOLD_MONTHS` constant (6) in `RC/sourceRules.ts` or its BLUEPRINT home, defined once and configurable.
- [ ] T050 {P3} Implement the offer Specification and the item read fields (`source`, `offer`) in `RS/import/publicVersion/offer.ts` and the import view builder (`RS/import/importView.builder.ts`).
- [ ] T051 {P4} Implement `RS/import/publicVersion/publicVersionJob.dal.ts` and `sourceRecords.dal.ts` (insert and read only for the records).
- [ ] T052 {P7} Implement the title builder (`RS/import/publicVersion/titleBuilder.ts`) from the facts sheet, with no model call and never the source title.
- [ ] T053 {P2} Implement the fingerprint key custody: Secrets Manager read with versions, a cache with a short TTL, and a missing key version reported as `checkUnavailable` on a later save and as `rewriteNeeded` at Publish. In `RS/import/publicVersion/fingerprintKey.ts`.
- [ ] T054 {P4} Implement the source-record write (classification inputs, fingerprint of steps and title, format and key version, `page_key`, `published_on`) in the same transaction as the item save or job creation. (needs #301)
- [ ] T055 {P6} Implement `RS/import/publicVersion/publicVersion.service.ts`: start (import path and the later route), read, cancel, Publish Command through `RecipesService.create`, with the `publishAgeAllowed` check at Publish only (`403 ageConfirmNeeded`) and the page-key idempotency.
- [ ] T056 {P8} Implement `RS/recipes/domain/publicVersionWordingGuard.ts` and call it inside `RecipesService.update` and version restore for any recipe with a `source_page_key`. A missing key version answers a retryable `503 checkUnavailable` and raises an alarm. A save that makes the version private skips the check.
- [ ] T057 {P8} Implement the page-key release in the delete, 020 rejection and opt-out transactions (FR-034a).
- [ ] T058 {P6} Implement the controller and zod schema `RS/import/publicVersion/publicVersion.controller.ts` and `publicVersion.schema.ts` for the routes in `contracts/publicVersion.api.md`. Run `contract:generate`; commit the generated `packages/schemas/recipe` copy.
- [ ] T059 {P3} Implement the per-market switch read in one place (`FR-090`), shared with web and mobile through the settings contract, with no test door.
- [ ] T060 {P10} Implement the rate alarm that counts public versions per `source_key` (configuration, no block, FR-071) and its CDK alarm.
- [ ] T061 {P10} Service e2e (deployed preview, skips when the sandbox is down): job and publish round trip, in `packages/services/recipe-service/tests/e2e/publicVersion.e2e.test.ts`.
- [ ] T062 {P10} k6 scenario `tests/load/publicVersionJobStatus.load.js` for job status reads. Hand-run only; add no automatic trigger.
- [ ] T144 {P10} [P] [US3] Unit test (fail first): `publicVersionOfferSchema` accepts every `PublicVersionOffer` case and its refine rejects `holdEndsOn` on any reason but `paidRecent`; the offer Specification is shared by the import view and the offer route; `hasSourceRecord` is true only for the owner with a `recipe_source_records` row whose `page_key` equals the evidence `source_key`, and omitted for any other viewer; in `RS/import/publicVersion/__tests__/publicVersionOffer.test.ts`.
- [ ] T145 {P10} [P] [US3] Integration test (database mocked): `GET /api/v1/recipes/{id}/public-version/offer` returns `200 { offer }` to the owner and `404` for another cook's recipe, a missing recipe and a recipe with no source record; the recipe read carries `hasSourceRecord` for the owner only; Start on the later route answers `409 offerChanged` when the offer differs from the shown one; in `packages/services/recipe-service/tests/publicVersionOffer.integration.test.ts`.
- [ ] T146 {P10} [US3] Implement the offer route, the shared `publicVersionOfferSchema` in `publicVersion.schema.ts` (the import item view reuses it), the owner-only `hasSourceRecord` on the recipe read (computed as #301 computes `publicNeedsCheck`) and the later-route start in `publicVersion.service.ts`. Run `contract:generate`; commit the generated `packages/schemas/recipe` copy.
- [ ] T147 {P10} Service e2e (deployed preview, skips when the sandbox is down): the offer route and the later-route start for a private copy with a source record, in `packages/services/recipe-service/tests/e2e/publicVersion.e2e.test.ts`.

## Phase 4: recipe-workers and infra

**Purpose**: the writer job runs on the shared engine under its own call site. Depends on Phases 1 to 3.

### Tests first

- [ ] T063 {P5} [P] [US3] Worker test: ceiling denial ends `budgetSpent`, refunds in full, and acks (no redelivery); an unreadable counter retries; a late result after `cancelled` is dropped; a 10-minute job ends `failed`; at most 3 calls per item; a deleted private copy mid-job is discarded; in `RW/handlers/__tests__/publicVersionWorker.test.ts`.
- [ ] T064 {P5} [P] [US1] Worker test: the facts snapshot and output are set to NULL at any terminal state, and the writer prompt holds facts only (no source wording, address, title or headnote), in the same file.
- [ ] T065 {P5} [P] Unit test: `createGatedStepWriter` selects a non-Anthropic model and refuses an Anthropic model id, in `RW/stepWriting/__tests__/gatedStepWriter.test.ts`.
- [ ] T066 {P5} [P] Guard test updates (fail first): `SPEND_CALL_SITES` gains `import-public-rewrite`, `llmSpendGuards` still shows one Bedrock grantee, `natEgressConsumers` lists the new Lambda, in `packages/tools/repoGuards/__tests__/` and `RW/__tests__/`.
- [ ] T067 {P5} CDK synth test for the new queue, DLQ, reserved concurrency and Lambda in `packages/services/recipe-workers/infra/__tests__/`.

### Implementation

- [ ] T068 {P5} Implement `RW/stepWriting/gatedStepWriter.ts` (Template Method over `gatedConverse`, terminal `budgetSpent` override as 004-FR-059). `@pattern Adapter`.
- [ ] T069 {P5} Implement `RW/handlers/publicVersionWorker.ts` with the state edges of the data model and the single claim.
- [ ] T070 {P5} Add the call site `import-public-rewrite` to `SPEND_CALL_SITES` in the shared spend module (`RC/spend/`), operating cost, never charged to a cook's uses.
- [ ] T071 {P5} Add the Lambda, queue, DLQ, reserved concurrency and the NAT row to `packages/services/recipe-workers/infra/lib/RecipeWorkersStack.ts` and to ADR-0004's `nat-consumers` table.
- [ ] T072 {D0} Amend ADR-0024 §3 with the third no-retry path (done in the feature ADR of Phase 0; link it here).

## Phase 5: Bake-off (027 step 5)

**Purpose**: pin the model and set the thresholds from measurements. 003B cannot launch without it.

- [ ] T073 {A6} Write the bake-off script in `packages/clients/bedrock/scripts/` (not in recipe-core), reading the evaluation set from an out-of-repo path.
- [ ] T074 {A6} Run it under a scoped non-root AWS profile (the default profile is root) on non-Anthropic Bedrock models. Record cost per call and the human-audit result of SC-001 (0 of 200 drop or change a fact).
- [ ] T075 {A7} Set the step wording threshold (027 owns it) and the title check's own measure from the same set. Pin the model id and prompt SHA in the engine.
- [ ] T076 {A7} If the code-built titles read badly, record the decision and add a second pinned title prompt behind the same adapter under its own call site. Otherwise record that none was needed.

## Phase 6: Whole-page paste import server work ("C1")

**Purpose**: the server side of paste and link import that 003B now includes: statement and attestation rows per item, the source-page key, the paid-site list as data, and the device-first link import. Design lives in `docs/design/pasteImport/spec.md`. The paths below follow `plan.md`. Depends on PR #301 and on Phases 2 and 3 for the source-page key. Do not edit `packages/shared/page-reader`.

### Tests first

- [ ] T077 {B1} [P] Unit test: `sourceLinkKey` (fragment and `utm_*` removed, normalised) is one pure function in `RC/sourceLink.ts`, the single key that replaces #301's `sourceKeyOf` (that function moves here and `RS/recipes/domain/sourceEvidence.ts` imports it); a paste with no detected address has no key, in `RC/__tests__/sourceLink.test.ts`.
- [ ] T078 {B2} [P] Unit test: admission reads a source hint through `parseSourceLink`, keeps only a usable public web link, sets kind `paid_site` and suggests the paid label for a domain in the paid-site list, in `RS/import/__tests__/importEvidenceAdmission.test.ts`. (needs #301)
- [ ] T079 {B3} [P] Unit test: the ordered `needs` list (`importItemIssueOf`, `importSaveGap`) gives statement and attestation rows per item in one order, in `RS/import/__tests__/importNeeds.test.ts`. (needs #301)
- [x] T080 {done} [P] Unit test: the one import allowance counts every user-facing import (paste, link, file, button) once per item, a test principal has no limit, in `RS/import/__tests__/importAllowance.test.ts`. Done: the allowance already takes the principal kind, so test principals are unlimited.
- [ ] T081 {B3} Integration test (database mocked): `GET /api/v1/import/copies?source=` returns `{ copies, total }` with at most 20 copies, newest first, `everPublished` true from `first_published_at` and never from status, and `total >= copies.length`, and charges nothing; a paste item with evidence saves an evidence row in the same transaction; a server link import never fetches a known paid site and answers "paste the page"; the server link fetch runs only after the device fetch failed, in `packages/services/recipe-service/tests/importPaste.integration.test.ts`. (needs #301)
- [ ] T082 {B3} Integration test: no raw page or recipe wording appears in any log line or Sentry event on a forced error (real SDK, in-memory transport), in `packages/services/recipe-service/tests/import/importSentry.integration.test.ts`.
- [ ] T083 {B3} LOCAL e2e: a paste is saved end to end with its evidence row and per-item statement and attestation rows; a replace keeps the id and adds a version; a stale version gives `replaceConflict`; replaying the same import id gives one item, in `packages/services/recipe-service/tests/e2e/importPaste.e2e.test.ts`. (needs #301)

### Implementation

- [ ] T084 {B2} Add the paid-site list as data (`paid_recipe_sites` table, seeded from an owner-approved list) in a migration pair, and inject it into `classifySource` (Phase 3). Open item: owner approves the domains.
- [ ] T085 {B3} Extend the import item schema and `import.schema.ts` with the evidence part, the per-item statement and attestation fields, and the source-page key; run `contract:generate`. (needs #301)
- [ ] T086 {B4} Implement the duplicate lookup `GET /api/v1/import/copies` (indexed on the cook and `source_key`) in `RS/import/import.controller.ts`, with the response shape of the contract: `everPublished` from `first_published_at` (never from status), and `total` counting every copy of the page the cook holds, from the same query.
- [ ] T087 {B4} Implement Replace as a new version of the same recipe through `RecipesService.update` with an `afterWrite` that claims the item inside the version-checked transaction. (needs #301)
- [ ] T088 {B5} HELD until link import has a design (link import has no UI in the first web release). Implement the server link import: device result accepted first, server fetch second, never for a known paid site (answer: ask the cook to paste), and a paste never fetches. No safe-fetch client exists in the tree: this task builds it in slice B5 (a maintained request-filtering agent over `node:https`, a robots reader, redirect, time and size limits), and it stays off by default.
- [ ] T089 {B2} Implement the paste switch (`IMPORT_PASTE_MODE`, signed grant `recipes:import:paste`) and one pure `pasteImportAllowed(mode, scopes)` in `RC/`, if the BLUEPRINT keeps it.
- [ ] T090 {B4} Service e2e (deployed) for `copies` and a create against the preview, and a k6 scenario `tests/load/importCopies.load.js` (hand-run only).

## Phase 6b: Age assurance and the Publish gate

- [ ] T131 {P3b} [P] Unit test: `publishAgeAllowed(principal)` allows only a principal with `publishAgeMet`, in `RS/recipes/domain/__tests__/publishAgeAllowed.test.ts`.
- [ ] T132 {P3b} [P] [US1] Integration test (database mocked): Publish answers `403 { code: 'ageConfirmNeeded' }` with no claim and `201` with it; the start of a job is never gated, in `packages/services/recipe-service/tests/publicVersionAge.integration.test.ts`.
- [ ] T133 {P3b} [P] Unit test: identity age assurance service writes the row first and then the claim; a failed claim write gives `503` and a retry writes only the claim, in `packages/services/identity/src/ageAssurance/__tests__/ageAssurance.service.test.ts`.
- [ ] T134 {P3b} [P] Integration test (identity, database mocked): `POST /api/v1/me/age-assurance` accepts only `floor: 16` and `wordingVersion: 'ageConfirm.v1'`, is idempotent, and answers `503` on a claim failure, in `packages/services/identity/tests/ageAssurance.integration.test.ts`.
- [ ] T135 {P3b} LOCAL e2e (write first, watch it fail): the migrated identity schema has `age_assurances`; the route writes one row; account erasure deletes it, in `packages/services/identity/tests/e2e/ageAssurance.e2e.test.ts`.
- [ ] T136 {P3b} Write the identity migration for `age_assurances` as defined in spec 016 data-model §3 and its Drizzle schema, and add the table to identity's erasure coverage test.
- [ ] T137 {P3b} Implement `POST /api/v1/me/age-assurance` in identity: row first, then the Clerk `public_metadata.ageFloorMet` claim, idempotent, `503` on a claim failure. Run `contract:generate`.
- [ ] T138 {P3b} Implement `publishAgeAllowed` in `RS/recipes/domain/publishAgeAllowed.ts` (pure) and call it at Publish.
- [ ] T139 {P3b} Service e2e (deployed preview, skips when the sandbox is down): Publish without the claim answers `403`, the age route sets the claim, the retried Publish succeeds.
- [ ] T140 {P3b} k6 scenario for the age assurance route. Hand-run only; add no automatic trigger.
- [ ] T141 {U2-U5} [US1] Client: on `403 ageConfirmNeeded` show `ageConfirm.*`; on "I'm 16 or over" call identity, `getToken({ skipCache: true })` (mobile: `commise-native` template), retry Publish once; a second `403` shows an error. "Not now" closes the dialog, publishes nothing and returns the cook to the review screen, where the job stays ready and the normal private exit (`review.notNow`) still works; nothing is saved automatically (design spec §6.10). Component tests, Playwright and Maestro first.
- [ ] T142 {P11} After PR #322: the editor's make-public and set-visibility routes adopt `publishAgeAllowed`, so those two routes are gated too (FR-016). Integration test first.
- [ ] T143 {P3b} [P] Unit test first, then implement: `@kitchensink/clerk-verify` and recipe-service `auth/principal.ts` parse the signed `public_metadata.ageFloorMet` claim into the `Principal` field `publishAgeMet`; a missing claim, or any value other than the integer `16`, reads false.

## Phase 7: Clients and UI (web and mobile together)

**Purpose**: every state, on both platforms, after `staff-ux-engineer` SPECIFY (Phase 0). Depends on Phases 3 and 6 for the contract. The shape is a statechart as a derived state union, an exhaustive switch (Visitor), a headless hook, and pure render components, like `details/detailsDialogMachine.ts`. Every string goes through localisation under `importMessages.choice.*`, and the banned-word guard covers them.

### Tests first (vitest component tests, one per state, both platforms)

- [ ] T091 {U2-U5} [P] [US1] Component tests: choice (three radios, none selected, label follows the choice, one line and one button when only one way exists, never a disabled radio), in `FR/import/choice/__tests__/ImportChoice.test.tsx` and `ImportChoice.native.test.tsx`.
- [ ] T092 {U2-U5} [P] [US1] Component tests: writing (loading, announce, stop, offline, Both saved) and review (written steps, new title, credit, licence, no photo, show and hide my copy, edit steps, publish, not now), in `FR/import/choice/__tests__/`.
- [ ] T093 {U2-U5} [P] [US1] Component tests: flags after an edit (`flag.*`), publish blocked until each flag is resolved, in the same folder.
- [ ] T094 {U4-U6} [P] [US5] Component tests: blocked save (`blocked.body`, `rewriteNeeded.body`, `flag.rewrite` "Write it again", "Keep it just for me"), `publicPage.hiddenOwner` and `publicPage.hiddenReader`, public page credit, licence and report link, in the same folder.
- [ ] T095 {U2-U5} [P] [US3] Component tests: failed (`failed.*` for import and Both), budget spent, AI opt-out, offline, no slot with public possible, in the same folder.
- [ ] T096 {U2-U5} [P] [US2] Component tests: every `privateOnly` reason (`privateOnly.*`, one button, `holdEndsOn` date), paid public credit (`credit.written` only, names no site), `publicExists` (`publicExists.published` with `publicExists.link`, `publicExists.writing`, `publicExists.inReview`, no slot), `button.none` with `pickOne` and focus to the group, `creditPreview.label`, `offerChanged.line` after a `409`, `failed.done`, in the same folder.
- [ ] T097 {U2-U5} [P] [US4] Component tests: dead end (`deadEnd.*`), Pro panel (price, renewal, trial only for a cook with no trial, both billing periods shown and neither chosen, "Not now" same size as "Upgrade to Pro", no countdowns), and the no-paid-plan variant with one Close button, in the same folder.
- [ ] T098 {U6} [P] [US6] Component tests: open source uses the existing visibility keys and shows nothing about rewriting, in the same folder.
- [ ] T099 {U2-U5} [P] [US1] Component tests: success states and the two links between the private and public recipe, and the later "Share a public version" action, in the same folder.
- [ ] T100 {U1} [P] Unit tests: the statechart reducer, every offer and job state through an exhaustive switch, and the hook's polling stop on terminal states, in `FR/import/choice/__tests__/importChoiceMachine.test.ts`.
- [ ] T101 {U0b} [P] Unit test: client hooks call the generated contract and declare no wire type (DD15), in `packages/clients/recipe-service-client/src/__tests__/publicVersionHooks.test.ts`.

### Playwright and Maestro (write first, red)

- [ ] T102 {U2-U5} [US1] Playwright spec: paste a blog page, choose For everyone, review, publish; and Both, in `packages/apps/commise/web/tests/e2e/publicVersion.spec.ts` (`getByRole` and `getByLabel` only).
- [ ] T103 {U2-U5} [US2] Playwright spec: Just for me; paid held back; paid allowed (enabled once the page evidence carries the paid facts), in the same spec folder.
- [ ] T104 {U2-U5} [US3] Playwright spec: writer failure, budget spent, opt-out, later route from the recipe menu.
- [ ] T105 {U2-U5} [US4] Playwright spec: dead end with the switch on and off, Upgrade opens checkout with neither period chosen, Not now ends the import.
- [ ] T106 {U4-U6} [US5] Playwright spec: pasting the private steps into the public version is refused; a reader sees credit and licence; report hides the version.
- [ ] T107 {U2-U5} [P] [US1] Maestro flows for US1 to US5 under `packages/apps/commise/mobile/.maestro/recipes/publicVersion*.yaml` (anchor with `above:` where Back collides).

### Implementation

- [ ] T108 {U0b} Add hooks `usePublicVersionJob`, `useStartPublicVersion`, `usePublishPublicVersion`, `useCancelPublicVersionJob` to `packages/clients/recipe-service-client/src/hooks.ts` source modules (derive types from `@kitchensink/schema-recipe`).
- [ ] T109 {U2} Add the strings under `importMessages.choice.*` and the `done.*`, `later.action` and `publicPage.*` keys, in every shipped locale. Run the banned-word guard.
- [ ] T110 {U1} Implement `FR/import/choice/importChoiceMachine.ts` and `useImportChoice.ts` (orchestration, no JSX).
- [ ] T111 {U2-U5} [P] Implement the render components (pure `props to JSX`, one responsibility each, Tamagui only on native) web and `.native.tsx` pairs: choice, writing, review, flags, blocked, failed, budget, publicExists, privateOnly, dead end, Pro panel, success. Each in `FR/import/choice/`.
- [ ] T112 {U7} Wire the choice step at the end of the import review on web (`FR/import/`) and mobile, behind the per-market switch; keep the existing private-only behaviour when the switch is off.
- [ ] T113 {U6} Add the public-page credit, licence and "Report a problem" to the recipe detail on both platforms; never show `editor.source.rightsLabel` for a public version. Add "See the public version" and "See my copy".
- [ ] T114 {U6} Add the later "Share a public version" action to the recipe menu on both platforms. Show it when the viewer is the owner, the recipe is private and `hasSourceRecord` is true (FR-092). On tap, `usePublicVersionOffer(recipeId, { enabled: false })` runs with `staleTime` 0 and the offer decides the next screen.
- [ ] T115 {U7} Open Pro's checkout as a modal from the dead end, both periods visible and neither chosen (needs the 010 amendment in Phase 8).
- [ ] T116 {U7} Regenerate component docs (`npm run docs:generate --workspace=packages/tools/docgen-components`) after the JSDoc and `@pattern` tags.
- [ ] T117 {L1} `staff-ux-engineer` EVALUATE (opus): parity audit against its SPECIFY on both platforms, 320 CSS px with no horizontal scroll, largest text size.
- [ ] T148 {U6} [P] [US3] Component tests (fail first): the menu item shows only for the owner of a private recipe with `hasSourceRecord` true, and is absent otherwise; one case per offer kind after the tap (`choice`, each `privateOnly` reason, `publicExists`, `publicOnly`, `deadEnd`); `usePublicVersionOffer` is disabled until the tap and uses `staleTime` 0; in `FR/recipes/detail/__tests__/sharePublicVersionMenu.test.tsx`.
- [ ] T149 {U6} [US3] Playwright spec (web) and Maestro flow (mobile): open the menu on a private copy with a source record, tap "Share a public version", see the offer; the item is absent on a recipe with no source record.

### Paste screens, web ("C2")

**Purpose**: the web paste screens of `docs/design/pasteImport/spec.md`. Web only for now: the mobile chooser row stays hidden until the mobile paste PR (owner exception), so no Maestro flow for these. Depends on Phase 6. The BLUEPRINT finalises files.

- [ ] T118 {C2b} [P] Component tests: add-a-recipe chooser, paste screen (every state and refusal), pick one, already saved with Replace and its confirm step, one-recipe review with needs list and statement block, success and held-from-public, in `FR/import/paste/__tests__/`.
- [ ] T119 {C2a} [P] Unit tests: `classifyPaste` use by the orchestration, the reducer for the paste flow, in `FR/import/paste/__tests__/`.
- [ ] T120 {C2b} Playwright spec: paste a page, review, save; several recipes then pick one; already saved (new copy, and replace); too large; no recipe found; "I wrote this" over a detected source is not offered Public, in `packages/apps/commise/web/tests/e2e/pasteImport.spec.ts`.
- [ ] T121 {C2b} Web privacy test: a broken JSON-LD marker string appears in no error event, breadcrumb or console call, in `packages/apps/commise/web/tests/pasteImportPrivacy.test.ts`.
- [ ] T122 {C2a} Implement the paste orchestration and render components in `FR/import/paste/` and the web route wiring; the mobile row stays hidden behind the existing switch.

## Phase 8: Amendments, release and polish

**Purpose**: owed amendments, final checks and cleanup. No new features.

- [x] T123 {D0} Amend `specs/010-subscriptions/` (US6 scenario 2 and FR-042c) for the dead-end screen only. Done in this PR; see 003B FR-074. Do not restate the ADR-0093 amendments.
- [ ] T124 {D0} Update `docs/design/pasteImport/spec.md` D8 line only if the ADR sweep did not already; check with `git grep`.
- [ ] T125 {L1} Turn the per-market switch on in every market at launch (ADR-0093 §6a) and check there is no other door (`git grep` for test overrides).
- [ ] T126 {L1} Run `quickstart.md` steps 1 to 10 on web, Android and iOS, and update the file if a step has changed.
- [ ] T127 {L1} Confirm success criteria SC-001 to SC-006 are measured: the audit (SC-001), the source-record check (SC-002, SC-003), the 30-second ready time (SC-004), the accessibility run (SC-005), and the pool counter (SC-006).
- [ ] T128 {L1} Run `staff-architect` REVIEW and `code-reviewer` (opus) over the diff, then `staff-code-quality` GATE once when the PR is ready (not before).
- [ ] T129 {L1} Run `npm run e2e:plan -- --base origin/main` and the impacted web and mobile suites. Report which tiers ran and which did not.
- [ ] T130 {L1} Cleanup: stop every process started (dev servers, local stack, emulators, orphaned vitest workers), delete scratch files, renders and build output, remove the worktree and branch of merged work.
- [ ] T150 {L2} When spec 016's age assurance ships: switch the Publish gate to 016's assurance, bring back the `under16` offer reason, and remove the interim exception to `016-FR-009` (003B FR-016, C-17, Conflicts and Amendments, and the pointer in spec 016 FR-009). Integration test first.

## Dependencies and order

- Phase 0 gates everything. Phase 1 gates 3, 4 and 5. Phase 2 gates 3 and 4. Phases 3 and 4 can overlap after 1 and 2
  (the worker needs the job table and the call site, the service needs the engine).
- Phase 5 needs Phase 4 and can overlap Phase 6. 003B cannot launch until Phase 5 is done.
- Phase 6 needs PR #301 and the source-page key from Phases 2 and 3. Phase 7 needs the contract from Phases 3 and 6.
- Within each phase the failing tests come before the code they cover.

## Parallel examples

- Phase 1: all the `[P]` unit-test tasks run at once, then the module implementations in dependency order
  (`wordShingles`, `factsSheet`, then `factCheck`, then `rewriteSteps`).
- Phase 3: the `[P]` unit tests and `[P]` integration tests at once, then the classifier, the job DAL and the title
  builder in parallel, then the service and the controller.
- Phase 7: the component tests for each state at once, and each web and `.native` pair together.

## Implementation strategy

- **MVP**: US1 and US2 (the two P1 stories) through the whole chain with the switch on for the local stage only:
  Phases 0 to 5, the US1 and US2 parts of Phases 3 and 7. Then US3, US4, US5 (P2), then US6 and US7 (P3).
- Land the engine first and alone (Phase 1) so 027 can use it. Land each phase as its own commit set on the open branch.
- Report the tiers that ran, honestly. A green unit suite without the integration, LOCAL e2e and UI tiers is not "done".
