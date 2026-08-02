# Feature Specification: Cooking School (Video Learning Platform)

**Feature Branch**: `013-cooking-school`
**Created**: 2026-05-09
**Status**: Bootstrapped
**Input**: Defined via cross-feature consistency report §11 (2026-05-09). Largest scope of the 011/012/013 expansion.

## Overview

013-cooking-school is a two-sided video learning marketplace. Educators (P13 Reese) create and sell structured cooking lessons and courses. Learners (P12 Jamie) discover, purchase, and progress through that content. This is the largest of the three new features by scope, touching video infrastructure, payments, AI drafting, and creator identity.

Live classes are explicitly **Phase 2** and out of scope for v1.

## Personas

| Role               | Persona   | Relationship                                               |
| ------------------ | --------- | ---------------------------------------------------------- |
| Primary (learner)  | P12 Jamie | Discovers and completes cooking courses                    |
| Primary (educator) | P13 Reese | Creates, publishes, and monetizes lessons                  |
| Secondary          | P1 Casey  | Overlap consumer; uses lessons to improve everyday cooking |
| Secondary          | P2 Taylor | Overlap consumer; follows specific educators               |
| Tertiary           | P9 Drew   | Pro-level content creator; high-production courses         |

Both P12 and P13 are co-primary. This feature cannot be designed for one side without the other.

## Audience Scope

`published-lesson` is a canonical audience scope under the unified audience model defined in `specs/cross-feature-consistency-report.md` §10 and enforced by `specs/governance-rules.md` GR-014. Feature 013 defines the lesson/course access rules applied to that scope: a lesson with `visibility: published-lesson` is accessible to any authenticated user who has purchased the parent course, or the lesson individually if that sales mode is later enabled.

## Dependencies

| Spec                                                            | Relationship                                                                                |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| [002-user-auth](../002-user-auth/spec.md)           | **Required** — all learner and educator sessions are authenticated                          |
| [001-commise-recipe-app](../001-commise-recipe-app/spec.md) | **Referenced** — recipe entity used as source material for lesson scripts                   |
| [005-ai-integration](../005-ai-integration/spec.md)             | **Referenced** — AI-assisted lesson script drafting from recipes (P13 Reese "Should" story) |
| [010-subscriptions](../010-subscriptions/spec.md)               | **Required** — course purchases, educator subscription tiers, revenue share                 |
| [012-creator-profiles](../012-creator-profiles/spec.md)         | **Required** — `CreatorProfile` provides educator identity and `@handle` pages              |

## Source-of-Truth Note

This file is the canonical feature boundary, audience-scope document, **and** the authoritative
functional-requirement enumeration. The crosswalk from `product-spec/product-spec.md` is **complete**
(2026-08-02); the `spec.md` ↔ `product-spec/` drift warning is closed.

## In-Scope (v1)

- Video upload, transcode pipeline, and CDN delivery
- Lesson entity: title, description, video asset, transcript, attached recipe references
- Course entity: ordered collection of lessons, pricing, thumbnail
- Learner enrollment and progress tracking (per-lesson completion state)
- Educator dashboard: upload, publish, unpublish, basic analytics (views, completions, revenue)
- Course purchase flow via 010 billing; revenue share calculation
- AI-assisted lesson script drafting from a linked recipe (005 integration)
- `published-lesson` audience-scope access rules
- Educator profile page powered by 012 `CreatorProfile`

## Functional Requirements

Canonical enumeration — crosswalked from `product-spec/product-spec.md` §Functional Requirements
(2026-08-02). `plan.md`, `tasks.md`, and `v-model/` trace to these IDs. Prior to this crosswalk
`spec.md` carried **no** FR definitions at all while 20 FR IDs were cited across those artifacts.

### Must Have (v1) — FR-001 … FR-010

| ID | Requirement | Persona |
| ------ | ----------- | --------- |
| FR-001 | Educators can create a course with title, description, thumbnail, and price | P13 Reese |
| FR-002 | Educators can upload video lessons; platform transcodes to HLS and delivers via CDN | P13 Reese |
| FR-003 | Learners can browse and purchase courses; enrollment is immediate post-payment | P12 Jamie |
| FR-004 | First lesson of every course is free to preview without purchase | P12 Jamie, P1 Casey |
| FR-005 | Learner progress is tracked per lesson (watch percent, completed_at) | P12 Jamie |
| FR-006 | Educators can view enrollment count, lesson completion rates, and revenue per course | P13 Reese, P9 Drew |
| FR-007 | Educators can link a recipe to a lesson and request an AI-drafted script outline | P13 Reese |
| FR-008 | `published-lesson` audience scope (S-004) gates lesson access to enrolled learners | Platform |
| FR-009 | Educator identity is the `CreatorProfile` from 012; no separate educator profile | P13 Reese |
| FR-010 | Revenue share: platform 20%, educator 80% (pro tier: 15%/85% via 010) | P13 Reese, P9 Drew |

