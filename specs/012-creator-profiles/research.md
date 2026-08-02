# Research: Public Creator Profiles (012)

**Bootstrapped**: 2026-05-09
**Source corpus**: cross-feature-consistency-report.md §11–12, 010-subscriptions spec, portfolio persona library

---

## 1. Problem Statement

KitchenSink users who create recipes have no public identity. Their content exists but isn't attributable in a way that builds audience trust or repeat discovery. Creators can't grow a following, and discovery-oriented users (P5 Morgan) have no reliable way to find a trusted source and subscribe to their output.

The gap is especially acute for P9 Drew (professional chef): they need a linkable, embeddable presence to point clients and social followers toward, without building a separate website.

---

## 2. Persona Research

### P11 Robin — Aspiring Food Creator (Primary)

Robin posts 2-4 recipes per week, shares on Instagram, and wants to convert social followers into a KitchenSink audience. Key needs:

- A clean `/@robin` URL they can put in their bio link.
- Collections to organize content by theme (dietary, cuisine, season).
- Some signal that their effort is building toward something — follower count, profile views.
- A low-friction way to accept tips without setting up a full payment processor.

Robin's biggest friction today: every recipe lives in isolation. There's no "see more from this creator" path.

### P5 Morgan — Discovery-Driven Home Cook (Secondary)

Morgan finds recipes through search and social shares. When a recipe works, they want to find more from the same person. Key needs:

- A profile page that loads fast and shows the creator's best work first.
- A follow button that surfaces new recipes in their feed without requiring a separate newsletter.
- Trust signals: follower count, recipe save counts, verified badge.

Morgan won't pay for a creator subscription unless they've cooked at least 3 recipes from that creator successfully.

### P9 Drew — Professional Chef / Brand (Tertiary)

Drew runs a catering business and teaches occasional pop-up classes. Key needs:

- An embed widget for their restaurant website ("Our Chef's Recipes").
- A professional-looking profile that doesn't look like a hobbyist app.
- Premium recipe gates to offer exclusive content to paying clients.

Drew's tolerance for setup friction is low. If the embed widget requires more than copy-paste, they won't use it.

---

## 3. Competitive Landscape

| Platform    | Creator Profile | Follow | Collections        | Embed | Analytics     | Monetization             |
| ----------- | --------------- | ------ | ------------------ | ----- | ------------- | ------------------------ |
| Substack    | Yes (`@handle`) | Yes    | No (issues only)   | No    | Basic         | Paid subscriptions       |
| Patreon     | Yes             | Yes    | Yes (tiers)        | No    | Moderate      | Tiered memberships       |
| NYT Cooking | Author pages    | No     | Curated by editors | No    | None (public) | Paywall (platform-level) |
| TikTok      | Yes             | Yes    | Playlists          | No    | Rich          | Creator Fund + tips      |
| Linktree    | Profile card    | No     | Links only         | Yes   | Basic         | No                       |

**Gap**: No food-specific platform combines `@handle` profiles + follow + collections + embed + creator-controlled monetization in one product. KitchenSink can own this niche.

---

## 4. UX Patterns

**Profile page structure** (informed by Substack + Patreon):

- Hero: avatar, display name, `@handle`, bio (160 chars), follower/following counts.
- Pinned collection (optional, creator-chosen).
- Recent recipes grid (paginated, newest first by default).
- Collections tab.
- "Follow" / "Tip" CTAs sticky on scroll.

**Follow flow**: single tap, optimistic UI update, no confirmation modal. Unfollow requires a second tap (prevent accidental unfollows).

**Embed widget**: `<iframe src="/@handle/widget" width="320" height="480">`. Renders avatar, name, follower count, 3 latest recipes. No JS required in the host page.

**Analytics dashboard**: simple line charts (profile views, follower delta). No third-party analytics SDK — aggregate from internal event log.

---

## 5. Codebase Analysis

**Relevant existing packages** (from 001 and 002):

- `@kitchensink/recipe-core`: `Recipe` entity, `RecipeVisibility` enum — profile pages will query public recipes by `userId`.
- `@kitchensink/clerk-verify`: networkless Clerk session-token verification (public `CLERK_JWT_KEY`, anchored `azp` check). Applied **in-service** by `AuthMiddleware`; there is deliberately **no** API-Gateway authorizer Lambda and no trusted `x-authorizer-context` header (removed in PR #39 — the ALB is public, so such a header would be forgeable).
- `@kitchensink/identity-core` (shipped): `User` / `Account` entities from 002's auth flow. `CreatorProfile` will be a separate table with a `userId` FK, not a column on `User`.

**New packages needed**:

- `@kitchensink/creator-profiles-service` — NestJS module, owns `CreatorProfile` entity, follow/unfollow logic, analytics aggregation.
- `@kitchensink/creator-profiles-widget` — lightweight Next.js route (`/[handle]/widget`) rendered as static HTML for embed use.

**Database**: new tables on the existing RDS PostgreSQL 16 instance.

- `creator_profiles`: `id`, `user_id`, `handle` (unique index), `display_name`, `bio`, `avatar_key`, `monetization_enabled`, timestamps.
- `creator_follows`: `follower_id`, `creator_id`, composite PK, `created_at`.
- `creator_collections`: `id`, `creator_id`, `name`, `description`, `position`, timestamps.
- `creator_collection_recipes`: `collection_id`, `recipe_id`, `position`, composite PK.

**S3**: avatar images stored under `avatars/{userId}/{uuid}.{ext}`. Presigned upload URL via existing `@aws-sdk/s3-request-presigner` pattern from 001.

---

## 6. Metrics & ROI

**Success metrics** (to be formalized in product-spec):

- 30-day activation: % of active recipe creators who claim a `@handle` within 30 days of feature launch.
- Follow conversion: % of profile visitors who follow (target: >8%).
- Embed adoption: number of unique external domains serving the widget (proxy for P9 Drew use case).
- Tip volume: total tip transactions in first 90 days (baseline: $0, any positive number is a win).

**Risk**: creator analytics could become a distraction if over-engineered. Keep v1 to 4 metrics max; resist adding cohort analysis or export until there's demand.

---

## 7. Tech Stack Decisions

- **Node 24.x** runtime (matches 001 NestJS backend).
- **NestJS 11** for `creator-profiles-api` module.
- **Drizzle ORM** for new tables (consistent with 001).
- **Next.js** App Router for `/@handle` public pages (SSR for SEO; creator profiles should be indexable).
- **No new AWS services**: reuse RDS, S3, CloudFront from 001. Analytics aggregation runs as a scheduled Lambda (cron) writing to a `creator_analytics_snapshots` table.
