# Feature Specification: Recipe Importing

**Feature Branch**: `004-recipe-importing`
**Created**: 2026-04-14
**Last revised**: 2026-08-02 (reconciliation against shipped 001; owner decisions D-001..D-004 recorded)
**Status**: Ready for implementation — all revalidation gates resolved. One requirement (FR-009, Instagram) is
specified in full but **gated on an external Meta credential**; see `D-002` and the Gating section.
**Input**: Split from `001-commise-recipe-app` — recipe importing from external sources (URLs, Instagram,
physical copies) with attribution and deduplication.

---

## FR identifier namespace (read before citing an FR)

004's local requirement IDs `FR-008`..`FR-014a` **collide** with 001's shipped `FR-008`..`FR-014`
(collections and ratings). Within this feature's documents the bare IDs refer to the requirements below.
**Every cross-feature reference MUST use the `004-` prefix** (`004-FR-011`), matching
[`../cross-feature-FR-index.md`](../cross-feature-FR-index.md). The local numbers are retained rather than
renumbered so existing links and the index entry keep resolving.

---

## Dependencies

| Spec                                                        | Relationship                                                                                                                                                                                                                                                             |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [001-commise-recipe-app](../001-commise-recipe-app/spec.md) | **Required — and largely already shipped.** Owns the Recipe entity, attribution columns, clone, and the C-004 visibility policy. See _Relationship to shipped 001_ below.                                                                                                |
| [002-user-auth](../002-user-auth/spec.md)                   | **Required** — all import actions require authentication                                                                                                                                                                                                                 |
| [003-usda-food-data](../003-usda-food-data/spec.md)         | **Required** — imported ingredient lines resolve against the food catalog via `@kitchensink/food-service-client`                                                                                                                                                         |
| [010-subscriptions](../010-subscriptions/spec.md)           | **Required** — premium entitlement gates clone-to-private (`004-FR-011`) **and now gates every channel whose result is non-public** (`004-FR-028`, D-014). Until 010 ships, premium is derived from the signed token's `permissions` (the shipped `PREMIUM_PERMISSION`). |

### Relationship to shipped 001 — what 004 does NOT build

001 shipped on PR #73. Its implementation **already provides** the persistence and policy layer this feature
was originally written to create. 004 **consumes** the following and MUST NOT redefine, duplicate, or fork them:

| Already shipped in 001                                                                                       | Where                                                   |
| ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------- |
| `recipes.source_type` (`user_created`/`imported_public`/`imported_physical`/`imported_paid`)                 | `database/schema/recipes.ts`                            |
| `recipes.source_url`, `recipes.source_attribution`, `recipes.cloned_from_id`, `recipes.has_substantive_edit` | `database/schema/recipes.ts` (since `0001_initial.sql`) |
| The C-004 visibility policy over `(sourceType, isPremium, hasSubstantiveEdit, requested)`                    | `evaluateVisibility` in `@kitchensink/recipe-core`      |
| Clone with attribution retention, `POST /api/v1/recipes/{id}/clone`                                          | `recipes.service.ts` `clone()`, `recipes.controller.ts` |
| `canClone` / `canGoPrivate` access policy                                                                    | `recipeAccessPolicy.ts` in `@kitchensink/recipe-core`   |
| Single error envelope `{ code, message, details? }`, `RecipeErrorCode` → HTTP mapping                        | `common/filters/api-exception.filter.ts`                |
| Per-user rate limiting                                                                                       | `common/throttle/` (`@nestjs/throttler`)                |

**004's scope is ingestion**: fetching, extracting, normalising, classifying, de-duplicating, and policy-checking
external recipe content, then handing a complete, valid recipe to 001's write path. Attribution _display_
semantics, visibility _enforcement_, and cloning are 001's, referenced here as dependencies.

> ### ⚠️ 004 REQUIRES an additive change to 001's shipped service
>
> An earlier revision of this spec claimed 004 consumes the shipped write path unchanged. **That is false.**
> `RecipesService.create` hardcodes `sourceType: RecipeSourceType.USER_CREATED` and accepts no provenance
> argument, so it **cannot create an imported recipe at all**. The DAL already supports
> `sourceType`/`sourceUrl`/`sourceAttribution` — `clone()` uses them — but no creation path exposes them.
>
> 004 therefore depends on 001's recipes vertical gaining provenance-aware creation (`004-FR-024`,
> `004-FR-025`). This is **additive**: `POST /api/v1/recipes`'s existing behaviour is unchanged when no provenance
> is supplied. It is called out here because it is a cross-feature code dependency, not a 004-local change.

---

## User Scenarios & Testing _(mandatory)_

### User Story 1 — Import a recipe from an external source (Priority: P1)

A user imports a recipe from a public website URL, an Instagram post, a structured file, or a photo of a
physical copy. Every channel produces an **import draft** the user reviews and completes before it becomes a
recipe (see _The draft-and-confirm model_ below). Web and Instagram imports are attributed and public;
physical-copy and file imports are private. Recipes from paid sources are never public.

**Why this priority**: Importing removes the single largest barrier to onboarding — users already have
recipes elsewhere. Attribution compliance for web/Instagram imports is a legal requirement.

**Independent Test**: Import a public URL, confirm the draft, verify the recipe is public with visible source
attribution, then clone it and verify the clone retains attribution.

**Acceptance Scenarios**:

1. **Given** a user provides a public recipe URL, **When** the import completes, **Then** a draft is returned
   containing extracted title, ingredient lines, steps, times, servings, and photos, each marked with an
   extraction confidence, **and** no recipe exists yet.
2. **Given** a draft with every required field present and valid, **When** the user confirms it, **Then** a
   recipe is created with `sourceType = imported_public`, `visibility = public`, and the source attribution
   stored and displayed.
3. **Given** a draft missing a required field (servings, any time, at least one ingredient, or at least one
   step), **When** the user attempts to confirm it, **Then** confirmation is rejected with field-level errors
   and no recipe is created.
