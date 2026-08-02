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
4. **Given** a user photographs a physical recipe, **When** OCR completes, **Then** a draft is returned for
   review and, on confirmation, the recipe is created with `sourceType = imported_physical` and
   `visibility = private`.
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
- **FR-012**: System MUST allow users to import recipes from physical copies via photo capture and OCR text
  extraction, producing a draft for review.
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

- **D-001 (OCR launch scope)**: Physical-copy import (`FR-012`) **ships at launch at P1**. Provider is **AWS
  Textract** — the account is already AWS-native, credentials are IAM rather than a new vendor secret, and
  `sharp` is already a service dependency for image preprocessing. It sits behind an `OcrProvider` port so the
  pipeline is testable without the vendor and the choice is reversible. **Amended by D-014**: OCR import is
  premium-only, which also bounds Textract spend to paying users.
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
- **D-016 (OpenAPI contract location, 2026-08-02)**: The service's single contract stays at
  `specs/001-commise-recipe-app/contracts/api.openapi.yaml` for this feature; 004 extends it rather than
  starting a second document. Relocating a 120 KB contract into the service package mid-feature adds risk for
  tidiness, and it gets worse with every feature that extends it — so the move stays its own change. Note the
  ADR-0011 migration rewrote that contract's paths in place **without** relocating it, so the location
  question is still open and this decision still stands.
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
