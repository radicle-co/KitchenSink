# Feature Specification: Public Creator Profiles

**Feature Branch**: `012-creator-profiles`
**Created**: 2026-05-09
**Status**: Bootstrapped (pending revalidation)
**Mode**: retroactive-bootstrap

## Overview

Creator Profiles gives home cooks, food bloggers, and professional chefs a public identity on KitchenSink. Each creator gets an `@handle` URL, a curated profile page, and tools to grow an audience. Followers can discover recipes through the creator's public collections. Embed widgets let creators share their profile on external sites.

This feature owns the `CreatorProfile` entity and the `public-profile` audience behavior. `public-profile` is a canonical audience scope under the unified audience model defined in `specs/cross-feature-consistency-report.md` §10 and enforced by `specs/governance-rules.md` GR-014. Monetization extensions (the tip jar and the creator-earnings surface) are implemented here but delegate billing mechanics to 010-subscriptions. There are **no premium recipes and no paid follows** — recipe visibility is binary private/public and owned by 001.

## Dependencies

| Spec                                                                            | Relationship                                                                                                                                                                                                                                                                                                   |
| ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [002-user-auth](../002-user-auth/spec.md)                                       | **Required** — `@handle` is tied to an authenticated identity; profile creation requires a verified account                                                                                                                                                                                                    |
| [001-commise-recipe-app](../001-commise-recipe-app/spec.md)                     | **Required** — recipes are the primary content surface on a creator profile                                                                                                                                                                                                                                    |
| [010-subscriptions](../010-subscriptions/spec.md)                               | **Integration** — the tip jar and creator-earnings surface extend 010's billing model. No premium recipes, no paid follows: visibility is binary private/public, owned by 001.                                                                                                                                 |
| [011-recipe-digitization](../011-recipe-digitization/spec.md)                   | **Peer** — `circle` is owned by 011; `public-profile` is owned here; the two audience scopes are siblings, not nested                                                                                                                                                                                          |
| [021-public-discovery-and-sharing](../021-public-discovery-and-sharing/spec.md) | **Required (2026-10-27).** Owns what a signed-out visitor sees, the open-to-web rule, indexing, previews and takedown reach. Resolves the conflict with `001-FR-045`. Its Q2 (2026-10-29) opens public collections to signed-out readers                                                                       |
| [026-chef-spaces](../026-chef-spaces/spec.md)                                   | **Amends (owner rulings 2026-10-29).** Adds site claims, corner sections, a recipe-first page rule, an email sign-up, more analytics and a "Cook this in Commise" card. Phase 1 features are open to any creator, and money features need chef standing (026 Q9). Requirements tagged `→ 012` there merge here |

