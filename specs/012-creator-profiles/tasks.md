# Tasks: Feature 012 — Public Creator Profiles

**Feature**: `012-creator-profiles`  
**Spec**: [spec.md](./spec.md)  
**Plan**: [plan.md](./plan.md)  
**Product Spec**: [product-spec/product-spec.md](./product-spec/product-spec.md)

---

## US Reference

| ID | Persona | Story | Spec FR |
|----|---------|-------|---------|
| US-001 | P11 Robin | Claim a unique `@handle` | FR-001, FR-002, FR-003, FR-005 |
| US-002 | P11 Robin | Organize recipes into named collections | FR-017, FR-018, FR-019 |
| US-003 | P5 Morgan | Follow/unfollow a creator | FR-013, FR-014, FR-015, FR-016 |
| US-004 | P5 Morgan | Browse a creator's profile without logging in | FR-006, FR-007, FR-008, FR-009, FR-010..FR-012 |
| US-005 | P9 Drew | Embed widget for external website | FR-026, FR-027 |
| US-006 | P11 Robin | View profile views and follower growth | FR-023, FR-024, FR-025 |

---

## Dependency Graph

```text
T-001 -> T-002 -> T-003 -> T-004 -> T-005
T-005 -> T-006 -> T-007 -> T-008 -> T-009 -> T-010
T-007 -> T-011
T-008 -> T-012 -> T-013 -> T-014 -> T-015
T-015 -> T-016 -> T-017
T-017 -> T-018 -> T-019 -> T-020 -> T-021
T-019 -> T-022 -> T-023 -> T-024 -> T-025
T-018 -> T-026
T-022 -> T-026
T-019 -> T-027 -> T-028 -> T-029
T-027 -> T-030 -> T-031
T-029 -> T-032
T-011 -> T-033 -> T-034 -> T-035
T-026 -> T-036 -> T-037
T-030 -> T-038
T-037 -> T-039
T-036 -> T-040
```

---

## US-001 — Claim & Manage @handle

- [ ] **T-001** [P] [US-001] Scaffold `@kitchensink/creator-profiles-service` package with tsconfig, lint, and test wiring aligned to Node 24 + NestJS 11 — `packages/services/creator-profiles-service/package.json`
- [ ] **T-002** [P] [US-001] Register workspace wiring for creator-profiles-api in root package/turbo config — `packages/services/creator-profiles-service/`
- [ ] **T-003** [P] [US-001] Add env schema and config surfaces (DB, S3, cache headers, scheduler cadence) — `packages/services/creator-profiles-service/src/config/`
- [ ] **T-004** [US-001] Wire shared type dependencies to `@kitchensink/recipe-core` and forbid local duplicate core entities — `packages/services/creator-profiles-service/src/domain/`
- [ ] **T-005** [US-001] Add route prefix guardrails enforcing `/api/v1/*` across all 012 endpoints — `packages/services/creator-profiles-service/src/common/guards/`
- [ ] **T-006** [P] [US-001] Create migration for `creator_profiles` table: handle uniqueness, profile metadata, moderation state, lifecycle timestamps — `packages/services/creator-profiles-service/src/db/migrations/`
- [ ] **T-007** [US-001] Add DB constraints/checks for handle format (3–30 chars, lowercase alphanumeric + underscore, no consecutive/leading/trailing underscore) — `packages/services/creator-profiles-service/src/db/migrations/`
- [ ] **T-008** [US-001] Add migration tests validating handle uniqueness and format constraints — `packages/services/creator-profiles-service/src/db/migrations/__tests__/`
- [ ] **T-009** [P] [US-001] Implement `POST /api/v1/creators` handle claim endpoint with auth, validation, and HTTP 409 conflict — `packages/services/creator-profiles-service/src/creators/`
- [ ] **T-010** [US-001] Implement owner profile update (`PUT /api/v1/creators/:handle`) with field bounds and avatar metadata — `packages/services/creator-profiles-service/src/creators/`
- [ ] **T-011** [US-001] Implement handle change cooldown/reservation policy (once per 30 days, previous handle reserved 14 days) — `packages/services/creator-profiles-service/src/creators/policies/`
- [ ] **T-012** [US-001] Implement profile deactivate/suspend-aware lifecycle for public visibility transitions — `packages/services/creator-profiles-service/src/creators/`

## US-004 — Public Profile Browse (SSR + SEO)

