# Product Specification: Public Creator Profiles (012)

**Feature**: `012-creator-profiles`
**Version**: 1.0 (bootstrapped 2026-05-09)
**Status**: Pending revalidation

---

## 1. Problem & Opportunity

Creators on KitchenSink have no public identity. Recipes exist in isolation with no "see more from this person" path. Discovery-oriented users can't follow a trusted source. Professional chefs can't link clients to a curated presence.

This feature closes that gap by giving every user the option to become a public creator with a profile page, a following, and a public audience surface.

---

## Vision

KitchenSink becomes the home for food creators who want a professional public presence without leaving the platform where they already cook. P11 Robin — a food blogger building an audience — gets a canonical `commise.com/@handle` URL, a curated collection surface, and the analytics to understand what resonates. P5 Morgan, the discovery-oriented home cook, gains a trusted follow graph that surfaces new recipes from creators they care about, replacing aimless search with a personalised feed. P9 Drew, the professional chef, can embed a live recipe widget on their restaurant website and point clients to a verified, branded profile. Together these three personas define the core value loop: creators publish, followers discover, professionals extend reach. All paid mechanics — tipping, subscription tiers, premium gating — are intentionally deferred to feature 010 (Subscriptions) so that 012 can ship a clean, fast, free-to-use identity layer first.

---

## 2. User Stories

### Must Have

**US-001** (P11 Robin): As a recipe creator, I want to claim a unique `@handle` so I have a shareable URL I can put in my social bio.

**US-002** (P11 Robin): As a creator, I want to organize my recipes into named collections so visitors can browse my content by theme.

**US-003** (P5 Morgan): As a home cook, I want to follow a creator so their new recipes appear in my feed without me having to search for them.

**US-004** (P5 Morgan): As a visitor, I want to browse a creator's profile page without logging in so I can evaluate whether to follow them.

**US-005** (P9 Drew): As a professional chef, I want an embed widget I can paste into my restaurant website so clients can see my recipes without leaving my site.

**US-006** (P11 Robin): As a creator, I want to see how many people viewed my profile and followed me this week so I know if my content is growing.

### Should Have

**US-007** (P11 Robin): As a creator, I want to enable a tip jar so followers can support me with a one-time payment. _(monetization handled by 010 Subscriptions; out of scope)_

**US-008** (P11 Robin): As a creator, I want to mark specific recipes as premium so only paying followers can access the full recipe. _(monetization handled by 010 Subscriptions; out of scope)_

**US-009** (P9 Drew): As a professional chef, I want a verified badge on my profile so visitors know I'm a credentialed creator.

### Could Have

**US-010** (P11 Robin): As a creator, I want to offer a paid monthly follow tier so my most engaged followers can support me on a recurring basis. _(monetization handled by 010 Subscriptions; out of scope)_

**US-011** (P5 Morgan): As a follower, I want to receive a weekly digest of new recipes from creators I follow.

### Won't Have (v1)

- Video content on profiles (owned by 013).
- Private group sharing via Circle (owned by 011).
- AI-generated bio suggestions (owned by 005).
- Verified badge issuance workflow (internal ops).

---

## 3. Functional Requirements

### Profile Creation & Management

**FR-001** A user MAY claim a unique `@handle` (3–30 chars, lowercase alphanumeric + underscore, no consecutive underscores, cannot start/end with underscore) to activate a `CreatorProfile`.

**FR-002** A creator MUST be able to set `displayName` (max 80 chars), `bio` (max 160 chars), and upload an avatar image (JPEG/PNG/WebP, max 5 MB, stored in S3).

**FR-003** The system MUST enforce global handle uniqueness at write time via a unique index; a handle-availability check endpoint MUST respond in < 100 ms.

**FR-004** A creator MUST be able to deactivate their profile, which hides the public page and removes them from discovery surfaces without deleting underlying recipes.

**FR-005** Handle changes MUST be rate-limited to once per 30 days; the previous handle MUST be reserved for 14 days to prevent squatting.

### Public Profile URL & Discovery

