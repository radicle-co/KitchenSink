# Product Specification: Cooking School (Video Learning Platform)

**Feature**: `013-cooking-school`
**Version**: 0.1 (bootstrapped)
**Date**: 2026-05-09
**Status**: Awaiting revalidation

---

## Executive Summary

013-cooking-school is a two-sided video learning marketplace embedded in KitchenSink. Educators publish structured cooking courses; learners discover, purchase, and track progress through them. It is the largest of the 011/012/013 expansion by scope, requiring new video infrastructure, a two-sided monetization model, and integration with four existing features (002, 005, 010, 012).

Live classes are Phase 2. v1 ships async video only.

---

## Personas

### Co-Primary

**P12 Jamie** (learner): Home cook who wants structured instruction beyond recipe cards. Motivated by skill improvement, not just meal output. Willing to pay for quality content from trusted educators. Frustrated by YouTube's lack of structure and MasterClass's price point. (canonical persona — see `specs/cross-feature-consistency-report.md` §9 Canonical Persona Library)

**P13 Reese** (educator): Recipe creator who wants to monetize her expertise through video. Already has an audience via her `CreatorProfile` (012). Needs a low-friction upload workflow and transparent revenue reporting. The AI script drafting feature (005) is her highest-value "Should" story. (canonical persona — see `specs/cross-feature-consistency-report.md` §9 Canonical Persona Library)

### Secondary

**P1 Casey**: Everyday home cook. Uses lessons to solve specific problems ("how do I debone a chicken?"). Likely to buy individual courses rather than follow a single educator.

**P2 Taylor**: Follows specific educators. Wants to know when Reese publishes something new. The follow/feed integration with 012 is important for Taylor's discovery loop.

### Tertiary

**P9 Drew**: Professional chef or culinary school instructor. High-production courses, multiple lessons per course, expects pro-tier revenue share. Drew's presence validates the platform's quality ceiling.

---

## User Journey

### Learner Journey (P12 Jamie)

1. **Discovery**: Jamie sees a course card on Reese's `@handle` profile page (012) or in a feed recommendation.
2. **Preview**: Jamie watches the first lesson for free. No account required to preview; purchase requires auth (002).
3. **Purchase**: Jamie completes checkout via 010 billing. Enrollment is immediate.
4. **Learning**: Jamie works through lessons at her own pace. Progress auto-saves at 80% watch completion.
5. **Completion**: Jamie marks the course complete. No certificate in v1; completion is visible in her progress dashboard.

### Educator Journey (P13 Reese)

1. **Setup**: Reese's educator account is her existing `CreatorProfile` (012) with an educator flag enabled via 010 subscription tier.
2. **Course creation**: Reese creates a course, sets a price, and adds lessons one by one.
3. **Upload**: Reese uploads a video. The platform transcodes it to HLS via MediaConvert and delivers via CloudFront.
4. **AI assist**: Reese links a recipe to a lesson and requests an AI script draft (005). She edits the draft and records her video.
5. **Publish**: Reese publishes the course. It appears on her profile and in discovery surfaces.
6. **Revenue**: Reese sees enrollment count and revenue in her educator dashboard. Payouts follow 010's disbursement schedule.

---

## Feature Requirements

### Must Have (v1)

| ID     | Requirement                                                                          | Persona             |
| ------ | ------------------------------------------------------------------------------------ | ------------------- |
| FR-001 | Educators can create a course with title, description, thumbnail, and price          | P13 Reese           |
| FR-002 | Educators can upload video lessons; platform transcodes to HLS and delivers via CDN  | P13 Reese           |
| FR-003 | Learners can browse and purchase courses; enrollment is immediate post-payment       | P12 Jamie           |
| FR-004 | First lesson of every course is free to preview without purchase                     | P12 Jamie, P1 Casey |
| FR-005 | Learner progress is tracked per lesson (watch percent, completed_at)                 | P12 Jamie           |
| FR-006 | Educators can view enrollment count, lesson completion rates, and revenue per course | P13 Reese, P9 Drew  |
| FR-007 | Educators can link a recipe to a lesson and request an AI-drafted script outline     | P13 Reese           |
| FR-008 | `published-lesson` audience scope (S-004) gates lesson access to enrolled learners   | Platform            |
| FR-009 | Educator identity is the `CreatorProfile` from 012; no separate educator profile     | P13 Reese           |
| FR-010 | Revenue share: platform 20%, educator 80% (pro tier: 15%/85% via 010)                | P13 Reese, P9 Drew  |

### Should Have (v1)

| ID     | Requirement                                                                                                                                                                                                                                                           | Persona   |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| FR-011 | Learners can follow educators and see new courses in their feed (via 012 follow graph)                                                                                                                                                                                | P2 Taylor |
| FR-012 | Educators can reorder lessons within a course via drag-and-drop                                                                                                                                                                                                       | P13 Reese |
| FR-013 | Lesson player shows linked recipe in a side drawer (read-only reference; no timer-synced steps, voice prompts, or ingredient checkoff — hands-free step-by-step execution is owned by 008 Cooking Mode; this feature ends at video playback + lesson-level resources) | P12 Jamie |
| FR-014 | Educators can publish/unpublish individual lessons without unpublishing the whole course                                                                                                                                                                              | P13 Reese |

### Won't Have (v1)