> **Plans (owner, 2026-10-27).** The plans are Free, Pro and Pro with AI, and "Pro" names the paid plan. The old
> name "Premium" survives only in quoted rulings and shipped strings. Which plan carries which feature is in 010's
> [plan register](../010-subscriptions/spec.md#plan-register). Open questions are 010's
> [owner inputs](../010-subscriptions/spec.md#owner-inputs-still-needed).

## Personas

- **Primary — P11 Robin** (aspiring food creator): wants a shareable profile to build an audience and eventually earn from their recipes.
- **Secondary — P5 Morgan** (discovery-driven home cook): browses creator profiles to find trusted recipe sources and follows creators whose style matches their taste.
- **Tertiary — P9 Drew** (professional chef / brand): needs a polished public presence with embed widgets for their restaurant or catering website.

## Audience Scope Defined Here

`public-profile`: content visible to any unauthenticated visitor on a creator's `/@handle` page. It is distinct from `circle` (private invite groups, owned by 011) and `published-lesson` (lesson/course access rules applied by 013).

> **Amended 2026-10-27 (owner ruling, [021](../021-public-discovery-and-sharing/spec.md)). The conflict with
> `001-FR-045` is resolved.** 001 required sign-in for everything, while this page was "viewable without
> authentication". The owner ruled for signed-out creator pages. Owner, 2026-10-27: "Let's add a feature and spec for
> indexing and sharing as you note." The accepted recommendation allows signed-out reading of public recipes that
> cooks wrote themselves, and of creator pages. Everything else stays behind sign-in. `001-FR-045` now names this page
> as an exception. To a signed-out visitor the page lists only recipes that are **open to the web** (`021-FR-002`):
> recipes that carry an open rights label: Written by you, Adapted by you, From a family member or friend, Public
> domain, and clones of those. _(Amended 2026-11-03, owner ruling, ADR-0082. Was: "recipes the cook wrote, never
> imported ones". A linked facts card is never listed on a creator page. Counsel review is owed before launch
> (`016-FR-050`).)_ _(amended 2026-11-03, owner ruling O7, ADR-0082)_ Decided: the page lists recipes the cook wrote or adapted (and their clones where the label
> carries), and still lists family and public domain recipes by the existing open-recipe rule. It lists no facts
> card, to anyone. This was an open question. A signed-in visitor sees every public recipe the creator owns. Public
> collection pages stay behind sign-in until the owner answers 021's Q2 (`021-FR-008`). 021 owns the page's search,
> preview, privacy and takedown rules. The requirements below are amended to match.
>
> **Amended 2026-10-29 (owner ruling, 021 Q2).** The owner answered Q2: "both, but only for public content and
> nothing that's behind a paywall (like a chef selling a collection)". Public collections are now readable signed out,
> each on its own address, under the same rules as public recipes (`021-FR-008`, `021-FR-015`). Anything a chef sells
> is not: a paid collection shows a signed-out reader at most its title, cover, price and the chef's own description,
> never its recipes (`026-FR-015`). Was: "Public collection pages stay behind sign-in until the owner answers 021's
> Q2."

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
  binary private/public and owned by 001. Following is free. _(Amended 2026-11-03, owner ruling O14, ADR-0082.)_ A
  creator can list PRIVATE recipes and collections for sale (FR-034a). That is a sale, not a visibility state.

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

- **FR-005** Handle changes MUST be rate-limited to once per 30 days; the previous handle MUST be reserved for 14 days to prevent squatting. _(Amended 2026-10-27, [021](../021-public-discovery-and-sharing/spec.md).)_ During those 14 days the previous handle redirects to the new one. After them it stops redirecting, but it is still never given to another account, because search engines and old links point at it. An erased cook's handle is never given to another account either (`021-FR-073`).

### Public Profile URL & Discovery (FR-006 … FR-009)

- **FR-006** _(domain corrected 2026-10-26, owner ruling. Amended 2026-10-27, [021](../021-public-discovery-and-sharing/spec.md))_ Every active `CreatorProfile` MUST be accessible at `commise.app/@{handle}` (canonical URL) without authentication, as `001-FR-045` now allows. A deactivated or suspended profile gets 021's one not-available answer (`021-FR-013`). An erased cook's handle, and a renamed handle, is never given to another account (`021-FR-073`).

- **FR-007** _(amended 2026-10-27, [021](../021-public-discovery-and-sharing/spec.md))_ Profile pages MUST be server-side rendered with `<title>`, `<meta description>`, and Open Graph tags populated from `CreatorProfile` fields. Indexing, `ProfilePage` structured data, canonical addresses and sitemaps follow `021-FR-020` to `021-FR-029a`. A page with no indexable recipe answers `noindex` (`021-FR-025`). The HTML response is the same for every viewer and sets no cookie (`021-FR-012`).

- **FR-008** _(amended 2026-10-27, [021](../021-public-discovery-and-sharing/spec.md). Amended 2026-10-29, owner ruling, 021 Q2)_ The public profile page MUST display: avatar, display name, bio, follower count, public collections, and a paginated list of public recipes. To a signed-out visitor it lists only recipes that are open to the web (`021-FR-002`) under every open label (written, adapted, family, public domain, clone), each showing its label (_(amended 2026-11-03, owner ruling O7, ADR-0082)_: never a facts card, signed in or out), and its licence where the cook chose CC BY 4.0 (`016-FR-010`, schema.org `license` on the recipe page, owned by 021), at most 24 per page, and its public collections, each readable signed out on its own address (`021-FR-015`, `021-FR-008`). A collection a chef sells MUST show a signed-out visitor at most its title, cover, price and the chef's own description, never its recipes (`026-FR-015`). The avatar address carries no user id (`021-FR-071`). _(Was, 2026-10-27: "and no public collections until 021's Q2 is answered".)_

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

- **FR-017** A creator MUST be able to organise recipes into named collections, each public or private (max 20 collections per creator in v1; max 60-char name, max 200-char description). _(Amended 2026-11-03, owner ruling, ADR-0082.)_ A public collection's description is public text, so 020 checks it (`020-FR-071`). A hit hides the description, not the page, until a person decides. A cover the creator uploads is checked as a photo. The shipped schema allows a 1000-character description (`collections.schema.ts`), against this 200. Counsel review is owed before launch (`016-FR-050`).

- **FR-018** Collections MUST support manual ordering of recipes; the order MUST be persisted and returned in API responses.

- **FR-019** Only recipes with `visibility = public` (owned by 001) and authored by the creator MAY be added to a collection. _(Amended 2026-11-03, owner ruling O14, ADR-0082.)_ This holds for a PUBLIC collection. A PRIVATE collection MAY hold the creator's private recipes, and a collection for sale MUST hold only sellable recipes (FR-034b). A FREE public collection MAY also hold a facts card or another person's recipe that the open-recipe rule allows (`021-FR-002`, O14d). A paid collection never holds one.

### Moderation (FR-020 … FR-022)

- **FR-020** The platform MUST allow a Support/Admin Operator to suspend a `CreatorProfile` (hides public page, blocks new follows) pending review without deleting data.

- **FR-021** A suspended creator MUST receive an in-app notification stating the reason and an appeal path.

- **FR-022** DMCA takedown requests targeting a creator's recipe MUST be routable to the Compliance Reviewer role; the affected recipe MUST be unpublished within 24 hours of a valid notice. _(Amended 2026-10-27, [021](../021-public-discovery-and-sharing/spec.md).)_ The route is 016's one notice mechanism (`016-FR-026`). Every public page carries a Report link to it (`021-FR-045`). A removal reaches every public surface within 021's purge bound (`021-FR-061`).

### Analytics (FR-023 … FR-025)

- **FR-023** A creator MUST be able to view aggregated analytics for their own profile: daily profile views, follower delta, top-performing recipes by view count, and collection click-through counts.

- **FR-024** Analytics MUST be aggregated-only; no individual visitor identity or IP address MAY be stored or surfaced.

- **FR-025** Analytics snapshots MUST be computed by a scheduled Lambda (daily cron) and stored in `creator_analytics_snapshots`.

### Embed Widget (FR-026 … FR-027)

- **FR-026** _(amended 2026-10-27, [021](../021-public-discovery-and-sharing/spec.md))_ `GET /api/v1/creators/:handle/widget` MUST return a static HTML fragment (no JavaScript) rendering: avatar, display name, follower count, and the 3 most-recently-published recipes that are open to the web. The widget is signed-out, so it reads 021's one open-to-web rule (`021-FR-001`) and never lists an imported recipe.

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

### Creator sales: private recipes and collections (FR-034a to FR-034d)

_(Added 2026-11-03, owner ruling O14, ADR-0082.)_ The owner, verbatim: "For creator recipes, a creator can choose to make recipes public or private. Same for
collections. They can also choose to list private recipes and collections for sale." These requirements merge the
product-spec row "Creator-priced private recipes and collections". They add no visibility state and reverse none of the
retired IDs below.

- **FR-034a** A creator MUST be able to choose public or private for each recipe and for each collection (O14b). A
  creator MAY list a PRIVATE recipe or a PRIVATE collection for sale at a price the creator sets (O14c). 010 takes the
  payment and grants the buyer access, through 018's seller model (`018-FR-026`, `018-FR-029`, `018-FR-087`) and 026's
  cookbooks (`026-FR-043`). 012 holds no billing logic. Listing for sale does not change visibility.
  _(amended 2026-11-03, owner ruling O15, ADR-0082. Amended again the same day, owner ruling, ADR-0082 §9. Was: every
  buyer gets a live view of the creator's current recipe or collection and no copy.)_ A buyer **purchases** the sold
  version and can download it to keep (`018-FR-029`, `018-FR-029a`). A buyer can also **subscribe** to the creator for
  the live view of the creator's current versions (`018-FR-029h`, FR-034d). The creator sees aggregate sales and no
  named buyer (`018-FR-029g`). The creator's confirm step for unpublishing from sale, deleting or erasing MUST say that
  buyers and subscribers lose in-app access, get a 30-day download of the last approved version, and get no refund
  (`018-FR-029e`, `018-FR-029i`). A public recipe or
  collection MUST NOT be for sale (`018-FR-029c`), and reading a public one is never paid for (O14a, `021`).
- **FR-034b** [Law] Only content the creator owns MAY be sold (O14d). That is "Written by you", "Adapted by you" in the
  creator's own words, and a family recipe whose giver's permission covers selling. It MUST NOT be an
  `imported_public`, `imported_physical` or `imported_paid` copy, a facts card, public-domain curator text, or anything
  holding another person's text, because selling is distribution (17 U.S.C. §106(3), `016-FR-029a`). A collection for
  sale MUST hold only sellable recipes, and adding a non-sellable recipe MUST be refused. A facts card or another
  person's recipe MAY sit only in a FREE public collection. 012 MUST NOT put an `isPremium` flag on collection
  membership. The one eligibility rule is owned by 018 (`018-FR-027`), and 012 reads it. [House rule] Counsel review is
  owed before launch (`016-FR-050`).
  _(amended 2026-11-03, owner ruling O16, ADR-0082)_ A recipe the creator imported from their own page with "This is
  my recipe, from my site or account" (`004-FR-014a` statement 1a) is "Written by you", so it is sellable when kept
  private. The creator page lists it like any recipe the creator wrote when it is public and 020 allows it
  (`021-FR-002`). Neither reads the site claim. A recipe is public or for sale, never both (`018-FR-029c`). Counsel
  review is owed before launch (`016-FR-050`).
- **FR-034c** Every sold recipe MUST pass 020's hold before it is listed and before it is delivered, because selling is a
  door to others like publishing (O14e, `020-FR-057`). A held recipe MUST NOT be listed. _(amended 2026-11-03, owner ruling O15b,
  ADR-0082. Was: a buyer's copy carries its source's checked-content digest.)_ A buyer reads the same recipe through the
  same hold. An edit to a sold recipe re-runs the hold, and buyers see the last approved version meanwhile
  (`018-FR-029d`, `020-FR-064`). [House rule] Counsel review is owed before launch (`016-FR-050`).
- **FR-034d** _(added 2026-11-03, owner ruling, ADR-0082 §9)_ The sale page of a recipe or collection MUST offer two
  products by these names. **Purchase** gives the sold version, to read in the app and to download and keep
  (`018-FR-029`, `018-FR-029a`). **Subscribe** gives the live view of the creator's current versions while the
  subscription runs, and nothing after it ends (`018-FR-029h`). Each button MUST say what it gives, before payment
  (`018-FR-046`). The copy goes through the localization path. 012 holds no billing logic (FR-034a). What a
  subscription covers is OPEN for the founder (`018` FQ-018-4). [House rule] A subscription is an access grant on
  private items for sale. It is not the paid follow tier that FR-038 retired, because following stays free and no
  public recipe is withheld. Counsel review is owed before launch (`016-FR-050`).
- _(Note 2026-11-03, owner ruling, ADR-0082 §9.)_ A profile can show the creator's linked social accounts. Linking
  proves ownership of that account's posts through the platform's own sign-in, and is specified in `026-FR-061`. 012
  shows the link only. It does not verify it.

> ### ⛔ Withdrawn 2026-08-02 — there is no such thing as a premium recipe
>
> _(Clarified 2026-11-03, owner ruling O14, ADR-0082.)_ What is withdrawn is a paywalled **visibility state**, a paid
> follow tier and server-side withholding of a public recipe. A creator selling a PRIVATE recipe or collection is a
> different thing. It is FR-034a to FR-034c. The retired IDs below stay retired and are not reused.
>
> An earlier revision of this section (in this same PR, never ratified) invented **premium recipes** and
> **paid follows**: a creator marking a recipe premium, server-side withholding of its ingredients and
> instructions from unentitled viewers, per-recipe purchase granting perpetual access, a creator-priced
> follow tier, and a "premium feed". **All of it is withdrawn.** It contradicted the product's actual
> content model.
>
> **The visibility model is binary, and 001 owns it**: a recipe is **private** or **public**
> (`001-FR-003`, `001-FR-004`). There is no third, paywalled state, and 012 does not get to introduce one. _(Clarified 2026-11-03, O14: a sale of a private recipe is not a visibility state, FR-034a.)_
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
> 010's entire functional scope is `010-FR-040` … `010-FR-044`: a free/Pro **subscriber** tier on Stripe
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

### Contract ownership (GR-015)

_The service authors it; clients declare nothing._

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
`z.infer` types, `contractHash.ts`, a barrel and a **derived** `openapi.yaml` (outbound only — for `oasdiff`,
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

### Input validation — where that zod RUNS (GR-016)

**Normative sources**: [`docs/CODING_STANDARDS.md` §15.4](../../docs/CODING_STANDARDS.md) ·
[`GR-016`](../governance-rules.md#gr-016-input-validation-at-every-boundary) ·
[ADR-0015](../../docs/architecture/decisions/0015-input-validation-at-every-boundary.md). Full bindings:
[`plan.md` → _GR-016_](./plan.md#gr-016--input-validation-at-every-boundary). The section above decides who
**authors** the contract; this one is where it is **enforced**. It adds no FR (GR-003).

- **One mechanism, one `400`.** `@kitchensink/creator-profiles-service` parses every profile, handle,
  collection, follow, analytics and widget input — body, path params (including the public `/@handle` segment)
  and query params — with its own authored zod via `createZodDto` + **`nestjs-zod`'s** `ZodValidationPipe`.
  ⚠️ Under Nest's **own** `ValidationPipe` a `createZodDto` DTO validates **nothing while looking correctly
  wired** (a live case on identity's `PATCH /users/me`), so the registered pipe is stated and proven by a
  bad-body route test.
- **⚠️ `handle` is the highest-risk input in this feature**: it is uniqueness-constrained, length-bounded, and
  rendered into a **public URL**. Its charset, length, normalisation form and reserved-word policy belong in the
  authored zod so a client sees the same rule the server enforces. Uniqueness and reservation remain **domain**
  checks (`409`), and neither substitutes for the other.
- **⛔ The storage floor applies to every bounded column** — handle/display-name lengths, collection ordering
  integers against their `int4` ceiling (**2,147,483,647**), analytics window/limit integers, status enums,
  nullability. **Asserted, never derived**: no zod generated from Drizzle, no storage type imported into a
  `*.schema.ts`. Bio text columns are unbounded, so their limits are **product decisions this feature owns**.
- **The analytics-snapshot scheduler is ingress a pipe never sees** and parses its event before it drives a
  write. A request-selected analytics metric, interval or sort maps through a **validated enum to a closed
  allowlist of literals** — never into a `sql.raw()` fragment.
- **The HTML-fragment widget is OUTPUT.** Its request and error shapes are validated like everything else; the
  fragment itself is governed by escaping and rendering rules, and **⛔ response validation is DEFERRED**
  portfolio-wide (GR-016 §16-g) — do not add an emission-side parse.

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