**FR-006** Every active `CreatorProfile` MUST be accessible at `commise.com/@{handle}` (canonical URL) without authentication.

**FR-007** Profile pages MUST be server-side rendered (Next.js SSR) with `<title>`, `<meta description>`, and Open Graph tags populated from `CreatorProfile` fields.

**FR-008** The public profile page MUST display: avatar, display name, bio, follower count, public collections, and a paginated list of public recipes.

**FR-009** Follower lists MUST NOT be publicly visible; only the aggregate `followerCount` is exposed.

### Recipe Attribution

**FR-010** Every public recipe owned by a creator MUST display a link back to the creator's `@handle` profile page.

**FR-011** If a recipe is imported or forked from another creator's recipe, the original creator's `@handle` MUST be shown as the attribution source.

**FR-012** Attribution links MUST survive recipe edits; the `attributedToCreatorId` field is immutable once set.

### Follow / Subscribe

**FR-013** An authenticated user MUST be able to follow or unfollow a creator; both operations MUST be idempotent.

**FR-014** Following a creator MUST cause that creator's new public recipes to appear in the follower's feed (feed ownership: 001/005).

**FR-015** `followerCount` and `followingCount` MUST be updated within 5 seconds of a follow/unfollow event (eventual consistency via DB trigger or application-level counter with optimistic locking).

**FR-016** A creator MUST be able to view a count of their followers but MUST NOT access the identity of individual followers without their explicit consent.

### Content Publishing

**FR-017** A creator MUST be able to organise public recipes into named collections (max 20 collections per creator in v1; max 60-char name, max 200-char description).

**FR-018** Collections MUST support manual ordering of recipes; the order MUST be persisted and returned in API responses.

**FR-019** Only recipes with `visibility = public` (owned by 001) and authored by the creator MAY be added to a collection.

### Moderation

**FR-020** The platform MUST allow a Support/Admin Operator to suspend a `CreatorProfile` (hides public page, blocks new follows) pending review without deleting data.

**FR-021** A suspended creator MUST receive an in-app notification stating the reason and an appeal path.

**FR-022** DMCA takedown requests targeting a creator's recipe MUST be routable to the Compliance Reviewer role; the affected recipe MUST be unpublished within 24 hours of a valid notice.

### Analytics

**FR-023** A creator MUST be able to view aggregated analytics for their own profile: daily profile views, follower delta, top-performing recipes by view count, and collection click-through counts.

**FR-024** Analytics MUST be aggregated-only; no individual visitor identity or IP address MAY be stored or surfaced.

**FR-025** Analytics snapshots MUST be computed by a scheduled Lambda (daily cron) and stored in `creator_analytics_snapshots`.

### Embed Widget

**FR-026** `GET /api/v1/creators/:handle/widget` MUST return a static HTML fragment (no JavaScript) rendering: avatar, display name, follower count, and the 3 most-recently-published public recipes.

**FR-027** The widget response MUST carry `Cache-Control: public, max-age=300` for CloudFront CDN caching; p95 latency on a cache hit MUST be < 50 ms.

### API Surface

**FR-028** All API routes for this feature MUST be prefixed `/api/v1/` and versioned independently of other features.

**FR-029** The profile creation endpoint (`POST /api/v1/creators`) MUST validate handle format, check uniqueness, and return HTTP 409 on conflict.

**FR-030** All owner-scoped endpoints MUST require a valid Clerk session token; the `sub` claim MUST match the `userId` on the `CreatorProfile`.

---

## 4. Functional Scope

### 3.1 CreatorProfile Entity (owned here)

Fields: `id`, `userId` (FK), `handle` (unique, 3-30 chars, alphanumeric + underscore), `displayName`, `bio` (max 160 chars), `avatarKey` (S3), `followerCount`, `followingCount`, `isVerified`, `monetizationEnabled`, `createdAt`, `updatedAt`.

Handle validation: lowercase only, no consecutive underscores, cannot start/end with underscore, globally unique.

### 3.2 Audience Scope S-004 (defined here)

