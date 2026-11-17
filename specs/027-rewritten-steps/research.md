# Research: Flow Steps

Phase 0 for `plan.md`. Each item: decision, rationale, alternatives rejected.

## R1. Writer input is a facts sheet for every recipe

- **Decision**: `FactsSheet` = ordered steps, each with `actions` (closed verb lexicon), `amounts`, `temperatures`,
  `durations`, `ingredients` (names from the recipe's ingredient lines found in the step), `equipment` (closed list),
  `safety` (FR-041 categories, carried as a category plus its facts, not its words). Plus the ingredient-line names and
  the recipe language. Built by code. Never stored.
- **Rationale**: spec FR-035. A cook's source statement is a claim and can be wrong. One input type gives one pinned
  prompt signature and one evaluation path (same discipline as 004-FR-057 and ADR-0026's `buildParsePrompt`).
- **Rejected**: wording for "Written by you" recipes (two prompts, two evaluations, trusts a cook-supplied label);
  LLM fact extraction (a model reading the wording defeats the rule and is a second unchecked model).

## R2. Fact check: two-way multiset across the whole recipe

- **Decision**: extract the same categories from the result with the same extractor. Compare per category as
  multisets over the whole recipe (steps may merge, split or reorder). Normalise before comparing: amounts to
  canonical quantity + unit, temperatures to °C integer with the stated scale kept, durations to seconds ranges,
  ingredient names by the recipe's own ingredient-line names. Any missing or extra element fails.
- **Rationale**: FR-040. 008-FR-034a forbids steps gaining amounts from the list, so "nothing added" is as binding
  as "nothing dropped". Durations feed Cooking Mode timers (008-FR-034). Research CK-006 names dropped and changed
  amounts as the trust failure.
- **Rejected**: per-step alignment (rejects legitimate merges). An LLM judge (non-deterministic, costs pool spend,
  and a judge that sees both texts sees the wording).

## R3. Wording check is a ceiling, on a hashed fingerprint of word 5-shingles

- **Decision**: lower-cased, punctuation-stripped word 5-shingles, reduced to a fingerprint: a versioned set of keyed
  hashes (`fingerprint(text, size, hash) → { formatVersion, hashes }`, where `hash` is an injected keyed hash). The measure
  takes fingerprint sets, not text: `jaccard(a, b)` for the whole recipe and `containment(part, whole)` for one result
  sentence. Refuse when either exceeds a
  threshold set from the evaluation set (start point for the bake-off: whole 0.10, per sentence 0.30. To be measured,
  not shipped as guessed). This feature fingerprints the saved steps in memory. Spec 003B stores the fingerprint of
  an import's steps, because it keeps no source text, and runs the same functions on every save.
- **Rationale**: FR-042. Same measure ADR-0074 §6 uses to confirm a 020 match, so one function serves 027's check,
  003B's stored check and 020's copy check (`wordShingles.ts`), while each feature owns its threshold
  (staff-architect). A hash cannot be recomputed later, so the format version and the key version are stored with it.
- **Rejected**: reusing 020's corpus lookup (one-to-many through an index. This is one-to-one). Embeddings (opaque,
  extra model).

## R4. Writer model

- **Decision**: Bedrock, non-Anthropic only. Bake-off candidates: Amazon Nova 2 Lite (default. Already the parse
  leg's settled model and priced near $0.003 per ~1,750-in/900-out call per ADR-0024 §6), Nova 2 Pro, Meta Llama on
  Bedrock, Mistral on Bedrock, OpenAI gpt-oss on Bedrock. Metric: share of evaluation recipes passing FR-040 and
  FR-042 (SC-002 ≥ 90%), then human-rated clarity. Explicit `maxTokens`, hard input cap (ADR-0024 preconditions).
- **Rationale**: FR-036; ADR-0024 layer 4b (only Bedrock is under the one grant).
- **Rejected**: cook's own keys (FR-036, C-6). Self-hosted open models (no GPU estate. Reopen if Bedrock lacks a
  passing model).

## R5. Content digest

- **Decision**: SHA-256 over a canonical JSON of `{ v: 1, lang, steps: string[] (trimmed, empty dropped per
008-FR-033a), ingredients: string[] (display text in order) }`, computed from the server row only (DD26). Stored
  hex. `engine_version` (model id + prompt SHA) recorded, not part of validity.
- **Rationale**: FR-020, FR-025. Steps name ingredients, so an ingredient rename must stale the version (C-14). A
  model upgrade must not silently invalidate paid versions (staff-architect).
- **Rejected**: steps only (stale names). Including servings (steps never scale, 008-FR-034a). Including engine
  version in validity.

## R6. One attached version per recipe

- **Decision**: `unique(recipe_id)`. Regenerate overwrites.
- **Rationale**: C-15. The view only ever needs the current row. Flip to `unique(recipe_id, content_digest)` if the
  owner wants history.

## R7. Replace always records a version

- **Decision**: eligibility requires `firstPublishedAt IS NOT NULL` (saved as a recipe once). Replace goes through
  `RecipesService.update` with `expectedVersion`, and the service checks `computeDigest(current) == row.digest`.
- **Rationale**: staff-architect found `recordsVersion` false for never-published drafts, so "restore from history"
  would be false there. Requiring a published recipe keeps one restore mechanism (ADR-0058) and adds no column.
- **Rejected**: storing the replaced steps beside the version (second history). Allowing drafts (no undo).

## R8. Charging a use

- **Decision**: reserve-then-settle on the use ledger, mirroring ADR-0024. At request time, inside the per-user
  advisory lock that also enforces the 3-pending cap, hold one use per pending job: eligibility is "uses left minus
  held uses ≥ 1". Settle the hold to a charge when the job reaches `ready`, in the transaction that writes the
  version, keyed on job id (unique). Release it on `checkRefused`, `budgetSpent` or `failed`. Nothing else charges.
  The pool is reserved and settled regardless (spend is real).
- **Rationale**: FR-050, C-5, FR-023 (two devices → one job → one charge). Without the hold, a cook with one use
  left could start three jobs and be charged three times.
- **Dependency**: 005-FR-015a ledger is unbuilt. 027 does not build a second ledger. Build order step 0.

## R9. Spend and failure semantics

- **Decision**: new member `step-rewrite-cook` in `SPEND_CALL_SITES`, under the verification role. Ceiling denial →
  full refund, job `budgetSpent`, message acked (never redelivered). Unreadable counter or transport error →
  transient, redelivered via queue, `maxReceiveCount` then DLQ. Job older than 10 minutes → `failed`.
- **Rationale**: FR-051, FR-052, FR-064. Same shape as 004-FR-059.

## R10. Offline

- **Decision**: the status response for a recipe is cached with the recipe in 019's store. A `ready` + fresh version
  is usable offline. No mutation is queued offline (FR-063). Controls show `state.offline`.
- **Rationale**: an outbox for a paid generation can charge the cook cannot see; DD26's outbox is for the editor.

## R11. Place mapping in Cooking Mode

- **Decision**: the writer's answer carries, for each result step, the source step indexes it covers
  (`covers: number[]`, validated: every source step with text covered at least once, indexes in range). Switching
  maps the current step to the first step whose `covers` contains it.
- **Rationale**: FR-012. Indexes only, no text, so it stays inside FR-035/FR-046.

## R12. Caps

- **Decision (to confirm on the evaluation set)**: input ≤ 60 steps and ≤ 24,000 UTF-8 bytes of steps + ingredient
  lines. Output ≤ 80 steps; `maxTokens` sized from the cap. Over cap → refused before reservation (FR-004).
