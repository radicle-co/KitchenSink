# Feature Specification: Recipe Importing

**Feature Branch**: `004-recipe-importing`
**Created**: 2026-04-14
**Amended**: 2026-11-03 (open recipe library, owner rulings, ADR-0082: `FR-008` ruling, `FR-011`, `FR-013`, `FR-014`, `FR-014a`, new `FR-014b`, `FR-009`, `FR-012`, `FR-023`, `FR-026` and C-001). 2026-10-28 (`FR-053` added: the "Save to Commise" button for food blogs, gated on the WP Recipe Maker
team, owner ruling). 2026-10-29 (recipe rights, owner rulings,
[ADR-0077](../../docs/architecture/decisions/0077-recipe-rights-label-linked-cards-and-outside-copy-checks.md): a web
import is private in full or public as a linked card, two new statements, and C-001 now keys the public card) 2026-10-29 (`FR-053a` added: a chef's bulk bring-in from their own claimed site, owner rulings on
[026](../026-chef-spaces/spec.md))
**Last revised**: 2026-08-19 (`FR-024`/`FR-025` amended for curator-declared provenance — [ADR-0023](../../docs/architecture/decisions/0023-curator-declared-provenance.md); findings recorded against `FR-020`, `FR-023` and the V-Model module design)
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

| Spec                                                        | Relationship                                                                                                                                                                                                                                                                       |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [001-commise-recipe-app](../001-commise-recipe-app/spec.md) | **Required — and largely already shipped.** Owns the Recipe entity, attribution columns, clone, and the C-004 visibility policy. See _Relationship to shipped 001_ below.                                                                                                          |
| [002-user-auth](../002-user-auth/spec.md)                   | **Required** — all import actions require authentication                                                                                                                                                                                                                           |
| [003-usda-food-data](../003-usda-food-data/spec.md)         | **Required** — imported ingredient lines resolve against the food catalog via `@kitchensink/food-service-client`                                                                                                                                                                   |
| [010-subscriptions](../010-subscriptions/spec.md)           | **Required** — Pro entitlement gates clone-to-private (`004-FR-011`) and lifts the free-tier limit of 50 private recipes (`004-FR-028` as amended 2026-10-26, ADR-0073). Until 010 ships, Pro is derived from the signed token's `permissions` (the shipped `PREMIUM_PERMISSION`). |

