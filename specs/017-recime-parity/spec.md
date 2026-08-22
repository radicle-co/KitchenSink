# Feature Specification: ReciMe Parity

**Feature Branch**: `chore/code-quality-enforcement-phase-1-2` (no new branch — standing owner directive)
**Created**: 2026-08-22
**Status**: Draft — clarifications resolved; **one cross-feature conflict flagged for 016**
**Input**: User description: "we want parity with the feature gaps against recime that
911043cd-1ce2-4e5b-8608-50a8524b5b98 review and discovered. We also have the artifact
https://claude.ai/code/artifact/18e8fcdc-0992-4861-8bd8-6d5a3b7baf41"

**Source of truth**: [`docs/competitive/02-gap-analysis-and-strategy.md`](../../docs/competitive/02-gap-analysis-and-strategy.md)
§2 (gap matrix) and §6 (spec deltas) · [`01-recime-teardown.md`](../../docs/competitive/01-recime-teardown.md) ·
briefing artifact _The ReciMe Problem_

> **Numbered 017, not 016.** A concurrent session created
> [`016-legal-compliance-framework`](../016-legal-compliance-framework/spec.md) thirteen minutes earlier and
> holds that number. This feature depends on it heavily — see **Dependencies**.

---

## How to read this spec — it is a DELTA spec

This feature owns **no capability of its own**. It is a change-set against seven existing feature specs, in
the same shape feature `015` uses to amend `001`. Every functional requirement below is tagged:

| Tag                  | Meaning                                                                                 |
| -------------------- | --------------------------------------------------------------------------------------- |
| **`→ 004 ADDED`**    | A new requirement to be merged into feature 004's spec                                  |
| **`→ 008 MODIFIED`** | An existing requirement in feature 008 whose text this delta replaces                   |
| **`→ 008 PROMOTED`** | Behaviour 008's own research and hazard analysis already assume, never written as an FR |
| **`→ 001 RECORDED`** | Behaviour **already shipped** with no FR anywhere; this writes it down                  |

On merge (`/speckit-product-forge-spec-merge`), each requirement lands in its owner spec and is struck from
here. **Nothing in this document is a second authoritative copy of anything** — where an existing FR already
states a rule, this spec cites it rather than restating it.

### Delta register — what is in scope

Seventeen of the gap analysis's twenty-four deltas. Owner rulings 2026-08-22: _every parity delta_; the _full
five-tier_ import waterfall; _pull D18 in_; _promote the voice surface 008 already analysed_; _subscriptions
only for now_.

| Delta   | Change                                                                                    | Owner spec            | Requirements          |
| ------- | ----------------------------------------------------------------------------------------- | --------------------- | --------------------- |
| D1      | Video import — five-tier waterfall                                                        | `004`                 | FR-001…FR-008, FR-011 |
| D8      | Reach Instagram without Meta Graph API approval                                           | `004`                 | FR-009                |
| D20     | Unquantified ingredients ("salt to taste") representable                                  | `004` / `001`         | FR-010                |
| D2      | Share-sheet capture, iOS + Android                                                        | `004`                 | FR-012…FR-013         |
| D3      | Browser extension                                                                         | `004`                 | FR-014…FR-015         |
| D15     | Migration importers (Paprika, AnyList, Copy Me That, ReciMe)                              | `004`                 | FR-016…FR-017         |
| D14     | Recipe export — JSON + PDF                                                                | `001`                 | FR-018…FR-020         |
| D13     | Cook mode beyond four FRs, incl. the voice surface                                        | `008`                 | FR-021…FR-024         |
| D22     | Offline read + cook                                                                       | `008`                 | FR-025                |
| D11     | Unit conversion metric ⇄ imperial                                                         | `001`                 | FR-026                |
| D21     | Dark mode                                                                                 | `001`                 | FR-027                |
| D9      | Aisle grouping lifted from plan into an FR                                                | `007`                 | FR-028…FR-029         |
| **D18** | **Household as a first-class entity** _(owner ruling — pulled in from the Strategic set)_ | `006` / `007` / `010` | FR-030…FR-032, FR-034 |
| D10     | Household grocery-list sharing                                                            | `007`                 | FR-033                |
| D12     | Write FRs for shipped-but-unspecified behaviour                                           | `001` / `008`         | FR-035…FR-036         |
| D7      | Invert BYOK → platform-managed inference **(prerequisite of D1)**                         | `005`                 | FR-037…FR-039         |

### Deliberately NOT in scope