4. _(**Moved to 011** — D-001 as amended 2026-08-14. The photo→OCR→draft scenario is 011's to specify and
   test; asserting it here would make 004's suite fail on a channel 004 no longer builds.)_ 004's residual
   obligation is testable without OCR: **Given** a caller submits candidate recipes to the bulk import
   processor declaring `sourceType = imported_physical`, **When** the import is confirmed, **Then** recipes
   are created with `visibility = private` and no public source attribution (`FR-013`) — which is precisely
   the contract 011's image branch submits against (`FR-047`).
5. **Given** a recipe imported from Instagram, **When** it is displayed, **Then** the original creator's handle
   and post link are visible as attribution.
6. **Given** a URL whose domain is on the paywalled-source blocklist, **When** the user attempts to import,
   **Then** the system rejects it **before making any outbound request** and explains why.
7. **Given** a URL already imported by any user, **When** another user imports the same URL, **Then** the
   existing public recipe is surfaced instead of a second import, with a clone option offered.
8. **Given** a user pastes recipe content manually, **When** they attest that it came from a non-public source
   (cookbook, subscription site), **Then** the recipe is created as `imported_paid` and can never be made public.

---

### Edge Cases

- **Unreachable source**: a URL returning 404/410/5xx, timing out, or failing DNS/TLS produces a typed failure
  and **no** recipe and **no** draft (`FR-016`).
- **Source deleted after import**: an Instagram post or web page deleted by its creator does not remove the
  imported recipe; attribution is retained and marked unverifiable on next check (`FR-017`).
- **JS-rendered page**: a page whose recipe content requires client-side rendering yields zero extracted
  content and is reported as an explicit "no recipe found" failure, never a silent empty success.
- **Extraction succeeds, required fields missing**: the common case. The draft is returned with gaps flagged;
  the user completes them at confirm time (`FR-015`).
- **Ingredient line unparseable**: the raw line is retained verbatim on the draft with a null quantity and is
  surfaced for the user to correct; it does not fail the import.
- **Two users import the same new URL simultaneously**: exactly one recipe is created; the loser of the race
  receives the winner's recipe (`FR-008`, enforced by a unique constraint, not a read-then-write check).
- **Redirect to a blocked or private-network host**: the blocklist and SSRF guard are re-evaluated on **every**
  redirect hop, not only the original URL.

---

## The draft-and-confirm model _(architecturally load-bearing — read before changing any import flow)_

**Every import channel produces an `ImportDraft`. Confirming a draft creates the Recipe. No import path writes
a recipe directly.**

This is not a UX preference; it is forced by the shipped schema. 001's `CreateRecipeRequest` and the `recipes`
table require `servings`, `prepTimeMinutes`, `cookTimeMinutes`, `totalTimeMinutes` (all `NOT NULL`, with
`CHECK (servings > 0)` and `CHECK (… >= 0)`), **at least one** ingredient, and **at least one** step. Structured
recipe markup on the open web guarantees none of these:

- `servings` arrives as free text (`"4–6 servings"`, `"serves a crowd"`) or not at all.
- Times arrive as optional ISO-8601 durations (`"PT1H30M"`) or prose, and are frequently absent.
- `recipeIngredient` is an array of **free-text lines** (`"2 cups all-purpose flour, sifted"`), while
  `recipe_ingredients.quantity` is `numeric(10,3)` with `CHECK (quantity > 0)`.

An import that wrote directly to the recipes table would therefore have to invent values (fabricating
`servings = 1` or `prepTimeMinutes = 0`) or fail on perfectly good sources. The draft makes the incomplete
state **representable and correctable** instead of forcing a lie, and it collapses what were previously two
separate flows (OCR's review step and URL import's optional preview) into one.

Drafts are owner-scoped, expire (`FR-018`), and hold no recipe row until confirmed.

---

## Requirements _(mandatory)_

### Functional Requirements

> **Channel-ownership transfer (2026-08-14, D-001 as amended · [ADR-0019](../../docs/architecture/decisions/0019-recipe-import-spine.md)).**
> Photo/OCR is **011's channel**, not 004's. Consequently **every photo/OCR-specific provision below transfers
> to 011 along with the channel** and is retained here only because the provision's _rule_ is still the right
> one and 011 MUST inherit it rather than re-derive it — specifically: the premium gate on
> `imported_physical` (`FR-028`, D-014), the tighter OCR sub-quota (`FR-022`), deletion of OCR artifacts on
> draft expiry (`FR-018`), the OCR vendor's classification as an untrusted third-party boundary (§15-d), and
> the per-photo rate limit. Read each as _"011 MUST satisfy this for the photo channel"_.
> **004 retains exactly two photo-related obligations**: the chooser presents the method as
> unavailable-until-011 (`FR-046`), and the bulk import contract accepts `sourceType = imported_physical`
> without a contract change (`FR-047`). `FR-011`'s `sourceType` mapping stays here in full, because the
> classification vocabulary is the shared contract both features bind to.

**Ingestion**

- **FR-008**: System MUST allow users to import recipes from public website URLs, extracting title, ingredient
  lines, instruction steps, times, servings, and photo URLs into an import draft. Extraction MUST attempt
  structured markup first and fall back to heuristics. If a recipe from the same **canonicalized** source URL
  has already been imported and is not deleted, the system MUST surface the existing public recipe instead of
  creating a duplicate, and offer to clone it. Uniqueness MUST be enforced by a database constraint, not by a
  read-then-write check.
- **FR-009** _(GATED — see D-002)_: System MUST allow users to import recipes from public Instagram posts by
  extracting recipe content from the post caption. Import is limited to posts whose caption contains recipe
  text; video-only or image-only posts without recipe text are unsupported and the user MUST be told so.
  Deduplication by canonicalized source URL applies. **This requirement cannot function without an approved
  Meta application** (D-002); it MUST ship behind a capability flag that is off until that credential exists.
- **FR-012** _(REASSIGNED TO 011 — see D-001, amended 2026-08-14)_: Import from physical copies via photo
  capture and OCR is owned by [011-recipe-digitization](../011-recipe-digitization/spec.md), **not by 004**.
  011's image branch routes to a dedicated stateless image-processing service and then submits its extracted
  candidates to **this feature's bulk import processor** (`FR-047`), so the post-extraction path is shared and
  004 does not build a second one. 004's obligation is limited to two things: the import-method chooser
  (`FR-046`) MUST present the photo method as **unavailable-until-011** rather than omitting it silently or
  offering an affordance that does nothing, and the bulk import contract MUST accept the
  `imported_physical` `sourceType` so 011 can submit against it without a contract change.
  See [ADR-0019](../../docs/architecture/decisions/0019-recipe-import-spine.md) §1 and §3.
- **FR-019**: System MUST allow users to import recipes from structured files (JSON, YAML, or Markdown with
  YAML frontmatter), producing a draft. File type MUST be determined by content inspection (magic bytes), not
  by the client-supplied filename or MIME type.
- **FR-020**: System MUST parse each free-text ingredient line into a structured quantity, unit, and
  ingredient name, retaining the original line verbatim. Lines that cannot be parsed MUST be preserved with a
  null quantity and flagged for user correction — an unparseable line MUST NOT fail the import. Parsed
  ingredient names MUST be submitted to the food catalog (003) for asynchronous resolution using the shipped
  resolution lifecycle; an unresolved ingredient MUST NOT block draft confirmation.
- **FR-021**: System MUST normalize extracted ISO-8601 durations to integer minutes and free-text servings to
  a positive integer where unambiguous. Where a value is absent or ambiguous, the field MUST be left empty on
  the draft and flagged for user completion — the system MUST NOT substitute a default.

**The import spine — method selection, one processor, and live status** _(added 2026-08-14, owner ruling;
normative source [ADR-0019](../../docs/architecture/decisions/0019-recipe-import-spine.md))_

- **FR-046**: System MUST present an **import-method chooser** on both web and mobile, listing every import
  method as a distinct choice (URL, structured file, photo, and — when its capability flag is on — Instagram).
  Selecting a method MUST route to a surface designed for **that input format**; there MUST NOT be a single
  omni-input that infers the format from what the user supplied. A method that is not available in the current
  build (photo before 011 ships, `FR-012`; Instagram while gated, `FR-009`/D-002) MUST be shown in a
  visibly unavailable state with the reason, **not** omitted and **not** rendered as a control that does
  nothing. Rationale: format inference is how a paste-a-URL field silently accepts a file path, and how
  provenance gets guessed instead of declared.
- **FR-047**: Every import channel MUST terminate in **one** bulk import processor. A channel's distinct
  responsibility is limited to producing candidate recipe records from its source plus the `sourceType` that
  records provenance; everything after extraction — validation, ingredient resolution, recipe creation, and
  per-recipe outcome reporting (`FR-027`) — MUST be the shared path. `sourceType` MUST be **declared by the
  invoking surface and whitelisted server-side** (`FR-025`), never inferred from the payload. Adding a channel
  MUST be an adapter plus a `sourceType` member, not a new pipeline.
- **FR-048**: System MUST emit a status message **per recipe** as that recipe advances through the import
  spine — accepted, in flight (carrying the current stage), and terminal (succeeded, failed, or errored).
  Messages for one recipe MUST **supersede** prior messages for that recipe rather than accumulating, so a
  consumer holding only the latest message for an entity holds correct current state. Supersession MUST be
  decided by a **monotonic sequence carried in the envelope**, never by arrival order: the bus is
  at-least-once and out-of-order, and last-write-wins on arrival would silently revert a terminal
  `succeeded` to `processing` on a redelivery. A 1,000-recipe import (`FR-026`) therefore produces a bounded
  live view rather than an unbounded event log each client must reconcile.
- **FR-049**: System MUST emit the same shape of superseding status message **per food item** as ingredient
  resolution advances through its import/sync stages to a terminal state. The recipe-level status
  (`FR-048`) MUST NOT be the only signal, because a recipe can be created while its ingredients are still
  resolving (`FR-020` — an unresolved ingredient MUST NOT block confirmation).
- **FR-050**: A recipe that references a food item which is not yet resolved MUST store a **placeholder
  reference** to that item, and the food catalog MUST hold a corresponding **shell entry** carrying that
  item's current processing/sync/import status. Status MUST therefore be readable **from the database at any
  time**, not only by having observed the message stream: a client connecting mid-import, or after a dropped
  connection, MUST render correct state from a read, with `FR-048`/`FR-049` making it live rather than being
  the only source of truth. A status message is a notification **of** a committed state change and MUST NOT
  be the state itself.
    > ⛔ A shell entry is **not** a recipe written into the food database. The standing prohibition — a recipe
    > is a method, not a substance, and is never registered as a food entity — is unchanged. A shell is a
    > **food** in a pending state, created and advanced by the food service's own resolution pipeline because a
    > recipe referenced an ingredient it had not yet resolved. The food database keeps exactly one writer and
    > the recipe→food relationship stays one-directional.
- **FR-051**: Ingestion of a status message MUST be **idempotent**. Delivery is at-least-once, so a consumer
  MUST tolerate redelivery of a message it has already applied without duplicating an effect or regressing
  state.

**Attribution, visibility, and provenance**

- **FR-010**: System MUST prominently display source attribution (source URL, original author, platform) for
  all recipes imported from websites or Instagram, on both web and mobile.
- **FR-011**: System MUST classify imports by provenance and set `sourceType` accordingly —
  `imported_public` for web/Instagram, `imported_physical` for **photo/OCR** imports, `imported_paid` for
  attested paid sources, and **`user_created` for structured-file imports**. A file export is the user's own
  recipe content in a different container, not third-party material: classifying it `imported_physical` would
  have wrongly marked a user's own migrated recipes as un-attributable third-party content and — once D-014
  applies — locked migration behind a subscription. The D-003 attestation remains available if the user
  declares the file's contents came from elsewhere. Enforcement of the resulting visibility rules is **001's shipped `evaluateVisibility`
  policy**; 004 MUST NOT reimplement it.
- **FR-013**: System MUST create recipes imported from physical copies as private, with no public source
  attribution. Structured-file imports follow the ordinary `user_created` visibility rules (FR-011).

**Policy enforcement**

- **FR-014**: System MUST reject import attempts from known paywalled recipe sources before performing any
  outbound request, and inform the user with a clear explanation. The blocklist MUST be stored as data with an
  admin-managed lifecycle (D-004), not as a code constant, and MUST be re-evaluated on every redirect hop.
- **FR-014a**: System MUST require, for any manually pasted or typed recipe the user attests originates from an
  external source, both (a) an explicit source attestation and (b) a source citation — a URL where one exists,
  otherwise a free-text citation (e.g. book title, author, page). Where the cited source is **not a publicly
  reachable web page**, the recipe MUST be classified `imported_paid` and MUST NOT be made public. Automated
  detection heuristics MUST additionally run as a **secondary signal** that flags a recipe for review; a
  heuristic MUST NOT by itself reclassify a recipe or block a save. _(Legal review remains advisable on the
  heuristic set; the attestation + citation rule above is operable without it — see D-003.)_

**Failure handling and lifecycle**

- **FR-015**: System MUST return every import as a draft carrying per-field extraction confidence and an
  explicit list of missing required fields. Confirmation MUST validate against the shipped
  `CreateRecipeRequest` contract and MUST reject an incomplete draft with field-level errors.
- **FR-016**: System MUST inform the user when a source is unreachable, blocked, or contains no recognisable
  recipe, using distinct machine-readable error codes for each case, and MUST NOT create a recipe or a draft.
- **FR-017**: System MUST preserve an imported recipe when its original source is later deleted, retaining the
  stored attribution and marking the source unverifiable rather than removing it.
- **FR-029**: Every API path this feature introduces MUST begin `/api/{version}/`. Where 004 references an
  endpoint shipped by another feature, it MUST cite that endpoint's **actual** current path until the
  platform-wide prefix migration lands (D-015).
- **FR-028**: Any import channel whose result is **non-public by policy** MUST require an active premium
  entitlement: photo/OCR import (`imported_physical`) and attested paid-source entry (`imported_paid`). A
  caller without the entitlement MUST be refused with a distinct, machine-readable code — not a generic
  authorization error — so the client can present the upgrade path rather than a failure. The channel MUST also
  be absent from the advertised channel list for such a caller, so no unusable affordance is rendered.
- **FR-024**: Recipe creation MUST accept an explicit provenance (`sourceType` plus optional source URL and
  attribution) rather than assuming `user_created`, and MUST evaluate the C-004 visibility policy against the
  **actual** provenance. Omitted provenance MUST continue to mean `user_created`, so existing behaviour is
  unchanged. _(Requires a change to 001's `RecipesService` — see the callout above.)_
- **FR-025**: Client-supplied provenance MUST be whitelisted, never mass-assigned. A caller MAY declare only
  provenance that is **equally or more restrictive** than `user_created` — specifically the attested paid-source
  case (`FR-014a`). A caller MUST NOT be able to declare `imported_public` (which would let them attach false
  attribution) or `imported_physical` (which would grant a free-tier caller a private recipe that C-004
  reserves for premium). Those classifications are set **only** by the server from the channel it observed.
- **FR-026**: System MUST support importing a single file containing **many** recipes — up to **1,000** per
  file, rejecting a larger file with an explicit limit message — producing one draft per
  recipe. Drafts with no missing required fields MUST be confirmable in a single bulk action; drafts with gaps
  MUST be surfaced individually for completion. A failure affecting one recipe MUST NOT discard the others.
- **FR-027**: Bulk confirmation MUST report a **per-recipe outcome** (created, already existed, or failed with
  a reason) rather than a single aggregate result, and MUST apply deduplication per recipe so that a recipe
  already present resolves to the existing one rather than counting as a failure.
- **FR-023**: System MUST consult the source site's `robots.txt` before fetching, and MUST apply it as follows
  (D-007): where a group **explicitly names the import user-agent**, every directive in that group MUST be
  honoured in full, including a site-wide `Disallow: /`. Where only the wildcard (`*`) group applies, a
  **path-specific** `Disallow` matching the requested path MUST be honoured, while a **bare site-wide**
  `Disallow: /` MUST NOT block a user-initiated import. A blocked fetch MUST be reported as
  `IMPORT_SOURCE_BLOCKED` and MUST be counted, so the real-world cost of this policy is measurable.
- **FR-022**: System MUST enforce a per-user daily import quota across all channels, and a tighter sub-quota
  for OCR imports specifically. Exceeding either MUST return a distinct, machine-readable error carrying the
  time at which the quota resets — not a generic rate-limit response. The quota is a **product allowance**, not
  a transport rate limit: it is evaluated in the domain layer and is expected to vary by subscription tier once
  [010-subscriptions](../010-subscriptions/spec.md) lands. Per-minute burst limiting remains the shipped
  throttler's job (D-006).
- **FR-018**: System MUST expire unconfirmed import drafts **7 days** after creation, and MUST delete any OCR
  source image on confirm, discard, or expiry — whichever occurs first. The draft and its image share one
  lifetime: there is no state in which an image outlives the draft that references it. The retention period is
  configurable per stage but MUST NOT exceed 7 days in production (D-005).

### Non-Functional Requirements _(constitution-derived)_

- **NFR-001**: All TypeScript MUST compile with `strict: true`; no `any` outside explicitly marked test doubles.
- **NFR-002**: All exported functions and interfaces MUST carry JSDoc documentation.
- **NFR-003**: Any UI component MUST expose an accessible name queryable via `getByRole`/`getByLabel`.
- **NFR-004**: Colour MUST NOT be the sole conveyor of state; icon or text label pairing required.
- **NFR-005**: All user-facing copy introduced by this feature MUST be routed through the shipped localization
  path (`@commise/i18n`, `useMessages`) and shared between web and mobile. The service MUST return
  machine-readable error **codes**; user-facing prose is the client's responsibility.
- **NFR-006**: Every outbound request to a third-party source MUST carry an explicit connection and request
  timeout, a bounded redirect count, a bounded response size, and MUST be wrapped in a circuit breaker.
  Retries are permitted only for idempotent, transient failures, with exponential backoff and full jitter.
- **NFR-007**: The service MUST NOT issue an outbound request to a private, loopback, link-local, or otherwise
  non-public network address, and MUST re-validate this on every redirect hop (SSRF defence).
- **NFR-008**: All extracted third-party content MUST be sanitized before persistence; no extracted markup may
  be stored or rendered as HTML.
- **NFR-009**: Import endpoints MUST publish latency and availability SLOs and MUST be load- and soak-tested
  against them (k6).

### Key Entities

- **Import Draft**: an owner-scoped, expiring staging record holding extracted recipe content, per-field
  confidence, the list of missing required fields, provenance classification, and the source reference.
  Confirming a draft creates a Recipe; nothing else does. Never public.
- **Paywalled Source**: an admin-managed blocklist entry (domain, reason, who added it, when) consulted before
  every outbound fetch and on every redirect hop.
- **Recipe Source** _(001-owned)_: the attribution metadata already carried on the Recipe entity —
  `source_type`, `source_url`, `source_attribution`, `cloned_from_id`. 004 populates it; 001 defines it.

---

## API Contract & Input Validation (GR-015 / GR-016)

> This section **applies existing portfolio rules to 004's own surface** and **mints no new FR numbers**
> (GR-003), the way 011/012/013/014 do. Where [`plan.md`](./plan.md) already decided something, the decision is
> cited rather than re-made. Every count was measured against the tree on **2026-08-12**.
>
> ⛔ **004 creates NO service and NO schema package.** It **extends** an existing service and **adds to** an
> existing schema package. There is no `@kitchensink/schema-recipe-importing` (verified 2026-08-12: no such
> directory), and there must not be — a schema package is per **SERVICE**, not per feature.

### Contract ownership (GR-015)

_The service authors it; clients declare nothing — and 004's untrusted input side is the inverted case._

**Normative sources**: [`docs/CODING_STANDARDS.md` §15](../../docs/CODING_STANDARDS.md) ·
[`GR-015`](../governance-rules.md#gr-015-api-contract-ownership) ·
[`GR-017`](../governance-rules.md#gr-017-contract--validation-conformance-for-every-new-service-client-and-app) ·
[ADR-0014](../../docs/architecture/decisions/0014-service-owned-api-contracts.md). Full bindings:
[`plan.md` → _3.0 Contract ownership and drift_](./plan.md#30-contract-ownership-and-drift-gr-015).

| Role                                                            | Binding for 004                                                                                                                                  |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Owning service (**authors** the zod)                            | `@kitchensink/recipe-service` — the import endpoints' `*.schema.ts` live **beside the import controller**, alongside 001's 8 existing wire files |
| Schema package (**GENERATED and committed; never hand-edited**) | `@kitchensink/schema-recipe` — `packages/schemas/recipe`. **Shared with 001: 004 ADDS to it, never forks it.**                                   |
| Consuming client                                                | `@kitchensink/recipe-service-client` — `packages/clients/recipe-service`                                                                         |
| Consuming apps / feature packages                               | `@commise/web`, `@commise/mobile`, `@commise/features-recipes`                                                                                   |
| 004 as a **client** of one of ours (§15-b)                      | `@kitchensink/food-service-client` for ingredient resolution → wire types from `@kitchensink/schema-food`, and **no food wire shape declared**   |
| Non-HTTP deployable in scope                                    | `@kitchensink/recipe-workers` — the async import job envelope is authored **once** and validated on receipt                                      |
| **Third-party boundaries (§15-d — EXEMPT, inverted)**           | every extraction adapter: scraped HTML, schema.org / JSON-LD, Instagram/Meta oEmbed, the OCR vendor, uploaded files                              |

**The service MUST** author every import / job / draft request and response shape — and the admin
paywalled-domain surface — as **zod in the recipe service** beside its controller; **validate its own requests
with that same zod** via `nestjs-zod`'s `createZodDto`; **regenerate `@kitchensink/schema-recipe`** so the new
shapes are exported; and keep those `*.schema.ts` files importing **only `zod` and other `*.schema.ts` files** —
no extractor type, no drizzle schema, no Nest symbol.

`@kitchensink/schema-recipe` is a committed **COPY** of that zod — not a transformation, because zod schemas are
runtime values and cannot be derived from themselves, and every package here exports raw `./src/*.ts` so there
is no bundle-into-`dist` path. It exports the **zod**, the **`z.infer` types**, a **`CONTRACT_HASH`**, a
**barrel**, and a **DERIVED `openapi.yaml`** — outbound only, for `oasdiff`, docs and integrators, and **never a
codegen input** (routing types through JSON Schema loses `readonly`, branded and template-literal types and
flattens discriminated unions).

⚠️ **`specs/001-commise-recipe-app/contracts/api.openapi.yaml` is SUPERSEDED and MUST NOT be extended with
004's endpoints.** This **supersedes D-016 in place** — see the amended decision under _Owner decisions_ below.
Recipe's derived document now
**exists** at `packages/schemas/recipe/openapi.yaml` (**5,700 lines, 34 paths**) against the hand-written file's
**2,840 lines, 32 paths** — ⚠️ **re-measured 2026-08-12, correcting the 4,945 / 2,827 pair this paragraph carried**;
both documents moved the same day the figures were taken (the derived one because it is **generated**, the
hand-written one by header rewrites over an unchanged 2,810-line body), so `wc -l` them rather than quoting.
And "the replacement has not been generated yet" is no longer said by the hand-written file's own header either —
it now carries a `STATUS (2026-08-12)` block naming the replacement. Where the two disagree, **the service's zod
wins**.

**The CLIENT's obligation — separately mandatory.** Mandating only the service half is exactly how the client
half got skipped portfolio-wide, behind green builds.

- Every consumer imports its import-job, draft and error wire **types AND runtime zod** from
  `@kitchensink/schema-recipe` and **declares none of its own** — including **type-only**, and including inside
  `packages/apps/**` feature packages (GR-015 §15-b.4, GR-017 §17-b.1).
- **The draft-review UI is 004's load-bearing case.** A review screen's editable model is a **DERIVATION** of
  the draft wire type via `Pick` / `Omit` / `Partial` — never a hand-written parallel interface — and it is
  derived **once and shared**, not re-typed on web and again on mobile. Reference implementation:
  `packages/apps/commise/features/recipes/src/filters/model.ts`.
- **Responses are validated ON RECEIPT by the consumer**, at the moment the body arrives (GR-016 §16-c.3).
- **An import endpoint is not complete until its types are reachable from `@kitchensink/schema-recipe`.** "The
  review screen will add the type" is a **contract fork**, not a task.

**CLIENT WORK IS ITS OWN DELIVERABLE, with its own tasks** (GR-017 §17-e.12): regenerating the schema package,
extending the typed client, receipt validation, and the **contract-skew guard** are tasks in
[`tasks.md`](./tasks.md) — not consequences of finishing the service. ✅ The guard exists at
`packages/clients/recipe-service/src/contractSkew.ts`, so 004 inherits it rather than inventing one.

**Drift gates** — inherited from GR-015 §15-c, all three required, none reinvented here:

1. **Rebuild (turbo):** `$TURBO_ROOT$`-anchored **`inputs`** covering
   `packages/services/recipe-service/src/**/*.schema.ts`. ⚠️ **`inputs`, NOT `dependsOn`** — `recipe-service`
   devDepends on its own client for the contract test tier, so a `dependsOn` edge closes the cycle
   `client → schema → service → client` and turbo rejects the graph. Ordering was never the requirement: the
   generated files are committed, so `build` only compiles what is on disk. What is needed is **cache
   invalidation** when an authored schema changes.
2. **Correctness (CI):** regenerate and fail on any diff against the committed artifacts — the strong gate, and
   the only one that catches a hand-edited generated file.
3. **Skew (runtime):** the `CONTRACT_HASH` **boot assertion**, the only layer that can catch a deployed recipe
   service running ahead of a released mobile binary's pinned schema.

⚠️ `oasdiff breaking` is worth adding with its blind spot stated: `@nestjs/swagger` emits **no response
schema** for a handler returning an `interface`, so until every response type is zod-derived that check cannot
see response changes — most of what actually breaks a client.

⛔ **THE THIRD-PARTY EXCEPTION (GR-015 §15-d) — on 004 this is the LOAD-BEARING half.** Every other feature
validates input a user typed; **004 validates input a stranger's web page emitted.** Its entire input side is
untrusted external data and **none of it is a contract we own**:

- **Scraped web pages, schema.org / JSON-LD recipe blobs, Instagram/Meta oEmbed payloads, uploaded files, and
  OCR output.** A publisher's JSON-LD is not an API we serve; it is arbitrary, attacker-influenceable input, and
  the same is true of a photograph of an arbitrary page.
- Every extraction adapter therefore **validates the raw upstream shape at the boundary with its own zod**
  before any field reaches a draft, and **MAY declare its own types**. The normalized draft shape **deliberately
  differs** from whatever the page emitted — that difference is the **normalization, not drift**.
- **No OpenAPI document is written for any upstream source**, and **none of those shapes enters
  `@kitchensink/schema-recipe`** as though we owned it. Only 004's **own** endpoints do.
- `packages/clients/usda` is the reference implementation and its `schemas.ts` must **never** be "converged".
  **Do not "converge" a boundary schema away here either:** on this feature it is the parse standing between a
  **hostile page** and the **recipe write path**. Doing so replaces a checked parse with unchecked trust in a
  remote party's data — a **security regression, not a cleanup**. §15-b's reasoning does not reach this case at
  all: duplication is only wrong when one side could have been derived from the other, and this side belongs to
  someone else.

### Input validation — where that zod RUNS (GR-016)

**Normative sources**: [`docs/CODING_STANDARDS.md` §15.4](../../docs/CODING_STANDARDS.md) ·
[`GR-016`](../governance-rules.md#gr-016-input-validation-at-every-boundary) ·
[`GR-017`](../governance-rules.md#gr-017-contract--validation-conformance-for-every-new-service-client-and-app) ·
[`GR-018`](../governance-rules.md#gr-018-one-rejection-path-and-invalid-input-is-never-retried) ·
[ADR-0015](../../docs/architecture/decisions/0015-input-validation-at-every-boundary.md). Full bindings:
[`plan.md` → _3.1 Input validation_](./plan.md#31-input-validation-gr-016--004s-input-is-hostile-by-definition).
The section above decides **who authors** the contract; this one is where it **runs**. It adds no FR (GR-003) —
`FR-025`'s provenance whitelist and the error-code table already state the requirements.

- **One mechanism, one `400`.** Every import / job / draft / admin-domain input — body, path params, query
  params, and the required `Idempotency-Key` header — is parsed by the recipe service's own `*.schema.ts` zod via
  `createZodDto` + **`nestjs-zod`'s** `ZodValidationPipe`. **004 adds NO `class-validator` DTO.** ✅ ⚠️ **CORRECTED
  2026-08-12 — the residue is now ZERO, not "one file", and not the 19 recorded elsewhere.** The "19" was always a
  **mention** count (JSDoc about the migration away from it); there was exactly one importer,
  `src/search/dto/search-recipes.query.dto.ts`, and it is now **converged** onto `createZodDto` +
  `ZodValidationPipe`, with `class-validator` and `class-transformer` **removed from recipe-service's
  `package.json` and `prod.package.json`**. `grep -rn "from 'class-validator'" packages --include="*.ts"` finds no
  importer anywhere under `packages/services`. So 004 inherits a **single-mechanism** service — ⛔ which raises the
  cost of adding a `class-validator` DTO here from "joining a mess" to "**re-creating** one", and it would now also
  fail **G5** in `packages/infra/global/__tests__/service-security-invariants.test.ts`, which carries **no
  exception list**.
- **⚠️ The pipe hazard is invisible in review.** Under Nest's **own** built-in `ValidationPipe`, a
  `createZodDto` DTO **validates nothing while looking correctly wired** — the schema is present, the DTO is
  referenced, the route reads as validated, and no input is checked. It already bit identity's
  `PATCH /users/me`. The service registers **`nestjs-zod`'s** pipe, and the **only** thing that catches the
  failure is a test that posts a **known-bad body to a real route** and asserts the `400`.
- **`z.strictObject()` for every mutating request body** — the portfolio default, ruled 2026-08-12 in GR-017
  §17-c, which **closes OPEN-GR-016-B** (the plan still records it as OPEN; it is not). Plain `z.object()`
  survives only on a **read** surface with a **documented forward-compatibility reason at the schema**. On
  `PATCH /api/v1/recipes/import/drafts/{id}` — a **user correcting an extraction** — a silently stripped unknown
  key returns `200` for a correction that was never applied, which is the worst possible place for `z.object`'s
  default. ⛔ Measured 2026-08-12, `recipe-service` has **zero** `z.strictObject()` against **36** `z.object()`
  occurrences, so 004's mutating bodies must be authored strict from the start rather than matching the
  neighbours.
- **⛔ THE STORAGE FLOOR — and 004 is the channel that reaches it from data we did not author.** 001's five
  int-backed fields — **`servings`, `prepTimeMinutes`, `cookTimeMinutes`, `totalTimeMinutes`, `timerSeconds`** —
  write `integer` (`int4`) columns capped at **2,147,483,647**. A publisher's JSON-LD claiming
  `"recipeYield": 9999999999` must be rejected **when the draft is created**, not discovered at the `INSERT`
  behind `confirm` — that is the `500`-that-owed-a-`400` shape GR-016 exists to end. Every extracted numeric is
  bounded **at the extraction boundary AND at the draft/confirm wire boundary**: two different inputs from two
  different parties.
    - ⚠️ **This is an ASSERTION between two independently authored artifacts, NEVER a derivation.** Zod is
      **not** generated from drizzle and a `*.schema.ts` **never imports a storage type** — GR-015 §15-a.5 is
      unchanged. Enforcement is 001's per-service parity test, which 004 **extends rather than duplicates**:
      `packages/services/recipe-service/src/database/__tests__/storage-capacity.test.ts`, over shared machinery in
      `@kitchensink/contract-gen` (`src/storage-capacity.ts`). It **may** import both artifacts because a test is
      not a wire schema; it **derives** the bounded-column set from the drizzle tables, so a new import-draft
      column fails the test until it is bound to the wire field that writes it or **exempted with a stated
      `why`**, and its field→column mapping completeness is asserted **in both directions**.
    - ⚠️ **A floor is not a target — and here it is also a DoS control.** Recipe's text columns are PostgreSQL
      `text()`, i.e. **unbounded**, so limits on an extracted title, step, note or ingredient string are
      **product decisions**, with the added property that on 004 **the upstream author chooses the length**.
      "The column allows it" is not a reason to persist a 2 MB step.
- **✅ The extraction adapters' boundary parse is REQUIRED by GR-016, not merely PERMITTED by §15-d.** The
  section above permits the adapters to own their types; GR-016 makes the parse **mandatory before any field
  reaches a draft**, and forbids converging it away.
- **The provenance whitelist is the pattern GR-016 wants everywhere.** `FR-025` / HAZ-057 makes
  `imported_public` / `imported_physical` **not representable** in the `POST /api/v1/recipes` DTO — the rule
  lives **in the type, not in a validation branch someone can forget.** That is "make illegal states
  unrepresentable" applied to a wire schema; prefer it over a refinement wherever the shape allows.
- **Non-HTTP ingress this feature owns, enumerated** (a Nest pipe reaches none of them): the async import path —
  `POST .../import/url`, `.../import/instagram` and `.../import/photo`, each answering `202` — enqueues a job,
  and the worker **parses its job payload against an authored zod before acting on it**. The job envelope is
  shared between the service and `@kitchensink/recipe-workers`, **authored once** and validated **on receipt**,
  because the two deployables version independently. **An invalid payload is NEVER retried** (GR-018 §18-b):
  there is no caller to answer, so a shape rejection is recorded with its `reason` and the message is
  **completed or dead-lettered once**, with an alarm on DLQ depth. The legitimate retry is a **transient
  dependency** failure — `IMPORT_PROVIDER_UNAVAILABLE` (`503`, circuit open) is that condition, with its own
  `reason`, and it MAY retry. `POST .../import/file` is **synchronous** (local parse, no outbound call) and has
  no queue ingress.
- **⚠️ For 004's own callers, an invalid body is a `400` — NOT the `2xx` GR-018 §18-c reserves for
  signature-verifying third-party webhook senders.** 004 exposes no third-party webhook: the OCR vendor is
  called **outbound** and its result is parsed on receipt. If a provider completion **callback** is ever added,
  it needs **both** controls in order — **authenticate it, then validate its schema** — because a signature
  proves **origin, not shape**, and that payload would decide whether a draft becomes a recipe.
- **004 is a client of food** (ingredient resolution): outbound bodies validated against
  `@kitchensink/schema-food` **before the call** — including the ≤100-name batch bound (`003-FR-045`) — and
  responses validated **on receipt**.
- **Identifiers are never sentinels (GR-019).** `jobId`, `draftId`, the owner `sub` and the created `recipeId`
  are typed **required** wherever consumed — never optional-with-a-default, never `'unknown'`, `''` or `0`,
  including as a map key, a metrics dimension or a branch condition. The **only** paths where an absent id is
  permitted are the **create** paths (a job/draft id and the confirmed recipe's id are **generated** as ULIDs).
  An unresolvable or foreign id is a **rejection** — and per the object-level authorization rule it is a `404`,
  never a `403`, so a draft belonging to another user is indistinguishable from one that does not exist.
- **⚠️ Validation is NOT SSRF defence, and neither substitutes for the other.** A URL that **parses** is not a
  URL that is **safe to fetch**: the SSRF controls (`REQ-NF-009` / HAZ-003, a Catastrophic hazard whose
  procedures are non-waivable per D-018) still apply **after** the schema accepts the input. Likewise
  `IMPORT_UNSUPPORTED_FORMAT` is decided by **magic bytes**, not by a declared content type.
- **⛔ Server-side RESPONSE validation is DEFERRED by owner decision (GR-016 §16-g) and MUST NOT be
  "completed".** Do not add server-side response parsing to the import endpoints. Say which one you mean
  (GR-017 §17-f): a **consumer** parsing what it **received** — including every extraction adapter parsing what
  a page sent — is REQUIRED; a **producing service** parsing what it **emits** is the deferred one. Reversing the
  deferral needs its own proposal under the governance amendment process.

---

## Success Criteria _(mandatory)_

- **SC-002**: For a fixture corpus of public recipe URLs carrying structured markup, extraction MUST populate
  title, ingredient lines, and instruction steps with at least **85% field-level accuracy**, measured against
  hand-verified expected values. The corpus, its size, and the measurement method are defined in
  `v-model/acceptance-plan.md`; the metric is meaningless without them.
- **SC-003**: At least **95%** of imports from sources carrying valid schema.org `Recipe` JSON-LD MUST produce
  a draft with zero missing required fields other than `servings`.
- **SC-004**: p95 end-to-end latency for a URL import job MUST be ≤ 15s; p99 ≤ 30s (the outbound fetch budget
  dominates). Draft confirmation is a local write: p95 ≤ 400ms.
- **SC-005**: Duplicate public recipes for the same canonicalized source URL MUST be **zero**, including under
  concurrent import of the same URL.

---

## Owner decisions _(2026-08-02 — resolves the revalidation gate)_

- **D-001 (OCR launch scope)** — ⛔ **SUPERSEDED 2026-08-14 by the owner ruling recorded in
  [ADR-0019](../../docs/architecture/decisions/0019-recipe-import-spine.md).** Read the amendment below; the
  original text is retained struck-through so the reversal is auditable rather than invisible.
    - _Original (2026-08-02):_ ~~Physical-copy import (`FR-012`) **ships at launch at P1**. Provider is **AWS
      Textract** — the account is already AWS-native, credentials are IAM rather than a new vendor secret, and
      `sharp` is already a service dependency for image preprocessing. It sits behind an `OcrProvider` port so
      the pipeline is testable without the vendor and the choice is reversible. **Amended by D-014**: OCR
      import is premium-only, which also bounds Textract spend to paying users.~~
    - **Amended:** **photo/OCR does not ship with 004.** The image branch is owned by
      [011-recipe-digitization](../011-recipe-digitization/spec.md), lands **after** 004, routes to a
      dedicated **stateless** image-processing service, and then submits its extracted candidates to 004's
      bulk import processor (`FR-047`). 004 ships the chooser (`FR-046`), the URL channel (`FR-008`) and the
      structured-file channel (`FR-019`), plus the first phase of bulk import (`FR-026`, `FR-027`).
    - **Why the original was wrong, not merely re-scoped.** It was never a clean decision to begin with:
      011's own prerequisite table already declared the boundary — _"004 = structured/web-URL imports;
      011 = unstructured photo imports"_ — while D-001 committed 004 to the same channel. **Two accepted
      specs each owned photo import**, and whichever shipped second would have found the other already owning
      `sourceType`, the draft-confirm flow and the recipe-creation call. The ruling resolves a real
      contradiction; it did not introduce one.
    - **Why 011 rather than 004 owns it.** 011's photo depth — handwriting, multi-photo batches, per-token
      confidence, and a side-by-side correction UI — is a product in its own right and far exceeds 004's
      single `FR-012` sentence. Folding it into 004 would have discarded the differentiator 011 exists for.
    - **Consequence for D-014.** The premium gate on OCR moves with the channel; it becomes 011's to enforce,
      via the same shared entitlement mechanism (never an import of the identity service — ADR-0017
      decision 3). D-014's rule for 004's own non-public channels is unchanged.
- **D-002 (Instagram)**: `FR-009` is **fully specified but gated**. The public no-auth oEmbed endpoint
  (`api.instagram.com/oembed`) was withdrawn on 2020-10-24; oEmbed now requires a Meta app credential and App
  Review. Instagram import therefore ships behind a capability flag, defaulting off, and its adapter is
  developed and tested against a contract fake. **No other requirement in 004 depends on it.** The Meta
  application is an external workstream that does not gate release.
- **D-003 (FR-014a)**: Attestation **and** citation **and** heuristics, as specified in `FR-014a`: the user
  declares the source and must cite it; a non-public cited source forces `imported_paid` (never public);
  heuristics flag for review only. Enforcement reuses 001's shipped `imported_paid` handling, so only
  _classification_ is new.
- **D-004 (Blocklist governance)**: The paywalled-domain blocklist is a **database table with an admin-scoped
  endpoint** and an audit trail (who added an entry, when, and why). Updating it is an operational action, not
  a release.
- **D-011 (Creation shape, 2026-08-02)**: Recipe creation is fixed at the source rather than fenced off.
  `RecipesService.create` stops hardcoding `USER_CREATED` and takes provenance as an explicit argument
  (defaulting to `user_created`, so `POST /api/v1/recipes` is unchanged), and a **bulk creation** path is added
  alongside it for multi-recipe import. Provenance that a client may declare is **whitelisted** (`FR-025`):
  self-declaring a more restrictive class is allowed, self-declaring `imported_public` or `imported_physical`
  is not. An earlier draft of this plan proposed instead leaving `create` alone and adding lint rules, a module
  fence, and an architecture test to stop anyone bypassing a wrapper — machinery guarding a hypothetical future
  mistake, on top of a method that could not do the job anyway. Fixing the method is the smaller and more
  honest change; the required-argument signature is the control.
- **D-016 (OpenAPI contract location, 2026-08-02) — ⛔ SUPERSEDED 2026-08-12 by GR-015 / ADR-0014. Do NOT
  follow the original text.** The decision below was correct when the only contract artifact for the recipe
  service was a hand-written document and no generated one existed. Both premises are now false.
    - **The authority is the zod authored in the recipe service** at
      `packages/services/recipe-service/src/**/*.schema.ts`, copied into `@kitchensink/schema-recipe`, from which
      `openapi.yaml` is **DERIVED** for `oasdiff`, docs and integrators — never as a codegen input. See
      _API Contract & Input Validation (GR-015 / GR-016)_ above.
    - **"One service, one contract" still holds; the contract moved to where it can be enforced.** The derived
      document **exists** at `packages/schemas/recipe/openapi.yaml` (**5,700 lines**, 34 paths) against the
      hand-written file's **2,840 lines** and 32 paths, so the "the move stays its own change" reasoning
      has been overtaken: the move happened. **Where the two disagree, the service's zod wins.** ⚠️ **Both figures
      re-measured 2026-08-12, correcting the 4,945 / 2,827 recorded here** — the derived document is generated and
      the hand-written one has had two header rewrites, so treat any line count in this prose as a timestamp.
    - ⛔ **`specs/001-commise-recipe-app/contracts/api.openapi.yaml` MUST NOT be extended with 004's endpoints**
      (GR-015 §15-a.7 / AC-015-f). Its citations are **partly** repointed — ⚠️ re-measured 2026-08-12 via
      `git ls-files`, **5** committed files under `packages/`, **20** under `specs/` and **5** under `docs/` still
      cite it, down from the **12 / 19 / 5** this bullet recorded — which is why this decision is marked superseded
      **in place** rather than deleted.
    - **What survives from the original reasoning:** 004 still starts **no second document** and creates **no
      schema package of its own**. _(Original text: "The service's single contract stays at
      `specs/001-commise-recipe-app/contracts/api.openapi.yaml` for this feature; 004 extends it rather than
      starting a second document. Relocating a 120 KB contract into the service package mid-feature adds risk for
      tidiness … so the move stays its own change.")_
- **D-017 (FR numbering, 2026-08-02)**: 004 keeps `FR-008`..`FR-014a` and relies on the mandatory `004-`
  prefix for cross-feature references. A clean renumber would break existing links and the cross-feature index
  for a cosmetic gain, and 004 is the last feature carrying this collision now the prefix convention is
  enforced. Recorded rather than left implicit.
- **D-018 (Catastrophic-hazard procedures are non-waivable, 2026-08-02)**: The acceptance procedures covering
  the three Catastrophic hazards — SSRF (`REQ-NF-009`), cross-tenant draft/job access (`REQ-027`), and
  unauthenticated import (`REQ-IF-004`) — **permit no waiver at any gate**. Ratified as a standing constraint
  so that a future waiver request is visibly a deviation from a recorded decision rather than a judgement call
  made under deadline pressure.
- **D-015 (API path prefix, 2026-08-02; superseded in part by ADR-0011)**: Every path this feature
  introduces is canonically `/api/v1/...`. **This is no longer a 004-local decision.**
  [`ADR-0011`](../../docs/architecture/decisions/0011-api-version-prefix.md) landed on `main` the same day
  and makes `/api/{version}/*` canonical across all three services, retaining the bare `/{version}/*` as a
  **deliberately deprecated alias** for consumers we cannot redeploy (the Clerk-registered webhook, already
  shipped mobile builds with endpoints baked in at build time, and cross-service erasure calls). It
  implements `specs/governance-rules.md` **GR-002**, which had mandated this shape since 2026-05-10 while the
  services still served bare `/v1/*`.
  Two consequences for 004, both applied: per ADR-0011 §4 — _"clients, tests, k6 scripts and contracts use
  the canonical path only"_ — every reference in this feature now uses `/api/v1/...`, **including references
  to endpoints shipped by 001** (`POST /api/v1/recipes`, `POST /api/v1/recipes/{id}/clone`). And 004 must not
  "tidy away" the bare alias it may encounter in shipped controllers: it is load-bearing, not dead code.
  _An earlier revision of this decision recorded the shipped services as non-compliant and scoped the
  migration as future work. That was true when written and is now obsolete — the migration has landed._
- **D-014 (Non-public creation is premium, 2026-08-02)**: Creating a recipe that is not public requires a
  subscription — applied consistently, including where the privacy is imposed by policy rather than chosen.
  Consequences, stated plainly: **photo/OCR import and attested paid-source entry become premium-only**; free
  tier keeps URL, Instagram, and file/migration import. Two things make this coherent rather than merely
  restrictive: it confines Textract spend to paying users, which retires the cost concern D-001 opened; and it
  is enforced by the **shipped** C-004 policy, since `imported_physical` and `imported_paid` are already
  non-public classes — the gate is on _creation_, not a second visibility rule. Free-tier users are shown the
  upgrade path, and the gated channels are not advertised to them at all (`FR-028`).
- **D-013 (Bulk limits, 2026-08-02)**: A single export file may contain up to **1,000 recipes**; above that it
  is rejected with an explicit limit message. A bulk file import counts as **one** import against the D-006
  daily allowance, not one per recipe — the allowance exists to bound outbound fetching and OCR spend, and a
  file import does neither (one upload, parsed locally, no third-party call). Without this carve-out a
  first-day migration would exhaust a user's daily allowance on the day they join, which is precisely backwards.
- **D-012 (Bulk import, 2026-08-02)**: A single uploaded export file may contain many recipes — the realistic
  migration path from Paprika, Mealie, or Plan To Eat, and the onboarding case this feature exists to serve.
  One draft per recipe (so nothing is fabricated and every rule still applies), with **split review**: complete
  drafts confirm in one action, incomplete ones are surfaced individually. Bulk **URL** submission stays out of
  scope — it multiplies outbound fetching for a far rarer case.
- **D-010 (Mutation thresholds, 2026-08-02)**: Mutation testing is gated **where it is meaningful, not
  uniformly**. The pure core carries a hard threshold — `policy/` and `normalize/` at **90%**, `ssrf-guard.ts`
  at **95%**, `extractors/` at **80%** — and the build fails below it. I/O-heavy adapters are **reported but
  not gated**. Rationale: in a pure total function a surviving mutant is always a real test gap, so the number
  means something; in an adapter many mutants are unkillable without asserting on the vendor, so a flat average
  would both hide a weak policy behind well-covered plumbing and waste effort chasing noise.
- **D-009 (SC-002 corpus, 2026-08-02)**: The corpus stays at **50 stratified pages** — enough to attribute a
  regression to a specific extractor, and the marginal page buys little once every stratum is covered. The real
  risk is **staleness, not size**: a frozen snapshot keeps reporting 85% while the web drifts. Mitigated by a
  **quarterly refresh**, triggered early if the extractor strategy mix (`Q-3`) shifts >10pp toward heuristic.
- **D-008 (Idempotency, 2026-08-02)**: `Idempotency-Key` is **required** on `POST /import/{url,instagram,photo}`;
  a missing header is a `400`. **No server-derived fallback.** A synthesised key would create a second
  idempotency path to reason about, and it would do nothing for photo and file imports — which have no natural
  key and are the two channels where a duplicate actually costs money. One mechanism, applied loudly: a naive
  caller gets an immediate, explicit error rather than silent double-imports.
- **D-007 (robots.txt interpretation, 2026-08-02)**: A recipe import is an agent acting for one identified user
  on one page that user chose — not crawling. So the wildcard group's blanket `Disallow: /`, which is aimed at
  search indexing, does not block an import; a **path-specific** wildcard `Disallow` still does, and any group
  that **names our user-agent** is honoured in full, giving a site owner a precise and effective opt-out.
  **Stated honestly: this encodes our reading of a site owner's intent, and a site owner who wrote
  `Disallow: /` meaning "no automated access at all" is overridden by it.** Three things make that defensible
  rather than merely convenient: we identify ourselves (`Commise/1.0 (+https://commise.app/bot)`) so we are
  attributable; we honour an agent-specific directive completely, so the opt-out is real and one line long; and
  we rate-limit ourselves per user (D-006). Every block is counted so this can be revisited on evidence.
- **D-006 (Import limits, 2026-08-02)**: Two layers, deliberately different mechanisms.
  **Burst** — the shipped `@nestjs/throttler` with per-route `@Throttle` overrides: `10/min/user` for URL and
  Instagram, `5/min/user` for photo (each photo is a paid OCR call), file and job-status inherit the shipped
  write/read defaults. **Daily allowance** — a domain quota of **200 imports/day/user** across all channels,
  with a **50/day sub-quota for OCR**, evaluated in `ImportsService` and returning `IMPORT_QUOTA_EXCEEDED`
  (`429`) with a `resetsAt`. It is NOT a second registered throttler: `throttle.config.ts` documents that
  `@nestjs/throttler` v6 ANDs every registered throttler across every route, so a daily throttler would apply
  service-wide. Treating the allowance as domain policy also puts it where 010's tier rules will need it.
- **D-005 (Draft & image retention, 2026-08-02)**: Unconfirmed drafts expire **7 days** after creation, and the
  OCR source image shares that lifetime exactly — deleted on confirm, discard, or expiry, whichever is first.
  Seven days covers a user who starts an import, is interrupted, and returns the following weekend, while
  bounding worst-case photograph retention to a week. A single shared lifetime was chosen over a shorter
  image-only window so there is one sweep and one invariant to keep correct, rather than two that can drift.

## Gating

`FR-009` is the only gated requirement. Release is **not** blocked on it: the URL, file, and OCR channels
constitute a complete, shippable feature. If the Meta credential is unavailable at release, the Instagram
channel is hidden by its capability flag and its tests run against the contract fake in CI.

---

## Assumptions

- Recipe attribution for imported content is a display requirement; the system stores and displays recipe
  metadata (title, ingredient lines, instruction text) and does not rehost source imagery or full article prose.
- OCR accuracy on photographs — particularly of handwriting — is variable and materially worse than structured
  markup extraction. The draft-and-confirm model is what makes this acceptable; SC-002's accuracy bar applies
  to structured-markup URL import only, and OCR is explicitly excluded from it.
- Ingredient-line parsing is heuristic and will mis-parse a minority of lines. Preserving the raw line verbatim
  is what keeps a mis-parse recoverable rather than lossy.
- Sites that render recipe content only via client-side JavaScript are out of scope at launch; they are
  reported as "no recipe found", not silently empty.

---

## Clarifications

- **C-001 (Import deduplication)**: When multiple users import the same URL, the system holds a single shared
  public recipe keyed by the **canonicalized** source URL (scheme and host lowercased, default port and
  fragment removed, tracking parameters stripped, trailing slash normalized). Later imports of that URL surface
  the existing recipe and offer a clone. Uniqueness is enforced by a partial unique index that excludes
  soft-deleted rows, so a deleted import can be re-imported. Applies to both website and Instagram imports.
- **C-003 (Instagram import method)**: Instagram import uses the Meta-hosted oEmbed endpoint with an app
  credential and caption-text parsing. Only posts with recipe content in the caption are supported. See D-002.
- **C-006 (Draft-and-confirm)**: Every import channel produces a draft; confirmation creates the recipe. See
  _The draft-and-confirm model_ above for why this is forced by the shipped schema rather than chosen.
- **C-007 (Extraction strategy set)**: The extractor chain is JSON-LD → microdata → heuristic HTML. **RDFa is
  deliberately excluded**: it is vanishingly rare for recipe content relative to JSON-LD and microdata, and no
  maintained Node RDFa parser exists. The chain is a Strategy set behind one interface, so adding RDFa later is
  additive if fixture evidence ever justifies it.
