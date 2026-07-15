# Implementation Log — 001-commise-recipe-app

Progressive-verification checkpoints for Phase 6 (`progressive_verify_interval: 3`).
Started 2026-07-15 on the resumed Phase 6 run (worktree `.worktrees/001-commise-recipe-app`).

---

## Checkpoint #1 — after T123-test, T126 (C-007 soft-delete backfill)

| Check                             |     Status     | Notes                                                                                                                       |
| --------------------------------- | :------------: | --------------------------------------------------------------------------------------------------------------------------- |
| Task-Code correspondence          |       ✅       | Both files exist at the exact paths tasks.md names; 8 unit + 3 integration tests, all green.                                |
| Spec AC alignment                 | ⚠️ drift found | T123-test's "owner can still see version history" contradicts FR-002. Task text corrected; code left alone (it is correct). |
| Unplanned changes                 |    ✅ None     | Only the two new test files. `recipes.dal.ts` mutated during verification, then restored byte-identical (`git diff` clean). |
| Plan alignment                    |       ✅       | Unit test under `src/**/dal/__tests__/`, integration under `__tests__/integration/**` — matches the configured test tiers.  |
| Dependency / supply-chain (W5-C2) | ✅ None added  | No new packages. `PgDialect` is drizzle-orm, already a direct dependency.                                                   |

**Verdict:** WARNING — drift found and resolved in the ledger; no code change required.

### Evidence

- Unit `436 passed` (43 files) · Integration `53 passed` (19 files) · typecheck exit 0 · `npm run lint` 0 errors.
- Integration ran against real Docker Postgres + LocalStack.

### Findings worth carrying forward

1. **C-007 retention was entirely unpinned (now closed).** No spec at any tier asserted the row survives a
   delete. Verified by mutation: turning `softDelete` into a hard `DELETE FROM recipes` left the
   pre-existing `recipes/crud` spec **green** (it asserts only 204-then-404) while the new T126 fails.
   A regression to a destructive delete would have shipped silently, destroying the retention guarantee
   the GDPR erasure flow depends on.
2. **Task-count error.** `tasks.md:273-275` are Parity-Checklist rubric bullets, not tasks. Every
   `- [ ]` count (incl. the "190 total") has been counting them. Real total is **187**.
3. **Spec drift, code correct.** See Spec AC alignment above — FR-002 says a tombstoned recipe is "no
   longer accessible via normal APIs"; retention ≠ reachability.
4. **Unit tests get NO static analysis (pre-existing, NOT introduced here).** `tsconfig.json` excludes
   `src/**/__tests__` + `src/**/*.test.ts`, and `npm run lint` runs
   `eslint 'src/**/*.ts' --ignore-pattern '**/*.test.ts'`. Vitest transpiles without typechecking, so
   nothing checks them. Typechecking them with the exclusion lifted surfaces ~10 pre-existing errors in
   `versions.service.test.ts`, `load-config.test.ts`, `schema.test.ts`, `auth.middleware.test.ts`.
   Out of scope for this slice; worth its own task.

---

## Checkpoint #2 — after the static-analysis fix + T127/T128/T129/T103 (clone + pull, FR-011)

| Check                             |      Status       | Notes                                                                                                                            |
| --------------------------------- | :---------------: | -------------------------------------------------------------------------------------------------------------------------------- |
| Task-Code correspondence          |        ✅         | 6 tasks flipped (T103, T127-test, T128-test, T127, T128, T129) → **146/187**. Files at the paths tasks.md names.                 |
| Spec AC alignment                 |        ✅         | FR-011 satisfied; the apparent spec/data-model/tasks contradiction resolved (see below), no behavior compromised.                |
| Unplanned changes                 | ✅ None remaining | `collections.service.ts` + `recipes.dal.ts` mutated during verification, each restored byte-identical.                           |
| Plan alignment                    |        ✅         | Zod schema + `parseOrThrow` (the controller's real convention), not the class-DTO the task text names — a documented divergence. |
| Dependency / supply-chain (W5-C2) |   ✅ None added   | No new packages.                                                                                                                 |

**Verdict:** CLEAN — continue.

### Evidence

- Unit **453 passed** (45 files) · Integration **61 passed** (21 files) · typecheck exit 0 · lint exit 0.
- TDD red gate honored: 17 unit tests written first, confirmed failing (`cloneCollection is not a
function`) before any implementation existed.
- Mutation-verified: pointing the clone's read at `source.ownerId` (the private-recipe leak FR-011
  forbids) fails the T103 integration test.

