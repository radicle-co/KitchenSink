# Implementation Plan: Public Creator Profiles

**Branch**: `012-creator-profiles` | **Date**: 2026-05-12 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/012-creator-profiles/spec.md`

---

## Milestone Context (M7)

- **Milestone**: `M7` Minas Tirith (post-1.0, still in v1 scope)
- **Launch plan authority**: [`v1-launch-plan.md`](../v1-launch-plan.md)
- **Product spec**: [`product-spec/product-spec.md`](./product-spec/product-spec.md)
- **Research baseline**: [`research.md`](./research.md)
- **V-Model baseline**: [`v-model/`](./v-model/)

Feature 012 is assigned to M7 per the canonical launch ladder in [`v1-launch-plan.md`](../v1-launch-plan.md) and must be sequenced after 1.0 GA stability (`M6`) while preserving v1 traceability and governance compliance.

---

## Summary

Feature 012 introduces public creator identity and discovery surfaces: canonical `@handle` profiles, follow/unfollow social graph, public collections, static embed widget, and creator analytics snapshots. The plan keeps monetization mechanics delegated to feature 010 while implementing thin 012 delegation boundaries.

Planned implementation adds one API package (`@kitchensink/creator-profiles-service`) plus web routes/components for profile pages and widget rendering, with PostgreSQL schema additions (`creator_profiles`, `creator_follows`, `creator_collections`, `creator_collection_recipes`, `creator_analytics_snapshots`) and scheduled aggregation jobs.

**Must Have stories addressed**: US-001, US-002, US-003, US-004, US-005, US-006 (from [`product-spec/product-spec.md`](./product-spec/product-spec.md)).

---

## Architecture Summary

Implementation follows the V-Model decomposition in [`v-model/system-design.md`](./v-model/system-design.md) and [`v-model/architecture-design.md`](./v-model/architecture-design.md):

1. **Profile lifecycle** (`SYS-001/002`): handle claim/update/deactivate, uniqueness checks, cooldown and reservation policy.
2. **Public read surface** (`SYS-003`): SSR payload builder for `/@handle` with SEO metadata and public recipe/collection projection.
3. **Follow graph** (`SYS-004/005`): idempotent follow/unfollow writes, bounded counter consistency, and feed projection event bridge to existing feed ownership.
4. **Collections curation** (`SYS-006`): owner-managed ordered collections with public-only recipe membership constraints.
5. **Embed delivery** (`SYS-007`): static HTML fragment endpoint with cache headers for CDN.
6. **Analytics pipeline** (`SYS-008`): scheduled aggregation snapshots and owner-only read endpoint.
7. **Moderation/compliance + security/privacy** (`SYS-009/011`): suspension, DMCA workflow hooks, blocked-user restrictions, and erasure propagation.
8. **Monetization delegation** (`SYS-010`): integration boundary only; billing and payment stay in feature 010.

---

## Dependency Sequencing

### Hard dependencies

- [`../002-user-auth/spec.md`](../002-user-auth/spec.md): authenticated identity and owner auth semantics.
- [`../001-commise-recipe-app/spec.md`](../001-commise-recipe-app/spec.md): canonical recipe entity, visibility model, and feed surfaces.

### Integration dependencies

- [`../010-subscriptions/spec.md`](../010-subscriptions/spec.md): tip/premium/paid-follow delegation contracts.
- [`../011-recipe-digitization/spec.md`](../011-recipe-digitization/spec.md): sibling audience scope relationship (`circle` vs `public-profile`).

### Forward consumers

- [`../013-cooking-school/spec.md`](../013-cooking-school/spec.md): consumes `creatorId` as educator surface.

---

## Governance Alignment

### GR-002 — API URL Prefix Standard

Rule reference: [`governance-rules.md#gr-002-api-url-prefix-standard`](../governance-rules.md#gr-002-api-url-prefix-standard)

All 012 contracts remain under `/api/v1/*` (no bare `/api/*` without a version, and no bare `/v1/*` without the `/api` segment), including profile, collections, follow, analytics, and widget endpoints.

### GR-007 — Shared Type Library Ownership