> **External dependency (added 2026-10-28, owner ruling).** The "Save to Commise" button (`FR-053`) needs one
> partner. The WP Recipe Maker plugin team must agree to add Commise as a save target. The plugin reports "50,000+"
> active
> installations ([WordPress.org](https://wordpress.org/plugins/wp-recipe-maker/)). Partner terms are unknown. Until
> the team agrees, `FR-053` stays behind a capability flag that is off (`D-019`). Nothing else in 004 depends on it.
> The plan also needs [017-recime-parity](../017-recime-parity/spec.md) (one capture pipeline, `017-FR-015`),
> [020-content-source-check](../020-content-source-check/spec.md) and
> [021-public-discovery-and-sharing](../021-public-discovery-and-sharing/spec.md) (`021-FR-035` app links).

> **Plans (owner, 2026-10-27).** The plans are Free, Pro and Pro with AI, and "Pro" names the paid plan. The old
> name "Premium" survives only in quoted rulings and shipped strings. Which plan carries which feature is in 010's
> [plan register](../010-subscriptions/spec.md#plan-register). Open questions are 010's
> [owner inputs](../010-subscriptions/spec.md#owner-inputs-still-needed).

### Relationship to shipped 001 — what 004 does NOT build

001 shipped on PR #73. Its implementation **already provides** the persistence and policy layer this feature
was originally written to create. 004 **consumes** the following and MUST NOT redefine, duplicate, or fork them:

| Already shipped in 001                                                                                       | Where                                                   |
| ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------- |
| `recipes.source_type` (`user_created`/`imported_public`/`imported_physical`/`imported_paid`)                 | `database/schema/recipes.ts`                            |
| `recipes.source_url`, `recipes.source_attribution`, `recipes.cloned_from_id`, `recipes.has_substantive_edit` | `database/schema/recipes.ts` (since `0001_initial.sql`) |
| The C-004 visibility policy over `(sourceType, isPremium, hasSubstantiveEdit, requested)`                    | `evaluateVisibility` in `@kitchensink/recipe-core`      |
| Clone with attribution retention, `POST /api/v1/recipes/{id}/clone`                                          | `recipes.service.ts` `clone()`, `recipes.controller.ts` |

> **⚠️ Amendment note (2026-08-22, C-016-003 / A-6).** `has_substantive_edit` keeps its meaning and its
> definition exactly — any modification to ingredients or instructions; title, description, tags and photos
> do not qualify. **Only the gate it feeds moves**: under [`GR-014`](../governance-rules.md#gr-014-audience-and-sharing-model)
> AC-014-g and the amended `001-FR-005b` it gates **publication of a clone** rather than **making a clone
> private**. No column changes, and nothing here is to be re-added — the shipped-columns table above stands
> as written.
> | `canClone` / `canGoPrivate` access policy | `recipeAccessPolicy.ts` in `@kitchensink/recipe-core` |
> | Single error envelope `{ code, message, details? }`, `RecipeErrorCode` → HTTP mapping | `common/filters/apiException.filter.ts` |
> | Per-user rate limiting | `common/throttle/` (`@nestjs/throttler`) |

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
recipe (see _The draft-and-confirm model_ below). Web and Instagram imports are attributed, and their public form is a facts
card with a link; physical-copy and file imports keep the verbatim copy private. A verbatim copy from a paid source is
never public. _(Amended 2026-11-03, owner ruling, ADR-0082: the cook can publish their own Adapted version of any of
them, and a family recipe is public as itself.)_

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

### User Story 2 - Save a recipe from a food blog with one tap (Priority: P3)

_(Added 2026-10-28, owner ruling. Gated on the WP Recipe Maker team, `D-019`.)_

Ana reads a recipe on a food blog that runs WP Recipe Maker. Under the recipe card she sees a "Save to Commise"
button. She taps it. Her phone has the Commise app, and she is signed in, so the app opens. It names the blog and asks
"Save this recipe?". She taps Save. A moment later the import draft is waiting for her to check, with the blog named
as the source. On a
computer with no app, the same tap opens Commise on the web. If she is signed out, she signs in first and comes back
to the same save.

**Why this priority**: One partner can put the button on every site that runs the plugin. But it needs the plugin
team to agree, so it cannot be the first thing built.

**Independent Test**: Turn the capability flag on, and use a test page that carries the button's link. Tap it signed
in, signed out, with the app installed and without. Each path ends at one import draft for that page, with the source
shown, through the same pipeline as a pasted link.

**Acceptance Scenarios**:

1. **Given** a signed-in cook, **When** they tap the button, **Then** Commise shows a save screen that names the source
   site. **When** they tap Save there, **Then** one import of that one page starts, and the cook sees the draft to
   confirm (`FR-053`, C-006).
2. **Given** a save link that opens with no tap on Commise's save screen, **When** a frame, an image request, a
   prefetch or a link preview loads it, **Then** nothing is fetched or imported, and no quota is used (`FR-053`).
3. **Given** a signed-out reader, **When** they tap the button, **Then** they reach sign-in or sign-up, and after it
   they return to the same save, which they confirm once. Nothing is imported before they sign in.
4. **Given** a page whose rights check allows it only as private, or blocks it, **When** the save runs, **Then** the
   outcome is the same as for a pasted link to that page (`FR-008` ruling).
5. **Given** the capability flag is off, **When** anyone opens a save link, **Then** they see that saving from that
   site is not available yet, and they can paste the link into the import chooser instead.

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
> one and 011 MUST inherit it rather than re-derive it — specifically: the private-slot rule on
> `imported_physical` (`FR-028` as amended 2026-10-26, ADR-0073), the tighter OCR sub-quota (`FR-022`), deletion of OCR artifacts on
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
    > ⚠️ **Ruling: the server checks the source page's rights first.** Owner ruling, 2026-10-26. Before a URL
    > import, the server checks the copyright or licence of the source page and decides one of three outcomes:
    > import as public, import as private, or block. Each outcome sets the label. An allowed-public link is stored
    > as `imported_public`. A link the check allows only as private is stored as `imported_paid`, which is
    > private-only on every plan and never public. It is NOT stored as `imported_public`, because that label is for
    > pages the check allowed to go public. A blocked link is not imported. The design session drew
    > these three outcomes on features canvas v21 (ImportReviewDraft, ImportLinkPrivateOnly, ImportPaidSiteBlocked).
    > The check itself is not designed yet. It belongs to this URL flow only. Bulk import is a separate flow, where the cook's per-recipe statement sets the label
    > ([ADR-0072](../../docs/architecture/decisions/0072-bulk-recipe-import.md) §9).
    >
    > ⚠️ **Ruling: a web import is private in full, or public as a linked card.** Owner ruling, 2026-10-29
    > ([ADR-0077](../../docs/architecture/decisions/0077-recipe-rights-label-linked-cards-and-outside-copy-checks.md)).
    > An `imported_public` recipe has exactly two states. Private is the full recipe, for the cook and their household.
    > Public is a linked card for other signed-in cooks: no method, headnote or source photo (`021-FR-014a`). So the
    > "existing public recipe" this FR surfaces is now that page's one public card (C-001). A cook who imports the same
    > page gets their own private copy, from their own capture. At capture the import keeps a fingerprint of the page's
    > method and headnote, never the page, for the source check (`020-FR-012b`). The research behind this is not legal
    > advice, and the card is subject to counsel review (`016-FR-050`).
    >
    > ⚠️ **Amended 2026-11-03 (owner ruling, ADR-0082): the facts card is open, the private copy is per market, and the
    > server check is reworded.**
    >
    > 1. **The card is open.** [Law] Nobody owns a recipe's facts: the name, ingredients, amounts, times, temperatures,
    >    yield, servings and the order of steps (17 U.S.C. §102(b), _Feist v. Rural_, 499 U.S. 340 (1991),
    >    and _Publications International v. Meredith_, 88 F.3d 473 (7th Cir. 1996)). So the one public card for a page is
    >    now readable signed out, by anyone, where the earlier text said "other signed-in cooks". Its field list does not
    >    grow (`021-FR-014a`). [House rule] It stays `noindex` with no recipe structured data.
    > 2. **One facts card per page.** There is one public facts card per canonical page. Two cooks' texts are never merged
    >    into one. Matching on the URL alone misses the same recipe at another address and pasted copies. That is a
    >    product gap, not a legal one, and it is recorded in C-001. [Law] Merging or linking near-identical recipes is a
    >    product choice (_Sheldon v. Metro-Goldwyn_, 81 F.2d 49 (2d Cir. 1936), and _Morrissey v. Procter & Gamble_, 379 F.2d
    >    675 (1st Cir. 1967)).
    > 3. **The private copy is a per-market switch (D6).** The switch is keyed on the cook's market and lives in one
    >    policy that defaults closed for any market counsel has not cleared. In the **US** the import keeps the private
    >    full copy. [Law, US] That is defensible but untested (_Cartoon Network v. CSC_, 536 F.3d 121 (2d Cir. 2008) is for it,
    >    _UMG v. MP3.com_ is against it). In the **EU and UK** the import keeps **facts and a link only**: no stored verbatim
    >    method, headnote or photo reference. [Law, EU and UK] Our server makes the copy, so hosting defences do not apply.
    >    The UK has no private-copy exception (_R (BASCA) v Secretary of State_ [2015] EWHC 2041 (Admin)). EU DSM Art. 4(2)
    >    limits how long text-and-data-mining copies can be kept. _VCAST_ (C-265/16) puts a commercial service's private
    >    copies outside the private-copy exception. A cook who wants the full text pastes it (`FR-052`). Paste and image
    >    storage is user-provided (UK reg. 19, DSA Art. 6).
    > 4. **"The server checks the page's copyright" is reworded.** [Law] The server cannot find "no copyright". Every page
    >    is protected from creation (Berne Art. 5(2) and 17 U.S.C. §102). Software can find a STATED licence (schema.org
    >    `license`, a Creative Commons mark). So the check records what the page states and what we keep and show.
    >    It decides: import with a facts card and a private copy where the market allows, import with a facts card only,
    >    or block. A page that states a licence allowing commercial use can be shown in full on that licence's terms
    >    (`021-FR-014f`). Otherwise the copy is never open in full.
    > 5. **Copy kept and credited.** [Law] The import keeps the source, the credit and any copyright notice with stored
    >    text, and never strips them (17 U.S.C. §1202). A server fetch adds contract risk and a closer copyright question.
    >    It does not by itself make Commise a direct actor (_Cartoon Network_ and _VHT v. Zillow_, 918 F.3d 723 (9th Cir.
    >    2019)). Paste is still the cleanest channel.
    > 6. **A cook who reads "Copied from a public web page" also reads:** "Nobody owns the ingredient list or the bare
    >    steps."
    >
    > Counsel review is owed before launch (`016-FR-050`).
- **FR-009** _(GATED — see D-002)_: System MUST allow users to import recipes from public Instagram posts by
  extracting recipe content from the post caption. Import is limited to posts whose caption contains recipe
  text; video-only or image-only posts without recipe text are unsupported and the user MUST be told so.
  Deduplication by canonicalized source URL applies. **This requirement cannot function without an approved
  Meta application** (D-002); it MUST ship behind a capability flag that is off until that credential exists.
    > **Amended 2026-11-03 (owner ruling, ADR-0082): social import rules.** [Law] The caption text of a post is protected
    > like any web text, and a video, its frames, its voice and its captions are protected too. So a social import
    > (Instagram, and TikTok or YouTube when added) MUST use **official APIs under their terms only**. The server MUST
    > NOT download a video from TikTok, Instagram or YouTube against their terms. Where no API allows the import, the
    > fallback is the cook's own **paste, share sheet or screenshot** (`FR-052`, `011`). The import MUST NOT keep video
    > frames or audio, and MUST NOT run face recognition on frames (Illinois BIPA, 740 ILCS 14). [Law, EU] DSM Art. 4(2)
    > limits retention of mining copies, and GDPR storage limitation applies where people appear. The result is a
    > facts card plus the cook's private copy where the market allows (`FR-008` ruling, D6), under the same labels as a
    > web page. Counsel review is owed before launch (`016-FR-050`).
- **FR-012** _(REASSIGNED TO 011 — see D-001, amended 2026-08-14)_: Import from physical copies via photo
  capture and OCR is owned by [011-recipe-digitization](../011-recipe-digitization/spec.md), **not by 004**.
  011's image branch routes to a dedicated stateless image-processing service and then submits its extracted
  candidates to **this feature's bulk import processor** (`FR-047`), so the post-extraction path is shared and
  004 does not build a second one. 004's obligation is limited to two things: the import-method chooser
  (`FR-046`) MUST present the photo method as **unavailable-until-011** rather than omitting it silently or
  offering an affordance that does nothing, and the bulk import contract MUST accept the
  `imported_physical` `sourceType` so 011 can submit against it without a contract change.
  See [ADR-0019](../../docs/architecture/decisions/0019-recipe-import-spine.md) §1 and §3.
    > **Amended 2026-11-03 (owner ruling, ADR-0082): the image path.** [Law] A cook's private copy of a cookbook page is
    > fine, and storage is user-provided (UK reg. 19, DSA Art. 6). The page image MUST be **deleted after extraction**
    > unless the cook asks to keep it. A kept image stays private. Video frames and audio are never kept. [Law, EU] DSM
    > Art. 4(2) limits retention, and GDPR storage limitation applies where people appear. Counsel review is owed
    > before launch (`016-FR-050`).
- **FR-052** _(raw-text channel — added 2026-08-16, owner ruling)_: System MUST allow users to import a recipe
  by **pasting its text**, as a first-class import method listed in the chooser (`FR-046`) alongside URL and
  file — not as an error-recovery fallback. The channel MUST accept a bounded body of raw text plus a
  **declared** source, and MUST create the draft **synchronously**: there is no outbound fetch and no vendor
  call, so there is nothing to poll and an asynchronous job would add a failure mode without removing one.
  Pasted text MUST flow through the **same** normalize → parse → classify → draft path as every other channel
  (`FR-047`), and unparseable lines MUST be preserved verbatim and flagged (`FR-020`) rather than failing the
  import — a paste of prose still produces a reviewable draft. `sourceType` MUST be **declared and whitelisted
  server-side** (`FR-025`): `user_created` for the user's own content, `imported_paid` when the user attests a
  paid or non-public source and supplies a citation (`FR-014a`). `imported_public` and `imported_physical`
  MUST NOT be representable on this endpoint. _(2026-10-29: paste also takes "Adapted in my own words" and "From a
  family member or friend, with their permission", per `FR-014a`'s six statements.)_ The pasted body is user input at an untrusted boundary and MUST
  NOT be logged (`NFR-008`).
    > **Why this is a hole being closed, not a feature being added.** Every failure state in this feature's
    > own wireframes already offers "paste manually", and the product spec's J3 journey is entirely about
    > pasting from a cookbook — while no FR, no endpoint and no task existed for it. `FR-014a` specified the
    > **attestation** for pasted content but attached it to ordinary recipe creation, so the promise the UI
    > makes had no channel behind it. It is also what the photo transfer makes load-bearing: with OCR owned by
    > 011, paste is how a user gets a physical-copy recipe in **today**.
- **FR-053** _(GATED, added 2026-10-28, owner ruling, see `D-019`)_: System MUST accept a **"Save to Commise"**
  link from a recipe page that shows the button, and turn one tap into one user-directed capture of that one page.
  Owner ruling, 2026-10-28: "Do 3 as well." The rules:
    - **The button is a plain link.** It carries the page's address and a fixed source tag for the partner, and
      nothing else. Commise puts no script, cookie, pixel or tracking call on the publisher's page. The link's
      exact form is a public contract with a third party. So `staff-architect` fixes it at PLANNING, and it is
      versioned like any wire contract.
    - **Opening the link does nothing by itself.** Any site can build the link, with any page address. So a request
      that reaches Commise from another site proves no person acted. Opening the link MUST only show Commise's own
      save screen, which names the source site. The fetch starts with the cook's tap on Save on that screen, and with
      nothing else. That
      tap is the one explicit user action of `017-FR-001a`. A frame, an image request, a prefetch or a link preview
      MUST NOT start a fetch, use quota or create anything. Nothing crawls the publisher's site or saves in bulk.
    - **The second tap is a known cost.** The owner asked for one tap. This rule adds a second tap, on Commise's
      screen, because one tap on another site cannot be told apart from a page that forges it. The owner accepted it
      on 2026-10-29 ("Keep the confirm tap").
    - **One pipeline.** The save goes through the same capture pipeline as every other channel (`017-FR-015`). So
      these all apply unchanged: the paywall blocklist (`FR-014`), the rights check in the `FR-008` ruling and the
      `robots.txt` rule (`FR-023`). The daily quota (`FR-022`), deduplication (C-001) and the draft-and-confirm model
      (C-006) apply too.
      The channel is recorded under `016-FR-028` like any link import.
    - **Sign-in comes first.** A signed-out reader goes to sign-in or sign-up and returns through the app's parsed
      return path (`safeReturnPath`) to confirm the save once. Nothing is fetched or stored for a person who is not
      signed in (`001-FR-045`). No AI work runs for a signed-out reader.
    - **The label comes from the rights check, never from the button.** A save is never `user_created`. The check
      gives one of three outcomes: `imported_public`, `imported_paid` for a page allowed only as private, or blocked. So
      it is
      never open to the web (`021-FR-003`), and a book or paid-site recipe's verbatim copy is never public (C-004, amended 2026-11-03, ADR-0082).
    - **020 still checks it.** A cook can make the recipe public. Then 020's source check runs before anyone else
      can see it (`020-FR-004`).
    - **Attribution.** The draft and the recipe show the source site and author, as for any link import
      (`FR-010`).
    - **On phones.** With the app installed, the save link opens the app through a universal link or app link. That
      needs `021-FR-035` to associate the save route, which 021 records as an amendment. With no app, the link opens
      the web app, which offers the store only by `021-FR-037`'s rule.
    - **Measurement.** A sign-up that starts from a save link counts under the `save_button` source in
      `023-FR-004`, with the partner as its detail. No reader identity is passed to the publisher or back from it.
    - **Every state is a deliverable.** The saving, saved, not available yet, blocked, private-only, quota reached,
      offline and error states each need a design, copy and a localisation key, on web and mobile.
      `staff-ux-engineer` DESIGN and SPECIFY run at plan time.
- **FR-053a** _(added 2026-10-29, owner rulings on [026](../026-chef-spaces/spec.md))_: A chef with a live site claim
  (`026-FR-001`) MUST be able to bring in recipes from their own claimed site in bulk, through ADR-0072's import route
  and its daily allowance. The rules:
    - **The list comes from the site itself.** The recipes offered MUST come from the claimed site's own sitemap or its
      recipe structured data. The chef picks which ones to bring in.
    - **One fetch per page, at the chef's request.** Every page fetched MUST be on the claimed domain, fetched once
      because the chef asked, with `robots.txt` honored (`FR-023`). Nothing fetches on a schedule, and nothing
      re-fetches a page by itself (`026-FR-008`).
    - **Each recipe carries its own statement.** A claim proves control of the site, not authorship. Each recipe the
      chef brings in as their own MUST carry "I wrote this" and "This is my own page", made per recipe (`FR-014a`,
      `026-FR-002`). Such a recipe is `user_created`, labelled "Written by you" (ADR-0077 §2), and its page address
      is stored as its origin. A recipe the chef does not state as their own takes the statement the chef makes, as
      in any bulk import.
    - **Photos need their own statement.** A photo comes in only where the chef states they own it or have the right
      to use it (`026-FR-004`).
    - **This is not the "Save to Commise" button.** A save through `FR-053` is never `user_created`. This route is the
      only one that turns a page into the chef's own recipe, and only under a live claim.
    - **020 still checks it.** A public recipe goes through 020 as usual. A hit on its own origin page under a live
      claim is handled by `020-FR-012g`.
- **FR-019**: System MUST allow users to import recipes from structured files (JSON, YAML, or Markdown with
  YAML frontmatter), producing a draft. File type MUST be determined by content inspection (magic bytes), not
  by the client-supplied filename or MIME type.
- **FR-020**: System MUST parse each free-text ingredient line into a structured quantity, unit, and
  ingredient name, retaining the original line verbatim. Lines that cannot be parsed MUST be preserved with a
  null quantity and flagged for user correction — an unparseable line MUST NOT fail the import. Parsed
  ingredient names MUST be submitted to the food catalog (003) for asynchronous resolution using the shipped
  resolution lifecycle; an unresolved ingredient MUST NOT block draft confirmation.
    > ⚠️ **FINDING (2026-08-19): "preserved with a null quantity" is UNIMPLEMENTABLE against the shipped
    > schema, on the recipe side of the boundary.** A quantity-less ingredient line — "salt to taste", "a pinch
    > of nutmeg", the two commonest forms in a 1900s cookbook — **cannot be represented at all** once the draft
    > becomes a recipe:
    >
    > - `recipeIngredientInputSchema` (`recipe-service/src/recipes/recipes.schema.ts`) makes `quantity`
    >   **required**; and
    > - `recipe_ingredients.quantity` is `numeric(10, 3) NOT NULL` with
    >   `CONSTRAINT recipe_ingredients_quantity_positive CHECK ("quantity" > 0)`
    >   (`src/database/migrations/0001_initial.sql`).
    >
    > So `null` has nowhere to go, and `0` is rejected by the CHECK. The requirement holds for the **draft**
    > (which 004 owns and can shape freely) and **fails at confirmation**, which is exactly the boundary
    > `MOD-019`'s "never a fabricated `1`" note is trying to protect — a fabricated `1` is the only value that
    > satisfies the shipped column, and it is a silent data corruption.
    >
    > **Recorded behaviour until 004 decides otherwise:** the curated public-domain import **DROPS** a line it
    > cannot assign a positive quantity to, and **reports it verbatim** in the import outcome, so the loss is
    > visible and correctable by hand rather than silent or fabricated.
    >
    > **Making `quantity` nullable is a separate ONE-WAY-DOOR decision and 004 must take it deliberately**, not
    > as an implementation detail: it changes a persisted column and its CHECK, the published wire contract
    > (`CONTRACT_HASH`, and every installed mobile client that parses a recipe), and **every read projection**
    > that today assumes a number is present — scaling (`a048bfd4`), the nutrition summary, and the detail
    > view's rendering of a line. The alternative shape — keeping the column non-null and carrying the
    > unquantified line as display text — is cheaper and should be priced against it in the same decision.
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
- **FR-047** _(amended 2026-08-16 — [ADR-0019](../../docs/architecture/decisions/0019-recipe-import-spine.md) §1)_:
  Every import channel MUST **converge at recipe creation**, which is the single place that classifies
  provenance, enforces quota, creates the recipe and reports per-recipe outcome (`FR-027`). A channel's
  distinct responsibility is limited to producing candidate recipe records from its source plus the
  `sourceType` that records provenance. `sourceType` MUST be **declared by the invoking surface and
  whitelisted server-side** (`FR-025`), never inferred from the payload. Adding a channel MUST be an adapter
  plus a `sourceType` member, not a new pipeline.
    > ⛔ **This requirement previously read "one bulk import processor", and that was the wrong unit.** The
    > diagram it came with already contradicted it: 011's image branch is a **separate deployable** by
    > ADR-0019 §3, and ingredient resolution is owned by the **food** service. One processor would therefore
    > have had to reach across two service boundaries to do its job, and pulling 011's image work back into
    > the recipe service is exactly what §3 took an exception to avoid. What FR-047 actually requires is **one
    > place where those rules live** — the convergence point — not one pipeline. Each domain runs its own
    > processor (recipe's bulk import, 011's image branch, food's resolution pipeline) and they meet at recipe
    > creation. The `sourceType` union and its exhaustive `switch` are unchanged; they live at the convergence
    > point, which is where they always effectively were.
- **FR-048**: System MUST emit a status message **per recipe** as that recipe advances through the import
  spine — accepted, in flight (carrying the current stage), and terminal (succeeded, failed, or errored).
  Messages for one recipe MUST be **selectable down to the current one** rather than accumulating, so a
  consumer holding the current message for an entity holds correct current state. **Selection is
  CONSUMER-SIDE: most-recent-by-timestamp wins** _(amended 2026-08-16 — ADR-0019 §4, owner ruling
  2026-08-15)_. The envelope carries **no sequence**. A 1,000-recipe import (`FR-026`) therefore produces a
  bounded live view rather than an unbounded event log each client must reconcile.
    > ⛔ **This requirement previously mandated a "monotonic sequence carried in the envelope". It cannot be
    > built as written.** A monotonic sequence has to be issued by the producer, which makes a
    > **fire-and-forget** producer stateful for a value whose only reader is a consumer that did not yet
    > exist — and the substrate's producers may run concurrently in more than one task, so there is no single
    > writer of "the last sequence I used". It was also solving a problem the substrate already solves: the
    > stated hazard is a redelivered `processing` reverting a terminal `succeeded`, and the substrate stores
    > messages durably **per group, ordered by sort key**, with the stream record acting as a **doorbell** —
    > the consumer is woken and then **re-queries the group**, which returns in order. A consumer that
    > re-queries never observes the revert, because it never reads one message in isolation.
    >
    > **⛔ The precondition, stated so it is checked rather than assumed: SINGLE WRITER PER GROUP.** Timestamp
    > selection is correct only while one writer produces a group's messages. Two concurrent writers for one
    > entity can stamp out of order relative to their true sequence, and most-recent-wins would then pick the
    > loser. Every producer named today satisfies it — a bulk import job owns its entities, food's resolution
    > pipeline is the single writer for a food, and 011's image branch owns the jobs it creates. **A future
    > producer that shares a group with another writer MUST NOT rely on this rule.**
- **FR-049**: System MUST emit the same shape of status message **per food item** as ingredient
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
  all recipes imported from websites or Instagram, on both web and mobile. _(2026-10-29.)_ The linked card shows it as
  "Saved from [site]" with a prominent "Open the full recipe on [site]" link (`021-FR-014a`), never "by [site]". Every
  recipe also shows its rights label (`016-FR-015c`).
- **FR-011**: System MUST classify imports by provenance and set `sourceType` accordingly —
  `imported_public` for web/Instagram, `imported_physical` for **photo/OCR** imports, `imported_paid` for
  attested paid sources, and **`user_created` for structured-file imports**. A file export is the user's own
  recipe content in a different container, not third-party material: classifying it `imported_physical` would
  have wrongly marked a user's own migrated recipes as un-attributable third-party content and, under D-014 as
  first written, locked migration behind a subscription. The D-003 attestation remains available if the user
  declares the file's contents came from elsewhere. Enforcement of the resulting visibility rules is **001's shipped `evaluateVisibility`
  policy**; 004 MUST NOT reimplement it.
    > **Amended 2026-10-29 (owner ruling, ADR-0077).** A recipe from a social video is `imported_public` and carries the
    > "Copied from a public web page" rights label. "Adapted in my own words" is `user_created` with a credit. "From a
    > family member or friend, with their permission" is never `imported_paid` (FR-014a). Which existing source type it
    > takes is a PLANNING decision for `staff-architect`, and it adds no fifth source type. The statement kind is stored
    > as its own fact, and the rights label is derived from it (`016-FR-015d`).
    >
    > **Amended 2026-11-03 (owner ruling, ADR-0082): what the values mean.** `imported_public` means "copied from a
    > publicly reachable page". [Law] Such a page is fully protected from the day it is written. So `imported_public`
    > is the **opposite** of public domain. It never means that anyone may republish the text. A public domain text
    > is also stored as `imported_public`, under the curator grant (ADR-0023), but its label comes from the curator's
    > public-domain record (`016-FR-015k`), not from the value. Nobody owns the facts of any recipe
    > (17 U.S.C. §102(b)), so every `imported_public` recipe can show a facts card. Its full text opens to the web only
    > on a stated licence (`021-FR-014f`) or after a public-domain pass. `imported_physical` and `imported_paid` keep the
    > cook's verbatim copy private. Counsel review is owed before launch (`016-FR-050`).
    >
    > **Statement kinds (D3).** The stored statement kind has five values: `authored` (I wrote this), `adapted` (my own
    > words, with a credit), `source` (a copy from a web page, book, magazine or paid site, with its citation and source
    > kind), `family` (from a family member or friend, with permission to share on Commise and the web, giver credit
    > optional) and `publicDomain` (curator grant only, needs the D1 record in `016-FR-015k`). Shipped migration 0059
    > holds only `authored` and `source`, so the other three are a code follow-up.
- **FR-013**: System MUST create recipes imported from physical copies as private, with no public source
  attribution. _(Amended 2026-11-03, owner ruling, ADR-0082: "private" covers the verbatim copy. The cook can publish an
  Adapted version with credit, and a facts card is `FR-014b`.)_ Structured-file imports follow the ordinary `user_created` visibility rules (FR-011).

**Policy enforcement**

- **FR-014**: System MUST reject import attempts from known paywalled recipe sources before performing any
  outbound request, and inform the user with a clear explanation. The blocklist MUST be stored as data with an
  admin-managed lifecycle (D-004), not as a code constant, and MUST be re-evaluated on every redirect hop.
    > **Kept and restated 2026-11-03 (owner ruling, ADR-0082).** The blocklist stays. [Law] Passing a paywall, login or
    > meter is a circumvention risk (17 U.S.C. §1201), and after a revocation it is unauthorised access (CFAA, _Facebook
    > v. Power Ventures_, 844 F.3d 1058 (9th Cir. 2016), UK Computer Misuse Act, German §202a StGB). So the import MUST
    > NOT pass a paywall, login or meter, MUST NOT use a cook's password or cookies, MUST NOT pose as another bot, and
    > MUST NOT rotate addresses. An honest user-agent and no rotation are law-shaped, not only house rules. Known
    > pirate hosts MUST also be on the blocklist, because a pirated copy is not "lawfully accessible" (DSM Art. 4(1)).
    > Our servers never fetch a paid site. Counsel review is owed before launch (`016-FR-050`).
- **FR-014a**: System MUST require, for any manually pasted or typed recipe the user attests originates from an
  external source, both (a) an explicit source attestation and (b) a source citation — a URL where one exists,
  otherwise a free-text citation (e.g. book title, author, page). Where the cited source is **not a publicly
  reachable web page**, the recipe MUST be classified `imported_paid`, and its **verbatim copy** MUST stay private.
  _(Amended 2026-10-29: except a family or friend recipe shared with permission, below. Amended 2026-11-03, owner
  ruling, ADR-0082: the rule is about the verbatim copy, not about the recipe. [Law] Where a recipe came from is not
  the test. What we show is. The cook can publish their own **Adapted** version, in their own words with credit, and
  it is judged by the Adapted rule. A family recipe is public as itself. See the six statements below. Counsel review
  is owed before launch (`016-FR-050`).)_ Automated
  detection heuristics MUST additionally run as a **secondary signal** that flags a recipe for review; a
  heuristic MUST NOT by itself reclassify a recipe or block a save. _(Legal review remains advisable on the
  heuristic set; the attestation + citation rule above is operable without it — see D-003.)_
    > ⚠️ **Six statements** (owner rulings, 2026-10-29,
    > [ADR-0077](../../docs/architecture/decisions/0077-recipe-rights-label-linked-cards-and-outside-copy-checks.md) §2).
    > This closes the research's gaps G5 and G6. The cook chooses one statement for each recipe, on every channel that
    > asks for one (the editor, paste, bulk import):
    >
    > 1. "I wrote this". No citation. `user_created`.
    > 2. "Adapted in my own words, from [credited source]". A credit is required. `user_created`, with the credit shown
    >    on the recipe. A method rewritten by an AI feature does not count as the cook's own words (`016-FR-015i`).
    > 3. "From a public web page", with its link. `imported_public`.
    > 4. "From a cookbook or magazine", with a citation. `imported_physical`. The verbatim copy stays private. The
    >    public form is a facts card (`FR-014b`).
    > 5. "From a paid site", with a citation. `imported_paid`. The verbatim copy stays private. Our servers never fetch a
    >    paid site.
    > 6. "From a family member or friend, with their permission". The credit is optional. It is never `imported_paid`.
    >    It can go public, under the same 020 check as any recipe (`020-FR-013a`). _(Amended 2026-11-03, owner ruling,
    >    ADR-0082: it is now open to the web and indexable like any recipe the cook wrote (`021-FR-002`). The statement
    >    must say the giver agreed to sharing "publicly, on Commise and on the web". Naming the giver is optional
    >    and needs the giver's permission, because a name can be personal data.)_
    >
    > ⚠️ **Amended 2026-11-03 (owner ruling, ADR-0082): statements 2 and 6 make a recipe publishable in full.**
    > [Law] The bare recipe is free, and a relative's handwritten prose can be theirs. The cook publishes it in their own
    > words, or the giver's words with the giver's permission. An "Adapted" method must be rewritten, not trimmed
    > (`016-FR-015b`). An AI rewrite is not the cook's own words (`016-FR-015i`). A cook who holds a verbatim book or
    > paid-site copy can write an Adapted version and publish that. Counsel review is owed before launch (`016-FR-050`).
    >
    > The statement sets the label and the rights label (`016-FR-015c`). Each channel offers the statements its own
    > rules allow. Paste (`FR-052`) still maps a book or paid-site statement to `imported_paid` and does not offer
    > statement 3, as before. It gains statements 2 and 6. Counsel confirms the wording of all six before launch
    > (`016-FR-050`). The bulk-import note below, which names two statements, now reads as these six.
    >
    > ⚠️ **Bulk import.** Owner rulings, 2026-10-26. Every bulk-imported recipe, private as well as public,
    > carries its own statement, and one statement for a whole file does not count. The statement is "I wrote this",
    > with no citation, or "From a source", with a citation. A source is a public web page, a book or a paid site. The import sets the label from it: `user_created`, `imported_public`,
    > `imported_physical` or `imported_paid`. A recipe whose source is not a public web page keeps its verbatim copy private _(amended 2026-11-03, ADR-0082: the cook can publish an Adapted version)_. A free
    > cook keeps a book or paid-site recipe private within their 50 private slots
    > ([ADR-0073](../../docs/architecture/decisions/0073-free-tier-private-slots.md)). Counsel approves the wording before launch (016
    > FR-050). See [ADR-0072](../../docs/architecture/decisions/0072-bulk-recipe-import.md) §9.
    >
    > ⚠️ **Source check.** Owner ruling, 2026-10-26: when an automated check can tell that a recipe is from a book, a paid
    > site or another published source, the recipe does not go public. A recipe skips review only when its text, each
    > photo and its source reference all pass green. Anything else waits for a staff reviewer before it goes public
    > (owner rulings, 2026-10-26). Feature 020 amends the heuristic sentence above: blocking evidence that
    > the rule-based detectors find in the text can prevent publication, by a publication hold. Only those detectors
    > block. What an AI model finds only sends the recipe to a person. The hold does not change the label, never
    > blocks a save, and a person can lift it. A heuristic still never reclassifies a recipe. The attestation and
    > citation stay the controlling record. In a bulk import, an item headed public waits only for the rule-based
    > detectors, and the rest of the check runs after its draft is saved. See
    > [020 spec](../020-content-source-check/spec.md) FR-010, FR-014, FR-016, FR-024 and FR-040, and
    > [ADR-0074](../../docs/architecture/decisions/0074-content-source-check.md).

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
- **FR-028** _(amended 2026-10-26, owner ruling — [ADR-0073](../../docs/architecture/decisions/0073-free-tier-private-slots.md))_:
  An import channel whose result is **non-public by policy** — photo/OCR import (`imported_physical`), attested
  paid-source entry (`imported_paid`), a URL the rights check allows only as private, and bulk import — MUST NOT
  require a Pro entitlement. Every such recipe a free-tier user keeps uses one of their 50 private slots
  (`001-FR-003`). A free-tier user with no free slot MUST be refused with a distinct, machine-readable code that
  states the slots used and the limit, not a generic authorization error, so the client can explain the choices.
  Such a recipe can never be made public, so the single-recipe channels refuse the save, and bulk import pauses
  ([ADR-0072](../../docs/architecture/decisions/0072-bulk-recipe-import.md) §9). The channels MUST stay
  advertised to free-tier users. Pro users have no slot limit. _(Amended 2026-10-29, ADR-0077.)_ A family or friend
  recipe shared with permission is not "non-public by policy". It can be public, so this FR's refusals do not apply to
  it. Its private copy uses a slot like any private recipe.
- **FR-014b** _(added 2026-11-03, owner ruling, ADR-0082, decision D5)_: System MUST offer a public **facts card** for a
  book or paid-site recipe (`imported_physical`, `imported_paid`). [Law] The facts of a recipe are free to anyone
  (17 U.S.C. §102(b), _Feist v. Rural_, 499 U.S. 340 (1991)). The card has the same field list as the linked card
  (`021-FR-014a`): no prose, no headnote and no photo. It credits the book (title, author, publisher) or the paid site.
  It MUST NOT appear in the book's order or as a book's collection. A **per-source cap** applies, per book (by ISBN or
  title) and per paid site, counted over time (E7, `016-FR-030a`). [Law, EU and UK] The cap rests on the database right
  (Directive 96/9/EC Art. 7), US compilation copyright for one source's selection (17 U.S.C. §103) and goodwill.
  The cook's full verbatim copy stays private. Our servers never fetch a paid site, so the card's facts come from the
  cook's paste or photo. Counsel review is owed before launch (`016-FR-050`).

- **FR-024** _(PARTIALLY IMPLEMENTED 2026-08-19 — [ADR-0023](../../docs/architecture/decisions/0023-curator-declared-provenance.md))_: Recipe creation
  MUST accept an explicit provenance (`sourceType` plus optional source URL and attribution) rather than
  assuming `user_created`, and MUST evaluate the C-004 visibility policy against the **actual** provenance.
  Omitted provenance MUST continue to mean `user_created`, so existing behaviour is unchanged. _(Requires a
  change to 001's `RecipesService` — see the callout above.)_
    > **Amended 2026-11-03 (owner ruling, ADR-0082).** A curator who declares `imported_public` for a public-domain text
    > MUST also record the public-domain record on the grant: first-publication year and place, each creator (author,
    > translator, illustrator) with a death year or "no named author", the "mort pour la France" flag per creator, the
    > edition used, the markets checked, who checked and when, and the rule version (D1, `016-FR-015k`). No new
    > `sourceType` value is added. The "Public domain" label is derived from the grant plus a passing record. The rule
    > rolls forward each 1 January, so no cut-off year is fixed here. Counsel review is owed before launch (`016-FR-050`).
    >
    > ✅ **The create half has shipped, ahead of the rest of 004 and additively.** `POST /api/v1/recipes` now
    > takes an optional `source` — a discriminated union over `sourceType` in
    > `packages/services/recipe-service/src/recipes/recipes.schema.ts` — and `RecipesService.create` no longer
    > hardcodes `USER_CREATED`: it resolves provenance through the pure `evaluateProvenance` policy
    > (`src/recipes/domain/provenancePolicy.ts`) and feeds the **resolved** `sourceType` into
    > `evaluateVisibility`, then writes all three provenance columns from the policy's output rather than from
    > the body. An absent `source` resolves to `user_created` with `null` source fields, which is byte-for-byte
    > the pre-change behaviour — so "existing behaviour is unchanged" is a checked property, not a claim.
    >
    > **What is still outstanding**: only `user_created` and `imported_public` are declarable (ADR-0023 records
    > why the other two are held back), and the **bulk** creation path `D-011` also calls for is not built.
- **FR-025** _(amended 2026-08-19 — [ADR-0023](../../docs/architecture/decisions/0023-curator-declared-provenance.md))_: Client-supplied provenance MUST be
  whitelisted, never mass-assigned. A caller MAY declare only provenance that is **equally or more restrictive**
  than `user_created` — specifically the attested paid-source case (`FR-014a`). An **unprivileged** caller MUST
  NOT be able to declare `imported_public` (which would let them attach false attribution) or
  `imported_physical` (whose attestation and citation, `FR-014a`, are not built on that route). Those
  classifications are set by the server from the channel it observed, **or declared by a principal holding
  the grant that channel requires**.
    > ⚠️ **The word "unprivileged" is an AMENDMENT, not a reading of the original.** This requirement previously
    > forbade **any** caller from declaring `imported_public`, justified by the server setting it "from the
    > channel it observed". That justification assumes **the server performs the fetch**. For the curated
    > public-domain import channel it does not fetch anything (see the `FR-023` finding below), so there is no
    > observed channel — and inventing one would satisfy this requirement's letter while removing its substance.
    > The honest construction: the curator scope `recipes:import:public` is a **new channel member**, whose
    > observation is _an administrator granted this principal the scope out of band in Clerk, carried inside the
    > token's SIGNED `public_metadata`, on the signing key's authority_.
    >
    > Argued on **this requirement's own threat model** — false attribution on public content — an administrator
    > grant is a **stronger** control than "the server fetched a URL the caller chose", because a caller-supplied
    > URL can point at content the caller wrote. Fetching proves a document exists at a URL; it proves nothing
    > about authorship, and this requirement is an authorship control.
    >
    > `imported_physical` and `imported_paid` remain **undeclarable by anyone** — that half is unchanged, and
    > ADR-0023 records why: the attestation and citation that must travel with them are not built there.
- **FR-026**: System MUST support importing a single file containing **many** recipes — up to **1,000** per
  file, rejecting a larger file with an explicit limit message — producing one draft per
  recipe. Drafts with no missing required fields MUST be confirmable in a single bulk action; drafts with gaps
  MUST be surfaced individually for completion. A failure affecting one recipe MUST NOT discard the others.
  _(Amended 2026-11-03, owner ruling, ADR-0082, E7: a **per-source cap** also applies to bulk import. Facts cards a
  file would make public are counted per source, per book or per site, over time, together with every earlier card and
  any later Commise version. A file past the cap keeps the extra recipes private. [Law, EU and UK] This rests on the
  database right (Directive 96/9/EC Art. 7(5), repeated and systematic taking), US compilation copyright
  (17 U.S.C. §103) and goodwill. Counsel review is owed before launch (`016-FR-050`).)_
- **FR-027**: Bulk confirmation MUST report a **per-recipe outcome** (created, already existed, or failed with
  a reason) rather than a single aggregate result, and MUST apply deduplication per recipe so that a recipe
  already present resolves to the existing one rather than counting as a failure.
- **FR-023**: System MUST consult the source site's `robots.txt` before fetching, and MUST apply it as follows
  RFC 9309: the group that names the import user-agent binds the fetch, and if no group names it, the `*` group
  binds it. _(Amended 2026-11-03, owner ruling, ADR-0082: the earlier D-007 exception, that a bare site-wide
  `Disallow: /` in the `*` group did not block a user-initiated import, is withdrawn. It was a reading of D-007, not of
  RFC 9309. "Honour every group that names us" alone was also wrong.)_ A blocked fetch MUST be reported as
  `IMPORT_SOURCE_BLOCKED` and MUST be counted, so the real-world cost of this policy is measurable.
  The fetch MUST also read and honour the machine-readable data-mining opt-outs, because the parse uses an LLM:
  TDMRep (`/.well-known/tdmrep.json` and the `tdm-reservation` header), `noai` and `noimageai` tags, blocks on AI
  crawlers (GPTBot, ClaudeBot, Google-Extended, CCBot) and Content Signals `ai-input=no`. [Law, EU] A machine-readable
  reservation under DSM Art. 4(3) takes the source out of text-and-data mining. This is [Judgement, strong], not
  settled: no court has ruled on TDMRep, and the law on prose-only opt-outs is open (_Kneschke v. LAION_, OLG Hamburg,
  10 Dec 2025, further appeal pending). [House rule] We honour them everywhere from v1. The fetch MUST log, per
  fetch, what each signal said, including "none found", as evidence. [Law, EU] The paste fallback does not cure an EU
  opt-out for our own LLM analysis. It moves the stored copy to the user side only. That is a counsel item. [Law, US]
  robots.txt is not US law, but ignoring it weakens implied-licence arguments (_Field v. Google_, 412 F. Supp. 2d 1106
  (D. Nev. 2006)). Extraction's legal basis is per market: US fair use (a judgement, weakened by _Thomson Reuters v.
  Ross_), EU DSM Art. 4 unless opted out, UK s.28A only, and Australia has no matching exception. Counsel review is
  owed before launch (`016-FR-050`).
    > ⚠️ **FINDING (2026-08-19 — [ADR-0023](../../docs/architecture/decisions/0023-curator-declared-provenance.md)): `robots.txt` compliance is NOT
    > terms-of-use compliance, and this requirement treats them as the same check.** A site may permit a path in
    > `robots.txt` and forbid automated access in prose elsewhere. Measured on the live site the same day:
    >
    > - `https://www.gutenberg.org/robots.txt` is, in full, `User-agent: *` / `Disallow: /ebooks/search` — so
    >   this requirement's check **PASSES** for `/cache/epub/…`, the paths a public-domain cookbook comes from;
    > - `https://www.gutenberg.org/policy/robot_access.html` states the site _"is intended for human users only.
    >   Any perceived use of automated tools to access the Project Gutenberg website will result in a temporary
    >   or permanent block of your IP address."_ Its only exceptions are a private **mirror**, the rate-limited
    >   **`/robot/harvest`** endpoint, and the catalog feeds — all operator activities, none of them a
    >   per-request fetch of a `/cache/epub/…` URL by an application server.
    >
    > **Consequence, already in force:** the public-domain cookbook corpus is downloaded **by an operator, out
    > of band**; nothing 004 deploys and no CI job fetches `gutenberg.org`. The persisted `sourceUrl` is a
    > **citation for a human reader**, not a fetch target. Egress identity here is shared and stage-level — a
    > VPC-attached Lambda leaves through the single `t4g.nano` NAT instance (ADR-0004), Fargate leaves through
    > an address the task does not choose, and CI runners share GitHub's pools — so a block earned by an import
    > job is not scoped to that job.
    >
    > **What 004 owes:** `FR-023` should gain an explicit terms-of-use step (an allow/deny list of sources with a
    > recorded basis, per-source, maintained like `D-004`'s blocklist), because no automated check can read a
    > policy page. Until it does, a source passing `robots.txt` MUST NOT be read as cleared to fetch.
- **FR-022**: System MUST enforce a per-user daily import quota across all channels, and a tighter sub-quota
  for OCR imports specifically. Exceeding either MUST return a distinct, machine-readable error carrying the
  time at which the quota resets — not a generic rate-limit response. The quota is a **product allowance**, not
  a transport rate limit: it is evaluated in the domain layer and is expected to vary by subscription tier once
  [010-subscriptions](../010-subscriptions/spec.md) lands. Per-minute burst limiting remains the shipped
  throttler's job (D-006).
    > ⚠️ **Where the count lives, and the bulk allowance.** Owner ruling, 2026-10-26. The quota is counted in
    > the `import_allowance_events` ledger (recipe-service migration 0058), not over an `import_jobs` table, which
    > was never built. Each channel counts only its own rows: **paste, 200 a rolling day**, one unit per paste,
    > and **bulk import, 1,000 recipes a rolling day on a paid plan and 200 on Free** (owner ruling, 2026-10-27), one unit per recipe. The two never borrow from each other.
    > This replaces "across all channels" for these two channels, and it replaces D-013's "one file is one
    > import". Bulk import now sends every line through the LLM parse and the match review, so a file is no longer
    > free of third-party calls. [ADR-0072](../../docs/architecture/decisions/0072-bulk-recipe-import.md) §8 holds
    > the rule. The OCR sub-quota is unchanged and stays with 011.
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
  `src/search/dto/searchRecipes.query.dto.ts`, and it is now **converged** onto `createZodDto` +
  `ZodValidationPipe`, with `class-validator` and `class-transformer` **removed from recipe-service's
  `package.json` and `prod.package.json`**. `grep -rn "from 'class-validator'" packages --include="*.ts"` finds no
  importer anywhere under `packages/services`. So 004 inherits a **single-mechanism** service — ⛔ which raises the
  cost of adding a `class-validator` DTO here from "joining a mess" to "**re-creating** one", and it would now also
  fail **G5** in `packages/tools/repoGuards/__tests__/serviceSecurityInvariants.test.ts`, which carries **no
  exception list**.
- **⚠️ The pipe hazard is invisible in review.** Under Nest's **own** built-in `ValidationPipe`, a
  `createZodDto` DTO **validates nothing while looking correctly wired** — the schema is present, the DTO is
  referenced, the route reads as validated, and no input is checked. It already bit identity's
  `PATCH /users/me`. The service registers **`nestjs-zod`'s** pipe, and the **only** thing that catches the
  failure is a test that posts a **known-bad body to a real route** and asserts the `400`.
- **`z.strictObject()` for every mutating request body** — the portfolio default, ruled 2026-08-12 in GR-017
  §17-c, which **closes OPEN-GR-016-B** (the plan still records it as OPEN; it is not). Plain `z.object()`
  survives only on a **read** surface with a **documented forward-compatibility reason at the schema**. On
  `PATCH /api/v1/import/drafts/{id}` — a **user correcting an extraction** — a silently stripped unknown
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
      `packages/services/recipe-service/src/database/__tests__/storageCapacity.test.ts`, over shared machinery in
      `@kitchensink/contract-gen` (`src/storageCapacity.ts`). It **may** import both artifacts because a test is
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
      import is Pro-only, which also bounds Textract spend to paying users.~~
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
    - **Consequence for D-014.** D-014's rule moves with the channel and becomes 011's to enforce. Since
      2026-10-26 that rule is the private-slot limit, not a Pro gate (ADR-0073). It is read through the
      same shared entitlement mechanism, never an import of the identity service (ADR-0017 decision 3).
- **D-002 (Instagram)**: `FR-009` is **fully specified but gated**. The public no-auth oEmbed endpoint
  (`api.instagram.com/oembed`) was withdrawn on 2020-10-24; oEmbed now requires a Meta app credential and App
  Review. Instagram import therefore ships behind a capability flag, defaulting off, and its adapter is
  developed and tested against a contract fake. **No other requirement in 004 depends on it.** The Meta
  application is an external workstream that does not gate release.
- **D-019 (Save to Commise, added 2026-10-28, owner ruling)**: `FR-053` is fully specified but gated, in the same
  way as `D-002`. Owner ruling, 2026-10-28: "Do 3 as well." The button needs the WP Recipe Maker team to add Commise as
  a save target. The founder emails the team in pre-launch block 1. If there is no reply within 30 days, outreach
  stops (acquisition brainstorm, idea B4). Writing our own WordPress plugin is not planned. It needs evidence of
  creator demand first. The capability flag stays off until a signed agreement exists. The publisher chooses to show
  the button, which is the publisher's own act. Whether that act grants any licence is a counsel question under
  `016-FR-050`. It does not change any label. No other requirement in 004 depends on `FR-053`.
- **D-003 (FR-014a)**: Attestation **and** citation **and** heuristics, as specified in `FR-014a`: the user
  declares the source and must cite it; a non-public cited source forces `imported_paid` (its verbatim copy never public, amended 2026-11-03, ADR-0082);
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
- **D-014 (Non-public creation is bounded by private slots — amended 2026-10-26, owner ruling,
  [ADR-0073](../../docs/architecture/decisions/0073-free-tier-private-slots.md))**: Creating a recipe that is
  not public no longer requires a subscription. A free-tier user holds up to 50 private recipes, and every one
  uses a slot, including where the privacy is imposed by policy rather than chosen. Photo/OCR import and attested
  paid-source entry are open to the free tier, within its slots. The decision of 2026-08-02 made both
  Pro-only, and it also confined Textract spend to paying users. That spend bound is gone: free-tier OCR is
  now bounded only by the OCR sub-quota (`FR-022`). The slot check is a visibility rule in the C-004 policy, not
  a gate on the channel (`FR-028`).
- **D-013 (Bulk limits, 2026-08-02)**: A single export file may contain up to **1,000 recipes**; above that it
  is rejected with an explicit limit message. A bulk file import counts as **one** import against the D-006
  daily allowance, not one per recipe — the allowance exists to bound outbound fetching and OCR spend, and a
  file import does neither (one upload, parsed locally, no third-party call). Without this carve-out a
  first-day migration would exhaust a user's daily allowance on the day they join, which is precisely backwards.
    > ⚠️ **Both halves are replaced.** Owner rulings, 2026-10-26. A file of any size is accepted, and there is no
    > 1,000-recipe file limit. Bulk import has its own allowance of 1,000 recipes a rolling day on a paid plan and 200 on Free. It counts per
    > recipe, and it is separate from paste (see the note under `FR-022`). A file larger than the room left imports
    > what fits, and the rest follows as room frees up.
- **D-012 (Bulk import, 2026-08-02)**: A single uploaded export file may contain many recipes — the realistic
  migration path from Paprika, Mealie, or Plan To Eat, and the onboarding case this feature exists to serve.
  One draft per recipe (so nothing is fabricated and every rule still applies), with **split review**: complete
  drafts confirm in one action, incomplete ones are surfaced individually. Bulk **URL** submission stays out of
  scope — it multiplies outbound fetching for a far rarer case.
    > ⚠️ **Switching at launch.** Owner ruling, 2026-10-27: "Include the other recommendations in either new
    > features or expanding existing features." The formats and paths for launch are in
    > [017's FR-016a](../017-recime-parity/spec.md). They are Paprika `.paprikarecipes`, Mela `.melarecipes`, Plan to
    > Eat CSV and Mealie JSON. Copy Me That and Crouton follow a plan-time check of a real export. ReciMe and AnyList
    > have no bulk export, so each gets a per-recipe path. A guided "Switch from another app" flow wraps this decision
    > (`017-FR-016b`). Each migrated recipe still carries its own statement. The file's source field prefills it
    > where there is one (`017-FR-016c`). Export out of Commise in open formats is `017-FR-018a` to `017-FR-018c`.
    > Every new surface here needs `staff-ux-engineer` DESIGN and SPECIFY before it is built.
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
    > ⚠️ The daily allowance's count and channels changed by owner ruling, 2026-10-26: paste 200 a rolling day,
    > bulk import 1,000 recipes a rolling day on a paid plan and 200 on Free, each counted on its own. See the note under `FR-022`.
- **D-005 (Draft & image retention, 2026-08-02)**: Unconfirmed drafts expire **7 days** after creation, and the
  OCR source image shares that lifetime exactly — deleted on confirm, discard, or expiry, whichever is first.
  Seven days covers a user who starts an import, is interrupted, and returns the following weekend, while
  bounding worst-case photograph retention to a week. A single shared lifetime was chosen over a shorter
  image-only window so there is one sweep and one invariant to keep correct, rather than two that can drift.

## Gating

`FR-009` and `FR-053` are the gated requirements (`FR-053` added 2026-10-28, `D-019`). Release is **not** blocked on
either: the URL, file, and OCR channels
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

- **C-001 (Import deduplication)** _(amended 2026-10-29, owner ruling, ADR-0077)_: When multiple users import the
  same URL, the system holds at most one public **linked card** keyed by the **canonicalized** source URL (scheme and
  host lowercased, default port and fragment removed, tracking parameters stripped, trailing slash normalized). Each
  cook's import of that URL is their own private copy, from their own capture, where 001's rule lets that cook keep
  it private. Later imports surface the existing card, which the cook can save (`021-FR-014d`). Who can keep a web
  import private is open (001, Session 2026-10-29). Until it is answered, a cook who cannot keep it private gets only
  the existing card, as C-001 offered a clone before, and loses nothing they had. Uniqueness of the public
  card is enforced by a partial unique index that excludes soft-deleted rows, so a deleted import can be re-imported.
  Applies to both website and Instagram imports. One card per page also keeps the count of public cards per site low
  (`016-FR-030a`).
    > **Amended 2026-11-03 (owner ruling, ADR-0082).** The key means one facts card per page, not one per recipe.
    > Duplicates are a product choice, not a legal problem, and two cooks' texts are never merged into one. **Known
    > product gap:** matching on the URL alone misses the same recipe at another address, and it misses pasted copies.
    > The card is now readable signed out (`FR-008` ruling). Counsel review is owed before launch (`016-FR-050`).
- **C-003 (Instagram import method)**: Instagram import uses the Meta-hosted oEmbed endpoint with an app
  credential and caption-text parsing. Only posts with recipe content in the caption are supported. See D-002.
- **C-006 (Draft-and-confirm)**: Every import channel produces a draft; confirmation creates the recipe. See
  _The draft-and-confirm model_ above for why this is forced by the shipped schema rather than chosen.
- **C-008 (Save to Commise, 2026-10-28)**: Owner ruling, verbatim: "Do 3 as well." Item 3 of the owner's list was a
  "Save to Commise" button for food bloggers through the WP Recipe Maker plugin. This spec reads it as one more link
  import channel, gated on the plugin team (`FR-053`, `D-019`). It keeps 016's rules, 017's user-directed posture and
  020's check, and it adds no new label and no new pipeline.
- **C-009 (Recipe rights, 2026-10-29)**: Owner, verbatim, in part: "The same goes for a private recipe that a chef
  copied from a public source and either a public or private recipe copied verbatim from a copyrighted or private
  source." The full ruling is quoted in `016` C-016-005. This spec reads it as four changes: a web import is private in
  full or public as a linked card (`FR-008` ruling, C-001), six statements in place of two (`FR-014a`), a family or
  friend recipe that can be public (`FR-028`), and a fingerprint kept at capture for the source check
  (`020-FR-012b`). The research behind them is not legal advice, and each is subject to counsel review.
    - **A risk for counsel, recorded and not acted on here.** The research found that the cook's own capture (paste,
      the share sheet, the browser extension) is safer under a site's terms than repeated server fetches. A URL shared
      from the share sheet that our server then fetches is still a server fetch. Only pasted or shared text and the page
      the extension reads in the cook's own browser are the cook's own capture. A server that
      returns again and again to a site whose terms it knows fits _Register.com v. Verio_ (2d Cir. 2004). That weighs
      against this spec's URL fetch (`FR-008`, and `FR-053` after the cook's tap) and against 017's tier 5 lookup of the
      source page (`017-FR-005`). It is on counsel's list (`016-FR-050`). This spec does not change 017.
- **C-007 (Extraction strategy set)**: The extractor chain is JSON-LD → microdata → heuristic HTML. **RDFa is
  deliberately excluded**: it is vanishingly rare for recipe content relative to JSON-LD and microdata, and no
  maintained Node RDFa parser exists. The chain is a Strategy set behind one interface, so adding RDFa later is
  additive if fixture evidence ever justifies it.

---

## Findings against this feature's own artifacts _(2026-08-19)_

Recorded here rather than fixed in place, because each is a decision this feature must take rather than an
edit. The two requirement-level findings are written against the requirements themselves — see `FR-020`
(a null quantity is unrepresentable at confirmation) and `FR-023` (`robots.txt` is not the terms of use).

- **⚠️ `v-model/module-design.md` prescribes file names that FAIL lint.** `MOD-019`, `MOD-020` and `MOD-021`
  give their modules kebab-case paths — `src/imports/normalize/ingredient-line.ts`, `value-normalizers.ts`,
  `content-sanitizer.ts` — and `docs/CODING_STANDARDS.md` §1 is **one regime, every package: `camelCase`, and
  hyphens are PROHIBITED in file names**, enforced in CI by `eslint-plugin-check-file`. A module built at the
  path the design names would not pass lint. Implementations MUST use `ingredientLine.ts`,
  `valueNormalizers.ts`, `contentSanitizer.ts`; treat the design's paths as naming the **module**, not the
  file. (`MOD-022`'s `provenance.policy.ts` carries a dot-suffix rather than a hyphen, so §1's prohibition does
  not reach it — but the policy that shipped lives at `src/recipes/domain/provenancePolicy.ts`, beside `visibilityPolicy.ts`, because
  it runs at recipe **creation**, which is where ADR-0019's convergence point put it.)
- **`MOD-022` as designed is a different function from the one that shipped, and both are wanted.** The design
  maps an **observed channel** to a `sourceType` (`url → imported_public`, `ocr → imported_physical`, …); the
  shipped `evaluateProvenance` decides whether a **caller may declare** the provenance it sent. They compose —
  the channel mapper produces the declaration, the grant policy authorizes it at the create boundary — and the
  channel mapper is still 004's to build.