### Findings

1. **Three documents looked contradictory; they are not.** FR-011 says pull removes "recipes the cloner
   can no longer access"; data-model.md §Clone semantics says removed-in-source recipes stay; tasks.md
   says "additive only". They describe **different conditions** — access-revocation vs source curation.
   The access case is already handled continuously by `CollectionsDal.listRecipes`' membership-IDOR
   guard (`visibility = 'public' OR owner_id = viewer`), so a recipe going private leaves the clone on
   the next read. Deleting rows on pull would be irreversible and strictly worse. Write path is
   additive; FR-011 holds at read time.
2. **Contract drift caught pre-merge.** An invented `PullFromSourceResult = { added: number }` did not
   match `api.openapi.yaml` (`PullFromSourceResponse` requires `[collection, addedRecipeIds]`). The
   contract won — implementation AND the tests asserting `added` were corrected. The same check
   surfaced `CloneCollectionRequest`'s optional name/description overrides, which are now wired.
3. **The static-analysis fix paid for itself immediately** — it caught
   `collections.controller.test.ts`'s `ServiceMock` (a mapped type over `CollectionsService`) going
   stale the moment the service gained two methods. Previously invisible.
4. **The integration tier caught a test-authoring bug the unit tier could not** — the "never overwrites
   the cloner's manual addition" case seeded the source _before_ cloning, so the row arrived as
   `clone_seed` and the collision was never exercised. It passed while proving nothing.

### Resolved from checkpoint #1

- **Unit tests now have static analysis** (`25a6549`): recipe-service `tsconfig.json` no longer excludes
  `src/**/__tests__`; lint no longer ignores `**/*.test.ts`. 13 hidden type errors fixed, incl. a
  `FakeS3` double that was not assignable to the `VersionArchiveS3` interface it doubles, and a
  `RecipeSnapshot` fixture whose `steps` the zod schema would reject. Proven effective: injecting
  `const x: number = "str"` into a unit test now fails typecheck; before, it reported nothing.
- **Task count fixed at the root** (`a3fe431`): the 3 Parity-Checklist rubric bullets are numbered, not
  checkboxes. Raw checkbox count now equals real task count (**187**). The old "190" was two cancelling
  errors — rubric over-count +3, per-phase drift −3.
- **Stale DRIFT-007 note corrected** (`a3fe431`) — the Home host shipped; run #3's counts preserved as
  historical record.

### Still open (needs a decision, other features' services)

- **identity**: same tsconfig/lint exclusion. Enabling it surfaces exactly one error —
  `src/database/migrations/__tests__/0005_identity_reset.test.ts` imports `@testcontainers/postgresql`,
  which is **not installed anywhere**. That file matches **no vitest include glob** (identity globs
  `tests/**`), so it has never run and cannot run, against a tool this repo deliberately left for
  LocalStack + Docker Postgres. Coverage theater — delete or port, then enable.
- **food-service**: same exclusion, **0 errors** — the change is free there.
- **`seed.ts` lint warnings**: 2 unused `no-console` disable directives. `eslint --fix` removes them but
  leaves whitespace-only lines, so they are intentionally left alone (warnings, exit 0).

### Local harness note

Port 5432 was held by the running `kitchensink-e2e-postgres` container carrying live local dev state
(`kitchensink_recipes` with 6 seeded recipes, `kitchensink_identity`, `food_e2e`). The vitest global
setup **drops and recreates the `public` schema**, so pointing it there would have destroyed that state.
Integration runs instead against a dedicated throwaway DB in the same container:
`DATABASE_URL=postgresql://postgres:postgres@localhost:5432/kitchensink_recipes_it`.
