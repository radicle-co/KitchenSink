# Feature Specification: Public Creator Profiles

**Feature Branch**: `012-creator-profiles`
**Created**: 2026-05-09
**Status**: Bootstrapped (pending revalidation)
**Mode**: retroactive-bootstrap

## Overview

Creator Profiles gives home cooks, food bloggers, and professional chefs a public identity on KitchenSink. Each creator gets an `@handle` URL, a curated profile page, and tools to grow an audience. Followers can discover recipes through the creator's public collections. Embed widgets let creators share their profile on external sites.

This feature owns the `CreatorProfile` entity and the `public-profile` audience behavior. `public-profile` is a canonical audience scope under the unified audience model defined in `specs/cross-feature-consistency-report.md` §10 and enforced by `specs/governance-rules.md` GR-014. Monetization extensions (tip jars, paid follows, premium recipe gates) are implemented here but delegate billing mechanics to 010-subscriptions.

## Dependencies

| Spec                                                            | Relationship                                                                                                          |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| [002-user-auth](../002-user-auth/spec.md)           | **Required** — `@handle` is tied to an authenticated identity; profile creation requires a verified account           |
| [001-commise-recipe-app](../001-commise-recipe-app/spec.md) | **Required** — recipes are the primary content surface on a creator profile                                           |
| [010-subscriptions](../010-subscriptions/spec.md)               | **Integration** — tip jars, premium recipe gates, and paid follows extend 010's billing model                         |
| [011-recipe-digitization](../011-recipe-digitization/spec.md)   | **Peer** — `circle` is owned by 011; `public-profile` is owned here; the two audience scopes are siblings, not nested |

## Personas

- **Primary — P11 Robin** (aspiring food creator): wants a shareable profile to build an audience and eventually earn from their recipes.
- **Secondary — P5 Morgan** (discovery-driven home cook): browses creator profiles to find trusted recipe sources and follows creators whose style matches their taste.
- **Tertiary — P9 Drew** (professional chef / brand): needs a polished public presence with embed widgets for their restaurant or catering website.

## Audience Scope Defined Here

`public-profile`: content visible to any unauthenticated visitor on a creator's `/@handle` page. It is distinct from `circle` (private invite groups, owned by 011) and `published-lesson` (lesson/course access rules applied by 013).

## Source-of-Truth Note

This file is the canonical feature boundary, audience-scope document, **and** the authoritative
functional-requirement enumeration. The crosswalk from `product-spec/product-spec.md` is **complete**
(2026-08-02): FR-001 … FR-030 below are the single authoritative representation, and `plan.md`,
`tasks.md`, and `v-model/` trace to these IDs.

Previously this section carried six coarse capability groupings that reused `FR-001` … `FR-006` with
**different meanings** from the enumeration in `product-spec/`, so a bare `FR-002` resolved to two
different requirements depending on which document the reader opened. That collision is resolved: the
capability groupings are retained below as prose without IDs, and every numbered requirement now has
exactly one meaning.

## Capability Overview

Six capabilities frame the feature. They are narrative groupings, **not** requirement IDs.

- **@handle profile pages** — every user may claim a unique `@handle`; `/@handle` shows bio, avatar,
  follower count, and pinned public collections, viewable without authentication.
