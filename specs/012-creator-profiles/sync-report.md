# Sync-Verify Report: 012-creator-profiles

**Generated**: 2026-06-02  
**Worktree**: `<repo root>`  
**Scope**: Pre-implementation 7-layer scan (L1–L4, L6, L7; L5 skipped)  
**Mode**: READ-ONLY — no code changes  

---

## Executive Summary

| Layer | Direction | Status | Key Finding |
|-------|-----------|--------|-------------|
| L1 | research ↔ product-spec | ✅ PASS | Personas, problems, and competitive analysis align with Must Have stories. |
| L2 | product-spec ↔ spec.md | ❌ CRITICAL | `spec.md` only defines 6 high-level FRs; `product-spec` has 30 FRs. Detail loss on Must Have requirements. |
| L3 | spec.md ↔ plan.md | ⚠️ WARNING | `plan.md` references 30 FRs from product-spec/V-model against `spec.md`'s 6 FRs. Forward drift. |
| L4 | plan.md ↔ tasks.md | ✅ PASS | 60 tasks across 7 phases map to plan phases and cover all 6 Must Have stories. |
| L5 | tasks.md ↔ code | ⏭️ SKIP | Per instructions. |
| L6 | code ↔ spec.md | ℹ️ INFO | No implementation exists yet. Missing-impl is expected for pre-implementation. |
| L7 | spec.md ↔ research.md | ✅ PASS | Full circuit: vision, personas, and monetization delegation align end-to-end. |

**Overall Gate**: ❌ **BLOCKED** — L2 CRITICAL prevents clean traceability chain. L3 WARNING compounds the drift.

---

## L1 — research ↔ product-spec (Backwards)

**Status**: ✅ PASS

### Evidence

- **Personas**: `research.md` defines P11 Robin, P5 Morgan, P9 Drew. `product-spec/product-spec.md` assigns these personas to Must Have (`US-001..US-006`) and Should Have (`US-007..US-011`) stories. Alignment is 1:1.
- **Problem statement**: `research.md` §1: "users who create recipes have no public identity" → `product-spec` §1 Vision: "giving every user the option to become a public creator with a profile page."
- **Competitive landscape**: `research.md` §3 maps Substack / Patreon / Instagram profile features → `product-spec` FRs cover identical surface area (handle, follow, collections, embed, analytics).
- **Monetization delegation**: Both documents consistently defer billing mechanics to feature 010.

---

## L2 — product-spec ↔ spec.md (Forwards; CRITICAL if Must Have missing)

**Status**: ❌ CRITICAL

### Evidence

- `product-spec/product-spec.md` enumerates **30 FRs** (`FR-001..FR-030`) across Profile Creation, Public Profile URL & Discovery, Recipe Attribution, Follow/Subscribe, Content Publishing, Embed Widget, Analytics, Moderation, and NFRs.
- `spec.md` defines only **6 high-level FRs** (`FR-001..FR-006`):
  - `FR-001` — @handle Profile Pages
  - `FR-002` — Follow / Unfollow
  - `FR-003` — Public Collections
  - `FR-004` — Embed Widgets
  - `FR-005` — Basic Creator Analytics
  - `FR-006` — Monetization Surface (extends 010)

### Missing Must Have Detail in spec.md

| product-spec FR | Must Have Story | Concern in spec.md |
|-------------------|-----------------|-------------------|
| `FR-003` (handle uniqueness <100ms) | US-001 | Covered under `FR-001` generically; latency requirement not explicit. |
| `FR-005` (handle change cooldown 30d/14d) | US-001 | Not mentioned in `FR-001`. |
| `FR-007` (SSR with `<title>`, `<meta>`, OG tags) | US-004 | Not in spec.md FRs. |
| `FR-008` (public profile page display rules) | US-004 | Not in spec.md FRs. |
| `FR-009` (follower lists NOT public) | US-003/US-004 | Not in spec.md FRs. |
| `FR-013` (idempotent follow/unfollow) | US-003 | Covered under `FR-002` at high level. |
| `FR-015` (counter consistency ≤5s) | US-003 | Not in spec.md FRs. |
| `FR-017`–`FR-019` (collection limits, ordering, constraints) | US-002 | Not in spec.md FRs. |
| `FR-023`–`FR-025` (analytics aggregation, scheduler, snapshots) | US-006 | Covered under `FR-005` at high level. |

### spec.md Acknowledges Drift

`spec.md` §33–36 includes an explicit source-of-truth note:

> "The detailed FR enumeration currently used by `plan.md`, `tasks.md`, and `v-model/` is carried in `product-spec/product-spec.md` pending revalidation or a formal crosswalk into this spec."

This confirms the gap is known but unresolved.

**Impact**: Any forward traceability from `spec.md` to downstream artifacts is incomplete for Must Have requirements. Verification must rely on `product-spec` as the de facto authoritative FR source until crosswalk is completed.

---

## L3 — spec.md ↔ plan.md (Forwards)

**Status**: ⚠️ WARNING

### Evidence

- `plan.md` §26 states it addresses Must Have stories `US-001..US-006`.
- `plan.md` §24 and §88–93 describe schema additions and implementation scope that assume the full 30-FR product-spec baseline (e.g., "handle cooldown/reservation checks", "SEO metadata builder", "suspension and moderation state").
- `plan.md` architecture summary references `SYS-001..SYS-011` from `v-model/system-design.md`, which in turn map to `REQ-001..REQ-018` from `v-model/requirements.md`, which trace to the full 30 FRs.

