# Feature Specification: Public Versions of Imported Recipes (import-time rewrite)

**Feature Branch**: single-branch directive (the spec directory is
`specs/003B-public-rewrite`. The owner asked for "003A", but `specs/003A-signed-out-reading` already exists, so this
feature takes 003B. It is not part of `003-usda-food-data` or `003A`.)
**Created**: 2026-11-15
**Status**: Draft. Planned, not built. Each clarification is ruled where marked, and the rest are assumed and wait for the owner (see Clarifications,
C-1 to C-23). It sits behind one per-market switch (FR-090).
**Input**: Owner rulings, 2026-11-15. A cook's private copy of an imported recipe keeps the site's wording. The import
process writes new steps for every public-facing recipe from a source that Commise cannot show as it is. The cook
chooses Private, Public or Both at import. A paid site's recipe can go public only as a page Commise writes in full, under the paid-site rules. Facts cards are
retired. A dead end offers "Upgrade to Pro".

## How this spec relates to others

This feature adds one thing to the import pipeline: a **public version** of an imported recipe, whose steps Commise
writes from the recipe's facts. Everything else it needs is owned elsewhere, and this spec cites it as `NNN-FR-xxx`
rather than restating it.

- **[004](../004-recipe-importing/spec.md)** owns the import pipeline: one pipeline, one allowance, the draft-and-confirm
  model, the statement, the paste fallback (`004-FR-056` to `FR-063`), and the paid-site list (`004-FR-014`). 003B adds
  a step at the end of an import: the visibility choice. If the cook asks for it, the public version follows.
- **[027](../027-rewritten-steps/spec.md)** (Flow Steps, planned) owns the **step-writing engine**: the facts sheet,
  the writer, the two-way fact check and the wording check (`027-FR-035` to `FR-046`). 003B uses that engine and does
  not write a second one. Whichever of 027 and 003B ships first builds it (`027-FR-045`). The split is in the plan
  (§Engine ownership).
- **[020](../020-content-source-check/spec.md)** and ADR-0074 own the content check and the hold in the read rule. A
  public version goes public through that one hold, like any recipe.
- **[ADR-0093](../../docs/architecture/decisions/0093-imported-recipes-go-public-only-as-a-commise-written-version.md)**
  ("imported recipes go public only as a Commise-written version") records the owner's 2026-11-15 rulings, and its sweep
  amended 004, 016, 020, 021 and the paste design spec. 003B does not repeat or restate them. It cites ADR-0093.
- **[016](../016-legal-compliance-framework/spec.md)** owns rights labels, licences and the report flow.
- **[021](../021-public-discovery-and-sharing/spec.md)** owns what a public page shows signed out and how it is indexed.
- **[010](../010-subscriptions/spec.md)** owns plans, prices and the subscription page. 003B needs one rule amended for one
  screen (FR-074).
- **[docs/design/pasteImport/spec.md](../../docs/design/pasteImport/spec.md)** owns the paste screens. 003B replaces
  its D8 visibility line.

Where 003B and an owner spec disagree, the owner spec wins. The exceptions are the owner's 2026-11-15 rulings, which
ADR-0093 records, and the owed amendments in "Amendments".

## Dependencies

| Spec or decision                                   | Relationship                                                                                                                               |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| 004 import pipeline (`004-FR-047`, `FR-061`)       | **Required.** The choice is a step of the one pipeline. No second save path.                                                               |
| 027 step-writing engine (`027-FR-035` to `FR-046`) | **Required, not built.** 003B cannot generate anything until the engine's pure core and its Bedrock adapter exist.                         |
| Source evidence (ADR-0089 §6)                      | **Required, not merged.** ADR-0089 §6 sets the append-only evidence record. Its table is not built yet. 003B extends that record (FR-080). |
| 020 hold and check (ADR-0074, `020-FR-057`)        | **Required, not built.** Until it ships, every public version reads as held ("Checking"), which is the safe direction.                     |
| 016 labels and licence (`016-FR-015c`)             | **Required, partly built.** The new label value (FR-061) and the licence value (FR-062) are one-way doors and need an ADR.                 |
| ADR-0024 / DD21 spend ceiling                      | **Governs.** A new call site, reserve-then-settle, fail closed.                                                                            |
| ADR-0073 private slots                             | **Governs.** A private copy uses a slot, with or without a public version. A public version uses none.                                     |
| 010 subscriptions (`010-FR-042a` to `FR-042j`)     | **Required for the Pro panel only.** With 010's switch off, the dead end has no paid-plan content (FR-075).                                |

## Terms

- **Private copy**: the recipe as imported, with the source's wording. Only its owner sees it.
- **Public version**: a separate recipe, owned by the cook, whose steps Commise wrote from the facts of the private
  copy. It carries the credit line (FR-060). It is what other people see.