| Delta         | Why excluded                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D4a, D4b, D5  | **Feature `015` owns these** (free-tier privacy un-gating, `imported_public` default, re-pricing). Duplicating them here would create the exact second-authority this spec exists to avoid.                                                                                                                                                                                                       |
| D6            | Payment rails (external US web checkout + IAP). Monetisation mechanics, not a capability gap; coupled to D5, so it moves with `015`/`010`.                                                                                                                                                                                                                                                        |
| **D23**       | **One-time / lifetime purchase tier — deferred by owner ruling 2026-08-22: _"we will only be doing subscriptions for now."_** Recorded rather than dropped: "subscription fatigue" remains a quoted, sourced churn driver on ReciMe's own subreddit, and FR-039's inference spend is precisely what makes a lifetime tier hard to price. Revisit in `010` when there is a cost model, not before. |
| D24           | Registered DMCA agent + repeat-infringer policy. **Now owned by `016-FR-022`/`016-FR-026`**, which mandates exactly one notice-and-action pipeline portfolio-wide.                                                                                                                                                                                                                                |
| D16, D17, D19 | The gap analysis files these under _"Strategic — to win rather than match"_. The owner scoped this feature to **parity**. (D18 was pulled out of this set — see above.)                                                                                                                                                                                                                           |

---

## Clarifications

### Session 2026-08-22

- Q: Retrieval posture when a source platform blocks us or forbids automated access? → A: Match ReciMe's user-directed posture, **and** treat source-platform access as a first-class tracked operational risk (per-platform success monitoring, explicit degradation path, no single platform load-bearing for the success criteria).
- Q: What may a household `member` do versus an `owner`? → A: Members create, edit and check off shared content; **owners alone** invite, remove members, delete the household, **and delete shared content**.
- Q: What page access should the browser extension request? → A: **`activeTab` only** — access granted on user activation, for that tab, for that invocation. No persistent host permissions and no background page reading.
- Q: A capture worker dies mid-waterfall after a billed inference tier — what happens on retry? → A: **Resume from the last recorded tier.** Each tier commits before the next begins; a retry skips completed tiers and never re-pays for inference already billed.
- Q: Does the share sheet confirm acceptance or extraction? → A: **Accept immediately, notify on completion.** One path for every tier; `014-FR-001` becomes a dependency and SC-003 splits into time-to-accept and time-to-draft.
- Q: Is FR-030c's complete-vs-delete split accepted (U-5)? → A: **Accepted.** `complete`/`archive` is a member action; `delete` is owner-only.
- Q: Does that split apply to meal plans as well as grocery lists? → A: **Yes — one truth table** across grocery lists, meal plans and the aisle taxonomy. No per-resource exceptions.
- Q: The "sole owner cannot leave" invariant is unenforceable against GDPR erasure — what happens? → A: **Ownership auto-transfers to the longest-tenured active member.** Erasure is never blocked and no reserved action becomes unreachable.

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
   that the source cannot be read and offers the screenshot/paste path — rather than failing silently.
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
entirely rather than waiting on Meta. It is also the **legally preferred** shape: `016` records that
user-supplied bytes are a stronger position than server-side fetching.

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
steps, navigation, timers, wake-lock — despite its own charter describing a _"hands-free cooking interface"_.
ReciMe paywalls cook mode and unit conversion, has no dark mode at all, and its offline access is Plus-only.

**Independent Test**: Complete a multi-timer recipe end to end, hands-free, in dark mode, in airplane mode,
with the recipe's units converted from metric to imperial.

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
7. **Given** the user's hands are occupied, **When** they speak a navigation command, **Then** the step
   advances — and per `008`'s HAZ-005 mitigation, a misrecognised command never mutates state without the
   confirmation `ARCH-005` requires, with tap/gesture remaining the authoritative path.
8. **Given** a timer completes, **When** the user is not looking at the device, **Then** spoken output
   announces it — and per HAZ-021, a visual completion cue is always present regardless of audio success.

---

### User Story 5 - Plan, shop, and cook as a household (Priority: P3)

Two people in one home share a meal plan and the grocery list it generates. Either can add to the plan; either
can check items off in the shop; the subscription covers both.

**Why this priority**: Sharing is where **nobody wins** — ReciMe's cookbook invite ships broken, delivering an
empty cookbook, and there is no household account model anywhere in the category. Our own position is no
better: `007`'s US-009 has no FRs at all and `006-FR-029` scopes every read and write to a single owner, with
`006` stating outright _"there is no sharing model in this feature."_ The owner ruled to pull **D18** in rather
than bolt per-list sharing onto a single-owner model, because §8 open decision 5 identifies this as a
one-way-door data-model choice — and retrofitting it later is precisely what every competitor is currently
doing badly.

**Independent Test**: Create a household of two, share a plan and its generated list, and confirm both members
can act on both, that seats are enforced against the subscription, and that removing a member leaves the
household's content intact.

**Acceptance Scenarios**:

1. **Given** a user with a subscription, **When** they invite a second person to their household, **Then**
   that person on accepting can see and edit the household's meal plans and grocery lists.
2. **Given** a grocery list generated from a shared plan, **When** either member checks off an item, **Then**
   the other sees it.
3. **Given** the default aisle categories do not match the household's store, **When** a member customises
   them, **Then** the grouping follows their categories and persists.
4. **Given** a household at its seat limit, **When** another invite is attempted, **Then** it is refused with
   a clear explanation rather than silently failing.
