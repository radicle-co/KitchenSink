# Feature Specification: ReciMe Parity

**Feature Branch**: `chore/code-quality-enforcement-phase-1-2` (no new branch — standing owner directive)
**Created**: 2026-08-22
**Status**: Draft — 3 clarifications open
**Input**: User description: "we want parity with the feature gaps against recime that
911043cd-1ce2-4e5b-8608-50a8524b5b98 review and discovered. We also have the artifact
https://claude.ai/code/artifact/18e8fcdc-0992-4861-8bd8-6d5a3b7baf41"

**Source of truth**: [`docs/competitive/02-gap-analysis-and-strategy.md`](../../docs/competitive/02-gap-analysis-and-strategy.md)
§2 (gap matrix) and §6 (spec deltas) · [`01-recime-teardown.md`](../../docs/competitive/01-recime-teardown.md) ·
briefing artifact _The ReciMe Problem_

---

## How to read this spec — it is a DELTA spec

This feature owns **no capability of its own**. It is a change-set against five existing feature specs, in
the same shape feature `015` uses to amend `001`. Every functional requirement below is tagged:

| Tag                  | Meaning                                                                |
| -------------------- | ---------------------------------------------------------------------- |
| **`→ 004 ADDED`**    | A new requirement to be merged into feature 004's spec                 |
| **`→ 008 MODIFIED`** | An existing requirement in feature 008 whose text this delta replaces  |
| **`→ 001 RECORDED`** | Behaviour **already shipped** with no FR anywhere; this writes it down |

On merge (`/speckit-product-forge-spec-merge`), each requirement lands in its owner spec and is struck from
here. **Nothing in this document is a second authoritative copy of anything** — where an existing FR already
states a rule, this spec cites it rather than restating it.

### Delta register — what is in scope

Sixteen of the gap analysis's twenty-four deltas. Owner rulings 2026-08-22: _every parity delta_, and the
_full five-tier_ import waterfall.

| Delta | Change                                                            | Owner spec    | Requirements  |
| ----- | ----------------------------------------------------------------- | ------------- | ------------- |
| D1    | Video import — five-tier waterfall                                | `004`         | FR-001…FR-008 |
| D8    | Reach Instagram without Meta Graph API approval                   | `004`         | FR-009        |
| D20   | Unquantified ingredients ("salt to taste") representable          | `004` / `001` | FR-010        |
| D2    | Share-sheet capture, iOS + Android                                | `004`         | FR-012…FR-013 |
| D3    | Browser extension                                                 | `004`         | FR-014…FR-015 |
| D15   | Migration importers (Paprika, AnyList, Copy Me That, ReciMe)      | `004`         | FR-016…FR-017 |
| D14   | Recipe export — JSON + PDF                                        | `001`         | FR-018…FR-020 |
| D13   | Cook mode beyond four FRs                                         | `008`         | FR-021…FR-024 |
| D22   | Offline read + cook                                               | `008`         | FR-025        |
| D11   | Unit conversion metric ⇄ imperial                                 | `001`         | FR-026        |
| D21   | Dark mode                                                         | `001`         | FR-027        |
| D9    | Aisle grouping lifted from plan into an FR                        | `007`         | FR-028…FR-029 |
| D10   | Household grocery-list sharing                                    | `007`         | FR-030        |
| D12   | Write FRs for shipped-but-unspecified behaviour                   | `001` / `008` | FR-031…FR-032 |
| D7    | Invert BYOK → platform-managed inference **(prerequisite of D1)** | `005`         | FR-033…FR-035 |
| D23   | One-time / lifetime purchase tier                                 | `010`         | FR-036        |

### Deliberately NOT in scope