### Drift Detail

- `spec.md` has no `FR-007` (SSR metadata), yet `plan.md` Phase 4 and tasks `T020`, `T028` explicitly build SSR/metadata surfaces.
- `spec.md` has no `FR-020` (moderation/suspension), yet `plan.md` Phase 5 and tasks `T018`, `T027`, `T037` implement moderation workflows.

**Impact**: `plan.md` is richer than `spec.md`. This is acceptable if `product-spec` is treated as the authoritative upstream, but it violates the expectation that `spec.md` is the canonical feature specification.

---

## L4 — plan.md ↔ tasks.md (Forwards)

**Status**: ✅ PASS

### Evidence

- **Task count**: 60 tasks (`T001..T060`), all unchecked (expected for pre-impl).
- **Phase alignment**: `tasks.md` phases 1–7 map 1:1 to `plan.md` phases 1–7.
- **Must Have coverage**:
  - `US-001` (claim handle): `T002`, `T007`, `T012`, `T015`
  - `US-002` (collections): `T009`, `T010`, `T021`, `T022`, `T023`
  - `US-003` (follow): `T008`, `T024`, `T025`, `T026`
  - `US-004` (browse public profile): `T019`, `T020`, `T028`
  - `US-005` (embed widget): `T029`, `T030`
  - `US-006` (analytics): `T011`, `T035`, `T036`, `T038`

- **Dependency graph**: `tasks.md` dependency chains (`T001 → T002 → T003...`) are internally consistent and match `plan.md` sequencing.

---

## L5 — tasks.md ↔ code

**Status**: ⏭️ **SKIPPED** (per run instructions)

---

## L6 — code ↔ spec.md (Backwards from code)

**Status**: ℹ️ INFO

### Evidence

- **No implementation files found** for planned creator-profiles modules.
- `packages/services/creator-profiles-service` does **not** exist in the worktree.
- No `creator_profiles`, `creator_follows`, `creator_collections` schema files exist outside spec artifacts.
- `glob("**/*creator*")` returned zero implementation matches.

**Assessment**: Missing implementation is expected for a pre-implementation planning scan. This is an informational observation, not a defect.

---

## L7 — spec.md ↔ research.md (Full Circuit)

**Status**: ✅ PASS

### Evidence

| research.md Element | spec.md Coverage | Match |
|--------------------|------------------|-------|
| P11 Robin needs shareable `/@handle` URL | `FR-001` — @handle Profile Pages | ✅ |
| P5 Morgan needs profile browsing without login | `FR-001` — unauthenticated visitors can view public content | ✅ |
| P9 Drew needs embed widget for restaurant site | `FR-004` — Embed Widgets | ✅ |
| Problem: "no public identity" / "recipes in isolation" | Vision: "public identity on KitchenSink" | ✅ |
| Monetization tip jar delegated to 010 | `FR-006` — Monetization Surface (extends 010) | ✅ |
| Verified badge deferred / internal ops | Out of Scope | ✅ |

---

## Cross-Cutting Findings

### Governance Compliance

| Rule | Status | Evidence |
|------|--------|----------|
| GR-002 API URL Prefix Standard | ✅ PASS | `spec.md` §67: "All endpoints under `/api/v1/`"; `tasks.md` `T005`, `T015`, `T019`, etc. all use `/api/v1/*`. |
| GR-007 Shared Type Library Ownership | ✅ PASS | `tasks.md` `T004` requires imports from `@kitchensink/recipe-core` and forbids local duplicates. |
| GR-014 Audience and Sharing Model | ✅ PASS | `spec.md` §31 correctly scopes `public-profile` vs `circle` (011) and `published-lesson` (013). |

### Monorepo Path References

- `tasks.md` references `packages/services/creator-profiles-service/*` as a new package path. This does not match the existing workspace list in the root README (`packages/apps/commise/{web,mobile}`, `packages/apps/commise/ui`, `packages/tools/*`), but `T001` explicitly calls for workspace registration, so the path is planned, not stale.
- No bare `apps/X` path references were found in task paths. All paths use `packages/` prefix or are underspecified controller-level references. No INFO flags raised on monorepo path mismatches.

---

## Recommendations

1. **Resolve L2 CRITICAL before implementation**: Complete the formal crosswalk from `product-spec/product-spec.md` FRs (`FR-001..FR-030`) into `spec.md`. Until then, treat `product-spec` as the authoritative FR source.
2. **Address L3 WARNING**: After crosswalk, re-validate that `plan.md` task-to-FR mappings reference `spec.md` FRs and not only `product-spec` FRs.
3. **L6 expected**: No action required. Implementation absence is correct for pre-impl planning.

---

## Appendix: Artifact Inventory

| Artifact | Absolute Path | Status |
|----------|---------------|--------|
| spec.md | `specs/012-creator-profiles/spec.md` | Read |
| product-spec/product-spec.md | `specs/012-creator-profiles/product-spec/product-spec.md` | Read |
| plan.md | `specs/012-creator-profiles/plan.md` | Read |
| tasks.md | `specs/012-creator-profiles/tasks.md` | Read |
| research.md | `specs/012-creator-profiles/research.md` | Read |
| v-model/requirements.md | `specs/012-creator-profiles/v-model/requirements.md` | Read |
| v-model/release-audit-report.md | `specs/012-creator-profiles/v-model/release-audit-report.md` | Read |
| verify-report.md | `specs/012-creator-profiles/verify-report.md` | Read |