`public-profile`: content visible to any unauthenticated visitor at `/@handle`. Recipes in this scope must have `visibility = public` (defined in 001). Collections inherit the creator's public scope.

This scope is a sibling of S-003 `Circle` (owned by 011). They don't nest.

### 3.3 Follow Graph

`creator_follows` table: `(follower_id, creator_id)` composite PK. Follow/unfollow are idempotent. `followerCount` and `followingCount` are denormalized counters updated via DB trigger or application-level increment/decrement with optimistic locking.

### 3.4 Collections

Ordered lists of public recipes. A creator can have up to 20 collections (v1 limit). Each collection has a name (max 60 chars), optional description (max 200 chars), and an ordered list of recipe IDs. Recipes must be public and owned by the creator.

### 3.5 Embed Widget

Route: `GET /api/v1/creators/:handle/widget` returns an HTML fragment (not a full page). Renders: avatar, display name, follower count, 3 most-recently-saved public recipes. No JavaScript. Cache-Control: `public, max-age=300` (5 min CDN cache via CloudFront).

### 3.6 Analytics

Aggregated snapshots written by a scheduled Lambda (daily cron). Metrics stored in `creator_analytics_snapshots`: `creatorId`, `date`, `profileViews`, `followerDelta`, `topRecipeIds[]`, `collectionClicks`. Creators access via `GET /api/v1/creators/:handle/analytics` (owner-only, auth required).

### 3.7 Monetization Surface (reference only — all mechanics owned by 010)

> _(monetization handled by 010 Subscriptions; out of scope for 012)_ The table below documents the integration boundary only; 012 exposes thin delegation endpoints but owns no billing, payment, or subscription logic.

| Feature             | Owner                    | 012's Role                                                                             |
| ------------------- | ------------------------ | -------------------------------------------------------------------------------------- |
| Tip jar             | 010 (payment processing) | 012 exposes `POST /api/v1/creators/:handle/tip`; delegates to 010's payment intent API |
| Premium recipe gate | 010 (paywall)            | 012 sets `isPremium` flag on recipe-collection membership; 010 enforces access         |
| Paid follow tier    | 010 (billing)            | 012 defines follow tiers (`free`, `paid`); 010 handles subscription lifecycle          |

---

## 4. Non-Functional Requirements

| Requirement                   | Target                       |
| ----------------------------- | ---------------------------- |
| Profile page load (SSR, cold) | < 800 ms p95                 |
| Follow/unfollow API           | < 200 ms p95                 |
| Widget response (cached)      | < 50 ms p95 (CloudFront hit) |
| Handle uniqueness check       | < 100 ms (indexed lookup)    |
| Analytics dashboard load      | < 1 s p95                    |

**SEO**: `/@handle` pages rendered server-side (Next.js SSR). `<title>`, `<meta description>`, and Open Graph tags populated from `CreatorProfile` fields. Canonical URL: `https://kitchensink.app/@{handle}`.

**Privacy**: analytics are aggregated only. No individual visitor tracking. Follower lists are not public (counts are).

---

## 5. API Contract Summary

Base: `/api/v1/`. Runtime: Node 24.x. Package: `@kitchensink/creator-profiles-api`.

| Method | Path                                       | Auth  | Description                                                                      |
| ------ | ------------------------------------------ | ----- | -------------------------------------------------------------------------------- |
| GET    | `/api/v1/creators/:handle`                 | None  | Public profile                                                                   |
| PUT    | `/api/v1/creators/:handle`                 | Owner | Update profile                                                                   |
| GET    | `/api/v1/creators/:handle/collections`     | None  | List collections                                                                 |
| POST   | `/api/v1/creators/:handle/collections`     | Owner | Create collection                                                                |
| PUT    | `/api/v1/creators/:handle/collections/:id` | Owner | Update collection                                                                |
| DELETE | `/api/v1/creators/:handle/collections/:id` | Owner | Delete collection                                                                |
| POST   | `/api/v1/creators/:handle/follow`          | Auth  | Follow creator                                                                   |
| DELETE | `/api/v1/creators/:handle/follow`          | Auth  | Unfollow creator                                                                 |
| GET    | `/api/v1/creators/:handle/analytics`       | Owner | Analytics snapshot                                                               |
| GET    | `/api/v1/creators/:handle/widget`          | None  | Embed widget HTML                                                                |
| POST   | `/api/v1/creators/:handle/tip`             | Auth  | Initiate tip (→ 010) _(monetization handled by 010 Subscriptions; out of scope)_ |
| POST   | `/api/v1/creators`                         | Auth  | Claim handle / create profile                                                    |