| Delta        | Why excluded                                                                                                                                                                                |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D4a, D4b, D5 | **Feature `015` owns these** (free-tier privacy un-gating, `imported_public` default, re-pricing). Duplicating them here would create the exact second-authority this spec exists to avoid. |
| D6           | Payment rails (external US web checkout + IAP). Monetisation mechanics, not a capability gap; coupled to D5, so it moves with `015`/`010`.                                                  |
| D16–D19      | The gap analysis files these under _"Strategic — to win rather than match"_. The owner scoped this feature to **parity**.                                                                   |
| D24          | Registered DMCA agent + repeat-infringer policy. A legal/ops action with no product surface; carried as a dependency of `015`.                                                              |

---

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Get the recipe out of the video (Priority: P1)

A cook saves a cooking Reel. In the app they paste or share that link and get back a structured, editable
recipe — title, ingredients with resolved quantities, and ordered steps — including from videos where the
recipe is only ever shown on screen and never written or spoken.

**Why this priority**: This is the entire competitive test. ReciMe won one job and won it well enough for
373,000 ratings; against that job our fourteen specs currently contain **no requirement at all**. Their
documented pipeline has exactly three tiers — caption, then audio, then go find the blog — and **no visual
tier**. Tiers 3 and 4 here are the two they structurally cannot do.

**Independent Test**: Run a fixed adversarial corpus of social videos through import and measure the
structured-recipe success rate, with the corpus weighted toward the four cases ReciMe is documented or
measured to fail: silent/ASMR video with on-screen text, text-overlay-only video, recipes posted in comments,
and multi-recipe meal-prep posts.

**Acceptance Scenarios**:

1. **Given** a Reel whose caption contains the full recipe, **When** the user imports it, **Then** the recipe
   is extracted from the caption and the draft records that tier 1 produced it.
2. **Given** an ASMR video with no caption, no narration, and a full ingredient list burned into the frames,
   **When** the user imports it, **Then** tiers 1 and 2 yield nothing, tier 3 reads the on-screen text, and a
   complete recipe is produced. _(ReciMe fails this import entirely — Android Police four-app head-to-head.)_
3. **Given** a vlog-style video where a step is performed on camera but never spoken and never captioned,
   **When** the user imports it, **Then** tier 4 recovers that step. _(ReciMe silently drops it.)_
4. **Given** a post whose recipe is in a comment rather than the caption, **When** the user imports it,
   **Then** the comment is considered as a source. _(ReciMe's own troubleshooting concedes comments are
   invisible to it.)_
5. **Given** a meal-prep post containing five distinct recipes, **When** the user imports it, **Then** all
   five are surfaced and the user chooses which to save. _(ReciMe extracts only one.)_
6. **Given** a login-gated or paywalled source, **When** the user imports it, **Then** the app states plainly
   that the source cannot be read and offers the screenshot path — rather than failing silently.
7. **Given** any successful video import, **When** the draft is presented, **Then** every ingredient quantity
   carries the per-field confidence and food-service resolution `004-FR-015` already requires.

---

### User Story 2 - Capture without leaving where I found it (Priority: P1)

A cook finds a recipe in another app or on a website and saves it into Commise from there — via the OS share
sheet on phone, or a browser button on desktop — without first opening Commise and pasting a URL.

**Why this priority**: The share sheet is ReciMe's **primary** capture path, and their Chrome extension has
30,000 users. Import quality (US1) is worth nothing if reaching the importer costs the user a context switch;
these two stories are one product and ship together. Instagram also rides here — `004-FR-009` is currently
gated on a Meta app approval that does not exist, and user-initiated share capture routes around that gate
entirely rather than waiting on Meta.

**Independent Test**: From a cold app state on iOS, Android, and Chrome, share a recipe URL from a third-party
app/site and confirm a draft is created without the user opening Commise first.

**Acceptance Scenarios**:

1. **Given** the mobile app is installed and closed, **When** the user shares a TikTok post to Commise from
   the OS share sheet, **Then** a draft import is created and the user is told it succeeded.
2. **Given** a recipe blog open in Chrome, **When** the user activates the extension, **Then** the recipe is
   captured through the same import pipeline as every other channel.
