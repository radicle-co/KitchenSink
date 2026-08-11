# Feature Specification: Public Creator Profiles

**Feature Branch**: `012-creator-profiles`
**Created**: 2026-05-09
**Status**: Bootstrapped (pending revalidation)
**Mode**: retroactive-bootstrap

## Overview

Creator Profiles gives home cooks, food bloggers, and professional chefs a public identity on KitchenSink. Each creator gets an `@handle` URL, a curated profile page, and tools to grow an audience. Followers can discover recipes through the creator's public collections. Embed widgets let creators share their profile on external sites.

This feature owns the `CreatorProfile` entity and the `public-profile` audience behavior. `public-profile` is a canonical audience scope under the unified audience model defined in `specs/cross-feature-consistency-report.md` §10 and enforced by `specs/governance-rules.md` GR-014. Monetization extensions (the tip jar and the creator-earnings surface) are implemented here but delegate billing mechanics to 010-subscriptions. There are **no premium recipes and no paid follows** — recipe visibility is binary private/public and owned by 001.

## Dependencies

| Spec                                                          | Relationship                                                                                                                                                                   |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [002-user-auth](../002-user-auth/spec.md)                     | **Required** — `@handle` is tied to an authenticated identity; profile creation requires a verified account                                                                    |
| [001-commise-recipe-app](../001-commise-recipe-app/spec.md)   | **Required** — recipes are the primary content surface on a creator profile                                                                                                    |
| [010-subscriptions](../010-subscriptions/spec.md)             | **Integration** — the tip jar and creator-earnings surface extend 010's billing model. No premium recipes, no paid follows: visibility is binary private/public, owned by 001. |
| [011-recipe-digitization](../011-recipe-digitization/spec.md) | **Peer** — `circle` is owned by 011; `public-profile` is owned here; the two audience scopes are siblings, not nested                                                          |

## Personas

- **Primary — P11 Robin** (aspiring food creator): wants a shareable profile to build an audience and eventually earn from their recipes.
- **Secondary — P5 Morgan** (discovery-driven home cook): browses creator profiles to find trusted recipe sources and follows creators whose style matches their taste.
- **Tertiary — P9 Drew** (professional chef / brand): needs a polished public presence with embed widgets for their restaurant or catering website.

## Audience Scope Defined Here

`public-profile`: content visible to any unauthenticated visitor on a creator's `/@handle` page. It is distinct from `circle` (private invite groups, owned by 011) and `published-lesson` (lesson/course access rules applied by 013).

## Source-of-Truth Note

