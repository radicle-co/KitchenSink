# Feature Specification: Commise - Recipe Management Core

**Feature Branch**: `001-commise-recipe-app`
**Created**: 2026-04-14
**Status**: Implemented — all lifecycle gates passed (code-review, verify, release-readiness); shipped to the feature branch on PR #73. Prod deploy is CONDITIONALLY READY, gated on the 6 operational conditions in [`release-readiness.md`](./release-readiness.md). This spec is canonical and reconciled with shipped behavior (CR-001 mockup parity folded in; Phase 10 spec-merge 2026-07-16 found no doc↔code drift). One deferral is called out inline rather than silently: Home-layout **consumption** (order/hidden) is deferred in Home v1 (WAV-002), noted at US-000 / FR-046.
**Input**: User description: "Core recipe management for the Commise app — CRUD, search, versioning, sharing/cloning, collections, and platform parity across web and mobile."

## Dependencies

This is the **foundational spec** for the Commise product. All other specs depend on it.

| Spec                                                        | Relationship                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [003-usda-food-data](../003-usda-food-data/spec.md)         | Provides the source-agnostic food service backing FR-007; ingredient data is consumed via its typed client (`@kitchensink/food-service-client`), foods referenced by internal id, resolution asynchronous                                                                                                                                                                                                                                                                                 |
| [002-user-auth](../002-user-auth/spec.md)                   | Provides authentication required by FR-045; owns the user profile/preferences where Home layout persists as JSON (`profiles.preferences.homeLayout`, via the existing `/v1/profiles/me`; consumption by US-000 / FR-046 deferred in Home v1 — WAV-002); provides the app-ULID→Clerk-`external_id` sync (**shipped**); 001 (T000-prereq) emits that ULID as a session-token claim + extends `@kitchensink/clerk-verify` to surface it as `userId` — the prerequisite for recipe `owner_id` |
| [004-recipe-importing](../004-recipe-importing/spec.md)     | Extends recipe creation with external source import                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| [005-ai-integration](../005-ai-integration/spec.md)         | Extends recipe creation with AI generation                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| [006-meal-planning](../006-meal-planning/spec.md)           | Consumes recipes for meal plan assignment                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| [007-grocery-lists](../007-grocery-lists/spec.md)           | Consumes recipe ingredients via meal plans                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| [008-cooking-mode](../008-cooking-mode/spec.md)             | Consumes recipe instructions for step-by-step display                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| [009-nutrition-planning](../009-nutrition-planning/spec.md) | Consumes recipe nutritional data via meal plans                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| [010-subscriptions](../010-subscriptions/spec.md)           | Gates premium features (private visibility, etc.)                                                                                                                                                                                                                                                                                                                                                                                                                                         |

## User Scenarios & Testing _(mandatory)_

### User Story 0 (US-000) - Post-Login Home Screen (Priority: P1)