---

## 6. Cross-Feature Boundaries

**012 owns**: `CreatorProfile` entity, `creator_follows`, `creator_collections`, `creator_collection_recipes`, `creator_analytics_snapshots`, audience scope S-004.

**012 does NOT own**:

- `Circle` entity or S-003 scope (011).
- `published-lesson` scope or `Course`/`Lesson` entities (013).
- Payment processing, subscription billing, revenue split (010).
- Recipe entity or `RecipeVisibility` enum (001).
- JWT issuance or `@handle`-to-`userId` resolution at auth layer (002).

---

## Internal Stakeholders

These are operational roles, not user personas. They do not appear in User Stories.

| Role                         | Responsibilities                                                                                                                                                                                                                                                 |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Support / Admin Operator** | Handle creator profile disputes; process handle-squatting complaints; suspend or reinstate profiles pending review; manage moderation appeals from creators who believe a suspension was incorrect.                                                              |
| **Compliance Reviewer**      | Process DMCA takedown notices targeting creator-published recipes; enforce content policy violations (hate speech, dangerous content); coordinate with legal on cross-border content removal obligations; audit `audience` scope changes for compliance logging. |

---

## 7. Success Metrics

| Metric            | v1 Target                                                   | Measurement                                          |
| ----------------- | ----------------------------------------------------------- | ---------------------------------------------------- |
| Handle claim rate | 20% of active creators within 30 days                       | `creator_profiles` row count / active recipe authors |
| Follow conversion | >8% of unique profile visitors                              | `creator_follows` inserts / profile view events      |
| Embed adoption    | >50 unique external domains                                 | Referrer header on widget requests                   |
| Tip transactions  | _(monetization handled by 010 Subscriptions; out of scope)_ | `TipTransaction` count tracked in 010's table        |

---

## Open Questions

**Q-001** Should 012 expose any monetization UI (tip button, premium badge) in v1, or should all such surfaces be deferred entirely to feature 010 (Subscriptions)? Current position: defer all tipping, subscription gating, and revenue share to 010; 012 ships zero paid mechanics in v1.

**Q-002** What is the creator handle reservation policy? Specifically: (a) how long is a released handle quarantined before it becomes available again? (b) are brand/trademark holders given priority claim? (c) is there a verified-creator fast-track for handle disputes?

**Q-003** What are the NSFW and moderation thresholds for creator-published content? Does the platform apply automated image classification on avatar uploads and recipe photos, or is moderation purely reactive (report-and-review)?

**Q-004** How should attribution conflicts be resolved when two creators both claim to be the original author of a recipe? Is there an arbitration workflow, or does the first-to-publish win?

**Q-005** Should `followerCount` be real-time or eventually consistent (daily snapshot)? The current spec uses eventual consistency via DB trigger; is that acceptable for creators who actively monitor growth?

**Q-006** What is the maximum number of public recipes a creator can have on their profile page before pagination is required, and what is the default page size?

**Q-007** Should the embed widget support a dark-mode variant, or is a single light-mode HTML fragment sufficient for v1?

**Q-008** Is the `isVerified` badge on `CreatorProfile` self-service (e.g., ID verification flow) or manually granted by an Admin Operator? The Won't Have list defers the issuance workflow to internal ops, but the field exists in the data model.

**Q-009** How should the platform handle a creator who deletes their account — should their `@handle` be permanently retired, quarantined, or released after a cooling-off period?

**Q-010** Does the analytics snapshot Lambda need to back-fill historical data on first run, or does day-0 of a new profile start with zero baseline?