### Should Have (v1) — FR-011 … FR-014

| ID | Requirement | Persona |
| ------ | ----------- | --------- |
| FR-011 | Learners can follow educators and see new courses in their feed (via 012 follow graph) | P2 Taylor |
| FR-012 | Educators can reorder lessons within a course via drag-and-drop | P13 Reese |
| FR-013 | Lesson player shows linked recipe in a side drawer (read-only reference; no timer-synced steps, voice prompts, or ingredient checkoff — hands-free step-by-step execution is owned by 008 Cooking Mode; this feature ends at video playback + lesson-level resources) | P12 Jamie |
| FR-014 | Educators can publish/unpublish individual lessons without unpublishing the whole course | P13 Reese |

## Out of Scope (v1)

- Live classes / live streaming (Phase 2)
- Community Q&A or comments on lessons
- Certificates or badges
- Mobile video playback offline download


**Deferred requirement IDs.** These IDs are defined so that citations resolve; they are **explicitly
out of scope for v1** and MUST NOT be planned or traced as deliverable requirements.

| ID | Requirement | Notes |
| ------ | ----------- | --------- |
| FR-015 | Live class scheduling and streaming | Phase 2 |
| FR-016 | Completion certificates or badges | Future |
| FR-017 | Offline video download (mobile) | Future |
| FR-018 | Community Q&A or lesson comments | Future |
| FR-019 | À la carte individual lesson purchases | Evaluate post-launch |
| FR-020 | Hands-free cook-along during video playback (timer-synced steps, voice prompts, in-player ingredient checkoff) | Owned by 008 Cooking Mode |

## API Surface

All paths under `/api/v1/`. Package names follow `@kitchensink/{group}-{name}` convention. Runtime: Node 24.x / NestJS 11.

| Method | Path                               | Description                              |
| ------ | ---------------------------------- | ---------------------------------------- |
| POST   | `/api/v1/courses`                  | Create course (educator)                 |
| GET    | `/api/v1/courses/:id`              | Get course detail                        |
| POST   | `/api/v1/courses/:id/lessons`      | Add lesson to course                     |
| GET    | `/api/v1/lessons/:id`              | Get lesson (gated by enrollment)         |
| POST   | `/api/v1/courses/:id/enroll`       | Purchase/enroll in course                |
| GET    | `/api/v1/learners/me/progress`     | Get learner progress across all courses  |
| PATCH  | `/api/v1/lessons/:id/progress`     | Update lesson completion state           |
| GET    | `/api/v1/educators/me/dashboard`   | Educator analytics summary               |
| POST   | `/api/v1/lessons/:id/draft-script` | AI script draft from linked recipe (005) |

## Cross-Feature Touches

**010 (Subscriptions)**: Course purchases flow through 010's billing primitives. Educator subscription tiers (free educator vs. pro educator) gate upload limits and revenue share rates. Revenue share is calculated and disbursed via 010's payout model.

**005 (AI Integration)**: P13 Reese can trigger AI script drafting from any recipe she owns. The 005 service receives the recipe entity and returns a structured lesson outline. This is a "Should" priority story for v1.

**012 (Creator Profiles)**: Educator identity on the platform is the `CreatorProfile` from 012. The cooking school does not redefine it. Educator course listings appear on the `@handle` profile page.

**011 (Circles)**: No direct dependency. `Circle` is owned by 011 and not used by 013 in v1.

## User Stories

### Must Have

**US-001** (P12 Jamie): As a learner, I can browse and purchase a cooking course so that I can learn a new technique at my own pace.

**US-002** (P13 Reese): As an educator, I can upload a video lesson and publish it within a course so that learners can access my content.

**US-003** (P12 Jamie): As a learner, I can track which lessons I've completed so that I know where I left off.

**US-004** (P13 Reese): As an educator, I can see how many learners enrolled and completed each lesson so that I can improve my content.

**US-005** (P13 Reese): As an educator, I can link a recipe to a lesson and request an AI-drafted script outline so that I spend less time writing from scratch.

### Should Have

**US-006** (P1 Casey): As a casual learner, I can preview the first lesson of a course before purchasing so that I can judge fit before committing.

**US-007** (P2 Taylor): As a learner, I can follow an educator and see their new courses in my feed so that I don't miss new content.

**US-008** (P9 Drew): As a pro educator, I can set per-course pricing and see my revenue share breakdown so that I can run a sustainable teaching business.

### Won't Have (v1)

**US-009**: Live class scheduling and streaming (Phase 2).