Rule reference: [`governance-rules.md#gr-007-shared-type-library-ownership`](../governance-rules.md#gr-007-shared-type-library-ownership)

012 will import shared canonical entities from `@kitchensink/recipe-core` and avoid local type forks for recipe/user/shared domain entities.

### GR-015 — API Contract Ownership

Rule reference: [`governance-rules.md#gr-015-api-contract-ownership`](../governance-rules.md#gr-015-api-contract-ownership)
· normative source [`docs/CODING_STANDARDS.md` §15](../../docs/CODING_STANDARDS.md) · reasoning and rejected
alternatives in [ADR-0014](../../docs/architecture/decisions/0014-service-owned-api-contracts.md).

**Both halves apply, and the client half is separately mandatory** — mandating only the service side is how the
client half got skipped portfolio-wide.

- **Service half.** `@kitchensink/creator-profiles-service` **authors** every wire shape as zod at
  `src/**/*.schema.ts` beside its controller, **validates its own requests with that same zod** via
  `nestjs-zod`'s `createZodDto`, and generates the committed `@kitchensink/schema-creator-profiles` package at
  `packages/schemas/creator-profiles` (zod + `z.infer` types + `contract-hash.ts` + barrel + a **derived**,
  outbound-only `openapi.yaml`). A `*.schema.ts` imports **only `zod` and other `*.schema.ts` files**.
- **Client half.** `packages/clients/creator-profiles`, `@commise/web` and `@commise/mobile` import wire types
  **and zod** from that schema package and **declare no wire shape of their own**; a divergent consumer shape
  (the `/@handle` SSR page model, an analytics series) is **DERIVED** with `Pick` / `Omit` / `Partial`.
- **Drift gates** are inherited from GR-015 §15-c — turbo `inputs` rebuild, regenerate-and-diff CI gate, and a
  `CONTRACT_HASH` boot assertion. **Phase 1 of the scaffold below must create the schema package and wire all
  three gates**, not defer them; a service that ships without them is where drift starts.
- **Third-party exception (§15-d)** does not bite here: monetization is delegated to 010, so **Stripe's shapes
  stay behind 010's boundary** and never enter this feature's schema package. If 012 later calls an external API
  directly, that client validates the raw upstream shape at the boundary with zod, may declare its own types,
  and gets no OpenAPI document — `packages/clients/usda` is the reference implementation and must not be
  "converged".

Full bindings, including the HTML-fragment widget caveat, are in
[`spec.md` → _Contract ownership (GR-015)_](./spec.md#contract-ownership-gr-015).

### Additional cross-feature guardrails applied

- Audience ownership boundaries respected: `public-profile` behavior is owned here; `circle` and `published-lesson` remain external scopes governed by GR-014.
- Monetization mechanics remain delegated to 010.

---

## Implementation Phases

### Phase 1 — Workspace + package scaffold

- Create `@kitchensink/creator-profiles-service` package and register workspace wiring.
- Add env schema and config surfaces (DB/S3/cache headers/scheduler cadence).

### Phase 2 — Schema + migrations

- Add `creator_profiles`, `creator_follows`, `creator_collections`, `creator_collection_recipes`, `creator_analytics_snapshots` tables.
- Add constraints/indexes for handle uniqueness, follow idempotency, collection ordering, and analytics query shape.

### Phase 3 — Core API domain

- Implement handle claim/update/deactivate APIs with policy validation.
- Implement public profile read model and collections APIs.
- Implement idempotent follow/unfollow and counter projection.

### Phase 4 — Web/profile surfaces

- Implement `/@handle` SSR page contract consumption and metadata generation.
- Implement static widget fragment endpoint (`/api/v1/creators/:handle/widget`) and cache directives.

### Phase 5 — Analytics + moderation/privacy

- Implement daily aggregation job and owner analytics endpoint.
- Implement suspension and moderation state enforcement in public/follow surfaces.
- Implement GDPR erasure propagation workflow for creator-profile-owned data.

### Phase 6 — Integration boundaries

- Wire feed projection bridge for follow/publication integration.
- Implement tip endpoint delegation to 010 and premium/paid-follow boundary checks.

### Phase 7 — Verification + readiness

- Complete API, integration, contract, and E2E tests.
- Validate M7 acceptance checkpoints and cross-artifact traceability.

---

## Acceptance Criteria (implementation gate)

1. Creator can claim a valid unique handle and edit profile fields under policy constraints.
2. Public `/@handle` route renders unauthenticated profile content with SEO metadata.
3. Follow/unfollow is idempotent with counters updated within bounded consistency targets.
4. Collections support ordering and enforce creator ownership + public recipe constraints.
5. Widget endpoint returns static HTML fragment with `Cache-Control: public, max-age=300`.
6. Analytics endpoint is owner-only and aggregate-only (no visitor identity leakage).
7. Moderation suspension state hides public surfaces and blocks new follows.
8. All 012 APIs use `/api/v1/*` (GR-002), and shared domain types import from `@kitchensink/recipe-core` (GR-007).
9. Traceability from spec/product-spec to tests is present and ready for downstream sync-verify.

---

## Rollout Strategy (M7 post-1.0)

1. **Dark launch (internal only)**: deploy API + DB + scheduler behind feature flag; validate metrics and moderation controls.
2. **Creator cohort beta (M7 controlled slice)**: enable handle claim and profile pages for an allowlist of creators; monitor follow conversion and profile load behavior.
3. **Public enablement (M7 exit candidate)**: open profile browsing and follow graph to all users once error budget and moderation readiness pass.
4. **Monetization handoff hardening**: keep tip/premium/paid flows delegated to 010; no 012-local billing logic introduced.

Rollback strategy: disable feature flag for profile claim and follow writes, preserve DB state, retain read-only admin access for remediation.

---

## Artifact Links

- Feature spec: [`spec.md`](./spec.md)
- Product spec: [`product-spec/product-spec.md`](./product-spec/product-spec.md)
- Launch sequencing authority: [`../v1-launch-plan.md`](../v1-launch-plan.md)
- Governance authority: [`../governance-rules.md`](../governance-rules.md)
- V-Model design/test baseline: [`v-model/`](./v-model/)
