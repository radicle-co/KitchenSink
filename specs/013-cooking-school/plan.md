# Implementation Plan: Cooking School (Video Learning Platform)

**Branch**: `013-cooking-school` | **Date**: 2026-05-12 | **Spec**: [spec.md](./spec.md)
**Input**: [`spec.md`](./spec.md), [`product-spec/product-spec.md`](./product-spec/product-spec.md), [`research.md`](./research.md), [`v-model/`](./v-model/)
**Milestone**: [`M7` Minas Tirith](../v1-launch-plan.md#38-m7--milestone-minas-tirith)
**Governance Authority**: [`governance-rules.md`](../governance-rules.md)

---

## Summary

Feature 013 delivers KitchenSink’s two-sided cooking school: educators publish and monetize structured video courses, and learners discover, purchase, and complete lessons with progress tracking.

This plan is milestone-scoped for `M7` and is designed to satisfy launch-plan remediation for 013:

- Generate executable plan/tasks/review artifacts from existing feature corpus
- Close traceability and test-evidence gaps through implementation + verification work
- Prove creator publish flow and learner enrollment flow with 010-integrated gating

---

## M7 Scope and Exit Alignment

Reference: [`v1-launch-plan.md`](../v1-launch-plan.md#38-m7--milestone-minas-tirith)

### M7 Artifact Remediation for 013

1. Planning artifacts exist and are internally consistent with spec/product-spec/research/v-model.
2. Verification path is explicit (`verify-report.md`, release-audit unblocking, traceability execution evidence).
3. Cross-feature integration is concretely planned for 002/005/010/012.

### M7 Exit Criteria (Feature-Level)

- `013/verify-report.md` shows `0 CRITICAL, 0 WARNING`.
- `013/v-model/release-audit-report.md` is unblocked by real test execution + traceability mapping.
- Demonstrated end-to-end:
    - Educator can create + publish a course.
    - Learner can purchase + enroll + access non-preview lessons.
    - Gating aligns with subscription + entitlement controls.

---

## Governance Mapping

Reference: [`governance-rules.md`](../governance-rules.md)

- **GR-002 API Prefix**: all API contracts use `/api/v1/...`.
- **GR-007 Shared Type Ownership**: shared domain entities imported from canonical shared packages; no duplicate local source-of-truth types.
- **GR-012 Subscription Gating**: server-side enforcement for purchase/enrollment/access rules.
- **GR-014 Audience/Sharing Model**: `published-lesson` is governed by the unified audience model; 013 defines and enforces the lesson/course access rules applied to that scope.
- **GR-006 Dependency Sequencing**: 013 integration points are blocked until 002 and 010 contracts are stable.

---

## Scope Baseline

### In Scope (v1)

- Educator authoring for courses and lessons
- Video upload, transcode (HLS 720p/1080p), and CDN playback
- Preview lesson exposure + enrollment-gated paid lesson access
- Course purchase and enrollment handoff from 010
- Progress tracking (`watch_percent`, completion threshold at `>=80%`)
- Educator analytics (enrollments, completion, revenue)
- Recipe-linked lesson context and AI script-draft assist

### Explicitly Out of Scope (v1)

- Live classes / livestream orchestration
- Certificates, badges, and advanced gamification
- Deep moderation automation beyond required safety/compliance workflows
- Full notification expansion owned by 014 (013 only emits integration events)

---

## Cross-Feature Dependency Plan

| Feature                                                         | Dependency Type             | 013 Integration Responsibility                                                                            |
| --------------------------------------------------------------- | --------------------------- | --------------------------------------------------------------------------------------------------------- |
| [001-commise-recipe-app](../001-commise-recipe-app/spec.md)     | Referenced domain           | Resolve `recipe_id` links for lessons and render read-only recipe context in player drawer.               |
| [002-user-auth](../002-user-auth/spec.md)                       | Required                    | Enforce authenticated educator/learner sessions, role checks, and JWT validation for protected endpoints. |
| [005-ai-integration](../005-ai-integration/spec.md)             | Referenced service          | AI draft endpoint consumes lesson context + recipe metadata; enforce fallback behavior on AI outage.      |
| [010-subscriptions](../010-subscriptions/spec.md)               | Required billing/gating     | Purchase lifecycle, entitlement checks, and revenue-share tier consumption.                               |
| [012-creator-profiles](../012-creator-profiles/spec.md)         | Required identity/discovery | Creator identity (`@handle`) in catalog + profile-linked course discovery surfaces.                       |
| [014-notification-service](../014-notification-service/spec.md) | Future integration          | Emit events for publish/enroll milestones; downstream push/email ownership remains in 014.                |

---

## Architecture and Package Strategy

### Proposed Workspaces

- `packages/services/cooking-school-service` (NestJS 11): authoritative API for educator + learner operations —
  and the **author** of the wire contract, as zod at `src/**/*.schema.ts` (GR-015; see _API Surface_ below)
- `packages/services/cooking-school-workers` (Node 24 worker): async transcode callback/status projection
- `packages/schemas/cooking-school` (`@kitchensink/schema-cooking-school`): **GENERATED, committed** copy of the
  service's zod — the zod itself, `z.infer` types, `contract-hash.ts`, a barrel, and a **derived** `openapi.yaml`
- `packages/clients/cooking-school`: the typed client every consumer depends on (never on the service package)

> ⚠️ **Amended 2026-08-11 (GR-015).** This list previously named a
> `packages/shared/cooking-school-contracts` package holding "DTOs/events/typed contracts for API and clients".
> **Superseded** — the location is `packages/schemas/<service>`, and it is **generated from the service's
> authored zod**, not a hand-maintained shared DTO package. A hand-written contracts package is a **second
> author** of the wire contract and would drift from the service silently, which is the failure GR-015 exists to
> make impossible. The `packages/schemas/` location is fixed (ADR-0014, rejected alternative 3), and nothing in
> that package is hand-edited.

### Core Runtime Components

1. **Authoring API**: course/lesson CRUD + publish lifecycle.
2. **Media Pipeline**: upload intent -> object storage -> transcode workflow -> playback manifest.
3. **Entitlement Service**: preview/public logic vs enrollment-only access.
4. **Enrollment Adapter**: payment result ingest from 010 and idempotent enrollment creation.
5. **Progress Service**: evented watch-state updates with threshold completion.
6. **Analytics Projection**: educator dashboard aggregates from enrollments/progress/revenue ledger.
7. **AI Draft Adapter**: 005 integration with policy guardrails and circuit breaker.

---

## Data Model Plan (Drizzle/PostgreSQL)

Planned entities (names reflect canonical intent; exact migration names finalized in implementation):

- `courses`
- `course_lessons`
- `course_enrollments`
- `lesson_progress`
- `lesson_video_assets`
- `educator_revenue_ledger`
- `course_audit_events`

Key invariants:

- `course_enrollments` unique on `(course_id, learner_user_id)`.
- `lesson_progress.watch_percent` constrained to `0..100`.
- completion timestamps set when `watch_percent >= 80`.
- non-preview lesson playback requires active enrollment entitlement.

---

## API Surface (GR-002 Compliant)

Representative route families:

- Educator authoring: `/api/v1/educator/courses/*`, `/api/v1/educator/lessons/*`
- Catalog/player: `/api/v1/courses`, `/api/v1/courses/:courseId/lessons/:lessonId/playback`
- Enrollment/progress: `/api/v1/enrollments/*`, `/api/v1/progress/*`
- AI assist: `/api/v1/educator/lessons/:lessonId/draft-script`
- Analytics: `/api/v1/educator/analytics/*`

All non-preview playback endpoints enforce auth + entitlement checks.

### Contract ownership and drift (GR-015)

**Normative sources**: [`docs/CODING_STANDARDS.md` §15](../../docs/CODING_STANDARDS.md) ·
[`GR-015`](../governance-rules.md#gr-015-api-contract-ownership) ·
[ADR-0014](../../docs/architecture/decisions/0014-service-owned-api-contracts.md).

**The service MUST** author every course, lesson, enrollment, progress, playback and analytics
request/response shape as **zod in `cooking-school-service`** at `src/**/*.schema.ts` beside the controller it
serves; **validate its own requests with that same zod** via `nestjs-zod`'s `createZodDto`; generate and commit
`@kitchensink/schema-cooking-school` (zod + `z.infer` types + `contract-hash.ts` + barrel + a **derived**,
outbound-only `openapi.yaml` — `oasdiff`/docs/integrators, **never a codegen input**); and keep every
`*.schema.ts` importing **only `zod` and other `*.schema.ts` files**.

**`cooking-school-workers` shares the transcode/status event envelope with the service.** That envelope is
authored once as zod and imported by both deployables — never declared per deployable.

**Every client MUST** — separately mandatory, because mandating only the service half is exactly how the client
half got skipped portfolio-wide:

- Import its wire **types and zod** from `@kitchensink/schema-cooking-school`, and **declare no cooking-school
  request or response body type of its own** — in `packages/clients/cooking-school`, `@commise/web`,
  `@commise/mobile`, or any feature package alike (GR-015 §15-b.4).
- **The playback manifest response and the entitlement decision are the load-bearing cases.** Both are consumed
  by a web player and a mobile player; a hand-written parallel type on either platform can drift by one field
  and either **fail open** (serving gated video) or fail closed, with `typecheck` green.
- **Derive** any divergent consumer shape with `Pick` / `Omit` / `Partial` — the player's lesson view model, the
  educator dashboard's series model. Reference:
  `packages/apps/commise/features/recipes/src/filters/model.ts`.
- **A new endpoint is not complete until its types are reachable from the schema package.**

**Drift gates** — inherited from GR-015 §15-c, all three required: turbo `inputs` rebuild, the
regenerate-and-diff CI gate, and the `CONTRACT_HASH` boot assertion (the layer that catches the service
deploying ahead of a released mobile player).

**013 is also a CLIENT of our other services**, bound identically by §15-b: AI script drafting via 005 →
`@kitchensink/schema-ai`; recipe reads via `@kitchensink/schema-recipe`; educator identity via 012 →
`@kitchensink/schema-creator-profiles`. 013 declares no wire type belonging to 005, 001, 010 or 012.

### ⚠️ Third-party APIs — the opposite case, do NOT converge them (GR-015 §15-d)

- **The transcode provider** (the media pipeline's external encoder, and its status/callback payloads) is an API
  we do **not** serve. Its adapter **validates the raw upstream shape at the boundary with zod** — the callback
  especially, since it is an **inbound external request** whose body is not ours — **may declare its own types**,
  and **gets no OpenAPI document**. Our playback-manifest shape deliberately differs from the provider's.
- **Payments stay behind 010.** Course purchase flows through 010's billing primitives, so **Stripe's shapes are
  010's boundary concern** and must not appear in `@kitchensink/schema-cooking-school`. `POST
/api/v1/courses/:id/enroll`'s own request/response are ours.
- **The LLM provider** behind the AI draft adapter is likewise third-party; model output is untrusted and is
  boundary-validated (see 005 §3.0).
- `packages/clients/usda` is the reference implementation; its `schemas.ts` must never be "converged". Deleting a
  boundary schema under §15-b replaces a checked parse with unchecked trust in a remote party's JSON — a
  security regression, not a cleanup.

---

## Verification and Acceptance Strategy

### Functional Acceptance (Must Have)

- US-001: Educator can create/publish a course with ordered lessons.
- US-002: Video upload/transcode/playback works for preview and enrolled states.
- US-003: Learner can purchase and immediately access entitled content.
- US-004: Progress is persisted and completion threshold is correctly applied.
- US-005: Educator dashboard surfaces enrollment/completion/revenue metrics.

### Non-Functional Targets

- Upload and playback error paths are explicit and observable.
- Idempotent handling for payment callbacks and enrollment creation.
- Audit trail for publish/unpublish/access denials/compliance actions.
- Security posture: JWT validation, signed playback URLs, least-privileged service roles.

### V-Model Closure Work (M7 Critical)

- Replace placeholder `❌ MISSING` mappings in `v-model/traceability-matrix.md`.
- Execute ATP/STP/ITP/UTP scenarios and ingest results into traceability artifacts.
- Regenerate `release-audit-report.md` with evidence-backed status.

---

## Rollout Plan (M7)

1. **Phase A — Foundations**: scaffold packages, schema, contracts, and guarded APIs.
2. **Phase B — Core Flows**: educator authoring, media pipeline, enrollment + entitlement, progress.
3. **Phase C — Integrations**: 005 draft assist, 010 billing/tiers, 012 identity/discovery projections.
4. **Phase D — Hardening**: analytics correctness, compliance workflows, failure-path testing.
5. **Phase E — Milestone Exit Evidence**: verify-report closure, release-audit unblocking, demo scripts.

Rollout guardrails:

- Feature flag for public course listing until enrollment/entitlement pass.
- Staged creator cohort before broad M7 release.
- Backout: unpublish + disable enrollment while preserving learner access to prior purchases.

---

## Risks and Mitigations

| Risk                                   | Impact                                    | Mitigation                                                                           |
| -------------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------ |
| Transcode latency spikes               | Delayed publish readiness                 | Async status projection + retry/DLQ + educator status UI.                            |
| Entitlement race on purchase callback  | Unauthorized deny or duplicate enrollment | Idempotency keys, transactionally safe enrollment creation, replay-safe handlers.    |
| AI draft availability/cost variance    | Educator flow degradation                 | Optional draft workflow with graceful fallback and explicit error feedback.          |
| Cross-feature contract drift (010/012) | Integration instability                   | Shared contracts package + integration tests + milestone-level contract checkpoints. |
| Traceability debt persists             | M7 exit blocked                           | Dedicated tasks for mapping closure + executed evidence ingestion.                   |

---

## Deliverables

- [`plan.md`](./plan.md)
- [`tasks.md`](./tasks.md)
- [`review.md`](./review.md)
- Follow-on (implementation milestone): `verify-report.md` + updated `v-model/` execution evidence
