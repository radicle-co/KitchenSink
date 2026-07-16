# Code Review: 001-commise-recipe-app (Phase 6B)

> Feature: 001-commise-recipe-app | Date: 2026-07-16
> Base: `ed917db` (branch point) → HEAD `139ccf1` | Reviewed: the Phase-6 implementation
> Method: 4 parallel adversarial reviewers (security, correctness, architecture/maintainability, test mutation-resistance)
> Status: **APPROVED WITH FIXES** — 0 CRITICAL, 0 HIGH; all confirmed MEDIUM/LOW findings fixed (see resolution column)

## Summary

| Dimension | CRITICAL | HIGH | MEDIUM | LOW | Total |
|-----------|:--------:|:----:|:------:|:---:|:-----:|
| Security | 0 | 0 | 0 | 1 | 1 |
| Correctness | 0 | 0 | 0 | 1 | 1 |
| Architecture | 0 | 0 | 3 | 1 | 4 |
| Tests | 0 | 0 | 0 | 0 | 0 |
| Doc↔Code | 0 | 0 | 0 | 0 | 0 |
| **Total** | **0** | **0** | **3** | **3** | **6** |

> **Machine gates:** typecheck PASS (all 8 packages) · lint PASS (all 8, incl. oxlint via commit hook) · coverage PASS (pyramid satisfied — thousands of unit vs ~130 integration vs handful e2e) · **SCA: tooling-unavailable** (`osv-scanner` not installed; new deps `sharp@^0.34.5` + `@aws-sdk/client-sqs@^3.935.0` unscanned locally — both well-maintained, low expected risk; scan in CI before deploy).

**Recommendation: PROCEED TO VERIFY (Phase 7).** No blocking findings. The confirmed MEDIUM cleanups and LOW bugs are fixed; the one accepted LOW is DAMP-tolerant.

## Positive highlights (verified by trace, not asserted)

- **GDPR erasure owner-scoping is airtight** — `ownerId` comes only from the verified token (`@OwnerId()` → `req.principal.userId`); the `whitelist` ValidationPipe strips any body `ownerId`. No cross-user erasure path. Worker validates a non-empty owner before any delete; `ownerMediaPrefix` trailing slash prevents prefix-widening.
- **Ratings IDOR boundary is exemplary** — unseeable recipe → same 404 as missing (no existence leak), own-recipe → 403 only after the visibility check; the "who may rate" predicate reuses the read path's `isRecipeViewableBy` so it can't drift from "who may read".
- **The test suite is genuinely mutation-resistant** — the dedicated reviewer could not manufacture material findings; each load-bearing test kills a named mutation (SQL-rendered erasure predicates, cross-system archive timeline, a real two-connection `FOR UPDATE` race gated on a `pg_stat_activity` lock-wait barrier, SQLSTATE-23505 index arbitration, two-user throttle isolation, null-vs-absent 3-state at DTO+DAL, observable-cache invalidation probes).
- **Home widget contract** — the `live | placeholder` discriminated union with inverse-capability gating makes illegal states (two tiles per capability, a placeholder that waits on nothing) unrepresentable and self-supersedes with no coordinated edit. Staff-level modelling.
- **Erasure durability model** — "the row is the authority, the message is derived" applied consistently across all worker handlers; the give-up/`failed` transition deliberately localized to the sweeper. Deep modules, coherent seams.
- All SQL parameterized (no injection sink); photo keys server-generated + magic-byte validated; rate-limit key is the unforgeable verified ULID (X-Forwarded-For deliberately rejected); no SSRF.

## Findings

### REV-001 (MEDIUM · Architecture · DRY/containment) — photo original key not composed from the shared scheme
`photos.service.ts` built the original photo key from a local `recipes/{ownerId}/…` hardcode instead of `ownerMediaPrefix()`, making its GDPR-erasure containment a coincidental string-match rather than structural (verticals-8 class). Flagged by security *and* architecture reviewers. **Resolution: FIXED** — key composed from a shared `recipe-core` helper; containment test extended to pin the photo key under `ownerMediaPrefix`.

### REV-002 (MEDIUM · Architecture · DRY) — EMF metric envelope hand-rolled 4×
Four worker handlers each rebuilt the identical CloudWatch EMF envelope. **Resolution: FIXED** — extracted `emitMetric()` in `recipe-workers/src/common`; all four delegate; emitted JSON byte-identical (pinned by test).

### REV-003 (MEDIUM · Architecture · consistency) — IngredientsController diverged from the house convention
Alone used `@Req()` + hand-rolled body validation vs the `@OwnerId()` + class-validator DTO + `ValidationPipe` used by recipes/ratings/account. **Resolution: FIXED** — brought onto the shared convention, same validation semantics + contract preserved.

### REV-004 (LOW · Correctness bug) — stale rating-write error leaks across recipe navigation (web/mobile)
The detail container isn't remounted per recipe id; the id-change reset cleared `ratingOverride` but not the `useMutation` error/pending, so a failed rating on recipe A showed a false error on recipe B. **Resolution: FIXED** — reset the rating mutations on id change, both platforms; pinned by a red→green test.

### REV-005 (LOW · Security hardening) — ingredient `resolve` could re-point an already-resolved shared-catalog ingredient
The `ingredients` catalog is intentionally ownerless (R5), but `resolve` let one user overwrite another's resolution (data-integrity, not IDOR). **Resolution: FIXED** — `resolve` is now converge-only (an already-RESOLVED ingredient is a no-op returning the existing resolution).

### REV-006 (LOW · Architecture · DAMP) — `makeRecipe` fixture duplicated across web/mobile/features
The client package ships a canonical wire-contract fixture; test dirs re-implement it. **Resolution: ACCEPTED (acknowledged)** — the reviewer explicitly rated this DAMP-tolerant and "not a violation to gate on"; over-DRYing test fixtures is its own smell. Left as-is; consolidate opportunistically.

## Residual risks (recorded, not blocking)

- **Throttle store is in-memory** — the per-user *key* is correct, but each Fargate task holds its own counter, so the effective per-user cap is ×(task count). Fine as abuse-dampening; if throttling must be a hard security control, move to a shared store (Redis/ElastiCache). *(Pre-existing infra choice; carried to release-readiness.)*
- **Non-prod dev-auth bypass** (`RECIPE_DEV_AUTH_USER_ID`, gated on `NODE_ENV !== 'production'`) is safe by deployment discipline — must stay out of every deployed task definition.
- **Erasure clone-detach bumps a non-requesting user's `updated_at`** — arguably correct (the recipe lost its provenance); confirm the recipe-list sort doesn't key on recency in a surprising way.
- **Orphan-sweeper 24h window** assumes the archive worker never holds a pre-erasure recipe read across a >60s invocation; re-derive the window if the worker's ceiling rises.
- **SCA not run locally** — run `osv-scanner --recursive .` in CI before deploy (covers `sharp` + `@aws-sdk/client-sqs`).

## Suggested canonical-spec updates (Theme G)

None — no doc↔code drift found; the contracts were reconciled to shipped reality during CR-001.

## Review checklist

- [x] All CRITICAL findings addressed — none found
- [x] All HIGH findings addressed — none found
- [x] Confirmed MEDIUM findings fixed (REV-001, REV-002, REV-003)
- [x] Confirmed LOW bugs/hardening fixed (REV-004, REV-005); REV-006 accepted (DAMP)
- [x] Test coverage adequate + mutation-resistant for Must-Have stories (independently verified)
- [x] No security vulnerabilities in new code (0 CRITICAL/HIGH; boundaries traced)
