# Spec Sweep — Features 007–014 (2026-08-02)

**Scope**: `specs/007-grocery-lists` … `specs/014-notification-service` (320 files, ~78k lines) plus the
cross-feature governance documents that govern them.
**Method**: ground truth was read from shipped `main` (`origin/main` @ `323fa3fc`) and from the in-flight
`004`, `005`, and `006` worktrees (**read-only**), then mechanical detectors were run across all 320 files.
**Related**: [`governance-rules.md`](./governance-rules.md), [`v1-launch-plan.md`](./v1-launch-plan.md),
`docs/api-conventions.md` (lands with feature 005)

---

## 1. Owner rulings applied

| #   | Question                                                              | Ruling                                                                                                                                                   |
| --- | --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Shipped code serves `/v1/*`; GR-002 mandates `/api/v1/*`. Which wins? | **GR-002 wins, portfolio-wide, no exceptions.** 007–014 normalized here; 004 and 006 correcting in their own branches; `main` being migrated separately. |
| 2   | Renumber FRs to 1-based, or keep numbers and qualify cross-refs?      | **Keep numbers, qualify cross-refs** — matches the 004/005/006 precedent.                                                                                |
| 3   | How far does the sweep reach?                                         | **007–014 plus the cross-feature governance docs.**                                                                                                      |
| 4   | 013 had no FRs; 012/010 cited undefined ones. Author them?            | **Reconstruct from downstream artifacts, marked DRAFT.** In practice nothing had to be invented — see §3.                                                |

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

## 4. Open items — all closed 2026-08-02

Every item this sweep originally deferred has been addressed. Two closures surfaced new blockers, recorded
below rather than absorbed.

### 4.1 ✅ API prefix — closed

`/api/v1/*` is the portfolio-wide target with **no standing exceptions**. `007`–`014` (this PR) and `005`
are conformant; `004` and `006` are correcting their docs in their own branches; shipped `main` is being
migrated under separate work. All owner direction, 2026-08-02.

Two corrections to how this sweep first framed it:

- It was filed as an **open conflict needing a Director-of-Product decision**. It is not open.
- It cited 006's PRF-006-16 as an **owner-of-the-recipe-service** ruling for the plain-segment form. That
  attribution was wrong: **a feature spec does not own a service.** The recipe service is owned by the
  repository owner, not by feature 006 — so PRF-006-16 was never an ownership-backed exemption from a
  portfolio rule; it is simply superseded.

### 4.2 ✅ `cross-feature-FR-index.md` — closed

Six rows registered, covering the citations that existed downstream but had never been recorded:
`007` → `001-FR-045`; `010` → `001-FR-001…006`, `004-FR-008`, `006-FR-022…024`, `007-FR-028…030`,
`008-FR-032…035`.

**Three of those rows also corrected a mis-cited FR** — the citation named a capability whose ID belongs to
a different requirement, or an abbreviated range spilled past the owner's defined set:

| In `010`'s gating map        | Cited        | Actually         | Why it was wrong                                              |
| ---------------------------- | ------------ | ---------------- | ------------------------------------------------------------- |
| Basic recipe importing (URL) | `004-FR-010` | `004-FR-008`     | `004-FR-010` is _source attribution_; URL import is `FR-008`. |
| Manual meal planning         | `FR-020–024` | `006-FR-022…024` | 006's namespace starts at `FR-022`.                           |
| Cooking mode                 | `FR-032–037` | `008-FR-032…035` | 008 defines only `032–035`; `036–037` are 009's.              |

A verifier now checks **every** qualified `{feature}-FR-{NNN}` in `specs/` against the target feature's
actual `spec.md`. Result: **0 references to a non-existent FR.**

> **Merge note.** `006`'s branch also edits this file (rewrites every registry row to widen the `Status`
> column, flips three rows to `Deferred`, and adds _Status Values_, _Deferral Notes_, and Review Rule 5).
> A conflict on merge is expected. **Resolution: take both** — keep 006's `Deferred` statuses and its three
> new sections, and keep the six rows added here. No row contradicts another.

### 4.3 ✅ GR-009 package naming — closed by amendment

Amended through the documented Governance Amendment Process; `governance-rules.md` **1.0.0 → 2.0.0**
(MAJOR: incompatible redefinition). `@kitchensink/{group}-{name}` was ratified when no packages existed and
none of the 26 shipped packages ever used it. Restated to the two real scopes — `@kitchensink/{name}` for
platform, `@commise/{name}` for the Commise product — with role **suffixes** (`-service`, `-workers`,
`-service-client`) replacing group prefixes, plus a directory mapping. The superseded pattern is preserved
in-section, per "no rule may be silently removed". `cross-feature-consistency-report.md` S-002 amended to
match.

⚠️ **One inconsistency the amendment does not paper over**: `@commise/test-utils` lives in
`packages/tools/test-utils/`, while all seven of its `packages/tools/*` siblings are `@kitchensink/*`.
Either it is mis-scoped or it is a deliberate exception — unresolved here because renaming a published
package is a code change, not a spec change.

### 4.4 ✅ `012` monetization — enumerated, and it exposed a blocker

`012-FR-031` … `012-FR-040` authored as **DRAFT**: tip jar (031–033), premium recipes (034–036), paid
follows (037–039), earnings surface (040).

⚠️ **BLOCKER — the capability they depend on is not specified anywhere.** 012 states that "010 owns the
paywall and revenue split". **It does not.** Feature 010's entire functional scope is `010-FR-040` …
`010-FR-043`: a free/premium **subscriber** tier on Stripe Checkout + Customer Portal, upgrade prompts, and
downgrade retention. There is no one-time payment, per-item purchase, creator-defined tier, revenue split,
or payout surface — its Out-of-Scope section rules out even multi-seat family plans.

**`013` carries the identical unmet dependency**: `013-FR-010` specifies a 20%/80% platform/educator
revenue share "via 010", with course revenue "disbursed via 010's payout model".

Per FR-index Review Rule 3, this is recorded as a **capability-level dependency** rather than resolved by
inventing an FR in 010's namespace. Marketplace payments need their own spec — in 010 or a dedicated
payments feature — including the money-transmission and tax posture that splitting third-party revenue
implies (Stripe Connect, 1099 reporting). Recorded in `010/spec.md` Out of Scope, `013/spec.md` FR-010, and
`v1-launch-plan.md` at both `M6` and `M7`.

### 4.5 ✅ `docs/api-conventions.md` — not needed here

Feature 005 authored it. GR-002 AC-002-d is satisfied by that file.

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