3. **Given** an Instagram post, **When** the user shares it to Commise, **Then** the import proceeds with no
   dependency on Meta Graph API approval.
4. **Given** any capture surface, **When** it produces a draft, **Then** that draft is indistinguishable in
   handling from one created through the in-app chooser of `004-FR-046`.

---

### User Story 3 - Bring my library in, and take it out again (Priority: P2)

A cook with years of recipes in Paprika, AnyList, Copy Me That, or ReciMe moves the whole library across in
one operation — and can export their Commise library back out at any time.

**Why this priority**: Switching cost is the moat, and ReciMe's own staff have confirmed they cannot do this:
a 2,000-recipe Paprika backup cannot be imported, and there is no JSON or CSV export — only PDF, paywalled.
Their users are asking for both **out loud**. This is cheap, uses the bulk-import machinery `004-FR-019`/
`004-FR-026` already specify, and does not wait on US1.

**Independent Test**: Import a real multi-thousand-recipe export from each supported competitor, then export
the result and re-import it, asserting equivalence.

**Acceptance Scenarios**:

1. **Given** a Paprika, AnyList, Copy Me That, or ReciMe export file, **When** the user imports it, **Then**
   recipes are created and a per-recipe outcome report is produced.
2. **Given** an import in which some recipes fail, **When** it completes, **Then** successful recipes are kept
   and each failure is individually reported — a partial import is never discarded wholesale.
3. **Given** any user on any tier, **When** they request an export, **Then** they receive both a lossless
   machine-readable file and a human-readable document.
4. **Given** an exported library, **When** it is re-imported into an empty account, **Then** the resulting
   recipes are equivalent to the originals in every user-visible field.

---

### User Story 4 - Cook from it in a real kitchen (Priority: P2)

A cook follows a recipe with wet hands, a dim room, a bad signal, and three things on the hob at once.

**Why this priority**: Cook mode is where a recipe app is judged, and `008` currently carries **four FRs** —
steps, navigation, timers, wake-lock. ReciMe paywalls cook mode and unit conversion, has no dark mode at all,
and its offline access is Plus-only. This story is where an app used at night, off-signal, in a foreign
recipe's units, either works or does not.

**Independent Test**: Complete a multi-timer recipe end to end, in dark mode, in airplane mode, with the
recipe's units converted from metric to imperial.

**Acceptance Scenarios**:

1. **Given** a recipe with three timed steps, **When** the user starts all three, **Then** all three run
   concurrently, each labelled with its step, and each alerts independently.
2. **Given** a recipe detail view has been opened while online, **When** the device loses all connectivity,
   **Then** the recipe and its cooking session remain fully usable.
3. **Given** a recipe authored in grams and millilitres, **When** the user's unit preference is imperial,
   **Then** quantities display converted, and the stored recipe is unchanged.
4. **Given** the device is in dark mode, **When** any Commise surface is opened on web or mobile, **Then** it
   renders in dark mode, and a manual override is available.
5. **Given** cooking mode is engaged, **When** the device is left untouched, **Then** the screen stays awake
   and may dim without sleeping.
6. **Given** the user is on step 4, **When** they need the quantities for that step, **Then** the ingredients
   for that step are visible without leaving the step.

---

### User Story 5 - Shop the plan, together (Priority: P3)

A household turns a meal plan into one grocery list, sorted the way their store is laid out, and shares it
with the person who is actually going.

**Why this priority**: Aisle sorting is a **free** ReciMe feature and ours exists only in `007`'s plan, not in
any requirement. Their list is a known weak point — it does not merge duplicates and its categories cannot be
customised, both of which `007-FR-028` and this delta beat. Sharing is where **nobody wins**: their cookbook
invite ships broken and `007`'s US-009 has no FRs at all.

**Independent Test**: Generate a list from a multi-recipe plan, confirm aisle grouping and custom categories,
then confirm a second person can see and check off the same list.

