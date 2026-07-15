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

### Local harness note

Port 5432 was held by the running `kitchensink-e2e-postgres` container carrying live local dev state
(`kitchensink_recipes` with 6 seeded recipes, `kitchensink_identity`, `food_e2e`). The vitest global
setup **drops and recreates the `public` schema**, so pointing it there would have destroyed that state.
Integration runs instead against a dedicated throwaway DB in the same container:
`DATABASE_URL=postgresql://postgres:postgres@localhost:5432/kitchensink_recipes_it`.
