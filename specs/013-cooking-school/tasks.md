# Feature Tasks: 013-cooking-school

**Branch**: `013-cooking-school`  
**Spec**: [`spec.md`](./spec.md)  
**Plan**: [`plan.md`](./plan.md)  
**Product Spec**: [`product-spec/product-spec.md`](./product-spec/product-spec.md)

---

## US Reference

| US ID   | Title (from plan.md)                                      |
| ------- | --------------------------------------------------------- |
| US-001  | Educator can create/publish a course with ordered lessons |
| US-002  | Video upload/transcode/playback works for preview/enrolled  |
| US-003  | Learner can purchase and immediately access entitled content |
| US-004  | Progress is persisted and completion threshold is correctly applied |
| US-005  | Educator dashboard surfaces enrollment/completion/revenue metrics |

---

## Dependency Graph (tasks written in this file)

```
T-001 → T-003 → T-004 → T-005 → T-006
                                ↘ T-007 → T-008 → T-009
                                ↘ T-014
                        ↘ T-010 → T-011 → T-012 → T-013
                                ↘ T-015
T-002 → T-004
```

---

## US-001 — Educator can create/publish a course with ordered lessons

- [ ] **T-001** [P1] [US-001] Bootstrap `cooking-school-api` NestJS workspace with Drizzle ORM and database config — `packages/services/cooking-school-service`
  - **Depends on**: —
  - **Implements**: [`spec.md` §In-Scope (course/lesson entities)](./spec.md#in-scope-v1), [`plan.md` §Proposed Workspaces](./plan.md#architecture-and-package-strategy)
  - **Acceptance**: `npm run build` passes; Drizzle config connects to PostgreSQL; health check endpoint alive.

- [ ] **T-002** [P1] [US-001] Create shared `cooking-school-contracts` package with DTOs and event schemas — `packages/shared/cooking-school-contracts`
  - **Depends on**: —
  - **Implements**: [`spec.md` §API Surface](./spec.md#api-surface), [`plan.md` §Proposed Workspaces](./plan.md#architecture-and-package-strategy)
  - **Acceptance**: Package exports typed `Course`, `Lesson`, `Enrollment` DTOs; Zod / class-validator schemas are valid and consumed by API.

- [ ] **T-003** [P1] [US-001] Define database schema and migrations for courses, lessons, enrollments, progress, video assets — `packages/services/cooking-school-service/src/db`
  - **Depends on**: T-001
  - **Implements**: [`spec.md` §In-Scope (lesson/course entities)](./spec.md#in-scope-v1), [`plan.md` §Data Model Plan](./plan.md#data-model-plan-drizzlepostgresql)
  - **Acceptance**: Migrations run successfully; invariants enforced (`course_enrollments` unique on `(course_id, learner_user_id)`; `lesson_progress.watch_percent` constrained `0..100`).

- [ ] **T-004** [P1] [US-001] Implement educator course CRUD endpoints (`POST /api/v1/courses`, `GET /api/v1/courses/:id`) — `packages/services/cooking-school-service/src/courses`
  - **Depends on**: T-002, T-003
  - **Implements**: [`spec.md` §API Surface POST/GET `/api/v1/courses`](./spec.md#api-surface), FR-001
  - **Acceptance**: Educator can create course with title, description, thumbnail, price; GET returns course detail with lesson list.

- [ ] **T-005** [P1] [US-001] Implement lesson management within course (`POST /api/v1/courses/:id/lessons`, ordering) — `packages/services/cooking-school-service/src/lessons`
  - **Depends on**: T-004
  - **Implements**: [`spec.md` §API Surface POST `/api/v1/courses/:id/lessons`](./spec.md#api-surface), FR-001, FR-002
  - **Acceptance**: Educator can add ordered lessons; `GET /api/v1/courses/:id` reflects sequence; publish/unpublish lifecycle works.

- [ ] **T-006** [P1] [US-001] Integrate `CreatorProfile` (012) for educator identity in course metadata — `packages/services/cooking-school-service/src/courses`
  - **Depends on**: T-004
  - **Implements**: [`spec.md` §Cross-Feature Touches 012](./spec.md#cross-feature-touches), FR-009
  - **Acceptance**: Course creator resolved from 012 `CreatorProfile`; no separate educator profile table in 013 schema.

## US-002 — Video upload/transcode/playback works for preview and enrolled states

- [ ] **T-007** [P1] [US-002] Build video upload intent and presigned URL flow — `packages/services/cooking-school-service/src/media`
  - **Depends on**: T-003
  - **Implements**: [`spec.md` §In-Scope (video upload)](./spec.md#in-scope-v1), FR-002
  - **Acceptance**: Educator requests upload URL; API returns presigned PUT for S3 object storage; `lesson_video_assets` row created with `status=pending`.

- [ ] **T-008** [P1] [US-002] Implement `cooking-school-video-worker` for transcode callback and status projection — `packages/services/cooking-school-workers`
  - **Depends on**: T-007
  - **Implements**: [`spec.md` §In-Scope (transcode pipeline)](./spec.md#in-scope-v1), [`plan.md` §Core Runtime Components (Media Pipeline)](./plan.md#core-runtime-components)
  - **Acceptance**: Worker ingests MediaConvert completion event; updates `lesson_video_assets` with HLS manifest URL and `status=ready`.

- [ ] **T-009** [P1] [US-002] Implement lesson playback endpoint with preview vs enrolled gating — `packages/services/cooking-school-service/src/playback`
  - **Depends on**: T-008
  - **Implements**: [`spec.md` §API Surface GET `/api/v1/lessons/:id`](./spec.md#api-surface), FR-002, FR-004, FR-008
  - **Acceptance**: First lesson accessible without enrollment; subsequent lessons require active enrollment entitlement; returns CloudFront-signed HLS manifest.

## US-003 — Learner can purchase and immediately access entitled content

- [ ] **T-010** [P1] [US-003] Build enrollment adapter integrating 010 purchase lifecycle — `packages/services/cooking-school-service/src/enrollments`
  - **Depends on**: T-003, T-004
  - **Implements**: [`spec.md` §API Surface POST `/api/v1/courses/:id/enroll`](./spec.md#api-surface), FR-003, FR-008
  - **Acceptance**: Payment confirmation from 010 creates idempotent `course_enrollments` row; learner can access non-preview lessons immediately.

- [ ] **T-015** [P2] [US-003] Emit publish/enroll events for 014-notification-service integration — `packages/services/cooking-school-service/src/events`
  - **Depends on**: T-005, T-010
  - **Implements**: [`plan.md` §Cross-Feature Dependency Plan 014](./plan.md#cross-feature-dependency-plan)
  - **Acceptance**: Typed events emitted on course publish and learner enrollment; schemas live in `cooking-school-contracts`; 014 can consume via SQS/EventBridge.

## US-004 — Progress is persisted and completion threshold is correctly applied

- [ ] **T-011** [P1] [US-004] Implement learner progress tracking (`watch_percent`, completion threshold ≥80%) — `packages/services/cooking-school-service/src/progress`
  - **Depends on**: T-010
  - **Implements**: [`spec.md` §API Surface PATCH `/api/v1/lessons/:id/progress`](./spec.md#api-surface), FR-005
  - **Acceptance**: `PATCH` updates `watch_percent`; `completed_at` set automatically when `≥80%`; `GET /api/v1/learners/me/progress` returns aggregate progress across courses.

## US-005 — Educator dashboard surfaces enrollment/completion/revenue metrics

- [ ] **T-012** [P1] [US-005] Build educator analytics dashboard endpoint — `packages/services/cooking-school-service/src/analytics`
  - **Depends on**: T-010, T-011
  - **Implements**: [`spec.md` §API Surface GET `/api/v1/educators/me/dashboard`](./spec.md#api-surface), FR-006
  - **Acceptance**: Dashboard returns enrollment count, lesson completion rate, and revenue per course; aggregates computed from `course_enrollments`, `lesson_progress`, `educator_revenue_ledger`.

- [ ] **T-013** [P1] [US-005] Implement revenue ledger and revenue-share calculation (20/80, pro 15/85) — `packages/services/cooking-school-service/src/revenue`
  - **Depends on**: T-012
  - **Implements**: [`spec.md` §Cross-Feature Touches 010 (revenue share)](./spec.md#cross-feature-touches), FR-010
  - **Acceptance**: Revenue entry created on each enrollment; tiered split calculated from educator 010 subscription tier; ledger compatible with 010 payout schedule.

## Cross-US — AI-assisted authoring (Should Have)

- [ ] **T-014** [P2] [US-001] Implement AI draft script adapter calling 005 with recipe context and circuit breaker — `packages/services/cooking-school-service/src/ai-draft`
  - **Depends on**: T-005
  - **Implements**: [`spec.md` §API Surface POST `/api/v1/lessons/:id/draft-script`](./spec.md#api-surface), FR-007
  - **Acceptance**: Endpoint returns structured draft from 005; fails gracefully on AI outage (fallback returns empty draft + message); linked `recipe_id` context included in request payload.