5. **Given** a member is removed or leaves, **When** the household is next opened, **Then** the household's
   plans and lists remain intact and the departing member retains their own personal recipes.
6. **Given** a household member's subscription lapses, **When** they open a shared plan, **Then** behaviour
   follows `010-FR-043`'s retention rule rather than destroying shared content.

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
- **The capture is accepted but the user has notifications denied.** FR-013a's notification is the only signal
  that a draft is ready. With it suppressed the draft must still be discoverable in-app — acceptance must never
  depend on a channel the user can switch off.
- **The extension is activated on a page with no recipe.** Activation-scoped access means we only learn this
  after the click; the extension must report "no recipe here" rather than appearing broken — the same
  `no_recipe` vs `unreadable` distinction FR-008 draws.
- **A platform stops working entirely.** One source platform blocking us, changing its surface, or going down
  must degrade that platform's imports only — never the feature. FR-001b's monitoring is what makes this
  visible rather than a slow silent decline in success rate.
- **The source is deleted between import and retry.** A retried import of a dead URL must fail cleanly without
  destroying the draft already extracted — and per FR-011a it resumes rather than restarting, so tiers already
  paid for are not re-attempted against a source that no longer exists.
- **A tier commits, then the settle write fails.** ADR-0024 forbids retrying settle. The reservation stands and
  is reconciled by the period's own accounting; the capture still resumes from the committed tier.
- **A migration file is 2,000 recipes and the connection drops at 1,400.** Resumable or restartable without
  duplicating the 1,400.
- **A migration file contains recipes the user did not author.** Provenance classification (`004-FR-014a`,
  ADR-0023) and `016-FR-013`/`016-FR-014` apply to migrated recipes exactly as to any other import — bulk
  migration is not a side door around provenance or attestation.
- **Unit conversion of an unquantified ingredient.** "Salt to taste" converts to "salt to taste" — see FR-010.
- **Conflicting units within one ingredient line** ("1 lb (450 g) beef"). Convert once; do not double-convert.
- **A member finishes the shop and wants the list gone.** FR-030c splits _complete/archive_ (any member) from
  _delete_ (owner only). If that split is rejected, FR-030b puts an owner in the path of a routine action.
- **The sole owner is erased, removed, or leaves.** Resolved by FR-032a — ownership transfers to the
  longest-tenured active member. Erasure is never blocked; the "sole owner cannot leave" invariant governs the
  _voluntary_ case only and is deliberately unenforceable against a legal erasure request.
- **The sole owner's subscription lapses but members remain.** Distinct from departure: the owner is still
  present, so no transfer fires. Content is retained per `010-FR-043`; what a lapsed household may still _do_
  is `010`'s to answer, not this feature's.
- **Two members joined at the same instant and the sole owner is erased.** FR-032a must be deterministic —
  ties resolve by a stable secondary key, never by whichever row the query returns first.
- **Two household members edit the same plan entry at once.** `006-FR-032`'s idempotency key was written for a
  single owner; concurrent editing by distinct members is a new condition it does not cover.
- **A household member goes offline in the shop and both check items off.** Governed by GR-005; this spec must
  declare the reconciliation rule before implementation, not invent one during it.
- **A voice command is heard while the user is talking to someone else in the room.** HAZ-005's mitigation
  requires confirmation before state mutation; ambient speech must not advance steps.
- **Spoken output fires while a household member is on a call.** Audio must be suppressible without disabling
  the visual cue that HAZ-021 requires to always be present.
- **Dark mode and the shipped difficulty chip.** A known live defect renders the selected difficulty chip
  white-on-white; a dark theme must not add a second instance of that class of bug.

---

## Requirements _(mandatory)_

### Functional Requirements

#### A. Video capture — D1, D8, D20

- **FR-001** `→ 004 ADDED`: System MUST import recipes from public social video posts on TikTok, Instagram
  Reels, YouTube (Shorts and long-form), and Facebook.
- **FR-001a** `→ 004 ADDED`: Retrieval MUST be **user-directed**: one item, on one explicit user action. System
  MUST NOT crawl, batch, pre-fetch, or speculatively retrieve, and MUST NOT rotate addresses, spoof a
  user-agent, or otherwise evade a platform control. Where a platform blocks us or its terms forbid automated
  access, the capture resolves `unreadable` (FR-008) and offers the screenshot/paste path. _(This is ReciMe's
  own stated position — "does not use bots or automated tools" — so it is the floor, not caution. Our exposure
  is strictly worse than theirs at equal posture, because we operate a public library and they do not. A green
  `robots.txt` is not terms-of-use clearance.)_