- [ ] **T-013** [P] [US-004] Implement public profile read endpoint (`GET /api/v1/creators/:handle`) with strict public payload schema — `packages/services/creator-profiles-service/src/creators/`
- [ ] **T-014** [US-004] Implement profile SEO/canonical metadata builder for SSR consumers — `packages/services/creator-profiles-service/src/creators/seo/`
- [ ] **T-015** [P] [US-004] Implement `/@handle` SSR route with profile API payloads and SEO metadata contract — `packages/apps/commise/src/app/(profile)/[handle]/`
- [ ] **T-016** [US-004] Implement profile page sections: bio, avatar, follower count, public collections, paginated public recipes — `packages/apps/commise/src/app/(profile)/[handle]/`
- [ ] **T-017** [US-004] Add recipe attribution link component linking public recipes back to creator profile — `packages/apps/commise/src/components/creator-attribution/`
- [ ] **T-018** [US-004] Implement profile route accessibility/usability smoke checks (desktop + mobile responsive) — `packages/apps/commise/web/tests/e2e/creator-profile.spec.ts`

## US-002 — Public Collections

- [ ] **T-019** [P] [US-002] Create migration for `creator_collections` with ownership, name/description constraints, and ordering position — `packages/services/creator-profiles-service/src/db/migrations/`
- [ ] **T-020** [US-002] Create migration for `creator_collection_recipes` join table with stable ordering and public-recipe-only membership — `packages/services/creator-profiles-service/src/db/migrations/`
- [ ] **T-021** [P] [US-002] Implement collections list/detail endpoints for public view with ownership/publicity enforcement — `packages/services/creator-profiles-service/src/collections/`
- [ ] **T-022** [US-002] Implement owner collection CRUD endpoints with max 20 collections and 60-char name / 200-char description limits — `packages/services/creator-profiles-service/src/collections/`
- [ ] **T-023** [US-002] Implement collection reordering persistence and deterministic response ordering — `packages/services/creator-profiles-service/src/collections/`
- [ ] **T-024** [US-002] Add collection UI components to profile page with shareable collection URLs — `packages/apps/commise/src/components/creator-collections/`

## US-003 — Follow / Unfollow

- [ ] **T-025** [P] [US-003] Create migration for `creator_follows` with composite PK (`follower_id`, `creator_id`) and follower/following indexes — `packages/services/creator-profiles-service/src/db/migrations/`
- [ ] **T-026** [P] [US-003] Implement follow endpoint (`POST /api/v1/creators/:handle/follow`) with idempotency guarantees — `packages/services/creator-profiles-service/src/follows/`
- [ ] **T-027** [P] [US-003] Implement unfollow endpoint (`DELETE /api/v1/creators/:handle/follow`) with idempotency and counter integrity — `packages/services/creator-profiles-service/src/follows/`
- [ ] **T-028** [P] [US-003] Implement follower/following count projection with ≤5s bounded consistency target — `packages/services/creator-profiles-service/src/follows/projector/`
- [ ] **T-029** [US-003] Implement authenticated follow/unfollow interactions on profile page with optimistic UX and rollback — `packages/apps/commise/src/components/follow-button/`

## US-005 — Embed Widget

- [ ] **T-030** [P] [US-005] Implement embed widget endpoint (`GET /api/v1/creators/:handle/widget`) returning static HTML fragment (no JS) — `packages/services/creator-profiles-service/src/widget/`
- [ ] **T-031** [P] [US-005] Enforce widget cache headers (`Cache-Control: public, max-age=300`) and CDN compatibility — `packages/services/creator-profiles-service/src/widget/`
- [ ] **T-032** [US-005] Validate widget payload includes avatar, displayName, followerCount, and 3 most-recent public recipes only — `packages/services/creator-profiles-service/src/widget/__tests__/`
- [ ] **T-033** [US-005] Add widget accessibility/usability smoke checks for desktop and mobile — `packages/apps/commise/web/tests/e2e/creator-widget.spec.ts`

## US-006 — Creator Analytics

- [ ] **T-034** [P] [US-006] Create migration for `creator_analytics_snapshots` with aggregate-only fields and creator/date query indexes — `packages/services/creator-profiles-service/src/db/migrations/`
- [ ] **T-035** [P] [US-006] Implement daily analytics snapshot Lambda job over internal event data with aggregate-only fields — `packages/services/creator-profiles-service/src/analytics/jobs/`
- [ ] **T-036** [P] [US-006] Implement owner-only analytics endpoint (`GET /api/v1/creators/:handle/analytics`) with strict authz checks — `packages/services/creator-profiles-service/src/analytics/`
- [ ] **T-037** [US-006] Enforce analytics privacy requirements (no visitor identifiers/IPs in storage or responses) — `packages/services/creator-profiles-service/src/analytics/filters/`
- [ ] **T-038** [US-006] Add analytics dashboard UI component for creator view with 7d/30d views, follower delta, top recipes — `packages/apps/commise/src/components/creator-analytics/`