- **Third-party source**: a source the import detects (from structured data, a link in the paste, a file's
  `source_url`, or the cook's statement) that is not the cook's own confirmed site.
- **Open source**: a source on the allowlist of FR-010. Its recipe can be public as it is, with its credit.
- **Paid source**: a source FR-012 classes as paid. Public only as a public version, under FR-017.
- **Signature recipe**: a recipe a paid publisher is known for. Its title names the publisher or its brand, or it is on
  the publisher's signature list, kept as data (FR-017).
- **Detected**: found by code in what the cook gave us. A detected source is a fact for this feature's rules, while it
  stays only a suggestion for the cook's statement (`004-FR-060`).

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Share a public version of a recipe from another site (Priority: P1)

A cook pastes a recipe from a food blog. Commise reads it, matches the ingredients and asks "Just for you, or for
everyone?". The cook picks "For everyone". Commise writes new steps from the recipe's facts, shows them, and the cook
reads them beside their own copy and publishes.

**Why this priority**: It is the feature. Without it a recipe from another site can only be private.

**Independent Test**: Paste a blog page with JSON-LD. Choose "For everyone". The review step shows new steps, the
credit and the licence, and "Show my copy" shows the pasted steps. Publish. The recipe reads "Checking", then public,
with no source photo, a new title and every amount, time and temperature from the paste.

**Acceptance Scenarios**:

1. **Given** a paste from a third-party site with free access, **When** the review is done, **Then** the choice offers
   "Just for me", "For everyone" and "Both", with none selected.
2. **Given** the cook chooses "For everyone", **When** the writer returns, **Then** the review step shows the written
   steps, a new title, `review.credit` and `review.licence`, and no photo from the page.
3. **Given** the review step, **When** the cook taps "Show my copy", **Then** the pasted steps show beside the written
   ones, and "Hide my copy" hides them.
4. **Given** the cook taps "Publish", **Then** the public version is saved as a public recipe, it reads "Checking"
   (ADR-0074), and the pasted copy is not kept (FR-033).
5. **Given** the cook chose "Both", **Then** the private copy is saved first with the site's wording, and the public
   version is published after the review. The copy shows "See the public version". The public version shows the owner
   only "See my copy".
6. **Given** the cook chose "Both" and taps `review.notNow` on the review, **Then** the private copy stays and no public
   version exists.

### User Story 2 - Keep it just for me (Priority: P1)

A cook wants a recipe only for themselves. It is saved as pasted, ingredient matching runs, and nothing is rewritten.

**Why this priority**: It is today's behaviour, and the most common path. It must not get worse.

**Independent Test**: Choose "Just for me". The recipe is private, keeps the page's wording, uses one private slot on
Free, and its ingredient lines are matched as before.

**Acceptance Scenarios**:

1. **Given** "Just for me", **Then** no writer call is made and no spend is reserved.
2. **Given** a Free cook with slots left, **Then** the hint shows the slot count, and the save uses one slot.
3. **Given** a paid source that FR-017 holds back (recent, signature or opted out), **Then** no choice is
   shown: one line, `paid.line` and `paid.keepWording`, and one button, "Save my copy".
4. **Given** a paid source that FR-017 allows, **Then** the three choices show, and the public version's credit names no
   site (`review.creditPaid`).
5. **Given** a private copy of a paid source, **Then** it cannot be shared or exported, except in the cook's own account data export (ADR-0093 §5). The household sees its public version if
   one exists, and nothing otherwise (FR-019).

### User Story 3 - The public version cannot be written now (Priority: P2)

The writer fails, the monthly AI budget is spent, or the page opts out of AI use.
The cook can still keep the recipe and make a public version later.

**Independent Test**: Force each cause. Each shows one line and its own actions (the `failed.*` and `budget.*` keys), never a group with one radio.

**Acceptance Scenarios**:

1. **Given** the budget is spent, **When** the cook opens the choice, **Then** only "Save my copy" is offered, with
   `budget.line`, and no writer call is made.
2. **Given** the writer fails after its retry (FR-031), **Then** `failed.title` and `failed.body` show with "Try again"
   and "Save my copy". On the Both path the private copy is already saved and the screen shows `failed.bodyBoth`.
3. **Given** a saved private copy whose public version did not get written, **When** the cook picks "Share a public
   version" from the recipe's menu, **Then** the review flow of User Story 1 runs from the saved copy.
4. **Given** the cook goes offline while the writer runs, **Then** `writing.offline` shows with "Try again".

### User Story 4 - No private spots left and no public version possible (Priority: P2)

A Free cook has all 50 private spots in use. The public version cannot be made, because of a paid-site rule, a failure,
the budget or an opt-out. The cook sees the free ways out first, then Pro with its real terms, and an equal "Not
now".

**Independent Test**: Fill 50 slots. Paste a paid-site page. The dead-end panel shows. "Upgrade to Pro" is the
primary button, with "Compare plans" beside it. "Not now" has equal size, with the note that the recipe is not saved.

**Acceptance Scenarios**:

1. **Given** 010's switch on and `account.paidFeatures = upsell`, **Then** the panel shows `deadEnd.*`, then `pro.*`
   with the price for the cook's country, the renewal line, and the trial line only for a cook who has had no trial.
2. **When** the cook taps "Upgrade to Pro", **Then** the subscription page opens as a modal at Pro's checkout, with
   monthly and yearly both shown and neither chosen. The import stays underneath, unchanged.
3. **Given** the upgrade succeeds, **Then** the cook returns to the choice with Private (and Both where possible)
   available, and hears `pro.welcome`.
4. **Given** checkout is cancelled or fails, **Then** the cook returns to the unchanged panel.
5. **When** the cook taps "Not now", **Then** the import ends, nothing is saved, and `deadEnd.closed` is announced.
6. **Given** 010's switch off, or `account.paidFeatures = hidden`, **Then** the panel shows no paid plan: `deadEnd.*`
   and one "Close" button with `deadEnd.closeNote`.
7. **Given** a Free cook with no slots and a public version possible, **Then** the screen shows `full.line`,
   `full.free` and "Write the public version" (no dead end).

### User Story 5 - A public version stays honest after it is published (Priority: P2)

The cook edits the public version later. Each save is checked so the source's wording cannot come back. Readers see who
wrote the steps, where the recipe is based, and can report a problem.

**Independent Test**: On a Both recipe, paste the private copy's steps into the public version and save. The save is
refused with `blocked.body`. A reader of the public page sees the credit, the licence and "Report a problem".

**Acceptance Scenarios**:

1. **Given** any save of a public version's steps or title, **Then** the wording check of FR-050 runs before the save
   is accepted.
2. **Given** the check refuses, **Then** nothing is saved, and the cook sees `blocked.body` with "Write it again" and
   "Keep it just for me".
3. **Given** a reader, signed in or out, **Then** the page shows `review.credit`, `review.licence` and
   `publicPage.report`, and never `editor.source.rightsLabel`.
4. **Given** "Report a problem", **Then** it opens 016's report flow for that recipe.

### User Story 6 - Sources that can be shown as they are (Priority: P3)

A cook imports a recipe from one of four sources: their own confirmed site, a page with an open licence we honour,
public-domain text, or a US government page. No rewrite is needed to make it public.

**Independent Test**: Import a page whose JSON-LD `license` is CC BY 4.0. The choice uses the cook's-own-recipe
visibility ("Who can see it?"), and the public recipe shows the licence's credit. No writer call is made.

**Acceptance Scenarios**:

1. **Given** each allowlist case of FR-010, **Then** no writer call is made and the recipe can be public as it is, with
   that case's credit.
2. **Given** a page whose licence forbids commercial use (for example CC BY-NC), **Then** it is not open, and the
   ordinary third-party choice applies.

### User Story 7 - Bulk import (Priority: P3)

A cook imports a file of many recipes. Third-party items are saved "Just for me". Each one can get a public version
later from its own menu. (C-6)

**Acceptance Scenarios**:

1. **Given** a bulk file, **Then** no writer call is made during the import.
2. **Given** a Free cook whose slots run out mid-batch, **Then** ADR-0072's pause applies, unchanged.

### Edge Cases

- **The source is detected but the cook states "I wrote this"**: the statement does not lift the rewrite rule unless the
  cook's site claim for that domain is confirmed (FR-010 item 1). Without it, the third-party choice applies, and the
  cook sees the offer to claim the site (`004-FR-055`). (C-3)
- **No source is detected and the cook states "I wrote this"**: the cook's own visibility ("Who can see it?") applies.
  If 020 later flags the steps as matching an outside page, the public form becomes the public version (FR-014).
- **Plain text with no source and a third-party statement** ("Adapted", "From a site"): treated as third-party.
- **A book or magazine statement**: out of this feature's v1. The 004 rules for books apply unchanged. (C-5)
- **A recipe-sharing site where other users post the recipes** (aggregator): the normal third-party rules apply (owner
  ruling 2026-11-15). (C-4)
- **The steps carry no facts** (one line "Mix and bake"): the writer can return one step. The fact check still runs.
- **The page has no steps at all**: nothing to rewrite. Only Private is offered.
- **The cook edits the private copy after a Both import**: the public version does not change. It is a separate recipe.
- **The cook deletes the private copy**: the public version stays. Its source record stays (FR-080).
- **The cook deletes the public version**: it goes like any public recipe. Its source record stays.
- **Two devices, or two cooks, publish the same page**: one public version per source page (FR-034). The second cook
  is pointed to the existing one.
- **A paid page with no publication date**: the hold counts from the first import of that page by any cook (FR-017).
- **A public version from a source later added to the paid list**: read live at the next public door (ADR-0082 §8).
  It is not withdrawn by this feature. A later publisher opt-out withdraws it (`016`, ADR-0093 §5). (C-12)
- **Account erasure**: the public version follows 016's erasure and donation rules like any public recipe.

## Requirements _(mandatory)_

### Functional Requirements

#### A. Which recipes this feature touches

- **FR-001**: The import choice and the public version MUST apply only to a recipe that arrives through the import
  pipeline (`004-FR-047`, `FR-061`): paste, URL, the "Save to Commise" button and file import. A recipe made in the
  single-recipe editor MUST NEVER be rewritten by this feature, whatever its statement. (Owner ruling 2026-11-15.)
- **FR-002**: A private copy MUST keep the source's wording as imported, and shows the source author's name (ADR-0093
  §1). Ingredient matching (ADR-0071) MUST run on it
  as it does today.

#### B. How a source is classified

- **FR-010**: One of these must hold for a source to be **open** (public as it is). This is an allowlist.
  Anything not on it is not open.
    1. The cook's own site, with a live confirmed site claim for that domain (`026-FR-001`, `020-FR-012g`).
    2. A page whose structured data states a licence on the honoured list (CC0, CC BY, CC BY-SA, and the Public Domain
       Mark), where the licence allows commercial use (`021-FR-014f`). Markup that states no licence is not a licence.
       The honoured list is data, not code.
    3. Public-domain text under the curator path (ADR-0023, `016-FR-015k`).
    4. A page from a US federal government publisher on a list kept as data. A `.gov` suffix alone is not enough. (C-2)
- **FR-011**: The import detects a source, or the cook states one. If that source is not open under FR-010, it is
  **third-party**. Every third-party source MUST go public only as a public version.
- **FR-012**: Three signals make a source **paid** (owner ruling 2026-11-15). Any one is enough:
    1. the page's structured data says `isAccessibleForFree` is false, for the page or for a part of it.
    2. its domain is on the paid-site list that `004-FR-014` already keeps as data.
    3. the page shows a metered paywall: paywall markup on the page, or a paid-list entry marked metered.

    A paid source's private copy keeps the site's wording (owner ruling 2026-11-15) and MUST NOT be shared or exported, except in the account data export (ADR-0093 §5). (C-1)

- **FR-017**: A paid source can go public only as a public version Commise writes in full. All of these must hold
  (owner ruling 2026-11-15). Otherwise it is private only.
    1. The publisher has not opted out, on the opt-out list kept as data or by a page signal (`004-FR-063`).
    2. The page's publication date is at least `PAID_CONTENT_HOLD_MONTHS` in the past. With no readable date, they
       count from the first import of that page by any cook, read from the source records. The constant is 6
       months, defined once and configurable (owner ruling 2026-11-15).
    3. The recipe is not the publisher's signature recipe. A signature recipe is never published from that single
       source.
    4. Where the dish also exists in free or independent sources, a consensus recipe is preferred to a single-source
       version. Consensus recipes are a later feature. Until then the public version is written from the cook's copy
       alone. (C-19)
- **FR-018**: A paid source's public version MUST carry the credit `review.creditPaid`: "Steps written by Commise with
  AI, checked by {cook}." It names no site and links to none, on the page and in its structured data. The source record
  keeps the source (FR-080).
- **FR-019**: A household member can see a read-only view of a cook's private recipes, except a paid site's own
  wording. For a paid private copy, the household sees its Commise-written public version, and nothing
  more. With no public version, the household sees nothing. (C-20)
- **FR-013**: The classification MUST be one pure rule that reads the detected evidence, the cook's statement, the live
  site claim, the honoured-licence list, the federal-publisher list and the paid-site list. A missing or unreadable
  input MUST read as third-party (or paid, for the paid inputs), never as open.
- **FR-014**: When 020 flags an imported recipe's steps as matching an outside page, the public form offered MUST be the
  public version, and the 020 dispute route stays. This replaces `020-FR-075`'s per-step suggestion for imported recipes
  only. Editor-made recipes keep `020-FR-075` and `FR-076` unchanged.
- **FR-015**: A recipe from a third-party source MUST reach the public only through this feature's Publish. No other
  door can make it public with third-party steps: not the visibility toggle, not a clone, and not a 027 Flow Steps
  replace. A 027 replace never changes the rights label. (Found at PLANNING, staff-architect.)
- **FR-016**: Publishing needs a cook aged 16 or over (owner ruling 2026-11-15). A younger cook MUST NOT be offered
  "For everyone" or "Both", and gets the private path only. Using the app at all needs the higher of 13 and the
  market's digital-consent age. That rule belongs to the account, not to this feature. (C-17)
- **FR-016a**: Each recipe this feature saves or publishes spends the one shared import allowance (`004-FR-061`: 200 a
  day on Free, 1,000 on a paid plan). A public version made in the same import costs no second unit. A private copy
  uses a slot, with or without a public version (owner ruling 2026-11-15).

#### C. The choice at import

- **FR-020**: After the import review, a third-party recipe (or a paid one that FR-017 allows) MUST ask "Just for you, or for everyone?" with three
  choices: "Just for me", "For everyone" and "Both". None is selected at first. The button label follows the choice
  (`button.private`, `button.public`, `button.both`).
- **FR-021**: "Just for me" saves the private copy (one private slot on Free). "For everyone" writes and reviews the
  public version and keeps no private copy. "Both" saves the private copy, then writes and reviews the public version.
- **FR-022**: When only one way forward exists, the screen MUST show one line and one button. It MUST NEVER show a
  group with one radio or a disabled radio (pasteImport D8 rule, kept).
- **FR-023**: An open source (FR-010) and a recipe with no third-party source use the cook's own visibility ("Who can see
  it?", existing keys). Nothing about rewriting or credit is shown.
- **FR-024**: A paid source that FR-017 holds back shows `paid.line`, `paid.keepWording` and, on Free, `paid.count`,
  with one button, "Save my copy". No Public, no Both, no "share it later". A paid source that FR-017 allows gets the
  choice of FR-020.

#### D. Writing the public version

- **FR-030**: The public version's steps MUST be written by 027's engine (`027-FR-035` to `FR-046`). The writer MUST
  see only the facts sheet, never the source's wording, address, title or headnote. The writer MUST NOT be an Anthropic
  model. The writer never fetches anything: the facts come from the import. A link import fetches the page on the
  device first. The server fetches only after a failed device fetch, and never for a known paid site: the cook is
  asked to paste the page instead. Paste detection never fetches (ADR-0093 §2, `004`).
- **FR-030a**: The public-version writer runs on the server, so Publish can re-check its result. The account's
  on-device AI setting is ON by default on mobile and OFF on web. It governs only the import's extraction tiers. That
  tier sits between the deterministic tiers and server AI, and it stays optional. Built-in OCR is allowed. (C-22)
- **FR-031**: A model result that fails the two-way fact check or the wording check MUST NOT be shown, stored or
  published (`027-FR-040`, `FR-042`). The job retries once automatically. A second refusal ends the job `failed`.
  (C-7)
- **FR-032**: The public version MUST hold these parts, and no photo from the source:
    - the written steps.
    - a descriptive title built by code from the facts sheet (the main foods and the method), with no model call. It
      is never the site's title, headnote or description. (C-8)
    - servings and times from the facts.
    - ingredient lines rebuilt from the matched facts (quantity, unit, food, preparation), not the source's line text.

    It MUST NOT carry the
    source's notes, tips or description. (C-8)

- **FR-033**: On the "For everyone" path the pasted text MUST NOT be kept once the public version is published or the
  flow ends. Only the source record of FR-080 stays.
- **FR-034**: A source page MUST have at most one public version, whoever imports it (owner ruling 2026-11-15). The
  page is the normalised source address (`sourceLinkKey`, `004`). A retry or a second device of the same cook MUST
  return the same version. A later cook who imports the same page and chooses "For everyone" or "Both" is shown the
  existing public version (`choice.exists`) and can keep a private copy. That cook never writes a second one.

#### E. The review step

- **FR-040**: The cook MUST see and confirm the public version before it publishes: `review.title`, `review.body`, the
  steps, `review.titleNote`, `review.photoNote`, `review.credit`, `review.licence`, and the actions "Publish", "Edit
  steps" and `review.notNow`. Nothing publishes without "Publish".
- **FR-041**: "Show my copy" MUST show the cook's copy beside the written steps, during the review on both paths. On the
  Both path it is also reachable later from the public version (owner only, "See my copy").
- **FR-042**: When the cook edits the written steps in the review, the two-way fact check MUST re-run on the server at
  "Publish", against the facts snapshot taken at import (the job's own copy, which also serves the "For everyone" path
  where no private copy exists). The server never trusts a verdict from the client. Each missing fact, safety line or allergen shows as a flag (`flag.*`). Publish
  waits until each flag is resolved by an edit or by "Write it again". (C-9)
- **FR-043**: The cook can change the title. The title then goes through the title check of FR-050.
- **FR-045**: On the Both path the private copy can change between the writing and "Publish". Publish MUST then be
  refused with "Write it again" (`flag.rewrite`). The wording fingerprint stays the one taken from the source at import.
- **FR-044**: A cook with no slot left who reaches `review.notNow` on the "For everyone" path sees **reuse** `cancel`
  instead of "Keep it just for me".

#### F. Every save of a public version

- **FR-050**: Every save of a public version's steps or title, at the review and at any later edit, MUST run the
  wording check against the source's stored fingerprint (FR-080). A save over the threshold MUST be refused, with
  `blocked.body`. The steps use the engine's measure (`027` research R3) with this feature's own threshold, set from
  the evaluation set. A title is too short for that measure. So a title MUST NOT equal the source's title once both are
  normalised, and its check uses 2-word shingles. The check runs inside the recipe write, so it covers an edit and a
  version restore alike. (C-10)
- **FR-051**: Every public door for a public version (publish, a later edit, a restore) MUST pass 020's hold
  (ADR-0074, ADR-0082 §8). The written steps never skip it.
- **FR-052**: A later edit by the cook is allowed, and the fact check is not re-run after publish. The edit is under the
  same licence (FR-062).

#### G. Credit, label and licence

- **FR-060**: A public version from a free (non-paid) source MUST show, wherever it is shown, the credit line
  `review.credit`: "Steps written by Commise with AI, checked by {cook}. Based on a recipe at {domain}. Not affiliated."
  The AI disclosure is plain on every public version (owner ruling 2026-11-15). The final wording is to be confirmed. `{domain}` is the registrable domain and a
  link. `{cook}` is the display name, or the username. Its schema.org data carries `isBasedOn` with the source address.
- **FR-061**: A public version's rights label MUST be a new derived label, "Steps written by Commise", never "Written by
  you" and never "Adapted by you" (`016-FR-015i`). It is open to the web (`021-FR-002`). Adding the value is a one-way
  door and needs an ADR before code. (C-11)
- **FR-062**: A public version's text MUST be licensed CC BY-SA 4.0, credited to "Commise and contributors", and the
  cook's later edits are under the same licence. The terms of service say who owns the written steps and the cook's
  edits. `review.licence` links to them. "Publish" is the cook's acceptance of that licence for their edits. The
  acceptance is recorded with the terms version (`016` data-model §1 and §11).
- **FR-065**: A public version MUST NOT earn rewards under 015, and MUST NOT be offered for sale (018).
- **FR-063**: A public version MUST show "Report a problem" (`publicPage.report`), which opens 016's report flow.
- **FR-064**: No string in this feature can use: copyright, legal, lawful, safe, safety, cleared, approved, "we checked"
  (any form), plagiarism, "original recipe", "same recipe", "By {site}", "From the kitchen of {site}", infringe,
  permission, "to avoid", "get around". There MUST be one list, held in one module that every copy guard imports. Today the words exist only as a
  comment beside `editor.source.rightsLabel` in `packages/apps/commise/features/recipes/src/editor/messages.ts`. The new module replaces that
  comment, and a test enforces it over every `importMessages.choice.*` string and 027's `recipes.flowSteps.*`.

#### H. Monitoring and review

- **FR-070**: There is no per-publisher or per-site cap (owner ruling 2026-11-15: "No caps on anything right now"). The
  source records still let monitoring count public versions per source (FR-071).
- **FR-071**: An alarm MUST fire at a set rate of public versions from one source. The rate is
  configuration. The alarm informs a person. It never blocks. (C-13)
- **FR-072**: There is no human-review gate for publishers before a public version goes public (ADR-0093 §6a).
  020's hold and "Report a problem" still apply to every public version. (C-12)

#### I. Dead end and subscription

- **FR-073**: The dead end (no slot left and no public version possible) MUST show the free ways out first
  (`deadEnd.*`). With 010's switch on and `account.paidFeatures = upsell`, it MUST then show the Pro panel (`pro.*`).
  It shows the real price and period, the renewal, and the trial terms for a cook who has had no trial. "Upgrade to Pro"
  is the primary button and "Compare plans" is a link beside it. "Not now" is an equal-size secondary button.
  `notNow.note` sits above both.
- **FR-074**: "Upgrade to Pro" MUST open the subscription page as a modal at Pro's checkout (`010-FR-042a`). The
  billing period MUST NOT be chosen for the cook. This needs `010-FR-042c` and 010 US6 scenario 2 amended for this screen only (owed).
- **FR-075**: With 010's switch off, or `account.paidFeatures = hidden`, the dead end MUST show no paid plan
  (`010-FR-042j`): `deadEnd.*` and one "Close" button.
- **FR-076**: The panel MUST NOT use countdowns, "only today", "last chance", or a decline that shames.

#### J. Cost and failure

- **FR-080**: Every import from a third-party source MUST write an internal source record, append-only and never shown
  to cooks or readers. It extends ADR-0089 §6's evidence record with these fields:
    - the classification and its inputs, the paid signal and the licence signal.
    - the hashed wording fingerprint of the source's steps and title, never the text.
    - the fingerprint's format version and key version. The engine version sits on the job and on the public version.

    The record is never updated. The public version points to it (one public version per record), not the other way
    round. It is the source of truth for this feature. (C-14)

- **FR-081**: The writer call MUST reserve and settle against the one ADR-0024 pool under its own call site. It is
  operating cost (ADR-0024 §6 item 1), never a cook's AI use. (C-15)
- **FR-082**: A ceiling denial MUST end the job `budgetSpent` at once, refund the reservation and never redeliver
  (`004-FR-059` pattern). An unreadable counter or a transport failure retries. A job older than 10 minutes ends
  `failed`.
- **FR-083**: Writer calls are bounded by the one shared import allowance (FR-016a), at most 3 calls per item (C-7), and
  the spend ceiling. There is no separate daily cap (C-15).
- **FR-084**: A page with an AI opt-out signal (`004-FR-063`) MUST NOT be sent to the writer. Only Private is offered,
  with the neutral `budget.line`. (C-16)
- **FR-085**: "Stop" during writing MUST end the job `cancelled` and return the cook to the choice. A result that
  arrives later is dropped. A call already started is still paid from the pool. The cook never pays (FR-081). On the
  Both path the private copy stays.

#### K. Release

- **FR-090**: The feature MUST sit behind one switch, read in one place, shared by web and mobile, and per market
  (ADR-0093 §6a). Every market is on at launch. Turning a market off stops new public versions there and hides the
  existing ones, and private copies are unaffected. With the switch off, imports behave as today (private only for web
  copies).
- **FR-091**: Web and mobile MUST ship every state in the same release (`CODING_STANDARDS.md` §14).

### UI states and localisation keys

Keys are under `importMessages.choice.*` unless marked **reuse**. Every state exists on web and mobile. Copy is from the
owner-approved v2 draft (staff-ux-engineer, 2026-11-15). `staff-ux-engineer` SPECIFY owns layout and final copy.

| State                         | Keys                                                                                                                                                                                                                                                      |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Public version already exists | `exists.line`, `exists.link`, `exists.pending`, then "Save my copy" as the one button                                                                                                                                                                     |
| Choice                        | `title`, `explain`, `private.label`, `private.hint` (ICU), `private.hintPro`. And `public.label`, `public.hint`, `both.label`, `both.hint` (ICU), `both.hintPro`. And `credit`, `creditLink`, `pickOne`, `button.private`, `button.public`, `button.both` |
| Writing (loading)             | `writing.title`, `writing.body`, `writing.bothSaved`, `writing.stop`, `writing.announce`                                                                                                                                                                  |
| Review                        | `review.title`, `review.body`, `review.compare`, `review.compareHide`, `review.titleNote`, `review.photoNote`, `review.credit`, `review.licence`, `review.publish`, `review.edit`, `review.notNow`                                                        |
| Flags after an edit           | `flag.title` (ICU), `flag.step`, `flag.allergen`, `flag.fix`, `flag.rewrite`                                                                                                                                                                              |
| Wording refused               | `blocked.body`, actions `flag.rewrite`, `review.notNow`                                                                                                                                                                                                   |
| Writer failed                 | `failed.title`, `failed.body`, `failed.bodyBoth`, **reuse** `wizard.retry`                                                                                                                                                                                |
| Budget spent, opt-out         | `budget.line` (one neutral line for both)                                                                                                                                                                                                                 |
| Offline                       | **reuse** `review.offline` (choosing), `writing.offline` (writing)                                                                                                                                                                                        |
| No slot, public possible      | `full.line`, `full.free`, button `button.public`, then the Pro panel without "Not now"                                                                                                                                                                    |
| Paid source, held back        | `paid.line`, `paid.keepWording`, `paid.count` (ICU)                                                                                                                                                                                                       |
| Other private-only reasons    | Under 16, no steps: `paid.line`, `paid.keepWording` and `paid.count`, with no "later" promise. Switch off: today's `review.webPrivate`, `review.webPrivatePro` and `hold.slotsFull`.                                                                      |
| Paid public version credit    | `review.creditPaid`                                                                                                                                                                                                                                       |
| Own recipe or open source     | **reuse** the editor's visibility keys                                                                                                                                                                                                                    |
| Dead end                      | `deadEnd.title`, `deadEnd.bodyNoWrite`, `deadEnd.bodyPaid`, `deadEnd.free`                                                                                                                                                                                |
| Pro panel                     | `pro.name`, `pro.price`, `pro.perk.private`, `pro.perk.pantry`, `pro.perk.ai`, `pro.trial`, `pro.renews`, `pro.upgrade`, `pro.compare`, `notNow`, `notNow.note`, `pro.welcome`, `deadEnd.closed`                                                          |
| Dead end, no paid plan        | `deadEnd.close`, `deadEnd.closeNote`                                                                                                                                                                                                                      |
| Success                       | `done.private`, `done.public`, `done.both`, **reuse** `saved`, `savedPublic`                                                                                                                                                                              |
| Links between the two recipes | `done.linkPublic`, `done.linkPrivate`                                                                                                                                                                                                                     |
| Later route                   | `later.action` ("Share a public version")                                                                                                                                                                                                                 |
| Public page                   | `review.credit`, `review.licence`, `publicPage.report`                                                                                                                                                                                                    |

The exact strings are in the plan's research (R8). The `budget.allowance` variant of the draft is not used: the writer
is never charged to a cook's uses (FR-081).

### Key Entities

- **Import choice**: the cook's answer for one import item: `private`, `public` or `both`. Stored on the item.
- **Public version**: a recipe row owned by the cook, public, label "Steps written by Commise", licence CC BY-SA 4.0,
  linked to its import item and its source record, and (Both) to the private copy.
- **Public-version job**: one writer job for one import item: `pending`, `ready`, `checkRefused`, `budgetSpent`,
  `failed`, `cancelled`.
- **Source record**: the append-only evidence of FR-080.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: In a human audit of 200 public versions, 0 drop or change an amount, time, temperature or safety line
  from the cook's copy.
- **SC-002**: 0 public versions are published whose wording check against their source exceeds the threshold, at any
  save (measured from the source records).
- **SC-003**: 0 public versions exist from an opted-out publisher, paid content
  younger than `PAID_CONTENT_HOLD_MONTHS`, or a paid signature recipe from a single source.
- **SC-004**: 95% of public versions are ready for review within 30 seconds of the choice.
- **SC-005**: Each choice state is reachable and announced on web, iOS and Android, at 320 CSS px with no horizontal
  scroll, and at the largest text size.
- **SC-006**: The feature's spend never takes the ADR-0024 pool past its ceiling (the counter is the control).
- **SC-007** (hypothesis, read at day 30): at least 30% of third-party imports choose "For everyone" or "Both".

## Assumptions

- The engine of 027 is good enough on facts alone. 027's bake-off measures it.
- The evidence record of ADR-0089 §6 is built before this feature.
- Prices come from the store for the cook's country, formatted by `Intl`.
- The terms of service text for the credit, the licence and "Not affiliated." is settled before the switch opens. The
  strings can change. The keys stay.

## Out of Scope

- Consensus recipes built from many sources (later).
- Rewrites of books and magazines (C-5).
- Public versions of editor-made recipes (owner ruling).
- A source fetch by the writer.
- Per-publisher or per-site caps (owner ruling 2026-11-15).
- Special handling for hosts of unauthorised copies (owner ruling 2026-11-15).
- A cook's own AI uses or own keys for this writer.
- Translating the public version.
- Rewards and sale of a public version (FR-065).

## Conflicts with existing specs (for the owner)

ADR-0093 and its sweep already settled the facts cards, the caps, the licence text, the pilot conditions (it replaced
them with a per-market switch and no publisher review gate, §6a), the paste design spec's D8 line and `016-FR-015i`.
Still open:

1. **Rights label**: no `016-FR-015c` label fits (FR-061). A new value is a one-way door.
2. **`020-FR-075` to `FR-080`, Q-4**: 003B replaces the per-step suggestion for imports (FR-014), answers Q-4 for the
   public version (label FR-061, credit FR-060, never "Adapted by you"), settles FR-078's spend for this call (FR-081),
   and gives FR-080's "adapted by Commise" its behaviour. Q-6 now has code behind it once 003B ships.
3. **`010` US6 scenario 2 and `010-FR-042c`**: "No plan is chosen for the cook". Owed: an amendment for the dead end
   only (FR-074).
4. **ADR-0024 §3**: a third ceiling-denial exception (this call site, terminal). Owed.

## Amendments

[ADR-0093](../../docs/architecture/decisions/0093-imported-recipes-go-public-only-as-a-commise-written-version.md)
carries the amendments to 004, 016, 020, 021 and the paste design spec. 003B does not duplicate them.

Still owed:

- `010` US6 scenario 2 and `010-FR-042c` (FR-074).
- ADR-0024 §3 (a third no-retry path) and the label, licence and provenance one-way doors (FR-061, FR-062, data-model), in 003B's BLUEPRINT ADR.

## Clarifications

### Session 2026-11-15 (speckit-clarify, no owner questions asked: each answer is the best default, "Assumed, owner to confirm")

- **C-1. Facts cards?** Ruled 2026-11-15: no facts cards anywhere. Paid sources go public only as a Commise-written
  page (FR-017). How a metered paywall is detected is assumed: page paywall markup, or a paid-list entry marked
  metered. Owner to confirm.
- **C-2. How is a US government work detected?** Assumed: a list of federal publisher domains kept as data. State and
  local `.gov` sites are not on it. Owner to confirm.
- **C-3. Does a cook's "I wrote this" lift the rewrite on a detected source?** Assumed: only with a live confirmed site
  claim. Owner to confirm.
- **C-4. Aggregator sites?** Ruled 2026-11-15: the normal rules apply.
- **C-5. Books and magazines?** Assumed: out of v1. 004's rules stand. Owner to confirm.
- **C-6. Bulk import?** Assumed: items save "Just for me". A public version is made later per recipe. No batch rewrite.
  Owner to confirm.
- **C-7. Retries of a refused model result?** Assumed: one automatic retry, then `failed`, and the cook can "Try
  again" once more by hand. At most 3 writer calls per item. Owner to confirm.
- **C-8. Ingredient lines and title on the public version?** Assumed: ingredient lines rebuilt from the matched facts,
  not the source's line text. The title is built by code from the facts, with no model call. Owner to confirm.
- **C-9. Can a cook publish with a fact removed in the review?** Assumed: no. Publish waits until each flag is resolved.
  After publish, edits are free (FR-052). Owner to confirm.
- **C-10. With no copy kept, what does the similarity check compare against?** Assumed: a hashed wording fingerprint
  of the source's steps and title in the source record, never the text. Owner to confirm.
- **C-11. Label?** Assumed: a new label "Steps written by Commise", open to the web, needing an ADR. Owner to confirm.
- **C-12. Review for registered publishers?** Ruled 2026-11-15: none (ADR-0093 §6a). A publisher who opts out later has
  its public versions withdrawn (`016`).
- **C-13. Monitoring numbers?** Assumed: an alarm at 20 public versions from one source in 24 hours, with no cap. Configuration. Owner to confirm.
- **C-14. Is the source record kept after the public version is deleted?** Assumed: yes, for 016's
  evidence period. It holds no personal data beyond the recipe link. Owner to confirm.
- **C-15. Who pays and how much?** Assumed: operating cost from the one $100 pool, own call site, bounded by the one import allowance
  and 3 calls per item. No daily cap (ruled 2026-11-15). Owner to confirm.
- **C-16. AI opt-out on the page?** Assumed: only Private is offered, with the neutral budget line. Owner to confirm.
- **C-17. Age?** Ruled 2026-11-15: publishing at 16 and over. App use at the higher of 13 and the market's digital-consent
  age.
- **C-18. Rewards and sale?** Assumed: none for a public version (FR-065). Owner to confirm.
- **C-19. Signature recipes and consensus?** Assumed: a signature recipe names the publisher or its brand in its title,
  or is on a signature list kept as data. Until consensus recipes ship, a common paid dish is published from the
  cook's copy alone. Owner to confirm.
- **C-20. Which household view of a paid recipe?** Ruled 2026-11-15: the Commise-written version, or nothing
  without one. Assumed: on a "Just for me" paid copy, the household sees nothing. Owner to confirm.
- **C-21. Recent paid content.** Ruled 2026-11-15: 6 months, one named configurable constant
  (`PAID_CONTENT_HOLD_MONTHS`), counted from the publication date, else from the first import of that page by any
  cook.
- **C-22. Does the on-device AI tier write public versions?** Assumed: no. It serves extraction only. The writer stays
  on the server, so Publish re-checks one known result. Owner to confirm.
- **C-23. AI credit wording?** Ruled 2026-11-15: "Steps written by Commise with AI, checked by {cook}." The final
  wording is to be confirmed.