- **FR-001b** `→ 004 ADDED`: System MUST monitor extraction success **per source platform**, MUST surface a
  defined degradation path when one platform stops working, and MUST NOT let any single platform be
  load-bearing for the feature's success criteria. _(ReciMe took a staff-acknowledged import outage across
  Instagram, TikTok and Facebook Reels in 2026 while running the conservative posture; platform access is an
  operational risk to be measured, not an assumption.)_
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
- **FR-010** `→ 004 MODIFIED`: Every **new** surface introduced by this feature — the waterfall (FR-002), unit
  conversion (FR-026), and export round-trip (FR-020) — MUST preserve an unstated quantity as unstated, never
  coercing it to a number, zero, or one. ⚠️ **Corrected by research R-01: the representation already ships.**
  `ABSENT_QUANTITY` in `recipe-core/src/ingredientQuantity.ts` is "the one representation of 'the source stated
  no amount' (R40, R41)" and already reaches parse, persistence, scaling and the form model. D20's claim that
  "salt to taste" is unrepresentable is **false against the shipped code**; the obligation here is not to break
  it. This matters most for D1 because video sources state quantities far less often than blog sources do.
- **FR-011** `→ 004 ADDED`: Frame sampling, transcription, and visual analysis MUST each be bounded per import,
  and the bound MUST be stated in the product. **No sampled frame, decoded audio, or derived rendition may be
  persisted to operator-controlled storage** — analysis is transient and the artefacts are discarded with the
  extraction that produced them. This satisfies `016-FR-027`, which prohibits _persisting_ a copy; it does not
  by itself answer whether transient decode is a reproduction (see Dependencies).

#### B. Capture surfaces — D2, D3

- **FR-011a** `→ 004 ADDED`: Each tier's result MUST be committed before the next tier begins, and a retried
  capture MUST resume from the last recorded tier rather than re-running the waterfall. A tier already billed
  MUST NOT be paid for twice. _(ADR-0024's settle is deliberately never retried — `reserved + $delta` is not
  idempotent — and its own reasoning is that crashes correlate with the runaway the ceiling exists to stop, so
  a crash storm must not become a spend storm.)_
- **FR-011b** `→ 004 ADDED`: A resumed capture MUST NOT consume the daily import quota (`004-FR-022`) a second
  time. Quota is charged per **user intent**, not per worker attempt.
- **FR-012** `→ 004 ADDED`: System MUST register as a share target on iOS and Android, accepting URLs, text,
  and images from any app's share sheet.
- **FR-013** `→ 004 ADDED`: Share-sheet capture MUST **durably accept** the capture and confirm acceptance
  without requiring the user to open the app first. Acceptance is confirmed as soon as the capture is
  crash-safe — it does **not** wait for extraction. _(An iOS share extension runs under a hard memory and
  wall-clock budget, and tier 4 can exceed it; waiting would make the OS killing the extension a routine
  outcome.)_
- **FR-013a** `→ 004 ADDED`: When extraction completes, System MUST notify the user that the draft is ready,
  via `014-FR-001`'s publish endpoint addressed to `recipient.kind = "user"`. A capture that resolves
  `no_recipe` or `unreadable` MUST notify too — silence is indistinguishable from a lost capture.
- **FR-014** `→ 004 ADDED`: System MUST provide a desktop browser extension that captures the current page as a
  recipe in one action. It MUST request **activation-scoped page access only** (`activeTab`): the page is
  readable only after the user activates the extension, only for the active tab, and only for that
  invocation. ⛔ It MUST NOT request persistent host permissions, MUST NOT read pages in the background, and
  MUST NOT pre-scan pages the user has not activated it on. _(The browser-level expression of FR-001a. Widening
  this later triggers store re-review and can suspend the extension for existing users pending re-consent, so
  it is treated as an expensive-to-reverse boundary.)_
- **FR-015** `→ 004 ADDED`: Every capture surface — chooser, share sheet, extension, migration — MUST route
  through **one** import pipeline, so provenance, confidence, quota (`004-FR-022`), attestation
  (`016-FR-014`), and policy behave identically regardless of entry point. Each surface MUST record its
  channel classification per `016-FR-028` — **video import is `operator-performed retrieval`**, which is
  the disfavoured side of `016-FR-029` and cannot be otherwise, since a user cannot hand us the bytes of a
  hosted video.

#### C. Portability — D15, D14

- **FR-016** `→ 004 ADDED`: System MUST import recipe libraries exported from Paprika, AnyList, Copy Me That,
  and ReciMe.
- **FR-017** `→ 004 ADDED`: A library migration MUST report a per-recipe outcome, MUST retain successfully
  imported recipes when others fail, and MUST be restartable without duplicating already-imported recipes.
