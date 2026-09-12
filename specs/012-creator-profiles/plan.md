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
  `packages/schemas/creator-profiles` (zod + `z.infer` types + `contractHash.ts` + barrel + a **derived**,
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

### GR-016 — Input Validation at Every Boundary

Rule reference: [`governance-rules.md#gr-016-input-validation-at-every-boundary`](../governance-rules.md#gr-016-input-validation-at-every-boundary)
· normative source [`docs/CODING_STANDARDS.md` §15.4](../../docs/CODING_STANDARDS.md) · reasoning and rejected
alternatives in [ADR-0015](../../docs/architecture/decisions/0015-input-validation-at-every-boundary.md).
GR-015 decides **who authors** the zod; GR-016 decides **where it runs**.

- **One mechanism, one `400`.** `@kitchensink/creator-profiles-service` validates every profile, handle,
  collection, follow, analytics and widget input — body, path params (including the public `/@handle`
  segment), query params — with its own `*.schema.ts` zod via `createZodDto` + **`nestjs-zod`'s**
  `ZodValidationPipe`. A new service starts with **one** mechanism; do not introduce a `class-validator` DTO
  alongside it. **Phase 1 wires the pipe with the schema package** — a service that ships without it is where
  the drift and the missing-validation defects both start.
- **⚠️ The handle is this feature's highest-risk input, and the schema is where its policy lives.** `handle`
  writes a **uniqueness-constrained, bounded** column and is rendered into a **public URL**. Charset, length,
  case-normalisation form and the reserved-word/blocklist policy belong in the authored zod (Phase 3's "policy
  validation"), so a client sees the same rule the server enforces. **Uniqueness and reservation are separate
  domain checks** — a `409`, not a `400` — and neither substitutes for the other.
- **⛔ THE FLOOR.** Every input field writing a bounded column is validated at least as strictly as the column
  can store: handle and display-name lengths, `creator_collection_recipes` ordering integers against their
  `int4` ceiling (**2,147,483,647**), analytics window/limit integers, status enums, nullability. A value the
  column cannot hold is a `400` at the boundary, never a failed `INSERT` — the measured failure mode elsewhere
  in the portfolio.
    - ⚠️ **Asserted, never derived**: no zod generated from Drizzle, no storage type imported into a
      `*.schema.ts` (the constraint stated under GR-015 above is unchanged).
    - ⚠️ **Bio/description text columns are unbounded**, so their limits are **product decisions 012 owns** —
      and since profile text is publicly rendered, the limit is also a rendering and abuse control.
- **Non-HTTP ingress is in scope.** The **analytics-snapshot scheduler** (Phase 2/3's
  `creator_analytics_snapshots` cadence) is an invocation a pipe never sees: its event is **parsed against an
  authored zod before it drives a write**. "The payload is ours" is an assumption about a deploy.
- **Idempotent follow/unfollow still validates.** Idempotency makes a repeated **valid** request safe; it does
  not make an invalid one acceptable. The target id is parsed, then authorised, then applied.
- **Unknown keys are a stated choice per surface** (`z.object` strips silently, `z.strictObject` rejects). On
  profile update a silently dropped field returns `200` for an edit that did not happen. (Portfolio default is
  **OPEN** — GR-016 OPEN-GR-016-B.)
- **No request-derived value reaches `sql.raw()`.** The analytics queries are the risk surface here: a
  request-selected metric, interval or sort maps through a **validated enum to a closed allowlist of literals**
  in code, never into a SQL fragment.
- **⛔ Response validation is DEFERRED (GR-016 §16-g).** Do not add server-side response parsing; the widget's
  HTML fragment is **output** and is governed by escaping/rendering rules, not by this rule.

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