**Acceptance Scenarios**:

1. **Given** a grocery list generated from a meal plan, **When** it is displayed, **Then** items are grouped by
   aisle category.
2. **Given** the default aisle categories do not match the user's store, **When** they customise them, **Then**
   the grouping follows their categories and persists.
3. **Given** a list shared with another person, **When** either checks off an item, **Then** the other sees it.

---

### Edge Cases

- **A video is a recipe _reaction_, not a recipe.** Import must be able to conclude "no recipe here" and say so,
  rather than hallucinating one from ambient food talk.
- **Every tier fails.** The user gets an explicit, actionable failure naming what was tried — not a silent
  empty draft. ReciMe's documented behaviour here is a generic error with "email us the URL"; that is the bar
  to beat, not to match.
- **The video is 45 minutes long.** Frame sampling and transcription must be bounded, and the bound must be
  stated, or a single import can consume an unbounded share of the inference budget.
- **On-screen text is decorative or is a watermark/handle.** Tier 3 must not emit `@creator` as an ingredient.
- **The source is deleted between import and retry.** A retried import of a dead URL must fail cleanly without
  destroying the draft already extracted.
- **A migration file is 2,000 recipes and the connection drops at 1,400.** Resumable or restartable without
  duplicating the 1,400.
- **A migration file contains recipes the user did not author.** Provenance classification (`004-FR-014a`,
  ADR-0023) applies to migrated recipes exactly as to any other import — bulk migration is not a side door
  around provenance, and it must not be able to declare `imported_public` without the grant ADR-0023 requires.
- **Unit conversion of an unquantified ingredient.** "Salt to taste" converts to "salt to taste" — see FR-010.
- **Conflicting units within one ingredient line** ("1 lb (450 g) beef"). Convert once; do not double-convert.
- **Offline edits to a shared grocery list on two phones.** Governed by GR-005; this spec must declare the
  reconciliation rule before implementation, not invent one during it.
- **Dark mode and the shipped difficulty chip.** A known live defect renders the selected difficulty chip
  white-on-white; a dark theme must not add a second instance of that class of bug.

---

## Requirements _(mandatory)_

### Functional Requirements

#### A. Video capture — D1, D8, D20

- **FR-001** `→ 004 ADDED`: System MUST import recipes from public social video posts on TikTok, Instagram
  Reels, YouTube (Shorts and long-form), and Facebook.
- **FR-002** `→ 004 ADDED`: System MUST attempt extraction as an ordered **waterfall**, stopping at the first
  tier that yields a structurally complete recipe: **(1)** caption/description text, **(2)** audio transcript,
  **(3)** on-screen text from sampled frames, **(4)** visual analysis of sampled frames, **(5)** lookup of the
  original source site. The draft MUST record which tier produced each field.
- **FR-003** `→ 004 ADDED`: Tier 3 MUST recover recipe text that appears only as burned-in on-screen text,
  including where the post has neither caption nor speech.
- **FR-004** `→ 004 ADDED`: Tier 4 MUST recover ingredients and steps that are demonstrated visually but never
  stated in caption or audio.
- **FR-005** `→ 004 ADDED`: Tier 5 MUST attempt the creator's original source page and, when it succeeds, MUST
  attribute to that page per `004-FR-010` rather than to the video.
- **FR-006** `→ 004 ADDED`: Where a single post contains more than one recipe, System MUST surface all of them
  and let the user choose which to save.
- **FR-007** `→ 004 ADDED`: System MUST consider recipe text posted in a post's comments as a candidate source.
- **FR-008** `→ 004 ADDED`: Where a source is login-gated, paywalled, or otherwise unreadable, System MUST say
  so explicitly and offer the screenshot/paste path, distinguishing "cannot read this source" from "read it and
  found no recipe". _(Extends `004-FR-016`, which covers the message but not the distinction.)_