- **FR-018** `→ 001 MODIFIED`: Users MUST be able to export their entire recipe library as a lossless
  machine-readable file **from a product surface**, not only as a privacy-request endpoint. ⚠️ **Corrected by
  research R-02:** `GET /api/v1/account/export` already ships a zod-contracted GDPR Art. 15/20 export covering
  recipes, collections, memberships, photos, ratings, versions and author handles. The work is surfacing and
  re-using it — including revisiting its deliberately tightest-in-service rate limit for a routine action —
  not building a serializer.
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
- **FR-024** `→ 008 PROMOTED`: Cooking Mode MUST support hands-free operation — spoken commands for step
  navigation, and spoken output for step content and timer completion. Voice is **additive, never mandatory**:
  the tap/gesture path stays authoritative (`008` REQ-010), intent mapping is explicit with confirmation before
  any state mutation (`008` ARCH-005, mitigating **HAZ-005**), and a visual completion cue is always present
  irrespective of audio (mitigating **HAZ-021**). This promotes to a requirement what `008`'s charter
  ("hands-free cooking interface"), its `research/ux-patterns.md` §5, and its hazard matrix already assume, and
  it satisfies **`013-FR-020`**, which formally delegates hands-free cook-along to 008.

- **FR-025** `→ 008 ADDED`: Recipe detail and Cooking Mode MUST remain fully usable with no connectivity once
  the recipe has been opened online — **excepting referenced source photographs**, which per `016-FR-027e` are
  unavailable offline and MUST render the defined placeholder rather than being cached. A user-supplied
  replacement image (`016-FR-027b`) is user content and IS available offline. Per **GR-005**, this spec MUST declare offline scope, persistence layer,
  sync strategy, and conflict handling before implementation begins; `008`'s `CookingSession` device storage is
  the named reference implementation.
- **FR-026** `→ 001 ADDED`: Users MUST be able to view any recipe's quantities in metric or imperial via a
  persisted preference. Conversion MUST be display-only — the stored recipe is never rewritten — and MUST leave
  unquantified ingredients (FR-010) untouched.
- **FR-027** `→ 001 ADDED`: Web and mobile MUST render a dark theme, defaulting to the OS setting with a manual
  override, using design tokens rather than per-component colour. Both themes are subject to NFR-004.

#### E. Shopping and the household — D9, D18, D10

