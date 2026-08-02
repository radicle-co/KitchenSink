# Spec Sweep — Features 007–014 (2026-08-02)

**Scope**: `specs/007-grocery-lists` … `specs/014-notification-service` (320 files, ~78k lines) plus the
cross-feature governance documents that govern them.
**Method**: ground truth was read from shipped `main` (`origin/main` @ `323fa3fc`) and from the in-flight
`004`, `005`, and `006` worktrees (**read-only**), then mechanical detectors were run across all 320 files.
**Related**: [`governance-rules.md`](./governance-rules.md), [`v1-launch-plan.md`](./v1-launch-plan.md),
`docs/api-conventions.md` (lands with feature 005)

---

## 1. Owner rulings applied

| #   | Question                                                              | Ruling                                                                                                           |
| --- | --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| 1   | Shipped code serves `/v1/*`; GR-002 mandates `/api/v1/*`. Which wins? | **GR-002 wins.** 007–014 normalized to `/api/v1/*`; the 004/006/shipped divergence recorded as an open conflict. |
| 2   | Renumber FRs to 1-based, or keep numbers and qualify cross-refs?      | **Keep numbers, qualify cross-refs** — matches the 004/005/006 precedent.                                        |
| 3   | How far does the sweep reach?                                         | **007–014 plus the cross-feature governance docs.**                                                              |
| 4   | 013 had no FRs; 012/010 cited undefined ones. Author them?            | **Reconstruct from downstream artifacts, marked DRAFT.** In practice nothing had to be invented — see §3.        |

---

## 2. What was fixed

| Class                  | Finding                                                                                                                                                                                                                                   | Volume           |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| **FR collision**       | `007` and `008` both defined **FR-032 and FR-033 with different meanings**, in the same milestone `M3`.                                                                                                                                   | 2 IDs            |
| **FR mis-attribution** | Two abbreviated ranges in `010` cited FRs their named owner does not define: `008 \| FR-032–037` (008 defines only 032–035) and `006 \| FR-020–024` (006 starts at 022).                                                                  | 2 ranges         |
| **GR-003 conformance** | Unqualified cross-feature `FR-NNN` references qualified to `{feature}-FR-{NNN}`.                                                                                                                                                          | 62 refs, 7 files |
| **Lossy spec**         | `012/spec.md` carried 6 coarse groupings that **reused FR-001…FR-006 with different meanings** than its own `product-spec/`; the real 30 requirements lived only in `product-spec/`. Crosswalked; groupings demoted to prose without IDs. | 30 FRs           |
| **Missing FRs**        | `013/spec.md` defined **zero** FRs while 20 IDs were cited across its plan/tasks/v-model. Crosswalked from `product-spec/`, with the 6 Won't-Have IDs kept in Out-of-Scope so citations resolve without implying scope.                   | 20 FRs           |
| **Collapsed ranges**   | `011/spec.md` collapsed `FR-008–010` and `FR-011–012` into range rows, so individually-traced requirements had no individual statement. Enumerated, per the precedent 006 set in PRF-006-14.                                              | 5 FRs            |
| **API prefix**         | Bare `/v1/*` and unprefixed shorthand endpoints normalized to `/api/v1/*`.                                                                                                                                                                | 82 + ~40         |
| **Package paths**      | `packages/api/*` (an **empty leftover** directory, not a workspace root) → `packages/services/<domain>-service`; `packages/shared/src/*` → `packages/shared/<pkg>/src`; `packages/ui` → `packages/apps/commise/ui`.                       | 364 replacements |
| **Package names**      | `@kitchensink/shared-recipe-core` → shipped `@kitchensink/recipe-core`; `@kitchensink/ui` → `@commise/ui`; `-api`/`-ocr` suffixes → `-service`/`-workers` per 005's precedent.                                                            | 8 names          |
| **Stale workspaces**   | Four `codebase-analysis.md` files quoted a **4-entry** root `workspaces` array; the real one has **11**.                                                                                                                                  | 4 files          |
| **False blocker**      | `011/plan.md` claimed the root workspace globs "currently exclude `packages/services/*` and `packages/shared/*`" and that a root `workspaces` update was required. Both are registered; no change is needed.                              | 3 claims         |
| **Auth model**         | `JwtAuthGuard` (never existed) → `AuthMiddleware` + fail-closed `PlanGuard`; `@kitchensink/auth-authorizer` "JWT verification Lambda" → `@kitchensink/clerk-verify`, noting PR #39 removed the authorizer/`x-authorizer-context` path.    | 8 refs           |
| **Test naming**        | 37 `.spec.ts` references retargeted to `docs/CODING_STANDARDS.md` v1.3.0: vitest `.test.ts` (`__tests__/` unit, `tests/*.integration.test.ts`), `.spec.ts` reserved for Playwright under `tests/e2e/`.                                    | 37 paths         |
| **Launch-plan drift**  | §3.8/§3.9 claimed `012`/`013`/`014` have no `plan.md`/`tasks.md`/`review.md`/`verify-report.md`, and §3.3 that `011/verify-report.md` was absent. All exist.                                                                              | 4 claims         |
| **Milestone headers**  | §7 mandates a `## Milestone Assignment` section in every `review.md`. All 8 carried the data in an ad-hoc preamble instead; converted, and the duplicated preamble lines removed.                                                         | 8 files          |