This file is the canonical feature boundary, audience-scope document, **and** the authoritative
functional-requirement enumeration. The crosswalk from `product-spec/product-spec.md` is **complete**
(2026-08-02): FR-001 … FR-030 below are the single authoritative representation — joined by
FR-031 … FR-034 (monetization, **DRAFT**, blocked on marketplace payments). `plan.md`,
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
- **Monetization surface (extends 010)** — a **tip jar** (one-time tips via 010's payment flow) and a
  read-only earnings view. There are **no premium recipes and no paid follows**: recipe visibility is
  binary private/public and owned by 001, so 012 has no gated content to sell. Following is free.

> **Monetization is now enumerated** as `FR-031` … `FR-034` below (tip jar + earnings), **marked DRAFT** and
> blocked on marketplace payments. An earlier revision of this PR also invented premium recipes and paid
> follows; those are **withdrawn** — recipe visibility is binary private/public and owned by 001.

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

### Monetization — Tip Jar (FR-031 … FR-033) — **DRAFT, merchant-blocked**

> **DRAFT — not ratified.** Blocked on marketplace payments; see the dependency note below.

- **FR-031** An active `CreatorProfile` MAY enable a tip jar. When enabled, the public profile page MUST render a tip control; when disabled, it MUST NOT render, and the tip endpoint MUST return HTTP 404 for that creator.
- **FR-032** A tip MUST be a one-time payment in a fixed set of amounts plus a caller-specified custom amount, bounded by a configured minimum and maximum. A tip MUST NOT create a recurring charge.
- **FR-033** A completed tip MUST be recorded against the recipient creator and MUST NOT expose the tipper's identity to the creator beyond a display name the tipper opted to share. Tip totals surface only in aggregate, consistent with `FR-024`.

### Monetization — Earnings Surface (FR-034) — **DRAFT, merchant-blocked**

- **FR-034** 012 MUST present a creator's earnings read-only (tip revenue, aggregated by period). 012 MUST NOT compute revenue splits, hold balances, or initiate disbursement.

> ### ⛔ Withdrawn 2026-08-02 — there is no such thing as a premium recipe
>
> An earlier revision of this section (in this same PR, never ratified) invented **premium recipes** and
> **paid follows**: a creator marking a recipe premium, server-side withholding of its ingredients and
> instructions from unentitled viewers, per-recipe purchase granting perpetual access, a creator-priced
> follow tier, and a "premium feed". **All of it is withdrawn.** It contradicted the product's actual
> content model.
>
> **The visibility model is binary, and 001 owns it**: a recipe is **private** or **public**
> (`001-FR-003`, `001-FR-004`). There is no third, paywalled state, and 012 does not get to introduce one.
> A **private** recipe may be shared with contacts **read-only** — that is 011's `circle` audience scope
> (`{ scope: 'circle', ref_id }`) with member read-only access per `011` US-006, **not** a purchase.
>
> The tip jar and earnings requirements above were renumbered into `FR-031` … `FR-034`, and the withdrawn
> IDs are **retired, not reused** — see the register below.

### Retired Requirement IDs — do not reuse

Withdrawn 2026-08-02 with the premium-recipe model. Listed so the numbers stay burned: reusing one would
make every historical reference silently resolve to a different requirement.

| ID     | Withdrawn requirement                                               | Why it cannot exist                                           |
| ------ | ------------------------------------------------------------------- | ------------------------------------------------------------- |
| FR-035 | Creator marks an authored recipe as premium                         | No paywalled visibility state — a recipe is private or public |
| FR-036 | Server-side withholding of ingredients/instructions from non-buyers | Nothing to withhold from; public recipes are readable by all  |
| FR-037 | Per-recipe purchase grants perpetual access                         | Recipes are not purchasable                                   |
| FR-038 | Creator-priced paid follow tier                                     | Following is free; no gated feed exists to sell               |
| FR-039 | No retroactive paywalling of already-entitled content               | Moot — there is no paywalled content                          |

Read-only sharing of a **private** recipe with contacts is served by 011's `circle` audience scope, not by
any of the above.

> What survives is **creator compensation that is not tied to gated content**: the tip jar and the earnings
> surface. Both remain blocked on marketplace payments.

> ### Dependency status — creator compensation is blocked
>
> `FR-031` … `FR-034` assume 010 provides one-time payments and payouts. **It provides neither.** Feature
> 010's entire functional scope is `010-FR-040` … `010-FR-044`: a free/premium **subscriber** tier on Stripe
> Checkout + Customer Portal, upgrade prompts, downgrade retention, and the tier as a signed token claim. It
> has no one-time payment, marketplace, revenue-split, or payout surface, and its Out-of-Scope section rules
> out even multi-seat family plans.
>
> Per [`cross-feature-FR-index.md`](../cross-feature-FR-index.md) Review Rule 3 this stays a
> **capability-level dependency** rather than an invented FR in 010's namespace. Marketplace payments need
> their own spec — in 010 or a dedicated payments feature — including the money-transmission and tax posture
> that splitting third-party revenue implies. **Feature 013 carries the same dependency** for `013-FR-010`'s
> 20%/80% revenue share.

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

### Contract ownership (GR-015) — the service authors it, and clients declare nothing

**Normative sources**: [`docs/CODING_STANDARDS.md` §15](../../docs/CODING_STANDARDS.md) ·
[`GR-015`](../governance-rules.md#gr-015-api-contract-ownership) ·
[ADR-0014](../../docs/architecture/decisions/0014-service-owned-api-contracts.md).

| Role                                        | Binding for 012                                                                                 |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Owning service (**authors** the zod)        | `@kitchensink/creator-profiles-service` — `src/**/*.schema.ts`, beside the controller it serves |
| Schema package (generated, committed)       | `@kitchensink/schema-creator-profiles` — `packages/schemas/creator-profiles`                    |
| Consuming client                            | `packages/clients/creator-profiles`                                                             |
| Consuming apps                              | `@commise/web`, `@commise/mobile`                                                               |
| Domain types (a **different** axis, GR-007) | `@kitchensink/recipe-core` — reused `import type`, never re-declared inside the schema package  |

**The service MUST** author every profile, collection, follow, analytics and tip-initiation request/response
shape as **zod in the service** beside its controller; **validate its own requests with that same zod** via
`nestjs-zod`'s `createZodDto` (handle format and uniqueness-error shapes included, so a client sees the same
constraint the server enforces); generate and commit `@kitchensink/schema-creator-profiles` exporting the zod,
`z.infer` types, `contract-hash.ts`, a barrel and a **derived** `openapi.yaml` (outbound only — for `oasdiff`,
docs and integrators, **never a codegen input**); and keep every `*.schema.ts` importing **only `zod` and other
`*.schema.ts` files**.

**Every client MUST** — separately mandatory, because mandating only the service half is exactly how the client
half got skipped portfolio-wide (276 + 144 lines of redeclared wire types survived behind green builds):

- Import its wire **types and zod** from `@kitchensink/schema-creator-profiles`, and **declare no
  creator-profile request or response body type of its own** — including in `@commise/web`, `@commise/mobile`
  and feature packages (GR-015 §15-b.4).
- **The SSR public-profile payload is the load-bearing case.** `/@handle` is server-rendered, so its response
  shape is consumed by web SSR, by mobile, and by the embed fragment. A hand-written "profile page props"
  interface is a second representation of that payload; it must be a **DERIVATION** of the wire type via
  `Pick` / `Omit` / `Partial`. Reference:
  `packages/apps/commise/features/recipes/src/filters/model.ts`.
- A follower-count badge model or an analytics chart series is likewise derived, not re-declared.
- **A new endpoint is not complete until its types are reachable from the schema package.** "The profile page
  will add the type" is a contract fork, not a task.

⚠️ **`GET /api/v1/creators/:handle/widget` returns an HTML fragment, not JSON.** Its **response body** is
therefore not a wire _shape_ the schema package can express — but its **request** (path/query params) and its
**error** responses are, and they are authored as zod like everything else. Do not treat "it returns HTML" as
an exemption from the rest of this section.

⚠️ **Third-party APIs (GR-015 §15-d).** 012 owns no external integration: the tip endpoint **delegates to 010**,
so **Stripe's shapes are 010's boundary concern and must not appear here**. `POST .../tip`'s own request and
response are ours and are authored in this service. If 012 ever calls an external API directly, that client is
the **opposite** case — it **validates the raw upstream shape at the boundary with zod**, **may declare its own
types**, and **gets no OpenAPI document**. `packages/clients/usda` is the reference implementation and its
`schemas.ts` must never be "converged"; deleting a boundary schema in the name of this section removes a
validation boundary rather than tidying one.

**Drift gates** — inherited from GR-015 §15-c, all three required, not reinvented here: turbo `inputs` rebuild,
the regenerate-and-diff CI gate, and the `CONTRACT_HASH` boot assertion.

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