- **FR-028** `→ 007 ADDED`: A grocery list MUST group items by aisle category. _(Today this exists only in
  `007`'s plan; this lifts it to a requirement.)_
- **FR-029** `→ 007 ADDED`: Users MUST be able to customise aisle categories and their order, persisted per
  household. _(ReciMe's categories are fixed — a named weakness.)_
- **FR-030** `→ 006 ADDED, → 007 ADDED`: System MUST model a **household** as a first-class entity with named
  members, and MUST make it the ownership boundary for meal plans and grocery lists. Every account belongs to
  exactly one household, created implicitly at signup with that user as its only member, so that a solo user is
  a household of one and no code path needs a "no household" branch.
- **FR-030a** `→ 006 ADDED, → 007 ADDED`: Every **active member** MUST be able to create, edit and check off
  the household's meal plans, grocery lists and aisle taxonomy. Content capability is equal across roles —
  that equality is the point of a household.
- **FR-030b** `→ 006 ADDED, → 007 ADDED, → 010 ADDED`: The following are reserved to an **owner**: inviting a
  member, removing a member, deleting the household, and **deleting shared content** (a meal plan, a grocery
  list, or the aisle taxonomy). A member attempting a reserved action receives a refusal that names the
  restriction. _(Membership control follows the seat allowance the subscriber pays for, so a member can
  neither spend the payer's seats nor remove the payer; reserving deletion makes shared content
  accident-resistant.)_
- **FR-030c** `→ 006 ADDED, → 007 ADDED` _(confirmed by owner, 2026-08-22)_: Completing or archiving shared
  content is **not** a deletion and MUST remain available to every active member. This applies uniformly to
  **grocery lists, meal plans and the aisle taxonomy** — there are no per-resource exceptions, so the policy
  stays a single truth table. Without this split the routine end-of-shop action would require an owner, putting
  FR-030b directly in the path of the one task US5 exists to serve.
- **FR-032a** `→ 006 ADDED, → 007 ADDED`: When the **sole owner** of a household departs — by removal, by
  leaving, or by **account erasure** — ownership MUST transfer automatically to the longest-tenured active
  member, deterministically and with no user interaction. ⛔ Erasure MUST NOT be blocked, delayed, or made
  conditional on a nomination: a right-to-erasure request is a legal statement, and the
  "sole owner cannot leave" invariant is **unenforceable against it**. Where the departing owner is the only
  member, the household is removed with them.
- **FR-032b** `→ 006 ADDED`: The transfer of FR-032a MUST be performed **before** the departing owner's
  membership row is removed, and MUST be idempotent under redelivery — following the ordering discipline of the
  existing account-erasure worker, whose stated design failure is _a false success_, not a crash. An
  interrupted erasure must leave the transfer still owed, never silently skipped.
- **FR-032c** `→ 006 ADDED`: A household's display name MUST NOT retain an erased member's identity. Where the
  name was derived from the departing owner's handle, it MUST be re-derived or neutralised as part of the same
  erasure — otherwise erasure pseudonymises the recipes and leaks the handle through the household.
- **FR-031** `→ 006 MODIFIED`: Meal plan reads and writes MUST be scoped to the owning **household** rather
  than the single authenticated owner. _(Replaces `006-FR-029`'s owner-scoping and supersedes `006`'s stated
  position that "there is no sharing model in this feature.")_
- **FR-032** `→ 006 ADDED, → 007 ADDED`: Membership MUST support invite, accept, decline, remove, and leave.
  Content created within a household MUST remain with the household when a member departs; a departing member
  MUST retain their own personal recipes.
- **FR-033** `→ 007 ADDED`: Every member of a household MUST be able to view and check off items on that
  household's grocery lists, and a check-off by one member MUST become visible to the others.
- **FR-034** `→ 010 ADDED`: A subscription MUST carry a **seat count** bounding household membership. Exceeding
  it MUST be refused with a clear explanation. Lapse behaviour follows `010-FR-043`'s existing retention rule —
  shared content is retained, not destroyed.

#### F. Shipped behaviour with no requirement — D12

- **FR-035** `→ 001 RECORDED`: Users MUST be able to scale a recipe's servings, with quantities scaled
  proportionally. _Already shipped_ (`ServingScaleControl`, `servingScale.ts`) with no FR in any spec. Interacts
  with FR-010 and FR-026.
- **FR-036** `→ 008 RECORDED`: Users MUST be able to check off ingredients during cooking, persisted for the
  session. _Already shipped_ (`cookingProgress.ts`, `useCookingProgress.ts`) with no FR in any spec.

#### G. Inference — D7, prerequisite of D1

- **FR-037** `→ 005 MODIFIED`: Platform-managed inference MUST be the default for every AI-assisted capability.
  _(Replaces `005-FR-015`/`005-FR-016`'s BYOK-first model.)_ **This is a hard prerequisite of FR-003 and
  FR-004**: a waterfall whose two differentiating tiers require the user to supply their own API key is not a
  consumer capability.
- **FR-038** `→ 005 ADDED`: Users MAY optionally supply their own provider credentials as an escape hatch.
  BYOK MUST NOT be required for any advertised capability.
- **FR-039** `→ 005 ADDED`: Platform-managed inference spend MUST be attributable per import channel and per
  waterfall tier, and MUST be bounded by the reserve-then-settle ceiling of **ADR-0024**. Tiers 3 and 4 run
  **only** on failure of the cheaper tiers above them, which is what keeps their cost proportional to the
  failure rate rather than to import volume.

### Non-Functional Requirements _(constitution-derived)_

- **NFR-001**: All TypeScript MUST compile with `strict: true`; no `any` outside explicitly marked test
  doubles. (Principle I)
- **NFR-002**: All exported functions and interfaces MUST carry JSDoc. (Principle II)
- **NFR-003**: Every UI element introduced here MUST expose an accessible name queryable via
  `getByRole`/`getByLabel`. (Principles IV & VII)
- **NFR-004**: Colour MUST NOT be the sole conveyor of state — including the per-field import confidence of
  `004-FR-015`, the waterfall tier badge of FR-002, household member attribution, and every state of the dark
  theme in FR-027. (Principle VII)
- **NFR-005**: Every capability here ships to **web and mobile in the same release**; single-platform delivery
  is a blocking defect per `001-FR-044a`. The browser extension (FR-014) is a desktop-only surface and is
  explicitly **exempt** — see Assumptions.
- **NFR-006**: Every user-facing string introduced here MUST route through the localisation path. No hard-coded
  literals, on any surface, including extension, share-sheet, and spoken output.

### Key Entities

- **Capture** — one attempt to turn an external source into a recipe. Holds the source reference, the channel
  it arrived through (chooser, share sheet, extension, migration), the tier that produced each field, and the
  outcome. Generalises what `004` currently models per-channel.
- **Waterfall tier result** — per-tier record of what was attempted, what it yielded, what it cost, and why it
  was insufficient. What makes FR-002's ordering auditable and FR-039's attribution possible.
- **Unquantified quantity** — an ingredient amount that is genuinely absent rather than unknown or zero. The
  representation FR-010 requires end-to-end.
- **Library migration** — one competitor-export import, its per-recipe outcomes, and its restart position.
- **Unit preference** — a per-user display preference; never a property of a recipe.
- **Household** — the ownership boundary for meal plans and grocery lists, with named members and a seat
  allowance drawn from the subscription. Every account belongs to exactly one; a solo user is a household of
  one.
- **Household membership** — the join between an account and its household, carrying invite state and the
  lifecycle of FR-032.
- **Aisle taxonomy** — a per-household ordered set of grocery categories, defaulting to a system taxonomy.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: On a fixed, published adversarial corpus of social videos, at least **80%** yield a structurally
  complete recipe with no manual correction — where the corpus deliberately over-weights the four cases ReciMe
  is documented or measured to fail (silent/ASMR with on-screen text, text-overlay-only, comment-thread
  recipes, multi-recipe posts).
- **SC-002**: On the subset of that corpus with **no caption and no speech**, at least **60%** succeed — a
  class in which the competitor's documented pipeline succeeds **0%** of the time, having no visual tier.
- **SC-003a**: From tapping share in another app to **confirmed acceptance** takes under **2 seconds** at the
  median, with no app switch required — and this holds regardless of which tier ultimately resolves it.
- **SC-003b**: From tapping share to the **draft being ready** takes under **20 seconds** at the median for
  captures resolved by tiers 1–2, which is the common case. Tiers 3–4 are notified on completion rather than
  waited on.
- **SC-004**: A 2,000-recipe competitor export completes migration with a per-recipe outcome for every entry
  and **zero** silently dropped recipes.
- **SC-005**: An exported library re-imported into an empty account reproduces **100%** of user-visible fields,
  verified field-by-field rather than by spot check.
- **SC-006**: A user completes a three-timer recipe end to end hands-free, in airplane mode, in dark mode, with
  units converted — **zero** blocking failures.
- **SC-007**: Every capability here is available on web and mobile on the day it ships. Any single-platform
  delivery is counted as a defect, not a phase.
- **SC-008**: Inference spend per successful import stays within the per-import bound of FR-011 and the monthly
  ceiling of ADR-0024, measured over a full month of real traffic — not modelled.
- **SC-009**: For every draft, the tier that produced each field is inspectable by the user.
- **SC-012**: Extraction success is reported **per source platform**, and no single platform contributes more
  than **50%** of the corpus behind SC-001 — so a platform-level block degrades the number visibly rather than
  invalidating the claim.
- **SC-010**: A two-person household shares a plan and its list with **zero** cases of one member's action
  being invisible to the other, and **zero** cases of a departing member's exit destroying household content.
- **SC-011**: Voice navigation never mutates cooking state on a misrecognised or ambient utterance across a
  scripted noise-and-crosstalk test set.

## Assumptions

1. **Delta, not duplicate.** These requirements merge into their owner specs and are struck from here. Until
   they merge, the owner spec remains authoritative for everything this document does not explicitly change.
2. **`015` owns privacy and pricing; `016` owns the legal layer.** D4a/D4b/D5 sit with 015. The content licence,
   the single notice-and-action pipeline, the rights representation, and the no-photo-copy ruling sit with 016
   and are **cited, never restated**, here.
3. **Chrome first for FR-014.** The gap analysis names Chrome; other browsers follow. A browser extension is a
   third distribution surface with its own review process, so `001-FR-044a`'s web+mobile parity rule is read as
   not extending to it (NFR-005).
4. **Export is available on every tier** (FR-018/FR-019). ReciMe paywalls PDF export; portability is being
   positioned as a trust claim against a category that locks users in, so gating it would forfeit the claim.
   This is a monetisation decision that touches `010` — flagged, not silently assumed.
5. **Tiers 3–4 are fallbacks, not defaults** (FR-039). Cost scales with the failure rate of tiers 1–2, not with
   import volume. This is what makes the five-tier design affordable under ADR-0024.
6. **Attribution and provenance are unchanged.** `004-FR-010` (attribution), `004-FR-014a` (per-item
   attestation) and ADR-0023 (curator-declared provenance) apply to every new channel here without amendment.
   Session `911043cd` established that attribution defuses moral-rights claims in exactly the jurisdictions
   where our other defences are weakest — it is load-bearing, not decorative.
7. **Migration files are user-supplied.** They are not fetched or crawled, which is what keeps them clear of
   the EU database right per that session's analysis.
8. **A household is created implicitly at signup**, so there is no "user without a household" state and no
   migration flag day. This is the cheap seam CLAUDE.md's YAGNI carve-out calls for on an expensive-to-reverse
   boundary.
9. **Subscriptions only.** Per the owner ruling of 2026-08-22, FR-034's seats are a subscription attribute.
   No one-time or lifetime purchase shape is designed for or designed against here.

## Dependencies

| Dependency                                              | Status                                        | Consequence if unmet                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------------------------------- | --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ⚠️ **Is transient frame decode a reproduction?**        | **Open — narrow question for `016`**          | _Corrected from an earlier, overstated flag._ `016-FR-027` prohibits **persisting** a copy to our storage, and `016-FR-027c` prohibits **derived renditions of a referenced photograph** for display — tiers 3–4 do neither, and FR-011 now states so explicitly. What remains genuinely open is narrower: decoding frames of a third-party video to _extract text and structure_, then discarding them, is closer to text-and-data-mining than to serving a thumbnail. Session `911043cd` already raised **DSM Art. 4** TDM and the machine-readable reservation against `004-FR-023`'s wildcard-`Disallow` carve-out; this is the same question on video. **Not a blocker to planning — a question to answer before tiers 3–4 ship.** |
| ⚠️ **`016-FR-029` channel preference vs video import**  | **Accepted, recorded**                        | `016-FR-029` requires preferring _user-supplied bytes_ where a channel choice exists. Video import has no such alternative — a user cannot hand us the bytes of a hosted video — so tiers 1–5 are permanently `operator-performed retrieval` under `016-FR-028`. This weakens the §512(c) "storage at the direction of a user" posture that `016`'s US-5 rests on, for this channel specifically. It is a consequence of the owner's five-tier ruling, not a defect, but it belongs on the record.                                                                                                                                                                                                                                      |
| **`016-FR-027e` offline photographs vs FR-025**         | **Resolved in FR-025**                        | `016` names this itself as "a known interaction with offline cook mode". Offline cook shows the placeholder; caching the referenced image to satisfy FR-025 is explicitly forbidden.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| **ADR-0024 cost model extended to import inference**    | ⚠️ Open                                       | The ceiling was sized for the LLM verification gate, not a vision waterfall. §8 open decision 4 says tiers 3–4 need costing **before** commitment. FR-039 is unenforceable until this lands.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| **D7 / FR-037 platform-managed inference**              | Open — in scope here                          | FR-003 and FR-004 cannot ship on BYOK.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| **`014-FR-001` notification publish**                   | Specified, not built                          | FR-013a needs it to tell the user a draft is ready. Without it, an accepted capture is silent and indistinguishable from a lost one. Note `014` is sequenced _after_ everything in the gap analysis's §7 ordering.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| **`016-FR-010`…`FR-014` content licence + attestation** | Specified; **A-1…A-8 amendments NOT applied** | Every capture surface added here increases the volume of content displayed under a licence that does not yet exist in the terms.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| **`016-FR-022`/`FR-026` notice-and-action**             | Specified, not built                          | Formerly tracked here as D24. Every delta here increases third-party-sourced content volume before safe harbour exists.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| **`docs/offline-strategy.md`** (GR-005 AC-005-d)        | ❌ Does not exist                             | FR-025 cannot enter implementation; GR-005 forbids inventing an ad-hoc offline approach.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| **`004` implementation**                                | ❌ Nothing built                              | Every `→ 004` requirement here lands in a spec with no code behind it. This feature does not reduce that; it enlarges it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| **`006-FR-032` idempotency under multi-member editing** | Written for a single owner                    | FR-031 introduces concurrent editors that `006`'s idempotency key was not designed against.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| **Feature `015`**                                       | ⏸ Paused                                      | D4a/D4b/D5. See Assumption 2.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **D23 one-time / lifetime tier**                        | Deferred — subscriptions only                 | Revisit in `010` once FR-039 yields a real AI cost model.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| **`cross-feature-FR-index.md`** (GR-003 AC-003-b)       | Must be updated                               | This spec adds cross-feature citations to 001, 004, 005, 006, 007, 008, 010, 013, and 016.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |

## Out of Scope

- Everything in the **Deliberately NOT in scope** table above.
- Native Mac and visionOS apps — the gap analysis explicitly files these under "not a gap".
- A curated editorial recipe library — ReciMe deliberately has none and it has not hurt them.
- Real-time collaborative editing beyond FR-033's shared visibility. Live cursor-level collaboration is an open
  _category_ gap, not a parity item.
- Apple Health / Health Connect sync (D17), cost-aware planning (D19), and nutrition-accuracy benchmarking
  (D16) — the remainder of the Strategic set.

## Status

**Draft — all three clarifications resolved. Ready for `/speckit-plan`.**

An earlier draft of this spec flagged a blocking conflict with `016` over frame sampling. Reading `016-FR-027`
and `016-FR-027c` closely, that was **overstated**: `016` prohibits _persisting_ a copy and _rendering derived
renditions of a referenced photograph_, and tiers 3–4 do neither. FR-011 and FR-025 now state the alignment
explicitly. What survives is one narrow question (is transient decode-for-extraction a reproduction?) and one
accepted consequence (video import is permanently operator-performed retrieval under `016-FR-029`). Neither
blocks planning; the first must be answered before tiers 3–4 ship.

⚠️ **A scope warning that belongs on the record.** This feature spans **seven owner specs, three backend
services, and two client apps**, and pulling D18 in adds a first-class data-model entity. That is a
portfolio-sized change-set, chosen deliberately by the owner over a narrower capture-only scope. Two
consequences follow, and neither is a defect:

1. `/speckit-plan` over the whole of it will produce a plan of low resolution. The intended path is to **plan
   and implement in the order §7 of the gap analysis sets** — Track B (portability, dark mode, unit conversion:
   US3 and parts of US4) in parallel with Track A (capture: US1, US2), then the kitchen, then the household.
2. The single most valuable thing here is **US1 + US2**. If anything is cut, cut from the bottom: US5, then US4,
   then US3. Cutting US1 or US2 forfeits the reason this feature exists.

⚠️ **D18 is the one-way door in this spec.** FR-030's household boundary is expensive to reverse and touches
`006`, `007` and `010` at once. It should be designed before anything else here is built, even though US5 is
the _lowest_-priority story — priority orders delivery, not data-model sequencing.