- **Follow / unfollow** — authenticated users follow creators; counts are public; a follower's feed
  surfaces new recipes from followed creators (integration point with 001's recipe feed).
- **Public collections** — creators group recipes into named, ordered collections, each with its own
  shareable URL, surfaced on the profile page.
- **Embed widgets** — a creator can generate an embeddable `<iframe>` snippet for their profile card
  or a specific collection, CDN-served with no auth dependency.
- **Basic creator analytics** — a private dashboard of profile views, follower growth, top recipes by
  saves, and collection click-through, aggregated with no individual visitor tracking.
- **Monetization surface (extends 010)** — tip jar (one-time tips via 010's payment flow), premium
  recipes (010 owns the paywall and revenue split), and paid follows (010 owns billing, 012 owns the
  follow-tier model).

> **Open gap — monetization is not yet enumerated.** The crosswalk found no FR-level requirements for
> the tip jar, premium recipes, or paid follows in `product-spec/product-spec.md`; FR-001 … FR-030
> cover profile, discovery, attribution, follow, publishing, moderation, analytics, widget, and API
> surface only. Monetization therefore has narrative scope but **no testable requirements**, and
> 012-FR-‹new› IDs must be authored and ratified before the monetization work is planned. Tracked in
> `review.md`.

## Functional Requirements

Canonical enumeration — promoted verbatim from `product-spec/product-spec.md` §3.

### Profile Creation & Management (FR-001 … FR-005)

- **FR-001** A user MAY claim a unique `@handle` (3–30 chars, lowercase alphanumeric + underscore, no consecutive underscores, cannot start/end with underscore) to activate a `CreatorProfile`.

- **FR-002** A creator MUST be able to set `displayName` (max 80 chars), `bio` (max 160 chars), and upload an avatar image (JPEG/PNG/WebP, max 5 MB, stored in S3).

- **FR-003** The system MUST enforce global handle uniqueness at write time via a unique index; a handle-availability check endpoint MUST respond in < 100 ms.

- **FR-004** A creator MUST be able to deactivate their profile, which hides the public page and removes them from discovery surfaces without deleting underlying recipes.

- **FR-005** Handle changes MUST be rate-limited to once per 30 days; the previous handle MUST be reserved for 14 days to prevent squatting.


### Public Profile URL & Discovery (FR-006 … FR-009)

- **FR-006** Every active `CreatorProfile` MUST be accessible at `commise.com/@{handle}` (canonical URL) without authentication.

- **FR-007** Profile pages MUST be server-side rendered (Next.js SSR) with `<title>`, `<meta description>`, and Open Graph tags populated from `CreatorProfile` fields.

- **FR-008** The public profile page MUST display: avatar, display name, bio, follower count, public collections, and a paginated list of public recipes.

- **FR-009** Follower lists MUST NOT be publicly visible; only the aggregate `followerCount` is exposed.


### Recipe Attribution (FR-010 … FR-012)

- **FR-010** Every public recipe owned by a creator MUST display a link back to the creator's `@handle` profile page.

- **FR-011** If a recipe is imported or forked from another creator's recipe, the original creator's `@handle` MUST be shown as the attribution source.

- **FR-012** Attribution links MUST survive recipe edits; the `attributedToCreatorId` field is immutable once set.


### Follow / Subscribe (FR-013 … FR-016)

- **FR-013** An authenticated user MUST be able to follow or unfollow a creator; both operations MUST be idempotent.

- **FR-014** Following a creator MUST cause that creator's new public recipes to appear in the follower's feed (feed ownership: 001/005).

- **FR-015** `followerCount` and `followingCount` MUST be updated within 5 seconds of a follow/unfollow event (eventual consistency via DB trigger or application-level counter with optimistic locking).

- **FR-016** A creator MUST be able to view a count of their followers but MUST NOT access the identity of individual followers without their explicit consent.


### Content Publishing (FR-017 … FR-019)

- **FR-017** A creator MUST be able to organise public recipes into named collections (max 20 collections per creator in v1; max 60-char name, max 200-char description).

- **FR-018** Collections MUST support manual ordering of recipes; the order MUST be persisted and returned in API responses.

- **FR-019** Only recipes with `visibility = public` (owned by 001) and authored by the creator MAY be added to a collection.


### Moderation (FR-020 … FR-022)

- **FR-020** The platform MUST allow a Support/Admin Operator to suspend a `CreatorProfile` (hides public page, blocks new follows) pending review without deleting data.

- **FR-021** A suspended creator MUST receive an in-app notification stating the reason and an appeal path.

- **FR-022** DMCA takedown requests targeting a creator's recipe MUST be routable to the Compliance Reviewer role; the affected recipe MUST be unpublished within 24 hours of a valid notice.


### Analytics (FR-023 … FR-025)

- **FR-023** A creator MUST be able to view aggregated analytics for their own profile: daily profile views, follower delta, top-performing recipes by view count, and collection click-through counts.

- **FR-024** Analytics MUST be aggregated-only; no individual visitor identity or IP address MAY be stored or surfaced.

- **FR-025** Analytics snapshots MUST be computed by a scheduled Lambda (daily cron) and stored in `creator_analytics_snapshots`.


### Embed Widget (FR-026 … FR-027)

- **FR-026** `GET /api/v1/creators/:handle/widget` MUST return a static HTML fragment (no JavaScript) rendering: avatar, display name, follower count, and the 3 most-recently-published public recipes.

- **FR-027** The widget response MUST carry `Cache-Control: public, max-age=300` for CloudFront CDN caching; p95 latency on a cache hit MUST be < 50 ms.


### API Surface (FR-028 … FR-030)

- **FR-028** All API routes for this feature MUST be prefixed `/api/v1/` and versioned independently of other features.

- **FR-029** The profile creation endpoint (`POST /api/v1/creators`) MUST validate handle format, check uniqueness, and return HTTP 409 on conflict.

- **FR-030** All owner-scoped endpoints MUST require a valid Clerk session token; the `sub` claim MUST match the `userId` on the `CreatorProfile`.

## API Paths

All endpoints under `/api/v1/` per `docs/api-conventions.md` (authored under feature 005; not yet on `main`). Node 24.x.
The backend package is `@kitchensink/creator-profiles-service` in `packages/services/creator-profiles-service/`,
following the shipped `@kitchensink/{name}` form — **not** GR-009's `@kitchensink/{group}-{name}`, which no
shipped package uses (see [GR-009 Current State](../governance-rules.md#gr-009-package-naming-convention)).

| Method | Path                                       | Description                            |
| ------ | ------------------------------------------ | -------------------------------------- |
| GET    | `/api/v1/creators/:handle`                 | Public profile data                    |
| GET    | `/api/v1/creators/:handle/collections`     | List public collections                |
| GET    | `/api/v1/creators/:handle/collections/:id` | Collection detail + recipes            |
| POST   | `/api/v1/creators/:handle/follow`          | Follow a creator (auth required)       |
| DELETE | `/api/v1/creators/:handle/follow`          | Unfollow (auth required)               |
| GET    | `/api/v1/creators/:handle/analytics`       | Creator's own analytics (auth = owner) |
| GET    | `/api/v1/creators/:handle/widget`          | Embed widget HTML fragment             |
| POST   | `/api/v1/creators/:handle/tip`             | Initiate tip (delegates to 010)        |

## Entity Ownership

**`CreatorProfile`** is defined and owned by this feature. Fields: `id`, `userId` (FK → auth), `handle` (unique), `displayName`, `bio`, `avatarKey` (S3), `followerCount`, `followingCount`, `isVerified`, `monetizationEnabled`, `createdAt`, `updatedAt`.

Referenced by:

- 010-subscriptions: `creatorId` on `PaidFollow` and `TipTransaction` tables.
- 013-cooking-school: `creatorId` on `Course` and `Lesson` tables (educator profile surface).

## Out of Scope

- Video hosting or lesson content (owned by 013).
- Circle / private group sharing (owned by 011).
- AI-generated bio or recipe suggestions (owned by 005).
- Verified badge issuance process (internal ops, not a user-facing feature).