**Verified clean, no action needed**: 0 broken relative links across all 320 files; no NAT/ALB/API-Gateway
infra drift; no Node/NestJS/Next/React version drift.

---

## 3. What was _not_ wrong (corrections to the initial triage)

Recorded because the first pass over-reported these, and the record should be accurate:

- **`011` FR-008…012 were never missing.** They are defined, in range-collapsed table rows. The defect was
  granularity, not absence.
- **`012`/`013` requirements were never missing either.** They were fully authored in each feature's
  `product-spec/` and simply never propagated into `spec.md`. Nothing was invented; the DRAFT-authoring
  latitude in ruling #4 went unused.
- **`010`'s 15 "undefined" FRs were cross-feature references**, not gaps — each sat in a table with an
  adjacent column naming the owning feature.
- **Milestone data was not missing** from the eight `review.md` files, only non-conformant in format.

---

## 4. Open items — deliberately NOT resolved here

1. ⚠️ **API prefix conflict (portfolio-level).** `007`–`014` and `005` now use `/api/v1/*`. Features `004`
   and `006` use `/v1/*`, as do all four shipped services — and 006's `review.md` records an explicit
   owner-of-the-recipe-service ruling (PRF-006-16) for the plain-segment form. **Needs a Director-of-Product
   decision**: migrate the shipped services, or amend GR-002. Migration surface: `docs/api-conventions.md` §6.

2. ⚠️ **`cross-feature-FR-index.md` not updated — hand-off.** Both the `005` and `006` worktrees hold
   uncommitted edits to this file. Editing it here would have caused a three-way conflict. Rows to register
   once they land:
    - `007-grocery-lists/product-spec/product-spec.md` and `research/ux-patterns.md` → `001-FR-045`
    - `010-subscriptions/plan.md` and `research.md` → `001-FR-001…006`, `004-FR-010`, `004-FR-011`,
      `005-FR-016`, `005-FR-019`, `006-FR-022…027`, `007-FR-028…031`, `008-FR-032…035`, `009-FR-038`

3. ⚠️ **GR-009 is contradicted by all 26 shipped packages** and needs ratification — amend the rule to the
   two real scopes (`@kitchensink/{name}`, `@commise/{name}`) or schedule a rename. See GR-009 Current State.

4. **`012` monetization has no testable requirements.** The tip jar, premium recipes, and paid follows have
   narrative scope only; FR IDs must be authored and ratified before that work is planned.

5. **Not created here: `docs/api-conventions.md`.** Feature 005 already authored it (untracked in its
   worktree). GR-002 AC-002-d is satisfied by that file, not by this sweep.

---

## 5. Reproducing the checks

```bash
# every cross-feature FR ref is qualified (expect 0 for all eight features)
node scripts/classify-fr-refs.mjs      # see PR description for the inline script

# no bare /v1/, no unprefixed endpoints except third-party
grep -rIlE '(?<!api)/v1/' specs/00[7-9]-* specs/01[0-4]-*
grep -rhoP '\b(GET|POST|PUT|PATCH|DELETE)\s+`?/(?!api/)[a-z]' specs/00[7-9]-* specs/01[0-4]-*

# no stale package roots
grep -rn 'packages/api/\|packages/shared/src\|@kitchensink/shared-recipe-core' specs/00[7-9]-* specs/01[0-4]-*

# vitest files never use .spec.ts (Playwright under tests/e2e/ may)
grep -rhoE '[A-Za-z0-9._/-]+\.spec\.tsx?' specs/00[7-9]-* specs/01[0-4]-* | grep -v 'tests/e2e/'
```