| ID     | Requirement                                                                                                    | Notes                     |
| ------ | -------------------------------------------------------------------------------------------------------------- | ------------------------- |
| FR-015 | Live class scheduling and streaming                                                                            | Phase 2                   |
| FR-016 | Completion certificates or badges                                                                              | Future                    |
| FR-017 | Offline video download (mobile)                                                                                | Future                    |
| FR-018 | Community Q&A or lesson comments                                                                               | Future                    |
| FR-019 | À la carte individual lesson purchases                                                                         | Evaluate post-launch      |
| FR-020 | Hands-free cook-along during video playback (timer-synced steps, voice prompts, in-player ingredient checkoff) | Owned by 008 Cooking Mode |

- Hands-free cook-along during video playback — owned by 008 Cooking Mode.

---

## Data Model (Conceptual)

### `courses`

```
id, creator_profile_id (FK → 012), title, description, thumbnail_s3_key,
price_cents, currency, published_at, created_at, updated_at
```

### `lessons`

```
id, course_id (FK), recipe_id (FK → 001, nullable), title, description,
video_s3_key, hls_manifest_url, transcript, sort_order, is_preview,
published_at, created_at, updated_at
```

### `enrollments`

```
id, learner_id (FK → users), course_id (FK), purchased_at,
stripe_payment_intent_id, gross_cents, platform_fee_cents, educator_payout_cents
```

### `lesson_progress`

```
id, learner_id (FK → users), lesson_id (FK), watch_percent, completed_at,
last_watched_at
```

---

## Internal Stakeholders

Internal/operational roles — not user personas. See `specs/cross-feature-consistency-report.md` §9 for the distinction.

| Role                       | Responsibilities                                                                                                                                   |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Compliance Reviewer**    | Reviews course content for copyright compliance; approves or rejects flagged uploads; coordinates DMCA takedown responses.                         |
| **Support/Admin Operator** | Handles creator/student disputes (refund requests, access issues); executes course takedowns on policy violations; manages educator account flags. |

---

## API Surface

> All endpoints conform to S-001 (`/api/v1/*` prefix, JSON, Clerk session token). See `specs/cross-feature-consistency-report.md` §S-001.

Runtime: Node 24.x / NestJS 11. All paths under `/api/v1/`.

| Method | Path                               | Auth               | Description                        |
| ------ | ---------------------------------- | ------------------ | ---------------------------------- |
| POST   | `/api/v1/courses`                  | Educator           | Create course                      |
| GET    | `/api/v1/courses/:id`              | Public             | Course detail + lesson list        |
| PATCH  | `/api/v1/courses/:id`              | Educator (owner)   | Update course metadata             |
| POST   | `/api/v1/courses/:id/lessons`      | Educator (owner)   | Add lesson                         |
| GET    | `/api/v1/lessons/:id`              | Enrolled / Preview | Get lesson + video URL             |
| POST   | `/api/v1/courses/:id/enroll`       | Learner            | Purchase and enroll                |
| GET    | `/api/v1/learners/me/progress`     | Learner            | All enrolled courses + progress    |
| PATCH  | `/api/v1/lessons/:id/progress`     | Learner (enrolled) | Update watch percent / completion  |
| GET    | `/api/v1/educators/me/dashboard`   | Educator           | Enrollment + revenue summary       |
| POST   | `/api/v1/lessons/:id/draft-script` | Educator (owner)   | AI script draft from linked recipe |

---

## Infrastructure

| Component         | Service           | Notes                                                           |
| ----------------- | ----------------- | --------------------------------------------------------------- |
| Raw video storage | S3                | Separate bucket from recipe photos                              |
| Transcode         | AWS MediaConvert  | HLS output; 720p and 1080p renditions                           |
| CDN delivery      | CloudFront        | Signed URLs for enrolled learners; unsigned for preview lessons |
| Progress store    | RDS PostgreSQL 16 | `lesson_progress` table in existing cluster                     |
| Payments          | Stripe via 010    | New `course_purchase` product type                              |

---

## Cross-Feature Integration Points

### 010 — Subscriptions & Monetization

Course purchases are one-time charges processed through 010's Stripe integration. A new `course_purchase` product type is registered with 010. Educator subscription tier (free vs. pro) is read from 010 to determine revenue share rate and upload limits. Payout disbursement follows 010's existing schedule.

### 005 — AI Integration

The `/api/v1/lessons/:id/draft-script` endpoint calls the 005 AI service with the linked recipe entity and a lesson-specific prompt template. The 005 service is not modified; 013 adds a new prompt template only.

### 012 — Creator Profiles

`CreatorProfile` is owned by 012. 013 reads `creator_profile_id` to associate courses with an educator. Course listings appear on the educator's `@handle` profile page via a 012 extension point. 013 does not write to `CreatorProfile`.

### 002 — Auth

All educator and learner actions require a valid JWT (002). Educator role is a claim on the token, gated by 010 subscription tier. Enrollment access checks are enforced in the 013 lesson access guard.

### 001 — Recipe Entity

Lessons hold an optional `recipe_id` FK. The recipe entity is read-only from 013's perspective; it provides source material for AI script drafting and the in-player recipe drawer.

---

## Metrics & Success Criteria

| Metric                           | 90-day Target      |
| -------------------------------- | ------------------ |
| Active course publishers         | 50                 |
| Courses published                | 100                |
| Learner enrollments              | 1,000              |
| Lesson completion rate           | >40%               |
| Gross merchandise volume         | $10,000            |
| Educator dashboard weekly active | >60% of publishers |

---

## Open Questions for Revalidation

1. À la carte lesson purchases in v1 or v2?
2. Minimum viable educator analytics: views only, or views + revenue breakdown?
3. Mobile video upload (phone camera) in v1, or web-only?
4. AI script drafting from public recipes the educator doesn't own — allowed or restricted to owned recipes?
5. Should the free preview lesson be configurable per course, or always the first lesson?