A user completes login and lands on the Home screen. The Home screen is the first thing they see every session. It is not a generic welcome page or a bare recipe list — it is a **widget surface**: a curated, ordered set of widget cards, each contributed by a feature. Widgets are discovered by explicit startup registration, composed by `curateHomeWidgets` (gating by **capability** — is the backing service deployed — and by **subscription tier**, ordered by the user's **personalization**), and rendered via `React.lazy` + Suspense with a per-widget error boundary; unknown widget ids are skipped. In **Home v1 the recent-recipes (recipe) widget is the only widget with a live implementation**: it shows the user's most recent recipes (up to 4). The meal-plan summary, nutrition snapshot, shopping-list status, AI-suggestion, and resume-cooking widgets (backed by services **005–009**) have no feature package yet, so they render as **skeleton placeholders** _(amended by CR-001, 2026-07-16 — these previously did not render at all)_: the real widget's layout and shape with **skeleton blocks in place of data**. A placeholder MUST NOT show mock, sample, or fabricated data — a plausible-looking macro total or shopping count reads to a user as real. The original technical constraint is preserved and **not** violated: a placeholder is rendered by the **host** from a static descriptor and **imports nothing** from the unbuilt package, so there is still no `import()` of a package that doesn't exist. Each feature registers its real widget (with its loader) when its package ships; **capability gating then swaps the placeholder for the live widget once its backing service is live**, with no client change. Note the placeholder covers **capability**-absence only: a widget gated out by **subscription tier** remains **absent** (a skeleton for a feature the user is not entitled to would mislead, not inform). Free-tier users see a contextual subscription nudge (at most once per session) when they tap a premium-gated entry point. The Home screen is present on both web and mobile with identical entry points; layout adapts to screen size. Per-user layout (order, hidden) persists across devices via `PATCH /v1/profiles/me`, owned by the identity service (002); **consumption (reading `homeLayout` to reorder/hide widgets) is deferred in Home v1** — with a single live widget (recipe), order/hidden is inert, so the surface renders the default order and ships no reorder/hide UI (REQ-068 / REQ-IF-006 deferred, WAV-002; revisited once features 005–009 add reorderable live widgets). Design authority: [`research/home-widget-architecture.md`](./research/home-widget-architecture.md) (the `## DECISION (2026-07-06)` section).

**Why this priority**: The Home screen is the product's first impression on every return visit. Without a valuable, personalized entry point, users have no clear next action after login. Every other feature (meal planning, nutrition, shopping, cooking mode, AI, subscriptions) must be reachable from Home as its widget lights up. This screen is the connective tissue of the entire product.

**Independent Test**: Log in as a new user (no data) and verify the recipe widget renders its empty state ("Create your first recipe") and that widgets whose backing services are not yet deployed (meal-plan, nutrition, shopping, AI, resume-cooking) render as **skeleton placeholders** — the widget's shape with skeleton blocks, and **no fabricated values**. Log in as a returning user with recipes and verify the recipe widget shows real data and navigates correctly; the placeholders remain skeletons until 005–009 ship, then auto-swap to the live widget.

**Acceptance Scenarios**:

1. **Given** a user completes login, **When** the app redirects post-auth, **Then** the Home screen loads within 2 seconds, the recipe (recent-recipes) widget renders, and any widget whose backing service is not yet deployed renders as a **skeleton placeholder** (the widget's shape with skeleton blocks — not an empty state, and not mock data).
2. **Given** the cooking-mode service (008) is deployed AND a user has an active cooking-mode session, **When** they view Home, **Then** a "Resume cooking" card appears at the top of the screen above all other widgets.
3. **Given** the resume-cooking widget is live AND a user has no active cooking session, **When** they view Home, **Then** no "Resume cooking" card is shown.
4. **Given** a user has recipes, **When** they view Home, **Then** up to 4 most recently viewed or edited recipes appear in the Recent Recipes widget.
5. **Given** a user has no recipes, **When** they view Home, **Then** the Recent Recipes widget (live in v1) shows an empty state with a "Create your first recipe" call to action.
6. **Given** the meal-plan service (006) is deployed AND a user has a meal plan with entries for today or tomorrow, **When** they view Home, **Then** the Meal Plan widget shows those entries with recipe names and meal type.
7. **Given** the nutrition service (009) is deployed AND a user has a nutrition goal set, **When** they view Home, **Then** the Nutrition widget shows today's planned macro totals vs. their goal.
8. **Given** the grocery service (007) is deployed AND a user has an active shopping list with unchecked items, **When** they view Home, **Then** the Shopping List widget shows the unchecked item count and a "View list" link.
9. **Given** the AI service (005) is not yet deployed, **When** a user views Home, **Then** the AI-suggestion widget renders as a **skeleton placeholder**; **and** once 005 deploys, **When** the same user next views Home, **Then** the placeholder is **replaced** by the live AI-suggestion widget showing one AI-generated recipe suggestion, with no client change.
10. **Given** a free-tier user taps a premium-gated entry point on Home, **When** the tap occurs, **Then** a subscription upgrade nudge appears. The nudge appears at most once per session regardless of how many premium entry points the user taps.
11. **Given** the Home screen on web, **When** compared to the Home screen on mobile, **Then** every widget — **live or placeholder** — is present on both platforms in the same state; no widget is live on one platform and a placeholder on the other.
12. **Given** any widget rendering as a skeleton placeholder, **When** a user views it, **Then** it displays **no numeric, textual, or list data of any kind** — only skeleton blocks. Specifically, it MUST NOT show a sample macro total, a sample shopping-list count, or a sample recipe name that a user could mistake for their own data. _(CR-001)_
13. **Given** a widget whose backing service **is** live but which the user's **subscription tier** excludes, **When** they view Home, **Then** the widget is **absent** — not a skeleton placeholder. A placeholder communicates "not built yet"; tier-gating is an entitlement state and is conveyed by the nudge (scenario 10), never by a skeleton. _(CR-001)_

---

### User Story 1 - Create and Manage Personal Recipes (Priority: P1)

A user opens Commise, creates an account, and begins building their personal recipe collection. They can create new recipes from scratch by entering a title, description, ingredients (backed by real food data with nutritional information), step-by-step instructions, prep/cook times, servings, tags, and photos. They can edit or delete recipes they own. They can view their recipes in a searchable, filterable list. They can organize recipes into collections (folders/groups) for personal categorization.

**Why this priority**: Recipe management is the core data model that every other feature depends on. Without recipes, there is no meal planning, no grocery lists, no cooking mode. This is the foundation of the entire product.

**Independent Test**: Can be fully tested by creating an account, adding 5+ recipes with full details, editing one, deleting one, and searching/filtering the collection. Delivers immediate personal value as a digital recipe box.

**Acceptance Scenarios**:

1. **Given** a logged-in user with no recipes, **When** they create a new recipe with title, ingredients, and instructions, **Then** the recipe appears in their collection and is marked as public by default.
2. **Given** a user owns a recipe, **When** they edit the title, ingredients, or instructions, **Then** the changes are saved and reflected immediately.
3. **Given** a user owns a recipe, **When** they delete it, **Then** it is removed from their collection and no longer accessible.
4. **Given** a user does NOT own a recipe, **When** they attempt to edit or delete it, **Then** the system prevents the action and displays an appropriate message.
5. **Given** a user with 20+ recipes, **When** they search by keyword or filter by tag/category, **Then** matching recipes are returned within 2 seconds.
6. **Given** a user is entering ingredients, **When** they type an ingredient name, **Then** the system suggests matches from the real food database with associated nutritional data.
7. **Given** a user is creating or editing a recipe, **When** they set its difficulty to easy, medium, or hard, **Then** the choice is saved and the recipe's card and detail view show that difficulty as a labelled badge. _(CR-001 / FR-001b)_
8. **Given** a user creates a recipe **without** choosing a difficulty, **When** they view it in the list or detail, **Then** **no** difficulty badge is shown — the system does not display a default, a guess, or a placeholder difficulty. _(CR-001 / FR-001b)_
9. **Given** a recipe with one or more photos, **When** the user views their recipe list, **Then** each card shows that recipe's cover image, and the list is retrieved without a per-recipe detail request; **and given** a recipe with no photos, **Then** its card shows the client's no-image treatment rather than a stock or placeholder image. _(CR-001 / FR-001c)_
10. **Given** a premium user has set their own recipe to private, **When** it appears in a list or detail view, **Then** it is marked with the PRO badge; **and given** a free-tier user holds a private recipe imported from a physical copy (private for every tier per C-004), **When** it appears, **Then** it is **not** marked PRO. _(CR-001 / FR-003a)_

---

### User Story 2 - Share, Copy, and Clone Recipes (Priority: P1)

A user wants to share a recipe they own with the community. They can make a recipe public so any authenticated user can view it. Other users can copy or clone a public recipe into their own collection. A cloned recipe becomes a private copy that the new user owns and can edit freely, independent of the original. Per-user sharing (sharing with specific named users) is out of scope for v1 and deferred to a future spec.

**Why this priority**: Sharing and cloning are essential social features that drive user engagement and content growth. They also establish the public/private recipe model that underpins imported recipe attribution.

**Independent Test**: Can be tested by User A sharing a recipe publicly, User B finding and cloning it, then User B editing their clone without affecting User A's original.

**Acceptance Scenarios**:

1. **Given** a user owns a private recipe (premium), **When** they set it to public, **Then** it becomes discoverable and viewable by all users.
2. **Given** a public recipe (user-created, not imported), **When** any user copies/clones it, **Then** a new recipe is created in their collection that they fully own. Visibility follows default rules (public for free users, configurable for premium).
3. **Given** a cloned recipe, **When** the new owner edits it, **Then** the original recipe remains unchanged.
4. **Given** a user does NOT own a recipe, **When** they attempt to share or modify sharing settings, **Then** the system prevents the action.
5. **Given** a public recipe with attribution (imported from public source), **When** a user clones it, **Then** the clone retains source attribution, remains public, and can only be made private by a premium user after making a substantive edit.
6. **Given** an authenticated user viewing another user's public recipe, **When** they rate it 4 stars, **Then** the rating is saved and the recipe's average rating and rating count update to include it. _(CR-001 / FR-013)_
7. **Given** a user who has already rated a recipe 4 stars, **When** they rate the same recipe 2 stars, **Then** their rating is **replaced** (not added): the rating count is unchanged and the average reflects 2, not the mean of 4 and 2. _(CR-001 / FR-013)_
8. **Given** a user viewing their own recipe, **When** they attempt to rate it, **Then** the system rejects the attempt and the recipe's aggregate is unchanged. _(CR-001 / FR-013)_
9. **Given** a private recipe the user does not own and cannot read, **When** they attempt to rate it by its id, **Then** the system responds exactly as it would for a recipe that does not exist, disclosing nothing about whether it exists. _(CR-001 / FR-013)_
10. **Given** a user who has rated a recipe, **When** they remove their rating, **Then** it stops contributing to the aggregate; **and when** they remove it again, **Then** the request still succeeds. _(CR-001 / FR-013)_
11. **Given** a recipe with no ratings, **When** any user views it, **Then** it reports a rating count of zero and **no** average rating — not an average of zero. _(CR-001 / FR-013a)_
12. **Given** two users rating the same recipe at the same moment, **When** both ratings commit, **Then** the recipe's rating count reflects **both** and its average is the mean of both — neither rating is lost. _(CR-001 / FR-013a)_
13. **Given** user A has rated user B's recipe, **When** user A erases their account, **Then** user A's rating is deleted, user B's recipe **survives**, and that recipe's average and count are re-derived to exclude user A's rating. _(CR-001 / FR-013b)_

---

### Edge Cases

- How does the system handle recipes with ingredients not found in the real food database? _(Resolved: see C-006 — freeform ingredients with user-entered nutrition data)_
- How does the system handle concurrent edits if a user edits the same recipe from two devices? _(Resolved: see C-005 — full version history with conflict detection)_
- How does the system handle recipe deletion and GDPR erasure? _(Resolved: see C-007 — soft delete tombstone is the default; hard purge requires explicit user-initiated "Erase my data" action.)_
- How does the system handle photo upload failures (network drop, S3 unavailable, oversized/malformed files)? _(Resolved: see FR-001a — recipe metadata persists atomically; photo uploads are independent, validated client+server side, and individually retryable.)_
- How does the system handle S3 version-archive failures during a recipe save? _(Resolved: see FR-007b-i — user save succeeds; failed archive payloads are persisted locally in the DB as pending-archive records and replayed via async retry/DLQ until S3 confirms.)_

## Requirements _(mandatory)_

### Functional Requirements

**Recipe Management (Core)**

- **FR-001**: System MUST allow authenticated users to create recipes with title, description, ingredients (linked to real food data), step-by-step instructions, prep time, cook time, total time, servings, tags/categories, an optional difficulty (FR-001b), and photos (maximum 10 per recipe, 5MB per image).
- **FR-001a**: System MUST persist a recipe atomically and independently of its photo uploads. Recipe metadata (title, ingredients, instructions, etc.) MUST save successfully even if one or more photo uploads fail. Each photo upload MUST be validated client-side (size ≤ 5MB; MIME type in allowlist `image/jpeg`, `image/png`, `image/webp`) before transmission and re-validated server-side on receipt by inspecting the file's magic bytes (not the client-supplied Content-Type); rejected files MUST surface a per-file error to the user. Failed uploads MUST be retryable per file without re-saving the recipe. Photos that fail validation or upload MUST NOT be persisted as broken references on the recipe.
- **FR-001b** _(CR-001)_: System MUST allow the recipe owner to set a recipe's **difficulty** on create and on edit, to exactly one of `easy`, `medium`, or `hard`. Difficulty MUST be **optional**: "the author did not state a difficulty" is a valid, first-class state, and the system MUST NOT substitute a default, a guess, or a computed value for it. A recipe with no difficulty MUST render **no difficulty badge** — never a placeholder or an assumed value. Difficulty is descriptive metadata only: no other behavior (nutrition, scaling, search ranking) may depend on it. Where difficulty is displayed, its label MUST accompany any color coding (NFR-004 — color is never the sole conveyor of state).
- **FR-001c** _(CR-001)_: The recipe **list** projection MUST expose a **cover photo URL** for each recipe, so that a client can render a recipe card image without fetching each recipe's detail (an N+1 read). The cover MUST be **derived**, not separately stored or user-selected: it is the recipe's photo with the lowest sort order, resolved deterministically (ties broken by a stable key) so that the same recipe yields the same cover across requests. A recipe with no photos MUST omit the field entirely — the system MUST NOT emit a placeholder or stock image URL; the client owns the no-image presentation.
- **FR-002**: System MUST restrict editing and deleting of recipes to the recipe owner only. Deletion MUST be a soft delete (tombstoned): the recipe is hidden from all listings, search, collections, and clones immediately and is no longer accessible via normal APIs, but DB rows and S3 version archives are retained indefinitely by default. Hard purge of a tombstoned recipe (DB rows + all S3 version archives) MUST occur only via an explicit user-initiated "Erase my data" action (GDPR right-to-erasure), which is irreversible.
- **FR-003**: System MUST default new user-created recipes to public visibility. Premium users MAY set their own original recipes to private. Free-tier users' recipes are always public.
- **FR-003a** _(CR-001)_: System MUST expose, on both the recipe list and detail projections, a read-only indicator of whether a recipe **uses a premium-only capability** (rendered as the "PRO" badge). This indicator MUST be **derived on projection, never stored**: there is no premium column on the recipe, and this requirement introduces no entitlement model and no dependency on [010-subscriptions](../010-subscriptions/spec.md). The derivation MUST have exactly **one authoritative implementation**, shared by the list and detail projections, so the two can never disagree. The rule today: a recipe uses a premium capability when it is **private AND its visibility was chosen rather than forced** — i.e. its source type is `user_created` or `imported_public`. Private `imported_physical` and `imported_paid` recipes MUST NOT be indicated as premium: per C-004 those are private for **any** tier, so their privacy reflects no premium capability. When 010 ships real entitlements, this single derivation changes and no client, wire field, or stored value changes with it.
- **FR-004**: System MUST allow any authenticated user to view public recipes.
- **FR-005** _(AMENDED 2026-08-22 — see C-016-003)_: System MUST allow any authenticated user to copy/clone a public recipe into their own collection, **subject to FR-005a**. A clone retains source attribution and references the recipe it was cloned from (`cloned_from_id`). A clone of a public-source imported recipe (website/Instagram) defaults to public once publishable per FR-005b.
- **FR-005a** _(new; `GR-014` AC-014-e, extended from initial scope to cloneability)_: **Cloneability is a function of provenance, not of visibility.** A recipe MUST NOT be clonable where its provenance carries a restriction incompatible with redistribution. That a recipe is publicly readable MUST NOT by itself make it copyable into another user's collection. ⚠️ This requires a provenance-restriction signal that does not exist today — see the amendment note below.
- **FR-005b** _(amends the old FR-005's second sentence; `GR-014` AC-014-g)_: A clone MUST carry a **substantive edit** — any modification to ingredients or instructions; changes to title, description, tags or photos alone do not qualify — before it may be **published**. Until that edit exists the clone is not publishable, whatever visibility it would otherwise default to. Cloning alone is never sufficient to publish. **The substantive edit now gates publication, not privacy**, and the premium gate on making a clone private is removed (it belongs to D4a / [015](../015-publishing-rewards/spec.md) C-015-001).
- **FR-005c** _(new; `GR-014` AC-014-h)_: A **private** recipe MUST NOT be clonable by anyone other than its owner. An owner's copy of their own private recipe is created private; publishing it later is subject to FR-005a and to the C-004 policy its provenance dictates.
- **FR-005d** _(new; `GR-014` AC-014-i)_: Deleting a recipe MUST NOT remove clones of it — a clone is the cloner's own modified work. Deletion tombstones the original and hides it from every surface including read-only circle shares (FR-002), so a person who could see it only through a share loses access, while a clone persists. Account **erasure** MUST strip the erased user's identifying attribution from surviving clones while retaining a non-identifying provenance marker.

<!-- prettier-ignore -->
> **⚠️ Amendment note (2026-08-22, C-016-003 / A-1…A-3). The spec is now AHEAD of the shipped code, deliberately.**
>
> - `evaluateVisibility` (`recipe-service/src/recipes/domain/visibilityPolicy.ts`) and `defaultCloneVisibility`
>   still implement the pre-amendment rule. They are **not** changed by this amendment; the change is
>   implementation work with its own tests.
> - **FR-005a's gap is narrow.** `GR-014` AC-014-e already governs sources "marked or licensed against
>   republication … or a licence forbidding redistribution **or derivatives**", and expresses it by classifying
>   such a source into a private-only `sourceType` at ingestion — after which FR-005c makes it unclonable. The
>   one case with no `sourceType` behind it is a source that is genuinely public and freely available but whose
>   licence forbids **derivatives** specifically, which a modified clone is.
> - **FR-005b collides with FR-003 while D4a is unlanded.** FR-003 still says free-tier users' recipes are
>   _always public_, so "not yet publishable" is unrepresentable for a free-tier user as a `private`
>   visibility. It needs either D4a (free-tier privacy, per 015 C-015-001) or a distinct **unpublished-draft**
>   state that is not `visibility = private`. **Unresolved — do not implement FR-005b before choosing.**
> - **FR-003a's PRO-badge derivation is invalidated by the same change.** It derives "uses a premium
>   capability" from _private AND source type is `user_created` or `imported_public`_. Once a clone can be
>   private without premium, privacy stops implying premium and the badge becomes wrong. FR-003a promises
>   exactly one authoritative derivation, so this is a single-site fix — but it MUST land with FR-005b, not
>   after it.

- **FR-006**: System MUST provide search and filtering of recipes by keyword, tags, cuisine, dietary category, ingredient, and prep/cook time.
- **FR-007**: System MUST back ingredient data with the source-agnostic food service (003) via its typed client (`@kitchensink/food-service-client`); foods are referenced by internal id (an opaque ULID `foodId`, never the source `fdcId`) and resolution is asynchronous. Typeahead over known foods uses `foodClient.search(query)`; an unknown name is submitted via `foodClient.addByName(name)` (returns `202 { id, status: PENDING|UNRESOLVED }` — nutrition may not be ready yet) and polled via `getById(id)` / `getStatus(id)` until `RESOLVED`; an `UNRESOLVED` food is disambiguated via `getCandidates(id)` + `resolve(id, candidateIds)`. The ingredient picker MUST handle PENDING/UNRESOLVED states — a just-added food may show "nutrition pending" and a recipe may temporarily show partial nutrition until resolution completes.
- **FR-007a**: System MUST allow users to add freeform ingredients not found in the food database. Users MAY manually enter nutrition values (calories, protein, carbs, fat) for freeform ingredients. Such ingredients MUST be flagged as "user-entered" to distinguish them from database-backed items. Recipes containing user-entered ingredients MUST indicate partial/user-supplied nutrition data.
- **FR-007b**: System MUST maintain a version history for every recipe. Each save creates a new version. The last 10 versions MUST be stored in the database and available for users to view and restore. All versions MUST be archived to S3 indefinitely for compliance and recovery purposes.
- **FR-007b-i**: A user-facing recipe save MUST succeed independently of the S3 version-archive write. The S3 archive MUST be performed asynchronously with retry and a dead-letter queue (DLQ); archive failures MUST raise an operational alert but MUST NOT block or fail the user's save. When an S3 archive attempt fails, the full version payload MUST be persisted locally (in the database) as a pending-archive record so that retries — automatic or operator-initiated — can replay the exact failed payload until the S3 write succeeds. Pending-archive records MUST only be deleted after a successful S3 confirmation. The pending-archive backlog (count of `recipe_version_pending_archives` rows) MUST stay below 100 under normal operating conditions; a CloudWatch alarm MUST fire when the backlog exceeds 100 rows for more than 15 minutes, and again when the oldest pending row is older than 1 hour.
- **FR-007c**: System MUST detect concurrent edit conflicts (e.g., same recipe edited on two devices) via optimistic concurrency on a monotonically increasing `version` field. When the client submits a save with a stale `version`, the server MUST reject the write with HTTP 409 and a payload containing both the server's current version and the client's attempted version. The client MUST then present a side-by-side view of both versions and let the user (a) keep the server version, (b) overwrite with the local version, or (c) merge field-by-field; the user's chosen result is then re-submitted as a fresh write with the latest server `version`. The system MUST NOT silently drop, auto-merge, or last-write-wins concurrent edits.

**Recipe Collections**

- **FR-008**: System MUST allow authenticated users to create, rename, and delete recipe collections.
- **FR-009**: System MUST allow users to add or remove recipes from their own collections. A recipe MAY belong to multiple collections.
- **FR-010**: System MUST allow users to set collection visibility (public/private, subject to subscription tier rules). Public collections are viewable by any authenticated user.
- **FR-011**: System MUST allow any authenticated user to clone a public collection into their own account. Cloning a collection excludes any private recipes the cloner cannot access. The clone is a snapshot at clone time and is fully owned by the cloner; future changes to the source collection MUST NOT propagate automatically. The system MUST retain a reference to the source collection on the clone and MUST expose a user-initiated "Pull updates from source" action that, when invoked, reconciles the clone with the source's current state (adding new public recipes, removing recipes the cloner can no longer access). The pull action MUST be opt-in per invocation and MUST NOT overwrite recipes the cloner has added directly to the cloned collection.
- **FR-012**: System MUST NOT cascade-delete recipes when a collection is deleted, or cascade-delete collections when a recipe is deleted.

**Recipe Ratings** _(CR-001)_

- **FR-013** _(CR-001)_: System MUST allow any authenticated user to rate a recipe with a whole number of stars from **1 to 5**, subject to all of the following:
    - **A user MAY rate any recipe they can see, and only a recipe they can see.** The existing visibility and ownership read rules (FR-004, C-004) govern rateability — there is no separate rating permission. A user MUST NOT be able to rate a recipe they cannot read.
    - **A failed rating attempt MUST NOT disclose whether the recipe exists.** Attempting to rate a recipe the user cannot read MUST be indistinguishable from rating a recipe that does not exist (the same not-found response), and MUST NOT return a distinct "forbidden" response that would confirm existence.
    - **A user MUST NOT rate their own recipe.** This attempt MUST be rejected. Because the owner demonstrably already knows their own recipe exists, this rejection MAY be explicit — it leaks nothing.
    - **A rating is per user, per recipe.** Re-rating MUST **update** the user's existing rating; it MUST NOT create a second rating or otherwise let one user's repeated submissions influence the average more than once. Submitting the same rating twice MUST be indistinguishable in effect from submitting it once (idempotent).
    - **A user MUST be able to remove their own rating**, after which it no longer contributes to the recipe's aggregate. Removing a rating that does not exist MUST succeed without error.
    - **A tombstoned (soft-deleted) recipe MUST NOT be rateable** (C-007).
- **FR-013a** _(CR-001)_: System MUST expose, on both the recipe list and detail projections, a recipe's **average rating** and **rating count**, both **read-only** — no client may write them, directly or indirectly, other than by rating (FR-013). The aggregate MUST be **consistent with the ratings it summarizes at all times**, including after bulk deletions (FR-013b) and after a rated recipe is deleted; it MUST NOT be possible for a write path to bypass its maintenance and leave it stale. A recipe with **no ratings** MUST report a count of zero and **no average** — the system MUST NOT report an average of zero, which renders as a genuine zero-star score. Concurrent ratings of the same recipe MUST NOT lose updates: the aggregate must reflect **every** committed rating.
- **FR-013b** _(CR-001)_: Ratings are **user-owned data** and MUST be erased by the GDPR "Erase my data" flow (C-007). Erasing a user MUST delete every rating that user authored, **including ratings on other users' recipes**. Those other users' recipes MUST **survive** erasure, and their average rating and rating count MUST be **re-derived** to exclude the erased user's rating. Erasure MUST NOT be able to leave a surviving recipe holding an aggregate that counts a deleted rating.

**Platform**

- **FR-046** _(amended by CR-001, 2026-07-16 — unshipped-feature widgets render as skeleton placeholders; they previously did not render at all)_: System MUST present a personalized Home screen immediately after login, structured as a **widget surface** (design authority: [`research/home-widget-architecture.md`](./research/home-widget-architecture.md), the `## DECISION (2026-07-06)` section). Widgets MUST be **discovered** by explicit startup registration (composition root, `.use(addFeature)` — not codegen or `require.context`), **composed** by `curateHomeWidgets(widgets, ctx)` — a pure function gating by **capability** (whether the widget's backing service is live) and **subscription tier**, ordered by per-user **personalization** — and **rendered** via a lazy loader + Suspense with a per-widget error boundary (web renders via `next/dynamic` for RSC compatibility; mobile via `React.lazy` — the lazy+Suspense contract is identical, only the loader primitive differs); unknown widget ids MUST be skipped. In **Home v1 the recent-recipes (recipe) widget MUST be the only widget with a live implementation and a loader** (up to 4 most recently viewed or edited recipes).

    The meal-plan summary, today's macro totals vs. the nutrition goal, the unchecked shopping-list count, one AI-generated recipe suggestion, and the "Resume cooking" card (backed by services **005–009**) have no feature package yet. They MUST therefore be **represented by a host-rendered skeleton placeholder**, subject to all of the following:
    - **The placeholder MUST reproduce the real widget's layout and shape**, with **skeleton blocks in place of every data value**.
    - **The placeholder MUST NOT display mock, sample, or fabricated data** — no specimen macro totals, item counts, or recipe names. A plausible value reads to a user as their own real data; this prohibition is the point of the placeholder, not a detail of it.
    - **The placeholder MUST be rendered by the HOST from a static descriptor (id + title + shape) and MUST NOT import anything from the unbuilt feature package**, and MUST NOT be given a loader. This preserves the original constraint intact: a literal `import()` of a package that does not exist would fail the build, and no such import exists.
    - **Each feature MUST register its real widget (with its loader) when its package ships**; **capability gating then swaps the placeholder for the live widget once its backing service is live**, with no client change.
    - **Placeholders cover capability-absence ONLY.** A widget gated out by **subscription tier** MUST remain **absent**, not a placeholder — tier exclusion is an entitlement state, conveyed by the nudge below, and a skeleton would misrepresent it as merely unbuilt.
    - The per-widget **empty state** remains distinct from both: it applies only to **live** widgets with **no data**.

    Free-tier users MUST see a subscription upgrade nudge (at most once per session) when they interact with a premium-gated entry point on Home. The Home screen MUST be present on both web and mobile; every widget MUST be present on both platforms **in the same state** — live on both, or a placeholder on both — behind one widget id (per-platform `.native.tsx` implementations). Per-user layout (order, hidden) MUST persist across devices via `PATCH /v1/profiles/me`, owned by the identity service (002); **its consumption on Home is deferred in Home v1** (single live widget ⇒ order/hidden inert; no reorder/hide UI ships yet — REQ-068 / REQ-IF-006 deferred, WAV-002; the `curateHomeWidgets` seam already accepts `order`/`hidden`, so wiring it is additive when 005–009 add reorderable live widgets).

- **FR-044**: System MUST be available as both a mobile application and a web application with feature parity.
- **FR-044a** _(Parity Enforcement Rule)_: Every user-facing feature task MUST either (a) cover both web and mobile explicitly, or (b) be accompanied by a paired task for the other platform, or (c) carry a documented exception in the task body stating why parity is deferred and which future spec closes the gap. A task that implements a user-facing screen or flow for only one platform without a documented exception is a blocking defect. This rule applies at task-creation time, not only at final audit.
- **FR-045**: System MUST require user authentication for all features. There is no unauthenticated/anonymous access.
- **FR-045a** _(owner decision, 2026-07-28 — replaces the branded welcome/auth-entry landing that shipped with U8)_: The signed-out front door MUST be the **sign-in surface itself**. A signed-out request for the app's root MUST land the user on sign-in **directly**, with **no branded welcome, landing, or auth-entry interstitial** in front of it; a signed-**in** request for the root MUST render Home (FR-046). This holds on **both** platforms (FR-044): web's locale root redirects a signed-out caller to `/{locale}/sign-in`, and mobile's auth gate renders its sign-in form as the signed-out surface — the gate's screen union MUST NOT be able to represent a landing screen. Ending a session MUST leave the user on that same signed-out destination, so sign-out, account closure, and account erasure all land on sign-in.
    - **Sign-up MUST remain reachable from sign-in on both platforms.** The deleted welcome hero was the product's only "Get started" entry, so registration now depends entirely on the sign-in surface's own sign-up affordance (web: the link Clerk's `<SignIn>` renders from `signUpUrl`; mobile: the login screen's sign-up control). That affordance is therefore **required**, not incidental, and is covered by an E2E on each platform.
    - **Known consequence, accepted:** the product loses its pre-auth brand/value-proposition surface — a first-time visitor now meets a credentials form with no explanation of what Commise is, and a user who has just **erased** their account is shown a sign-in form for an account that no longer exists. Both are direct consequences of the owner's decision and are recorded here rather than worked around.

### Non-Functional Requirements _(constitution-derived)_

- **NFR-001**: All TypeScript MUST compile with `strict: true`; no `any` used outside explicitly marked test doubles. (Constitution Principle I)
- **NFR-002**: All exported functions and interfaces MUST carry JSDoc documentation. (Principle II)
- **NFR-003**: Any UI component MUST expose an accessible name queryable via `getByRole`/`getByLabel` in Playwright tests. (Principles IV & VII)
- **NFR-004**: Color MUST NOT be the sole conveyor of state; icon or text label pairing required. (Principle VII)

### Non-Functional Requirements _(testing & CI)_

- **NFR-005**: Development MUST follow TDD (red-green-refactor). Test files MUST be written before or co-committed with the implementation they cover. No implementation task is complete without its corresponding test.
- **NFR-006**: Browser E2E tests MUST use Playwright (`*.spec.ts`). Mobile E2E tests MUST use Maestro (`*.yaml` flow files). Platform selection is determined by target: web → Playwright, mobile (iOS/Android) → Maestro.
- **NFR-007**: All backend service tests (unit + integration) MUST run against LocalStack for AWS service emulation (S3, SQS). LocalStack MUST be available as a Docker Compose service for local development and as a GitHub Actions service container in CI.
- **NFR-008**: CI pipeline (GitHub Actions) MUST run `typecheck`, `lint`, `format:check`, `test` (unit + integration), and `test:e2e` (Playwright + Maestro) for every PR. All checks MUST pass before merge. (Constitution Principle VI)
- **NFR-009**: Frontend applications MUST resolve every API base URL from validated environment configuration, with **NO in-code default** (owner decision, 2026-07-28 — supersedes the earlier "Default: `http://localhost:4000`"). An absent or blank value MUST fail the build/startup loudly rather than fall back. Web: `NEXT_PUBLIC_RECIPE_API_URL`, `NEXT_PUBLIC_IDENTITY_API_URL`. Mobile: `EXPO_PUBLIC_RECIPE_API_URL`, `EXPO_PUBLIC_IDENTITY_API_URL`. Values are supplied per stage: the committed `.env.development` for local work (loaded by `next dev`/Expo and never by `next build`), the PR pipeline for previews (PR-scoped recipe host + shared sandbox identity host), and the production pipeline for prod. RATIONALE: these are `NEXT_PUBLIC_`/`EXPO_PUBLIC_` variables, inlined at BUILD time — a fallback is frozen into the shipped bundle, and a `http://localhost:3000` default did exactly that on the sandbox preview, making every visitor's browser call its own machine while every test still passed. Local port assignments MUST avoid collisions: API `:4000`, Next.js web `:3000`, Expo Metro `:8081`, Postgres `:5432`, LocalStack `:4566` (see plan.md NFR-009 section for the canonical port table).
- **NFR-010**: E2E tests MUST run against a database seeded with deterministic test data. Seed scripts MUST be idempotent and produce stable IDs for fixture-based assertions.
- **NFR-011**: Unit and component tests MUST use mocks and fixture factories (`make*` pattern per constitution Principle IV) — never live services or databases.

### Key Entities

- **User**: Represents a registered account holder. Has a subscription tier (free or premium), owns recipes, meal plans, nutrition plans, and grocery lists. Can configure AI provider credentials and manage external agent authorizations. _(Auth details: see [002-user-auth](../002-user-auth/spec.md))_
- **Recipe**: The core data object. Has a title, description, ingredients, instructions (ordered steps), prep/cook/total time, servings, tags, photos, an optional difficulty (`easy`/`medium`/`hard`, FR-001b), visibility (public/private), owner, and optional source attribution. Carries a read-only rating aggregate (average + count, FR-013a) derived from its **Rating**s. Backed by real food data for nutritional information. Its "PRO" indicator and list cover image are **derived on read**, not stored (FR-003a, FR-001c).
- **Rating** _(CR-001)_: One user's 1–5 star score for one recipe, owned by the **rater** (not the recipe's owner). At most one rating per user per recipe — re-rating replaces it. A user may rate any recipe they can see, except their own. Ratings are user-owned personal data and are erased with the rater's account, re-deriving the aggregate of the (surviving) rated recipes (FR-013b).
- **Collection**: A user-owned grouping of recipes. Has a name, visibility (public/private), an ordered list of recipe memberships, and an optional `sourceCollectionId` reference set when the collection was cloned from another user's public collection. A recipe can belong to multiple collections. Deletion of a collection does not cascade to its recipes, and vice versa.
- **Ingredient**: An ingredient reference linking a recipe to a food item with nutritional data (calories, protein, carbs, fat per unit), at a specific quantity and unit. Database-backed ingredients reference the food service's internal food id (`foodId`, an opaque ULID — never the source `fdcId`); the food↔ingredient link and a resolution-status field are owned by 001 (no cross-DB FK to the food service). Because [003-usda-food-data](../003-usda-food-data/spec.md) resolves food data **asynchronously**, a just-added food may be PENDING/UNRESOLVED and its nutrition may arrive later. Alternatively an ingredient may be user-entered (freeform name with optional manually-supplied nutrition values, flagged as "user-entered").

## API Contract & Input Validation (GR-015 / GR-016)

> This section **applies existing portfolio rules to 001's own packages** and **mints no new FR numbers**
> (GR-003), the way 011/012/013/014 do. Where [`plan.md`](./plan.md) already decided something, this section
> cites the decision rather than re-deciding it. Every count below was measured against the tree on
> **2026-08-12**; where the plan's own status notes have gone stale, the measured state is given and the
> staleness is named.

### Contract ownership (GR-015)

_The service authors it; clients declare nothing._

**Normative sources**: [`docs/CODING_STANDARDS.md` §15](../../docs/CODING_STANDARDS.md) ·
[`GR-015`](../governance-rules.md#gr-015-api-contract-ownership) ·
[`GR-017`](../governance-rules.md#gr-017-contract--validation-conformance-for-every-new-service-client-and-app) ·
[ADR-0014](../../docs/architecture/decisions/0014-service-owned-api-contracts.md). Full bindings:
[`plan.md` → _API Contracts — ownership and drift_](./plan.md#api-contracts--ownership-and-drift-gr-015).

| Role                                                            | Binding for 001                                                                                                                                                              |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Owning service (**authors** the zod)                            | `@kitchensink/recipe-service` — `packages/services/recipe-service/src/**/*.schema.ts` (8 files: recipes, collections, ingredients, photos, ratings, search, account, health) |
| Second deployable in scope                                      | `@kitchensink/recipe-workers` — authors its own queue envelopes at `src/common/messages.schema.ts`, and is a **consumer** of the service's zod                               |
| Schema package (**GENERATED and committed; never hand-edited**) | `@kitchensink/schema-recipe` — `packages/schemas/recipe`                                                                                                                     |
| Consuming client                                                | `@kitchensink/recipe-service-client` — `packages/clients/recipe-service`                                                                                                     |
| Consuming apps / feature packages                               | `@commise/web`, `@commise/mobile`, `@commise/features-recipes`                                                                                                               |
| Bound identically, **no dependency declared yet**               | `@commise/features-core`, `@commise/ui` — measured 2026-08-12 neither imports `@kitchensink/schema-recipe` nor the client; GR-015 §15-b.4 binds them the day they do         |
| 001 as a **client** of one of ours                              | `@kitchensink/food-service-client`, whose wire types come from `@kitchensink/schema-food` — food is ours, so §15-b applies in full                                           |
| Domain types (a **different** axis, GR-007)                     | `@kitchensink/recipe-core` — reused `import type`, **never re-declared** inside the schema package                                                                           |

**The service MUST** author every request and response shape of `/api/v1/recipes/*`, `/api/v1/collections/*`,
photos, ratings, search and `POST /api/v1/internal/account/erasure` as **zod in the recipe service**, at
`src/**/*.schema.ts` beside the controller it serves; **validate its own requests with that same zod** via
`nestjs-zod`'s `createZodDto`, so server and clients check one authored definition rather than two that agree
by convention; and keep every `*.schema.ts` importing **only `zod` and other `*.schema.ts` files**.
`@kitchensink/schema-recipe` is a committed **COPY** of that zod — not a transformation, because zod schemas
are runtime values and cannot be derived from themselves, and every package here exports raw `./src/*.ts` so
there is no bundle-into-`dist` path. It exports the **zod**, the **`z.infer` types**, a **`CONTRACT_HASH`**, a
**barrel**, and a **DERIVED `openapi.yaml`** — outbound only, for `oasdiff`, docs and integrators, and **never
a codegen input** (routing types through JSON Schema loses `readonly`, branded and template-literal types and
flattens discriminated unions).

**The CLIENT's obligation — separately mandatory.** Mandating only the service half is exactly how the client
half got skipped portfolio-wide: `@kitchensink/recipe-service-client` shipped **276 lines** of independently
declared wire types and imported nothing from the service, behind green builds.

- Every consumer imports its wire **types AND its runtime zod** from `@kitchensink/schema-recipe` and
  **declares no request or response body shape of the recipe service** — including **type-only**, and including
  inside `packages/apps/**` feature packages (GR-015 §15-b.4, GR-017 §17-b.1). The rule is about who authors a
  wire shape, not which directory it lives in.
- Where a consumer's shape **genuinely differs** — a form model, a filter view model, a narrowed list
  projection — it is **DERIVED** with `Pick` / `Omit` / `Partial` / mapped types, never independently declared.
  Reference implementation, already in this feature's own UI:
  `packages/apps/commise/features/recipes/src/filters/model.ts`.
- **Requests are validated in the SERVICE; responses are validated ON RECEIPT by the CONSUMER** — with that same
  zod, at the moment the body arrives (GR-016 §16-c.3, GR-017 §17-b.3). A consumer that parses is defending
  itself, which it may do unilaterally. Every **outbound** body is likewise validated against the **callee's**
  schema-package zod **before the call** (§16-c.2), so a malformed payload fails in the caller with a usable
  stack rather than as a remote `400`.
- **A new endpoint is not complete until its types are reachable from `@kitchensink/schema-recipe`.** "The web
  app will add the type" is a **contract fork**, not a task.

**CLIENT WORK IS ITS OWN DELIVERABLE, with its own tasks** (GR-017 §17-e.12). The schema package, the typed
client, response validation **on receipt**, and a **contract-skew guard** are tasks in
[`tasks.md`](./tasks.md) — not consequences of finishing the service. Measured 2026-08-12: the guard pattern
exists at `packages/clients/{recipe-service,food-service}/src/contractSkew.ts`, so 001 inherits it rather than
inventing one.

**Drift gates** — inherited from GR-015 §15-c, all three required, none reinvented here:

1. **Rebuild (turbo):** `$TURBO_ROOT$`-anchored **`inputs`** covering
   `packages/services/recipe-service/src/**/*.schema.ts`. ⚠️ **`inputs`, NOT `dependsOn`** — `recipe-service`
   devDepends on its own client for the contract test tier, so a `dependsOn` edge closes the cycle
   `client → schema → service → client` and turbo rejects the graph. Ordering was never the requirement: the
   generated files are committed, so `build` only compiles what is on disk. What is needed is **cache
   invalidation** when an authored schema changes.
2. **Correctness (CI):** regenerate and fail on any diff against the committed artifacts — the strong gate, and
   the only one that catches a hand-edited generated file.
3. **Skew (runtime):** the `CONTRACT_HASH` **boot assertion** (`src/main.ts` + `src/contract/`), the only layer
   that can catch a deployed recipe service running ahead of a **released mobile binary's** pinned schema.

⚠️ `oasdiff breaking` is worth adding with its blind spot stated: `@nestjs/swagger` emits **no response
schema** for a handler returning an `interface`, so until every response type is zod-derived that check cannot
see response changes — which is most of what actually breaks a client.

⚠️ **`specs/001-commise-recipe-app/contracts/api.openapi.yaml` is SUPERSEDED — and the plan's status note on it
is stale.** Recipe's derived document now **exists** at `packages/schemas/recipe/openapi.yaml`
(**5,700 lines, 34 paths** — re-measured 2026-08-12, correcting an earlier **4,945** taken the day before; the
document is generated, so its line count moves whenever a schema copy lands and **must be re-measured, never
quoted**) against the hand-written file's **2,840 lines, 32 paths** (also re-measured; the earlier **2,827**
predated two successive header rewrites, and the **body is unchanged at 2,810 lines** — the body is the only
figure worth comparing across revisions), so the condition
[`plan.md` → _Status_](./plan.md#status--in-progress-and-001s-hand-written-contract-is-not-yet-replaced) and the
hand-written file's own header both record ("the replacement has NOT been generated yet") no longer holds. The
**repointing is UNDERWAY, not untouched** — ⚠️ re-measured 2026-08-12 via `git ls-files`, only **5** committed
files under `packages/` still cite it (4 `.ts`, 1 k6 `.js`), **down from the 12 this paragraph previously
recorded**; **20 under `specs/`** and **5 under `docs/`** remain. So two
OpenAPI documents describe one service and only one of them is verified. **Where they disagree, the service's
zod wins**, and **the hand-written file MUST NOT be extended with a new endpoint** (GR-015 §15-a.7 / AC-015-f) —
author the zod in the service instead.

⛔ **THE THIRD-PARTY EXCEPTION (GR-015 §15-d) — the opposite case, and converging it deletes a boundary.** 001
reads the ingredient catalog through `@kitchensink/food-service-client`, which **is** one of ours, so §15-b
governs it in full. But that data originates at **USDA FoodData Central**, an API we do **not** serve, whose
client is `packages/clients/usda`. That client **validates the raw upstream shape at the boundary with its own
zod**, **MAY declare its own types**, and **gets NO OpenAPI document** — and it is the portfolio's **reference
implementation**, so `packages/clients/usda/src/schemas.ts` must **never** be "converged" under §15-b. Doing so
replaces a checked parse with unchecked trust in a remote party's JSON: a **security regression, not a
cleanup**. §15-b's reasoning does not reach here at all — duplication is only wrong when one side could have
been derived from the other, and this side belongs to someone else. See
[003](../003-usda-food-data/spec.md#api-contract--input-validation-gr-015--gr-016) for the full statement.

### Input validation — where that zod RUNS (GR-016)

**Normative sources**: [`docs/CODING_STANDARDS.md` §15.4](../../docs/CODING_STANDARDS.md) ·
[`GR-016`](../governance-rules.md#gr-016-input-validation-at-every-boundary) ·
[`GR-017`](../governance-rules.md#gr-017-contract--validation-conformance-for-every-new-service-client-and-app) ·
[ADR-0015](../../docs/architecture/decisions/0015-input-validation-at-every-boundary.md). Full bindings:
[`plan.md` → _Input validation_](./plan.md#input-validation--where-the-authored-zod-runs-gr-016). The section
above decides **who authors** the contract; this one is where it **runs**. It adds no FR (GR-003).

- **One mechanism, one `400`.** Every recipe / collection / photo / rating / search input — body, path params,
  query params and any header a handler reads — is parsed by the service's own `*.schema.ts` zod via
  `createZodDto` + **`nestjs-zod`'s** `ZodValidationPipe`.
    - ⚠️ **The `class-validator` residue is GONE — corrected 2026-08-12, superseding this bullet's earlier
      numbers, all of which were wrong in different ways.** The **"19 files"** was a **mention** count (JSDoc
      narrating the migration away from it), not an importer count. The **"18 `ZodValidationPipe` / 26
      `createZodDto` (21 `extends`)"** triple was **unreproducible by any parse**. And the "ONE file still
      imports it" — `src/search/dto/searchRecipes.query.dto.ts` — is now **converged** onto `createZodDto` +
      `ZodValidationPipe`, with `class-validator` and `class-transformer` **removed from
      `packages/services/recipe-service/package.json` and `prod.package.json`**. Re-measured today:
      recipe-service has **23 `ZodValidationPipe` references** and **22 classes extending `createZodDto`** across
      26 files, and `grep -rn "from 'class-validator'" packages --include="*.ts"` (minus `node_modules`/`dist`)
      finds **no importer anywhere under `packages/services`** — its single hit is a synthetic fixture string
      inside the repo-wide AST gate.
    - So recipe-service is **no longer the GR-016 §16-a.2 example**; it is the converged case. The rule is
      unchanged and now enforced repo-wide by **G5** in
      `packages/infra/global/__tests__/serviceSecurityInvariants.test.ts`, which requires a `ZodValidationPipe`
      over every HTTP controller in every discovered deployable and runs with **no exception list at all** — the
      `UNCONVERGED_CONTROLLERS` ratchet was **deleted** when search's controller, its one entry, converged. A new
      endpoint never adds a `class-validator` DTO, and the gate now fails the build rather than trusting prose.
- **⚠️ The pipe hazard is invisible in review.** Under Nest's **own** built-in `ValidationPipe`, a
  `createZodDto` DTO **validates nothing while looking correctly wired** — the schema is present, the DTO is
  referenced, the route reads as validated, and no input is checked. It already bit identity's
  **`PATCH /users/me`** (`002-FR-021`'s surface). This service registers **`nestjs-zod`'s** pipe, and the
  **only** thing that catches the failure is a test that posts a **known-bad body to a real route** and asserts
  the `400`. Make one of those the out-of-range `servings` case below, so the fix cannot silently regress.
- **`z.strictObject()` for every mutating request body** — the portfolio default, ruled 2026-08-12 in GR-017
  §17-c, which **closes OPEN-GR-016-B** (the plan still records it as OPEN; it is not). Plain `z.object()`
  survives only on a **read** surface with a **documented forward-compatibility reason at the schema**. The
  ruling picks the failure that is **visible**: on a mutating body a silently stripped unknown key is a `200`
  plus a partial write the caller was told succeeded. ⚠️ **Re-measured 2026-08-12 — the "zero `z.strictObject()`
  against 36 `z.object()`" figure this bullet carried is stale and understated the progress badly.**
  `recipe-service` now has **18** `z.strictObject()` occurrences against **22** `z.object()` in non-test sources.
  §17-c is therefore **mostly closed**, not a wide-open gap; what remains is confirming that each surviving
  `z.object()` is on a **read** surface with the documented forward-compatibility reason §17-c requires, rather
  than a mutating body that was missed. Count them, and read the reason at each site.
- **⛔ THE STORAGE FLOOR — this feature's own `500` that owed a `400`.** Five int-backed wire fields —
  **`servings`, `prepTimeMinutes`, `cookTimeMinutes`, `totalTimeMinutes`, `timerSeconds`** — carried **no upper
  bound** while writing `integer` (`int4`) columns capped at **2,147,483,647**, so `servings: 9999999999`
  **passed validation** and failed at the `INSERT`. Every input field writing a bounded column is validated at
  least as strictly as that column can store.
    - ⚠️ **Read the paragraph above as HISTORY, not as an open gap — corrected 2026-08-12.** An earlier revision
      let it stand as the **current** state, which schedules work already done. All five fields are bounded today
      by `positiveInt4()` / `recipeMinutesSchema` in
      `packages/shared/recipe-core/src/recipeRequestBounds.ts` (`z.number().int().max(INT4_CEILING)`,
      `INT4_CEILING = 2_147_483_647`), with accept-at-ceiling / reject-above asserted in
      `__tests__/recipeRequestBounds.test.ts`. It is kept because it is **why the bound exists**: a reader who
      does not know the `500` it caused is a reader who will "simplify" the ceiling away.
    - ⚠️ **This is an ASSERTION between two independently authored artifacts, NEVER a derivation.** Zod is
      **not** generated from drizzle and a `*.schema.ts` **never imports a storage type** — that coupling is the
      disease ADR-0014 removed (`RecipeSearchResponse.facets` taking its wire type from `../dal/search.dal.js`),
      not the cure. GR-015 §15-a.5 is unchanged. Enforcement is a **per-service parity test** in the service
      (GR-017 §17-d), which **may** import both artifacts — a test is not a wire schema — enumerates bounded
      columns **derived from the drizzle schema** rather than typed out, and asserts its field→column mapping
      complete **in both directions**, without which it silently shrinks to the fields someone remembered. It
      exists: `packages/services/recipe-service/src/database/__tests__/storageCapacity.test.ts`, over shared
      machinery in `@kitchensink/contract-gen` (`src/storageCapacity.ts`), whose `collectBoundedColumns`
      derives the column set from the drizzle tables and requires a stated `why` on every exemption.
    - ⚠️ **A floor is not a target.** Recipe's text columns are PostgreSQL `text()` — **unbounded** — so limits
      on `title`, step text, notes and ingredient names are **product decisions 001 owns**, with no floor to
      derive from. "The column allows it" is not a reason to accept a 2 MB recipe title.
- **Non-HTTP ingress this feature owns, enumerated** (a Nest pipe reaches none of them). All six
  `@kitchensink/recipe-workers` handlers — `version-archive-worker`, `account-erasure-worker`,
  `archive-sweeper`, `erasure-sweeper`, `erasure-orphan-sweeper`, `handle-sync-worker` — parse their SQS/event
  payload against authored zod (`src/common/messages.schema.ts`) **before** it becomes a job. An enqueued body
  is a string the producer chose. A **scheduled** sweep parses its event too: "ours" is an assumption about a
  deploy that has already drifted once. **An invalid payload is NEVER retried** (GR-018 §18-b): these consumers
  have no caller to answer, so a shape rejection is recorded with its `reason` and the message is **completed or
  dead-lettered once**, with an alarm on DLQ depth — returning it for redrive turns a producer's bug into
  sustained load.
- **Service-to-service, both directions.** 001 **calls** food via `@kitchensink/food-service-client`: outbound
  bodies validated against `@kitchensink/schema-food` **before the call**, responses validated **on receipt**.
  001 is also **called** — `POST /api/v1/internal/account/erasure` from identity's fan-out
  (`packages/services/identity-webhooks/src/common/erasureFanout.ts`) — and that inbound body is validated like
  any other. **"Internal" is not a synonym for "trusted"**: a caller inside our VPC still sends the wrong shape
  after a one-sided deploy. Because these are **our own** callers, an invalid body gets the `400` GR-016
  §16-a.3 requires, **not** the `2xx` that GR-018 §18-c reserves for signature-verifying third-party webhook
  senders.
- **Identifiers are never sentinels** (GR-019). `recipeId`, `collectionId`, `ratingId`, `photoId` and the owner
  `sub` are typed **required** wherever consumed — never optional-with-a-default, never `'unknown'`, `''` or
  `0`, including as a map key, a metrics dimension or a branch condition. The **only** paths where an absent id
  is permitted are the **create/upsert** bodies (`POST /api/v1/recipes`, `POST /api/v1/collections`, the rating
  upsert), where the id is **generated** as a ULID. An unresolvable id is a **rejection**, never a placeholder
  row.
- **No request-derived value reaches `sql.raw()`.** ⚠️ **Re-measured 2026-08-12, and the answer is stronger than
  this bullet claimed.** It named the search DAL
  (`packages/services/recipe-service/src/search/dal/search.dal.ts`) plus the two sweepers as **the only three
  sites passing a non-literal — "the state to preserve"**. There are now **ZERO `sql.raw(` call sites anywhere
  under `packages/`**; every remaining textual hit is prose, a comment recording the removal, or a gate fixture.
  Those sites now pass a **bound parameter** (`${value}`, or `${value}::interval` for an interval) instead.
  ⛔ **Do not "restore" a `sql.raw()` for readability** — two gates now hold the count at zero: an ESLint
  **`no-restricted-syntax`** ban in `packages/tools/eslint/index.js`, and repo-wide AST gate **G3** in
  `packages/infra/global/__tests__/serviceSecurityInvariants.test.ts`. Search is still the surface that would
  break it first — facet, sort and filter selections arrive **from the request** — so a validated enum still maps
  to a **closed allowlist of literals in code**: the request supplies the key, never the SQL fragment.
- **⛔ Server-side RESPONSE validation is DEFERRED by owner decision (GR-016 §16-g) and MUST NOT be
  "completed".** No service in this portfolio validates the bodies it **emits**, deliberately; a contributor who
  "finishes the job" is **undoing a decision**. Say which one you mean (GR-017 §17-f): a **consumer** parsing
  what it **received** is REQUIRED and is what the client half above mandates; a **producing service** parsing
  what it **emits** is the deferred one. Reversing the deferral needs its own proposal under the governance
  amendment process.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: Users can create a complete recipe (with ingredients, instructions, and photo) in under 5 minutes.
- **SC-005**: 80% of free-tier users engage with at least 3 core features (recipe creation, search, sharing) within their first week.
- **SC-009**: The system supports 10,000 concurrent users with p95 API response time ≤ 500ms.

## Assumptions

- Users have internet connectivity for core features.
- The real food/nutrition database will be sourced from a publicly available or licensable dataset (e.g., USDA FoodData Central or equivalent).
- The mobile application will target iOS and Android platforms.

## Clarifications

- **C-004 (Visibility Model)**: No unauthenticated/anonymous access — all users must sign up. Visibility rules by recipe origin:
    - **User-created recipes**: Public by default. Premium users can set to private. Free-tier users' recipes are always public.
    - **Imported from public source (website/Instagram)**: Always public with source attribution. Clones of these recipes also remain public with attribution until a premium user makes a substantive edit (modification to ingredients or instructions — title/description/tag/photo changes alone do not qualify), at which point they may set the clone to private.
    - **Imported from physical copy (photo/OCR)**: Private (no public source to attribute).
    - **Recipes from paid sources (cookbooks, subscription sites)**: MUST NEVER be made public. _(Legal review required — see FR-014a in [004-recipe-importing](../004-recipe-importing/spec.md))_
    - **On premium lapse**: Previously private user-created recipes stay private; no new recipes can be set to private until renewal. Paid-source recipes remain private regardless.
- **C-005 (Concurrent Edit Conflict Resolution)**: Every recipe save creates a new version. The last 10 versions are stored in the database for user access; all versions are archived to S3 indefinitely. On concurrent edit conflict (same recipe edited from two devices), the system detects the conflict, warns the user, and presents both versions for the user to choose or manually merge.
- **C-006 (Freeform Ingredients)**: When a user adds an ingredient not found in the food database, they may enter it as freeform text and optionally supply nutrition values manually. Such ingredients are flagged as "user-entered" to distinguish from database-backed data. Recipes with user-entered ingredients display a notice that nutrition data is partially user-supplied.
- **C-007 (Recipe Deletion & GDPR Erasure)**: Recipe deletion (FR-002) is a soft delete (tombstone). Tombstoned recipes are immediately removed from all listings, search, collections, and clone targets, but DB rows and S3 version archives are retained indefinitely. Hard purge (DB + all S3 version archives) is irreversible and only occurs via an explicit user-initiated "Erase my data" action satisfying GDPR right-to-erasure. **Erasure spans three owner-scoped roots** _(CR-001)_: the user's recipes, their collections, and the **ratings they authored** — the last of which live on **other users' recipes**, which survive erasure and must have their rating aggregate re-derived (FR-013b). This overrides FR-007b's indefinite-retention guarantee only for recipes the user explicitly chooses to erase. The `POST /v1/account/erasure` endpoint MUST be idempotent: a duplicate request while a job is already `queued` or `running` for the user MUST return HTTP 202 with the existing job's id (not enqueue a second job); a request after a `completed` job MUST return HTTP 410 (account already erased); a request after a `failed` job MUST enqueue a fresh retry and return HTTP 202 with the new job id.

### Session 2026-07-28 (owner decision — no welcome screen)

- Q: The signed-out front door was a branded welcome/auth-entry hero (U8) that led into sign-in or sign-up. Keep it? → A: **No — remove it entirely, on both platforms** (FR-045a). A signed-out visitor loads the **sign-in screen**; a signed-in visitor goes to **Home**. This **reverses** the U8 landing that shipped in the 2026-07-26 mobile-UI remediation campaign, and it reverses the reasoning previously recorded in code that the front door should be the branded hero "rather than straight to the bare sign-in form". Consequences accepted with the decision, not silently: the product no longer has a pre-auth surface that explains what it is, and a just-erased account lands on a sign-in form for an account that no longer exists. Sign-up remains reachable **only** from the sign-in surface, which is why that affordance is now a stated requirement with E2E coverage on each platform rather than an incidental link.

### Session 2026-07-16 (CR-001 — mockup parity)

Recorded by [`change-requests/CR-001-mockup-parity.md`](./change-requests/CR-001-mockup-parity.md), which carries the full rationale, the rejected alternatives, and the cross-artifact impact analysis.

- Q: The home and recipes mockups show a difficulty badge, but difficulty exists nowhere in the spec, model, contract, or schema. Add it — and is it required? → A: Add as `easy`/`medium`/`hard` (FR-001b), **optional**. There is no honest default: a `NOT NULL DEFAULT 'medium'` would make every recipe claim its author chose "medium" (and would be wrong for every recipe 004 imports). Absent difficulty renders no badge. This diverges from the `servings`/times NOT NULL precedent (migrations 0007/0008) **on purpose** — those are load-bearing and always knowable; difficulty is a subjective judgement nothing computes from.
- Q: Should recipe ratings be stored as a denormalized aggregate maintained by a trigger, or computed on read? → A: **Denormalized + trigger-maintained** (FR-013a), following the existing trigger-maintained `search_vector` precedent. Reads (Home widget + list, every session) vastly outnumber writes (one rating per user per recipe); the trigger also makes the aggregate impossible for a write path — including the erasure worker's bulk delete and the recipe-delete cascade — to bypass and leave stale.
- Q: Who may rate what? → A: Any authenticated user may rate any recipe **they can see** (existing visibility/IDOR read rules govern; an unreadable recipe is indistinguishable from a non-existent one), **except their own** (FR-013). One rating per user per recipe; re-rating replaces.
- Q: Is the "PRO" badge a stored flag or an entitlement lookup? → A: **Neither — it is derived on projection** (FR-003a), from `visibility` + `sourceType`, with one authoritative implementation. No column, no entitlement model, no 010 overlap. It is explicitly **not** `visibility === 'private'`: per C-004, physical/paid imports are private for every tier and must not be badged PRO.
- Q: Should widgets for unshipped features 005–009 remain absent from Home? → A: **No — this reverses FR-046 / R6.** They render as **skeleton placeholders** (the real widget's shape, skeleton blocks, **no fabricated data**). The original technical rationale is preserved, not violated: the host renders the skeleton from a static descriptor and imports nothing from the unbuilt package. Capability gating swaps the placeholder for the live widget when the package ships. Placeholders cover **capability**-absence only; **tier**-gated widgets stay absent.

### Session 2026-04-30

- Q: When a user deletes a recipe (FR-002), what is the deletion semantic? → A: Soft delete permanently (tombstoned, never auto-purged); explicit user-initiated "Erase my data" action triggers hard purge for GDPR.
- Q: After a user clones a public collection (FR-011), how do later updates to the source collection affect the clone? → A: Snapshot at clone time with an opt-in user-initiated "Pull updates from source" action; no automatic propagation; pull never overwrites recipes the cloner added directly.
- Q: What is the v1 scope for sharing collections with specific named users? → A: Out of scope for v1; v1 supports public/private only. Per-user collection sharing is deferred to a future spec.
- Q: How should the system handle photo upload failures (network drop, S3 unavailable, oversized/malformed files)? → A: Atomic recipe save; photo uploads are independent, validated client-side AND server-side for size/format, with per-file errors and individual retry; failed photos are never persisted as broken references.
- Q: If the S3 version-archive write fails during a recipe save, what is the required behavior? → A: User save succeeds; S3 archive is async with retry + DLQ and ops alerting on failure; failed-archive payloads are persisted locally in the DB as pending-archive records so retries can replay the exact payload until S3 confirms.

### Session 2026-04-18

- Q: How should the system handle ingredients not found in the food database? → A: Allow freeform ingredients with user-manually-entered nutrition values; flag as "user-entered" to distinguish from database-backed data.
- Q: What constitutes a "substantive edit" for visibility unlock on cloned imported recipes? → A: Any modification to ingredients or instructions. Title, description, tags, and photo changes alone do not qualify.
- Q: What is the concrete latency target for SC-009? → A: p95 API response time ≤ 500ms under 10,000 concurrent users.
- Q: What are the photo storage constraints per recipe? → A: Max 10 photos per recipe, 5MB per image.
- Q: What is the version history retention policy? → A: Last 10 versions in the database (queryable/restorable); all versions archived to S3 indefinitely.
- Q: What is the scope of recipe organization/collections and friends features? → A: **Collections are in scope for this spec** with public/private visibility only. Recipes can belong to multiple collections; deleting a recipe/collection doesn't cascade; cloning a public collection excludes private recipes the cloner can't access. Per-user sharing of collections (sharing with specific named users) and the friends system (QR codes, friend codes, friend requests, cross-platform) are both deferred to a separate spec.