## Cross-cutting: Moderation, Privacy, Integration

- [ ] **T-039** [US-004] Implement moderation suspension workflow hooks that hide profile and block new follows — `packages/services/creator-profiles-service/src/moderation/`
- [ ] **T-040** [US-004] Implement creator-facing suspension notification and appeal-path response contract — `packages/services/creator-profiles-service/src/moderation/notifications/`
- [ ] **T-041** [US-004] Implement DMCA takedown workflow integration and recipe unpublish SLA instrumentation — `packages/services/creator-profiles-service/src/compliance/`
- [ ] **T-042** [US-001] Implement GDPR erasure propagation for creator-profile-owned records and caches — `packages/services/creator-profiles-service/src/privacy/`
- [ ] **T-043** [US-003] Implement feed projection bridge for follow/publication events to existing feed ownership boundaries — `packages/services/creator-profiles-service/src/follows/bridge/`
- [ ] **T-044** [US-001] Implement tip delegation endpoint contract (`POST /api/v1/creators/:handle/tip`) to 010 without local billing logic — `packages/services/creator-profiles-service/src/monetization/`
- [ ] **T-045** [US-001] Implement premium/paid-follow delegation markers and boundary validations to 010 contracts — `packages/services/creator-profiles-service/src/monetization/`
- [ ] **T-046** [US-004] Add sibling audience scope checks ensuring `public-profile` (S-004) is not nested with `circle` (S-003) or `published-lesson` (S-002) semantics — `packages/services/creator-profiles-service/src/audience/`

## Verification & Release Readiness

- [ ] **T-047** [US-001] Add API contract tests for all `/api/v1/creators/*` endpoints including authz and error envelopes — `packages/services/creator-profiles-service/src/__contracts__/`
- [ ] **T-048** [US-001] Add integration tests for profile lifecycle, follow graph, collection ordering, and moderation transitions — `packages/services/creator-profiles-service/src/__integration__/`
- [ ] **T-049** [US-001] Add unit tests for handle validator, follow projector, widget renderer, analytics aggregators, and privacy filters — `packages/services/creator-profiles-service/src/__tests__/`
- [ ] **T-050** [P] [US-001] Add E2E tests: claim handle, public browse, follow/unfollow, collection browse, widget embed render, owner analytics view — `packages/apps/commise/web/tests/e2e/creator-profiles.spec.ts`
- [ ] **T-051** [US-001] Add performance checks: profile SSR p95, follow API p95, widget cache-hit p95, analytics endpoint p95 — `packages/services/creator-profiles-service/src/__perf__/`
- [ ] **T-052** [US-001] Add security/privacy tests for blocked-user restrictions, stale-session protections, and PII non-leak in public payloads — `packages/services/creator-profiles-service/src/__security__/`
- [ ] **T-053** [US-001] Run full test suite + lint + typecheck for affected workspaces and archive evidence — `packages/services/creator-profiles-service/`
- [ ] **T-054** [US-001] Update V-Model execution status artifacts with real test-case mappings and results — `specs/012-creator-profiles/v-model/`
- [ ] **T-055** [US-001] Validate links among spec.md, product-spec, plan.md, and tasks.md remain intact — `specs/012-creator-profiles/`

---

## Traceability

| Task | Implements | Spec FR | Plan Phase |
|------|-----------|---------|------------|
| T-001..T-012 | Profile lifecycle | FR-001..FR-005 | Phase 1–2 |
| T-013..T-018 | Public read surface | FR-006..FR-012 | Phase 3–4 |
| T-019..T-024 | Collections curation | FR-017..FR-019 | Phase 2–3 |
| T-025..T-029 | Follow graph | FR-013..FR-016 | Phase 2–3 |
| T-030..T-033 | Embed widget | FR-026..FR-027 | Phase 4 |
| T-034..T-038 | Analytics pipeline | FR-023..FR-025 | Phase 5 |
| T-039..T-042 | Moderation / privacy | FR-020..FR-022 | Phase 5 |
| T-043..T-046 | Integration boundaries | FR-014, FR-030 | Phase 6 |
| T-047..T-055 | Verification / readiness | All | Phase 7 |