- **FR-009** `→ 004 MODIFIED`: Instagram import MUST be reachable through user-initiated capture and MUST NOT
  depend on Meta Graph API approval. **This closes gate D-002 on `004-FR-009`**; the Graph API path becomes an
  optional enhancement, never a precondition.
- **FR-010** `→ 004 MODIFIED, → 001 MODIFIED`: An ingredient whose quantity is genuinely unstated ("salt to
  taste", "a splash of oil") MUST be representable and MUST round-trip through storage, display, scaling, unit
  conversion, and export without being coerced to a number or silently dropped. **This resolves the `004-FR-020`
  finding**; it is a blocker for D1 because video sources state quantities far less often than blog sources do.
- **FR-011** `→ 004 ADDED`: Frame sampling, transcription, and visual analysis MUST each be bounded per import,
  and the bound MUST be stated in the product, so one long video cannot consume an unbounded share of budget.

#### B. Capture surfaces — D2, D3

- **FR-012** `→ 004 ADDED`: System MUST register as a share target on iOS and Android, accepting URLs, text,
  and images from any app's share sheet.
- **FR-013** `→ 004 ADDED`: Share-sheet capture MUST create a draft and confirm success without requiring the
  user to open the app first.
- **FR-014** `→ 004 ADDED`: System MUST provide a desktop browser extension that captures the current page as a
  recipe in one action.
- **FR-015** `→ 004 ADDED`: Every capture surface — chooser, share sheet, extension, migration — MUST route
  through **one** import pipeline, so provenance, confidence, quota (`004-FR-022`), and policy behave
  identically regardless of entry point.

#### C. Portability — D15, D14

- **FR-016** `→ 004 ADDED`: System MUST import recipe libraries exported from Paprika, AnyList, Copy Me That,
  and ReciMe.
- **FR-017** `→ 004 ADDED`: A library migration MUST report a per-recipe outcome, MUST retain successfully
  imported recipes when others fail, and MUST be restartable without duplicating already-imported recipes.
- **FR-018** `→ 001 ADDED`: Users MUST be able to export their entire recipe library as a lossless
  machine-readable file.
- **FR-019** `→ 001 ADDED`: Users MUST be able to export a recipe, a collection, or the whole library as a
  human-readable document.
- **FR-020** `→ 001 ADDED`: An export re-imported into an empty account MUST reproduce every user-visible field,
  including provenance classification and attribution.

#### D. The kitchen — D13, D22, D11, D21

- **FR-021** `→ 008 ADDED`: Cooking Mode MUST support multiple concurrent timers, each labelled with its step
  and each alerting independently. _(Extends `008-FR-034`, which is singular.)_
- **FR-022** `→ 008 ADDED`: Cooking Mode MUST surface the ingredients relevant to the current step without
  leaving that step.
- **FR-023** `→ 008 MODIFIED`: Cooking Mode MUST keep the screen awake **and** permit it to dim without
  sleeping. _(Replaces `008-FR-035`.)_
- **FR-024** `→ 008 ADDED`: Cooking Mode MUST support hands-free step navigation.
  [NEEDS CLARIFICATION: voice control is a capability **ReciMe also lacks** — the gap analysis files it as an
  open-category gap, not a parity item. It brings a speech surface, a microphone permission, and a privacy
  posture that nothing else in this feature needs. In scope, or deferred to the "win" set with D16–D19?]
- **FR-025** `→ 008 ADDED`: Recipe detail and Cooking Mode MUST remain fully usable with no connectivity once
  the recipe has been opened online. Per **GR-005**, this spec MUST declare offline scope, persistence layer,
  sync strategy, and conflict handling before implementation begins; `008`'s `CookingSession` device storage is
  the named reference implementation.
- **FR-026** `→ 001 ADDED`: Users MUST be able to view any recipe's quantities in metric or imperial via a
  persisted preference. Conversion MUST be display-only — the stored recipe is never rewritten — and MUST leave
  unquantified ingredients (FR-010) untouched.
- **FR-027** `→ 001 ADDED`: Web and mobile MUST render a dark theme, defaulting to the OS setting with a manual
  override, using design tokens rather than per-component colour. Both themes are subject to NFR-004.

#### E. Shopping — D9, D10

- **FR-028** `→ 007 ADDED`: A grocery list MUST group items by aisle category. _(Today this exists only in
  `007`'s plan; this lifts it to a requirement.)_
- **FR-029** `→ 007 ADDED`: Users MUST be able to customise aisle categories and their order, persisted per
  user. _(ReciMe's categories are fixed — a named weakness.)_
- **FR-030** `→ 007 ADDED`: A grocery list MUST be shareable with at least one other person, who can view and
  check off items.
  [NEEDS CLARIFICATION: **D18 — household as a first-class entity — is out of scope** (Strategic set), so there
  is no household model to hang this on. §8 open decision 5 calls this a one-way-door data-model choice.
  Options: (a) lightweight per-list share, no household concept; (b) pull D18 into this feature; (c) delete
  `007` US-009 as the gap analysis offers, and defer sharing entirely.]

#### F. Shipped behaviour with no requirement — D12

- **FR-031** `→ 001 RECORDED`: Users MUST be able to scale a recipe's servings, with quantities scaled
  proportionally. _Already shipped_ (`ServingScaleControl`, `servingScale.ts`) with no FR in any spec. Interacts
  with FR-010 and FR-026.
- **FR-032** `→ 008 RECORDED`: Users MUST be able to check off ingredients during cooking, persisted for the
  session. _Already shipped_ (`cookingProgress.ts`, `useCookingProgress.ts`) with no FR in any spec.

#### G. Inference — D7, prerequisite of D1

- **FR-033** `→ 005 MODIFIED`: Platform-managed inference MUST be the default for every AI-assisted capability.
  _(Replaces `005-FR-015`/`005-FR-016`'s BYOK-first model.)_ **This is a hard prerequisite of FR-003 and
  FR-004**: a waterfall whose two differentiating tiers require the user to supply their own API key is not a
  consumer capability.
- **FR-034** `→ 005 ADDED`: Users MAY optionally supply their own provider credentials as an escape hatch.
  BYOK MUST NOT be required for any advertised capability.
- **FR-035** `→ 005 ADDED`: Platform-managed inference spend MUST be attributable per import channel and per
  waterfall tier, and MUST be bounded by the reserve-then-settle ceiling of **ADR-0024**. Tiers 3 and 4 run
  **only** on failure of the cheaper tiers above them, which is what keeps their cost proportional to the
  failure rate rather than to import volume.

#### H. Monetisation — D23

- **FR-036** `→ 010 ADDED`: System MUST offer a one-time purchase tier alongside the subscription.
  [NEEDS CLARIFICATION: the gap analysis's own recommendation is **"model it, don't commit yet"** — a lifetime
  tier caps LTV and complicates AI COGS under FR-035, but "subscription fatigue" is a quoted, sourced churn
  reason from ReciMe's subreddit and the destinations are one-time-purchase apps. Commit to it as a requirement,
  or drop FR-036 and carry D23 as an open business decision?]

### Non-Functional Requirements _(constitution-derived)_

- **NFR-001**: All TypeScript MUST compile with `strict: true`; no `any` outside explicitly marked test
  doubles. (Principle I)
- **NFR-002**: All exported functions and interfaces MUST carry JSDoc. (Principle II)
- **NFR-003**: Every UI element introduced here MUST expose an accessible name queryable via
  `getByRole`/`getByLabel`. (Principles IV & VII)
- **NFR-004**: Colour MUST NOT be the sole conveyor of state — including the per-field import confidence of
  `004-FR-015`, the waterfall tier badge of FR-002, and every state of the dark theme in FR-027. (Principle VII)
- **NFR-005**: Every capability here ships to **web and mobile in the same release**; single-platform delivery
  is a blocking defect per `001-FR-044a`. The browser extension (FR-014) is a desktop-only surface and is
  explicitly **exempt** — see Assumptions.
- **NFR-006**: Every user-facing string introduced here MUST route through the localisation path. No hard-coded
  literals, on any surface, including extension and share-sheet UI.

### Key Entities

- **Capture** — one attempt to turn an external source into a recipe. Holds the source reference, the channel
  it arrived through (chooser, share sheet, extension, migration), the tier that produced each field, and the
  outcome. Generalises what `004` currently models per-channel.
- **Waterfall tier result** — per-tier record of what was attempted, what it yielded, what it cost, and why it
  was insufficient. What makes FR-002's ordering auditable and FR-035's attribution possible.
- **Unquantified quantity** — an ingredient amount that is genuinely absent rather than unknown or zero. The
  representation FR-010 requires end-to-end.
- **Library migration** — one competitor-export import, its per-recipe outcomes, and its restart position.
- **Unit preference** — a per-user display preference; never a property of a recipe.
- **Aisle taxonomy** — a per-user ordered set of grocery categories, defaulting to a system taxonomy.
- **Shared list membership** — who may see and mutate a grocery list. **Shape is blocked on FR-030.**

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: On a fixed, published adversarial corpus of social videos, at least **80%** yield a structurally
  complete recipe with no manual correction — where the corpus deliberately over-weights the four cases ReciMe
  is documented or measured to fail (silent/ASMR with on-screen text, text-overlay-only, comment-thread
  recipes, multi-recipe posts).
- **SC-002**: On the subset of that corpus with **no caption and no speech**, at least **60%** succeed — a
  class in which the competitor's documented pipeline succeeds **0%** of the time, having no visual tier.
- **SC-003**: From tapping share in another app to a confirmed saved draft takes under **20 seconds** at the
  median, with no app switch required of the user.
- **SC-004**: A 2,000-recipe competitor export completes migration with a per-recipe outcome for every entry
  and **zero** silently dropped recipes.
- **SC-005**: An exported library re-imported into an empty account reproduces **100%** of user-visible fields,
  verified field-by-field rather than by spot check.
- **SC-006**: A user completes a three-timer recipe end to end in airplane mode, in dark mode, with units
  converted — **zero** blocking failures.
- **SC-007**: Every capability here is available on web and mobile on the day it ships. Any single-platform
  delivery is counted as a defect, not a phase.
- **SC-008**: Inference spend per successful import stays within the per-import bound of FR-011 and the monthly
  ceiling of ADR-0024, measured over a full month of real traffic — not modelled.
- **SC-009**: Users can state what the app did to their import: for every draft, the tier that produced each
  field is inspectable.

## Assumptions

1. **Delta, not duplicate.** These requirements merge into their owner specs and are struck from here. Until
   they merge, the owner spec remains authoritative for everything this document does not explicitly change.
2. **`015` owns privacy and pricing.** D4a/D4b/D5 are excluded on that basis. If `015` stalls, D4b in particular
   becomes load-bearing here — the legal analysis in session `911043cd` concluded that the entire jurisdictional
   exposure of imported content attaches to _republishing_ it, which D4b removes.
3. **Chrome first for FR-014.** The gap analysis names Chrome; other browsers follow. A browser extension is a
   third distribution surface with its own review process, so `001-FR-044a`'s web+mobile parity rule is read as
   not extending to it (NFR-005).
4. **Export is available on every tier** (FR-018/FR-019). ReciMe paywalls PDF export; portability is being
   positioned as a trust claim against a category that locks users in, so gating it would forfeit the claim.
   This is a monetisation decision that touches `010` — flagged, not silently assumed.
5. **Tiers 3–4 are fallbacks, not defaults** (FR-035). Cost scales with the failure rate of tiers 1–2, not with
   import volume. This is what makes the five-tier design affordable under ADR-0024.
6. **Attribution and provenance are unchanged.** `004-FR-010` (attribution), `004-FR-014a` (per-item
   attestation) and ADR-0023 (curator-declared provenance) apply to every new channel here without amendment.
   Session `911043cd` established that attribution defuses moral-rights claims in exactly the jurisdictions
   where our other defences are weakest — it is load-bearing, not decorative.
7. **Photos are not copied on import.** The one copyright residue that survived that session's analysis:
   images are protected in every regime with no facts defence. New channels here MUST NOT introduce a
   source-photo copy path.
8. **"Structurally complete"** for SC-001/SC-002 means feature `015`'s eligibility floor — title, at least one
   ingredient with a resolved quantity, at least one step, servings, and at least one time field.
9. **Migration files are user-supplied.** They are not fetched or crawled, which is what keeps them clear of
   the EU database right per that session's analysis.

## Dependencies

| Dependency                                           | Status                        | Consequence if unmet                                                                                                                                                                         |
| ---------------------------------------------------- | ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **ADR-0024 cost model extended to import inference** | ⚠️ **Open**                   | The ceiling was sized for the LLM verification gate, not a vision waterfall. §8 open decision 4 says tiers 3–4 need costing **before** commitment. FR-035 is unenforceable until this lands. |
| **D7 / FR-033 platform-managed inference**           | Open — in scope here          | FR-003 and FR-004 cannot ship on BYOK.                                                                                                                                                       |
| **`docs/offline-strategy.md`** (GR-005 AC-005-d)     | ❌ Does not exist             | FR-025 cannot enter implementation; GR-005 forbids inventing an ad-hoc offline approach.                                                                                                     |
| **`004` implementation**                             | ❌ Nothing built              | Every `→ 004` requirement here lands in a spec with no code behind it. This feature does not reduce that; it enlarges it.                                                                    |
| **Feature `015`**                                    | ⏸ Paused                      | D4a/D4b/D5. See Assumption 2.                                                                                                                                                                |
| **D24 — DMCA agent + repeat-infringer policy**       | ❌ Absent for the main corpus | Every delta here increases the volume of third-party-sourced content before safe harbour exists. Cheap, needs no product decision, and should not wait on this feature.                      |
| **`cross-feature-FR-index.md`** (GR-003 AC-003-b)    | Must be updated               | This spec adds cross-feature citations to 001, 004, 005, 007, 008, 010.                                                                                                                      |

## Out of Scope

- Everything in the **Deliberately NOT in scope** table above.
- Native Mac and visionOS apps — the gap analysis explicitly files these under "not a gap".
- A curated editorial recipe library — ReciMe deliberately has none and it has not hurt them.
- Real-time collaborative list editing beyond FR-030's shared visibility. Real-time is an open _category_ gap,
  not a parity item.
- Apple Health / Health Connect sync (D17), cost-aware planning (D19), nutrition-accuracy benchmarking (D16),
  household as a first-class entity (D18) — the Strategic set.

## Status

**Draft — blocked on three clarifications** (FR-024 voice, FR-030 sharing model, FR-036 lifetime tier).

⚠️ **A scope warning that belongs on the record.** This feature spans **six owner specs, three backend
services, and two client apps**. That is a portfolio-sized change-set, and it was chosen deliberately by the
owner over a narrower capture-only scope. Two consequences follow, and neither is a defect:

1. `/speckit-plan` over the whole of it will produce a plan of low resolution. The intended path is to **plan
   and implement in the order §7 of the gap analysis sets** — Track B (portability, dark mode, unit conversion:
   US3 and parts of US4) in parallel with Track A (capture: US1, US2), then the kitchen, then shopping.
2. The single most valuable thing here is **US1 + US2**. If anything is cut, cut from the bottom: US5, then US4,
   then US3. Cutting US1 or US2 forfeits the reason this feature exists.
