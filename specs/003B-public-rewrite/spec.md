# Feature Specification: Public Versions of Imported Recipes (import-time rewrite)

**Feature Branch**: single-branch directive (the spec directory is
`specs/003B-public-rewrite`. The owner asked for "003A", but `specs/003A-signed-out-reading` already exists, so this
feature takes 003B. It is not part of `003-usda-food-data` or `003A`.)
**Created**: 2026-11-15
**Status**: Draft. Planned, not built. Each clarification is ruled where marked, and the rest are assumed and wait for the owner (see Clarifications). It sits behind one per-market switch (FR-090).
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
  not write a second one. 003B builds the engine first, and 027 uses it (`027-FR-045`). The split is in the plan
  (§Engine ownership).
- **[020](../020-content-source-check/spec.md)** and ADR-0074 own the content check and the hold in the read rule. A
  public version goes public through that one hold, like any recipe.
- **[ADR-0093](../../docs/architecture/decisions/0093-imported-recipes-go-public-only-as-a-commise-written-version.md)**
  ("imported recipes go public only as a Commise-written version") records the owner's 2026-11-15 rulings, and its sweep
  amended 004, 016, 020, 021 and the paste design spec. 003B does not repeat or restate them. It cites ADR-0093.
- **[016](../016-legal-compliance-framework/spec.md)** owns rights labels and licences. `020` owns the report hide (FR-063).
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
  copy and its source steps (`027-FR-035`). It carries the credit line (FR-060). It is what other people see.
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
   steps, a new title, `credit.written` (with `credit.basedOn` for a free site) and `review.licence`, and no photo from the page.
3. **Given** the review step, **When** the cook taps "Show my copy", **Then** the pasted steps show beside the written
   ones, and "Hide my copy" hides them.
4. **Given** the cook taps "Publish", **Then** the public version is saved as a public recipe, it reads "Checking"
   (ADR-0074), and the pasted step text is cleared when the job ends (FR-033).
5. **Given** the cook chose "Both", **Then** the private copy is saved first with the site's wording, and the public
   version is published after the review. The copy shows "See the public version". The public version shows the owner
   only "See my copy".
6. **Given** the cook chose "Both" and taps `review.notNowBoth` on the review, **Then** the private copy stays and no public
   version exists.

### User Story 2 - Keep it just for me (Priority: P1)

A cook wants a recipe only for themselves. It is saved as pasted, ingredient matching runs, and nothing is rewritten.

**Why this priority**: It is today's behaviour, and the most common path. It must not get worse.

**Independent Test**: Choose "Just for me". The recipe is private, keeps the page's wording, uses one private slot on
Free, and its ingredient lines are matched as before.

**Acceptance Scenarios**:

1. **Given** "Just for me", **Then** no writer call is made and no spend is reserved.
2. **Given** a Free cook with slots left, **Then** the hint shows the slot count, and the save uses one slot.
3. **Given** a paid source that FR-017 holds back (clearly recent, a clearly read signature recipe or a stated opt-out), **Then** no choice is
   shown: one line (`privateOnly.paidRecent` with the date when known, else `privateOnly.line`), and one button, "Save my copy".
4. **Given** a paid source that FR-017 allows, **Then** the three choices show, and the public version's credit names no
   site (`credit.written` only, no `credit.basedOn`). Enabled once the page evidence carries the paid facts. Until
   then a page on the paid list with no clear signal, and a paywall that cannot be read, take the rewrite path to
   public with `credit.written` only, no hold and no site named (FR-012b).
5. **Given** a private copy of a paid source, **Then** it cannot be shared or exported, except in the cook's own account data export (ADR-0093 §5). The household sees its public version if
   one exists, and nothing otherwise (FR-019).

### User Story 3 - The public version cannot be written now (Priority: P2)

The writer fails, the monthly AI budget is spent, or the page opts out of AI use.
The cook can still keep the recipe and make a public version later.

**Independent Test**: Force each cause. Each shows one line and its own actions (the `failed.*` and `budget.*` keys), never a group with one radio.

**Acceptance Scenarios**:

1. **Given** the budget is spent, **When** the cook opens the choice, **Then** only "Save my copy" is offered, with
   `budget.line`, and no writer call is made.
2. **Given** the page carries a stated AI opt-out signal, **Then** only "Save my copy" is offered, with `privateOnly.line` and no
   promise of a later public version (FR-084).
3. **Given** the writer fails after its retry (FR-031), **Then** `failed.title` and `failed.body` show with "Try again"
   and "Save my copy". On the Both path the private copy is already saved and the screen shows `failed.bodyBoth`. At
   3 attempts "Try again" is hidden and only `failed.done` is offered.
4. **Given** a saved private copy whose public version did not get written, **When** the cook picks "Share a public
   version" from the recipe's menu (shown to the owner of a private recipe with a source record, FR-092), **Then** the
   offer is read from the server and the review flow of User Story 1 runs from the saved copy.
5. **Given** the cook goes offline while the writer runs, **Then** `writing.offline` shows with "Try again".

### User Story 4 - No private spots left and no public version possible (Priority: P2)

A Free cook has every private spot in use (ADR-0073). The public version cannot be made, because of a paid-site rule, a failure,
the budget or an opt-out. The cook sees the free ways out first, then Pro with its real terms, and an equal "Not
now".

**Independent Test**: Fill the Free private-recipe limit. Paste a paid-site page. The dead-end panel shows. "Upgrade to Pro" is the
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
refused with `blocked.bodyBoth`. A reader of the public page sees the credit, the licence and "Report a problem".

**Acceptance Scenarios**:

1. **Given** any save of a public version's steps or title, **Then** the wording check of FR-050 runs before the save
   is accepted.
2. **Given** the check refuses, **Then** nothing is saved, and the cook sees `blocked.body` (public path) or
   `blocked.bodyBoth` (Both path) with "Write it again" and the path's not-now key. At 3 attempts "Write it again" is
   hidden, and `blocked.bodyFinal` (`blocked.bodyFinalBoth` on the Both path) shows with the not-now key only.
3. **Given** a reader, signed in or out, **Then** the page shows `credit.written`, `credit.basedOn` (free site), `review.licence` and
   `publicPage.report`, and never `editor.source.rightsLabel`.
4. **Given** "Report a problem", **Then** the version is hidden from every reader at once and stays hidden until staff
   decide (`020-FR-082`). Its owner sees `publicPage.hiddenOwner`, and a reader sees
   `publicPage.hiddenReader`.

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

- **FR-010**: A source is **open** (public as it is) only when it is on the copy-outright allowlist of ADR-0093 §3.
  Anything not on it is not open. This feature fixes how each entry is detected. (1) The cook's own site: a live
  confirmed site claim for that domain (`026-FR-001`, `020-FR-012g`). (2) An honoured licence: read from the page's
  structured data (`021-FR-014f`). Markup that states no licence is not a licence. The honoured list is data, not
  code. (3) Public-domain text under the curator path (`016-FR-015k`). (4) A US federal publisher: a list kept as data.
  A `.gov` suffix alone is not enough. (C-2)

- **FR-011**: The import detects a source, or the cook states one. If that source is not open under FR-010, it is
  **third-party**. Every third-party source MUST go public only as a public version.
- **FR-012**: A source is **paid** when a clear signal of ADR-0093 §5 is read: `isAccessibleForFree` false, or a
  metered paywall. Either one is enough. A domain on the paid-site list of `004-FR-014` is a known paid site, but the
  list is not a clear signal on its own (FR-012b). A paid source's private copy follows
  ADR-0093 §5: the site's wording, no sharing, no household view, and no export except the account data export. (C-1)
- **FR-012a**: A third-party paste with no detectable page address MUST be Private only (offer reason
  `noSourceAddress`). A recipe the cook wrote is unaffected.
- **FR-012b**: Only a clearly read signal blocks a public version. A stated opt-out gives `publisherOptOut` or
  `aiOptOut`. A clearly paid page (`isAccessibleForFree` false, or a metered paywall) keeps the paid rules: the
  FR-017 hold, and no site named. A clearly read signature recipe stays private only (`paidSignature`). A domain on
  the paid list is not a clear signal. A signal that cannot be read is `unknown`: a paywall the reader cannot tell, an
  opt-out it cannot read, or an unread signature signal. A page whose domain is on the paid list and that carries no
  clear signal is treated the same way: no hold, and no site named. A paste from a domain not on the paid list with no
  paid signal is free third-party (US1 scenario 2, `credit.basedOn`). For `unknown`, and for a paid-list page with no
  clear signal, the offer takes the rewrite path to public: the choice shows with `credit.written` only, no site is
  named, and no paid hold applies. The offer is `{ kind: 'choice', credit: 'paid' }`, where `credit: 'paid'` means
  `credit.written` only. `source.classification` is `paid` only for a clearly read paid signal. For `unknown` and for a
  paid-list page with no clear signal it is `thirdParty`, so the FR-012 private-copy rules do not apply (the source
  record's `source_class` still reads `paid_site` for the list case, for monitoring). `unknown` never maps to
  `privateOnly`. The paid-site
  list and the federal publisher list are approved data, drafted with sources and approved before they are seeded (task
  T084, slice B2).
- **FR-012c**: A public version is written in the language of the source recipe's steps, for every language the
  platform's language detector supports. There is no list of languages and no per-language reviewer: the cook's review
  before publishing is the language check, beyond the output check of `027-FR-040`. Two reasons keep a recipe Private only. `languageUnsupported`: the detector
  or the platform's Unicode and locale data cannot handle the language. `languageUncertain`: the language cannot be
  decided with confidence. The server finds the language in this order:
    1. It takes the steps text and removes the ingredient-name spans, digits and units.
    2. It detects the language of each sentence and skips a sentence too short to judge.
    3. A sentence is confidently detected when the detector's confidence is at least a stated threshold. Among the
       confidently detected sentences, the language with the most letters wins. There is no share threshold, so a recipe
       that mixes languages keeps its leading language, and a mix is never a refusal and never unsure. A tie in letters
       goes to the declared tag (step 4) when it is among the tied languages, and otherwise to the language of the first
       confident sentence. The one threshold is calibrated on the golden fixtures, mixed-language ones included (T183).
    4. With no confidently detected sentence, it uses the page's declared language (the page `lang` or JSON-LD
       `inLanguage`, carried on the import evidence as `evidence.page.language`), but only when that tag equals the
       detector's top candidate for the whole text.
    5. Otherwise the language is uncertain and the recipe stays Private only (`languageUncertain`). A recipe is
       **unsure** when it has no confidently detected sentence and its declared tag does not equal the top candidate.
    6. When the language is decided, the server stores it, then checks that the platform can handle it: a language
       profile can be derived for it (027). If not, the recipe stays Private only (`languageUnsupported`).

    A declared tag is cut to its lower-case primary subtag, and a tag with no primary subtag of 2 or 3 letters, and
    `und`, read as no language. The result is stored on the source record (`recipe_source_records.language`, a BCP 47
    primary subtag of 2 or 3 lower-case letters, set at the import save). Ingredient names pass through into the public version exactly as the cook wrote them, in any script.

- **FR-013**: The classification MUST be one pure rule that reads the detected evidence, the cook's statement, the live
  site claim, the honoured-licence list, the federal-publisher list and the paid-site list. A missing or unreadable
  input MUST read as third-party, never as open. A missing or unreadable paid, opt-out or signature input reads as
  `unknown` and takes the rewrite path (FR-012b), never as paid and never as `privateOnly`.
- **FR-014**: When 020 flags an imported recipe's steps as matching an outside page, the public form offered MUST be the
  public version, and the 020 dispute route stays. This replaces `020-FR-075`'s per-step suggestion for imported recipes
  only. Editor-made recipes keep `020-FR-075` and `FR-076` unchanged.
- **FR-015**: A recipe from a third-party source MUST reach the public by one of two doors only. Door one is this
  feature's Publish of the Commise-written version, the default. Door two is the cook's own rewrite in their own words,
  labelled "Adapted by you" (`016-FR-015i`, ADR-0093 Alternatives), which passes the similarity check against the
  source and 020's review (`020-FR-075` to `FR-080`) before it is public. Door two is not open for a paid source
  (ADR-0093 §5). No other door can make third-party steps public: not the visibility toggle on a copy that keeps the
  source's wording, not a clone, and not a 027 Flow Steps replace. A 027 replace never changes the rights label
  (`027-FR-032`). (Owner ruling 2026-11-17, found at PLANNING, staff-architect.)
- **FR-016**: Publishing needs a cook aged 16 or over (ADR-0093 §8, `016-FR-009`). Only Publish is gated: Publish, the
  Publish step of the later "Share a public version" route, and later (slice P11) the editor's make-public and
  set-visibility routes. The start of a job is never gated, and a cook with no age claim gets the normal offer. One pure
  predicate, `publishAgeAllowed(principal)` (recipe-service `recipes/domain/`), decides. A gated route refuses with
  `403 { code: 'ageConfirmNeeded' }` when the principal has no `publishAgeMet`, the `Principal` field that
  `clerk-verify` parses from the signed `public_metadata.ageFloorMet` claim. The claim is the integer `16`. Any other
  value, or none, reads as not met. The client then shows the age question (`ageConfirm.*`, wording `ageConfirm.v1`). On
  "I'm 16 or over" it calls identity's age assurance route (FR-016b), refreshes the token, and retries Publish once. A
  second `403` shows an error and never loops. "Not now" (`ageConfirm.notNow`, the same size as the confirm button) closes the
  dialog, publishes nothing, returns focus to Publish and returns the cook to the review screen. The job stays ready until it expires as usual,
  and the cook can still take the normal private exit from review (the path's not-now key (`review.notNow` on the public path, `review.notNowBoth` on the Both path), FR-044). Nothing is saved
  automatically. Spec 016's stronger age assurance replaces this later. (C-17)
- **FR-016a**: Each recipe this feature saves spends the one shared import allowance (ADR-0072 §8,
  `004-FR-061`). The Both path spends one import unit, not two: the public version is part of the same import. Making
  a public version spends no unit, in the same import or on the later "Share a public version"
  route (C-24). The site-wide AI ceiling still applies (FR-082). A private copy uses a slot, with or without a public version (ADR-0093 §8).
- **FR-016b**: Identity owns the age claim. `POST /api/v1/me/age-assurance` records one `age_assurances` row (spec 016's
  table, built now) and then sets the `ageFloorMet` claim on the cook's session. The route is idempotent. See
  `contracts/publicVersion.api.md` and `data-model.md` "Identity".
- **FR-017**: A paid source can go public only as a public version Commise writes in full, under ADR-0093 §5: no
  publisher opt-out (`004-FR-063`), not a clearly read signature recipe from that single source, and older than
  `PAID_CONTENT_HOLD_MONTHS`. The constant is defined once and configurable. With no readable page date, the age counts
  from the first import of that page by any cook, read from the source records. Otherwise it is private only.
  Consensus recipes, which ADR-0093 §5 prefers, are a later feature. Until then the public version is written from the
  cook's copy alone. The hold applies only to a clearly paid page, so an unknown paywall applies none (FR-012b). (C-19)
- **FR-018**: A paid source's public version MUST carry `credit.written` and no `credit.basedOn` (ADR-0093 §4 and §5). It names no site and
  links to none, on the page and in its structured data. The source record keeps the source (FR-080).
- **FR-019**: A household sees a paid private copy's Commise-written public version, or nothing (ADR-0093 §7, `017`).
  (C-20)

#### C. The choice at import

- **FR-020**: After the import review, a third-party recipe (or a paid one that FR-017 allows) MUST offer the choice of
  ADR-0093 §2: "Just for me", "For everyone" and "Both". None is selected at first. The button label follows the choice
  (`button.private`, `button.public`, `button.both`).
- **FR-021**: "Just for me" saves the private copy (one private slot on Free). "For everyone" writes and reviews the
  public version and keeps no private copy. "Both" saves the private copy, then writes and reviews the public version.
- **FR-022**: When only one way forward exists, the screen MUST show one line and one button. It MUST NEVER show a
  group with one radio or a disabled radio (pasteImport D8 rule, kept).
- **FR-023**: An open source (FR-010) and a recipe with no third-party source use the cook's own visibility ("Who can see
  it?", existing keys). Nothing about rewriting or credit is shown.
- **FR-024**: A paid source that FR-017 holds back shows one line (`privateOnly.paidRecent` or `privateOnly.line`) and, on Free, the slot line `private.hint`,
  with one button, "Save my copy". No Public, no Both, no "share it later". A paid source that FR-017 allows gets the
  choice of FR-020.

#### D. Writing the public version

- **FR-030**: The public version's steps MUST be written by 027's engine. 027 owns the engine's rules: the writer's input
  (the facts sheet and the source step text, `027-FR-035`), the model rule (`027-FR-036`), the checks (`027-FR-040`, `FR-042`) and the thresholds. This
  feature adds no engine rule. The writer MUST NOT be an Anthropic model (owner ruling, 2026-11-17). The writer never
  fetches anything: the facts come from the import. A link import fetches as ADR-0093 §2 says (device first, server
  second). The server never fetches for a known paid site: the cook is asked to paste the page instead. The server link read is
  held until link import has a design, and link import has no UI in the first web release, which follows the paste
  web-first exception.
- **FR-030a**: The public-version writer runs on the server, so Publish can re-check its result. The account's
  on-device AI setting is ON by default on mobile and OFF on web. It governs only the import's extraction tiers. That
  tier sits between the deterministic tiers and server AI, and it stays optional. Built-in OCR is allowed. (C-22)
- **FR-030b**: The writer writes each public version in the source recipe's own language. There is no translation. The
  worker gives the source record's language to the one prompt template as a parameter, and reads the language profile
  (027) derived from it (FR-012c). The engine also checks the output's language by the same rule (`027-FR-040`, log category
  `wrongLanguage`, wire `unreadable`). A Spanish recipe whose steps hold a few English sentences passes. A writer that
  answers in English is refused.
- **FR-031**: A model result that fails 027's checks MUST NOT be shown, stored or published. The job retries once
  automatically. A second refusal moves the job to `checkRefused` and the cook sees the failed screen. `checkRefused`
  is a resting state while fewer than 3 attempts are used: "Try again" calls the retry route and makes a third
  attempt. After the third attempt a refusal is final. A resting `checkRefused` expires to `cancelled` after 24
  hours. A job that ends `failed` (FR-082) rests the same way: "Try again" while fewer than 3 attempts are used, then
  `cancelled` after 24 hours, and final at 3 attempts. Cancel (`button.private` on the "For everyone" path, `failed.done` on the Both path) is accepted from
  `checkRefused` and `failed`. Attempts carry over a retry and no allowance unit is spent. At 3 attempts the client
  hides `wizard.retry` and `flag.rewrite`: the failed screen shows `failed.title`, `failed.body` (`failed.bodyBoth` on the Both path) and `failed.done`
  only, and the blocked state shows `blocked.bodyFinal` (`blocked.bodyFinalBoth` on the Both path) with the path's
  not-now key only. On `409 attemptsUsed` the client refetches the job. (C-7)
- **FR-032**: The public version MUST hold these parts, and no photo from the source:
    - the written steps.
    - a descriptive title built by code from the facts sheet (the main foods), with no model call. It
      is never the site's title, headnote or description. (C-8)
    - servings and times from the facts.
    - ingredient lines rebuilt from the matched facts (quantity, unit, food, preparation), not the source's line text.

    It MUST NOT carry the
    source's notes, tips or description. (C-8)

- **FR-033**: On the "For everyone" path the pasted step text MUST be kept only in the job's `source_steps`, so a
  retry sends the writer the same text. It MUST be cleared in the same UPDATE as `facts_snapshot` and `output` at every
  terminal state and on cancel, and the import item's draft step text MUST be cleared in that same transaction. Until
  then the item's draft still serves "Show my copy" and the cook's exits that save a private copy. A job lives about 73 hours at most, inside ADR-0072's 30 days. Only the source record of
  FR-080 stays.
- **FR-034**: A source page MUST have at most one Commise-written public version at a time (ADR-0093 §2). The page is
  its normalised source address (`sourceLinkKey`, `004`). A retry or a second device of the same cook MUST return the
  same version. A later cook who chooses "For everyone" or "Both" while one holds the page is shown it (`publicExists.published`,
  `publicExists.link`) and can keep a private copy. That cook never writes a second one. A cook's own "Adapted by you"
  recipe (FR-015, door two) is not a public version and does not hold the page.
- **FR-034a**: A public version holds its page through the source page key. The key MUST be released, in the same
  transaction as its cause, when the version is (a) deleted, (b) not approved by 020 (it becomes private,
  ADR-0074), or (c) withdrawn by a publisher opt-out (`016`).
  After a release a later cook sees the normal choice and may write a new version, except under (c), where the cook
  sees `privateOnly.line` and Private only. While a version is hidden by a report or held in 020's review it keeps the key,
  and a later cook sees `publicExists.inReview` and Private only. (C-27)
- **FR-035**: Start and Publish MUST each check the `shownOffer` the client sends against the offer the server
  computes now, with one pure function, `publishGate(offer, shownOffer)`, and answer `409 offerChanged` when it
  refuses. `shownOffer` is `{ kind: 'choice' | 'publicOnly', credit: 'free' | 'paid' }` and nothing else, because a
  cook can only start or publish from one of those two offers. Any other kind is a `400`. The gate allows the call
  only when the computed offer is publish-allowed (kind `choice` or `publicOnly`) and its `credit` equals the shown
  `credit`. It never compares slots: `choice` and `publicOnly` differ only by a slot fact, and a slot that changes
  between the screen and the call does not refuse it. The budget is checked at Start only. Publish ignores it, and a
  retry that goes over the ceiling ends the job `budgetSpent` in the worker (FR-082). When the server computes the
  offer at Start and at Publish, it EXCLUDES the caller's own live job and its reservation, so "the same job" means the
  same cook's job. If the page is now held by another cook's version, the answer is `409 publicExists`, which takes
  precedence over `offerChanged`. See `contracts/publicVersion.api.md`.

#### E. The review step

- **FR-040**: The cook MUST see and confirm the public version before it publishes: `review.title`, `review.body`, the
  steps, `review.titleNote`, `review.photoNote`, `credit.written`, `credit.basedOn` (free site), `review.licence`, and the actions "Publish", "Edit
  steps" and the path's not-now key (`review.notNow` on the public path, `review.notNowBoth` on the Both path). Nothing publishes without "Publish".
- **FR-041**: "Show my copy" MUST show the cook's copy beside the written steps, during the review on both paths. On the
  Both path it is also reachable later from the public version (owner only, "See my copy").
- **FR-042**: When the cook edits the written steps in the review, the two-way fact check MUST re-run on the server at
  "Publish", against the facts snapshot taken at import (the job's own copy, which also serves the "For everyone" path
  where no private copy exists). The server never trusts a verdict from the client. Each missing fact, missing ingredient name or added fact shows as a flag (`flag.*`: `flag.step`, `flag.allergen` and
  `flag.added`). The `flag.allergen` flag keeps its key and checks the ingredient name only. Publish
  waits until each flag is resolved by an edit or by "Write it again", which calls the retry route and returns the
  job to `pending` (data-model "State transitions"). (C-9)
- **FR-043**: The cook can change the title. The title then goes through the title check of FR-050.
- **FR-044**: A cook with no slot left who reaches `review.notNow` on the "For everyone" path sees the reused `cancel`
  instead of "Keep it just for me".
- **FR-045**: On the Both path the private copy can change between the writing and "Publish". Publish MUST then be
  refused with `409 privateCopyChanged` and "Write it again" (`flag.rewrite`). That retry rebuilds the job's facts
  snapshot and private digest from the changed private copy before the job re-enters `pending`. The wording
  fingerprint stays the one taken from the source at import.

#### F. Every save of a public version

- **FR-050**: Every save of a public version's steps or title, at the review and at any later edit, MUST run the
  wording check against the source's stored fingerprint (FR-080). A save over the threshold MUST be refused, with
  `blocked.body` (`blocked.bodyBoth` on the Both path). The steps use 027's measure and threshold (`027-FR-042`, 027 research R3). This feature sets none. A
  title is too short for that measure, so a title MUST NOT equal the source's title once both are normalised, and its
  check uses 2-word shingles. The check runs inside the recipe write, so it covers an edit and a version restore
  alike. (C-10)
- **FR-050a**: This feature owns the fingerprint key. It is a secret in AWS Secrets Manager, with rotation that keeps
  old versions readable and never deletes one. The source record stores the key version. When the stored key version is
  not the current one, the save runs the check with the stored version's key. Keys are never deleted, so a missing key
  version is an operator fault. On a later edit or a version restore, that save answers a retryable
  `503 { code: 'checkUnavailable' }` and raises an alarm. The editor keeps the cook's edit in its device draft (DD26), so
  nothing is lost, and saves it once the check works again. The cook can still choose "Keep it just for me" (the version
  becomes private). That save does not run the wording check, so it always works. At Publish, a key version the service
  cannot read answers the same retryable `503 { code: 'checkUnavailable' }` and raises the same alarm. The job stays
  `ready` and no attempt is spent, because a new writer call cannot repair a missing key. The cook sees
  `checkUnavailable.body` (`checkUnavailable.bodyBoth` on the Both path) with Publish, enabled, to try again and the path's
  private exit (the path's not-now key). (C-26)
- **FR-051**: Every public door for a public version (publish, a later edit, a restore) MUST pass 020's hold
  (ADR-0074, ADR-0082 §8). The written steps never skip it.
- **FR-052**: A later edit by the cook is allowed, and the fact check is not re-run after publish. The edit is under the
  same licence (FR-062).
- **FR-053**: Every save of cook-typed public text MUST refuse the raw text, before any fold or other normalisation,
  when it contains a bidirectional control: U+202A to U+202E, U+2066 to U+2069, U+200E, U+200F or U+061C. This covers
  the cook's own rewrite of door two ("Adapted by you", FR-015), an edit under FR-050 or FR-052, and a title. The save
  is refused with `blocked.body` (`blocked.bodyBoth` on the Both path). A reversed step wrapped in U+202E is refused.
  Cook-typed public text may be in any language. The save also refuses any WORD that mixes Unicode scripts, such as a
  Latin word with one Cyrillic letter, with `blocked.body` (`blocked.bodyBoth` on the Both path). A word mixes scripts when its UTS #39 resolved script set
  is empty, using augmented script sets: Han with Hiragana and Katakana, Han with Hangul, and Han with Bopomofo each
  count as one script, and Common and Inherited characters (digits, symbols) are ignored. A word in one script passes,
  so "Bibimbap (비빔밥)", "食べる", "350°F" and "½" are accepted. The bidi check comes first, on the raw text. Then default-ignorable code points (soft hyphen, zero-width space and
  similar) are removed, and the mixed-script check reads the result. Both checks run before any fold, and the fold
  removes default-ignorables too (`comparisonForm`). The saved text is never changed by either removal.

#### G. Credit, label and licence

- **FR-060**: A public version MUST show, wherever it is shown, the credit of ADR-0093 §4. The credit reads the
  version's own `recipes.public_credit`, set at Publish from the credit the cook was shown (data-model "Columns on
  existing tables"). `free` shows `credit.written` with the AI disclosure, and `credit.basedOn` with the domain
  line. `{site}` is the registrable domain and a link, read from the source record. `paid` (a clearly paid or an
  unknown paid source, or a paid-list page with no clear signal) shows `credit.written` only: no site is named,
  linked or read for display, and its schema.org data carries no `isBasedOn` (FR-018). `{cook}` is the display name,
  or the username. The wording is in research R8. For `free`, the schema.org data carries `isBasedOn` with the source
  address.
- **FR-061**: A public version's rights label MUST be a new derived label, "Steps written by Commise", never "Written by
  you" and never "Adapted by you" (`016-FR-015i`). It is open to the web (`021-FR-002`). Adding the value is a one-way
  door and needs an ADR before code. (C-11)
- **FR-062**: A public version's text carries the licence and credit of ADR-0093 §4, and the cook's later edits are
  under the same licence. The terms of service say who owns the written steps and the cook's edits. `review.licence`
  links to them. "Publish" is the cook's acceptance of that licence for their edits, recorded as the Publish
  confirmation row (wording `publicVersionConfirm.v1`, data-model "Columns on existing tables").
- **FR-063**: A public version MUST show "Report a problem" (`publicPage.report`). A report hides the version until
  staff look and decide, as ADR-0093 §4 and `020-FR-082` say. 020 owns the hide, the decision and the statement of
  reasons. While it is hidden the owner sees `publicPage.hiddenOwner`, and a reader sees
  `publicPage.hiddenReader`.
- **FR-064**: No string in this feature or in 027's `recipes.flowSteps.*` can use a word on the banned-word list. The
  list lives in one module, `packages/shared/recipe-core/src/copy/bannedWords.ts`, that every copy guard imports. It
  replaces the comment beside `editor.source.rightsLabel` in
  `packages/apps/commise/features/recipes/src/editor/messages.ts`. This spec does not repeat the list. A test enforces
  it over every `importMessages.choice.*` string and every `recipes.flowSteps.*` string.

- **FR-065**: A public version MUST NOT earn rewards under 015, and MUST NOT be offered for sale (018).

#### H. Monitoring and review

- **FR-070**: There are no caps of any kind on public versions (ADR-0093 §8). The source records still let monitoring
  count public versions per source (FR-071).
- **FR-071**: An alarm MUST fire at a set rate of public versions from one source. The rate is
  configuration. The alarm informs a person. It never blocks. (C-13)
- **FR-072**: There is no human-review gate for publishers (ADR-0093 §6a). 020's hold and "Report a problem" apply to
  every public version. (C-12)

#### I. Dead end and subscription

- **FR-073**: The dead end (no slot left, no public version possible, and no public version of the page exists, C-28) MUST show the free ways out first
  (`deadEnd.*`). With 010's switch on and `account.paidFeatures = upsell`, it MUST then show the Pro panel (`pro.*`).
  It shows the real price and period, the renewal, and the trial terms for a cook who has had no trial. "Upgrade to Pro"
  is the primary button and "Compare plans" is a link beside it. "Not now" is an equal-size secondary button.
  `notNow.note` sits above both.
- **FR-074**: "Upgrade to Pro" MUST open the subscription page as a modal at Pro's checkout (`010-FR-042a`). The
  billing period MUST NOT be chosen for the cook. `010-FR-042c` and 010 US6 scenario 2 are amended for this screen only (2026-11-17).
- **FR-075**: With 010's switch off, or `account.paidFeatures = hidden`, the dead end MUST show no paid plan
  (`010-FR-042j`): `deadEnd.*` and one "Close" button.
- **FR-076**: The panel MUST NOT use countdowns, "only today", "last chance", or a decline that shames.

#### J. Cost and failure

- **FR-053a**: 003B uses 027's checks (`027-FR-040` to `FR-042`), which work in any language: they read digits,
  fractions, unit symbols and digit times and temperatures, match every ingredient name to the cook's ingredient list
  exactly, keep the step count within ⌈n/2⌉ to 2n+1 for n source steps (the range is calibrated on the golden
  fixtures) and the sentence count within a set range, and cut words with the platform's segmenter. The address and
  hidden-character rules apply unchanged. Verbs, equipment, safety words and number words are not
  machine-checked. The writer also reads the source step text (027-FR-035), so reuse of the source's wording is
  caught by the fingerprint check (027-FR-042), and the cook's review covers the parts the checks do not. A safety
  instruction with no number, or an amount written as a word, is checked only by the cook's review.
- **FR-080**: Every import from a third-party source MUST write an internal source record, append-only and never shown
  to cooks or readers. It extends ADR-0089 §6's evidence record with these fields:
    - the classification and its inputs, the paid signal and the licence signal.
    - the hashed wording fingerprint of the source's steps and title, never the text.
    - the source's language (FR-012c).
    - the fingerprint's format version and key version. The engine version sits on the job and on the public version.

    A paste with no detectable page address writes no record: `page_key` and `source_key` are NOT NULL, and that
    recipe is Private only (FR-012a).

    The record is never updated. The public version points to it (one public version per record), not the other way
    round. It is the source of truth for this feature. (C-14)

- **FR-081**: The writer call MUST reserve and settle against the one ADR-0024 pool under its own call site. It is
  operating cost (ADR-0024 §6 item 1), never a cook's AI use. (C-15)
- **FR-082**: A ceiling denial MUST end the job `budgetSpent` at once, refund the reservation and never redeliver
  (`004-FR-059` pattern). An unreadable counter or a transport failure retries: the message is not acked, and the worker re-claims the job
  (`writing` to `writing`, no attempt spent, `state_changed_at` unchanged, `claimed_at` updated). The claim is one
  conditional UPDATE: state `pending`, or state `writing` with `claimed_at` older than the visibility timeout, and only a
  claim from `pending` adds an attempt. A job in `pending` or `writing` for more than 10 minutes ends `failed`, which
  rests while fewer than 3 attempts are used (FR-031). (C-25)
- **FR-083**: Writer calls are bounded by the site-wide spend ceiling (FR-082), one public version per source page
  (FR-034) and at most 3 attempts per job (C-7). Making a public version spends no import unit (FR-016a). There is no
  separate daily cap (C-15).
- **FR-084**: A page with a stated AI opt-out signal (`004-FR-063`) MUST NOT be sent to the writer. Only Private is offered,
  with its own line, `privateOnly.line`, which makes no promise of a later public version. (C-16)
- **FR-085**: "Stop" during writing MUST end the job `cancelled` and return the cook to the choice. A result that
  arrives later is dropped. A call already started is still paid from the pool. The cook never pays (FR-081). On the
  Both path the private copy stays.

#### K. Release

- **FR-090**: The feature MUST sit behind one switch, read in one place, shared by web and mobile, and per market
  (ADR-0093 §6a, which rules the launch state). The reader's market decides whether a public version is shown, and
  the cook's market does not gate publishing. There is one switch for each market, all on at launch. With the feature
  switch off, imports behave as today (private only, offer reason `switchOff`).
- **FR-091**: Web and mobile MUST ship every state in the same release (`CODING_STANDARDS.md` §14).
- **FR-092**: The recipe menu MUST show "Share a public version" (`later.action`) when the viewer is the owner, the
  recipe is private, and the recipe read's owner-only `hasSourceRecord` is true (a source record exists whose
  `evidence_id` equals this recipe's evidence row). Only an import writes a source record. An edit in the editor never
  writes one, so adding a link to a recipe there does not make it shareable. Inside that set the item always shows,
  and the offer decides the next screen. On tap the client reads the offer from
  `GET /api/v1/recipes/{recipeId}/public-version/offer` (owner only; `404` for another cook's recipe, a missing recipe
  or a recipe with no source record). The private copy already holds its slot, so the route answers only
  `choice { credit }`, `privateOnly { reason }` or `publicExists { status }`, never `publicOnly` or `deadEnd`. It is
  rendered as the import choice does (FR-020 to FR-024, FR-034), but the choice is Public only: the copy is already
  saved. Start on the later route sends `{ shownOffer: { kind: 'choice', credit } }` and no `choice` field. The job
  has `private_recipe_id` set and `import_item_id` NULL, builds its facts snapshot from the private copy, and sets
  `private_digest`. If the offer changes before Start, the `409 offerChanged` of Start covers it (FR-035). See
  `contracts/publicVersion.api.md`.

### UI states and localisation keys

Keys are under `importMessages.choice.*` unless marked **reuse**. Every state exists on web and mobile. Copy is the
owner-approved v3 draft over v2 (staff-ux-engineer). `staff-ux-engineer` SPECIFY owns layout and final copy.

| State                                                                                                | Keys                                                                                                                                                                                                                                                                                                                                                                       |
| ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Public version already exists                                                                        | `publicExists.published` with `publicExists.link`, `publicExists.writing`, `publicExists.inReview`. A Free cook with no free slot sees the line and the link, with no "Save my copy" and no dead end (C-28)                                                                                                                                                                |
| Public version hidden                                                                                | Owner: `publicPage.hiddenOwner`. Reader: `publicPage.hiddenReader`                                                                                                                                                                                                                                                                                                         |
| Choice                                                                                               | `title`, `explain`, `private.label`, `private.hint` (ICU), `private.hintPro`. And `public.label`, `public.hint`, `both.label`, `both.hint` (ICU), `both.hintPro`. And `creditNote`, `creditLink`, `creditPreview.label`, `pickOne`, `button.private`, `button.public`, `button.both`, `button.none`                                                                        |
| Nothing chosen                                                                                       | `button.none` ("Continue", never disabled): shows `pickOne` and moves focus to the choice group                                                                                                                                                                                                                                                                            |
| Writing (loading)                                                                                    | `writing.title`, `writing.body`, `writing.bothSaved`, `writing.stop`, `writing.announce`                                                                                                                                                                                                                                                                                   |
| Review                                                                                               | `review.title`, `review.body`, `review.titleLabel`, `review.titleNote`, `review.stepsHeading`, `review.compare`, `review.compareHide`, `review.oursHeading`, `review.yourCopyHeading`, `review.photoNote`, `credit.written`, `credit.basedOn` (free site only), `review.licence`, `review.publish`, `review.edit`, `review.notNow`, `review.notNowBoth` (Both path)        |
| Flags after an edit                                                                                  | `flag.title` (ICU), `flag.step`, `flag.allergen`, `flag.added`, `flag.fix`, `flag.rewrite`                                                                                                                                                                                                                                                                                 |
| Wording refused                                                                                      | `blocked.body` (public path) or `blocked.bodyBoth` (Both path), actions `flag.rewrite` ("Write it again"), the path's not-now key. At 3 attempts: `blocked.bodyFinal` (`blocked.bodyFinalBoth` on the Both path) and the not-now key only, with no `flag.rewrite`                                                                                                          |
| Check unavailable (Publish)                                                                          | `checkUnavailable.body` (`checkUnavailable.bodyBoth` on the Both path), Publish enabled to try again, and the path's not-now key. The job stays ready.                                                                                                                                                                                                                     |
| Check unavailable (later edit)                                                                       | The editor's ordinary retryable save error, with no new key. The edit stays in the device draft. "Keep it just for me" stays available.                                                                                                                                                                                                                                    |
| Writer failed                                                                                        | `failed.title`, `failed.body`, `failed.bodyBoth`, `failed.done`, **reuse** `wizard.retry` (hidden at 3 attempts, when only `failed.done` is offered)                                                                                                                                                                                                                       |
| Budget spent                                                                                         | `budget.line`, and `failed.done` on the Both path                                                                                                                                                                                                                                                                                                                          |
| The offer changed                                                                                    | `offerChanged.line`, then the area re-renders from the new offer with nothing selected                                                                                                                                                                                                                                                                                     |
| Private only, by reason                                                                              | One line per reason: `privateOnly.paidRecent` (with `{date}`), `privateOnly.noSteps`, `privateOnly.noSource`, `privateOnly.language`, `privateOnly.languageUnsure`, `budget.line`; `privateOnly.line` for `paidSignature`, `publisherOptOut`, `aiOptOut`, `switchOff`, and for `paidRecent` with no date. On Free the slot line `private.hint` follows. No "later" promise |
| Offline                                                                                              | **reuse** `review.offline` (choosing), `writing.offline` (writing)                                                                                                                                                                                                                                                                                                         |
| No slot, public possible                                                                             | `full.line`, `full.free`, `public.hint`, button `button.public`, then the Pro panel without "Not now"                                                                                                                                                                                                                                                                      |
| Own recipe or open source                                                                            | **reuse** the editor's visibility keys                                                                                                                                                                                                                                                                                                                                     |
| Dead end                                                                                             | `deadEnd.title`, `deadEnd.body` (one string, with `{limit}`), `deadEnd.free`                                                                                                                                                                                                                                                                                               |
| Pro panel                                                                                            | `pro.name`, `pro.trialBadge`, `pro.price`, `pro.saving`, `pro.perk.private`, `pro.perk.pantry`, `pro.perk.ai`, `pro.trial`, `pro.renews`, `pro.upgrade`, `pro.compare`, `notNowLabel`, `notNow.note`, `pro.welcome`, `deadEnd.closed`                                                                                                                                      |
| Dead end, no paid plan                                                                               | `deadEnd.close`, `deadEnd.closeNote`                                                                                                                                                                                                                                                                                                                                       |
| Success                                                                                              | `done.private`, `done.public`, `done.both`, **reuse** `saved`, `savedPublic`                                                                                                                                                                                                                                                                                               |
| Links between the two recipes                                                                        | `done.linkPublic`, `done.linkPrivate`                                                                                                                                                                                                                                                                                                                                      |
| Later route                                                                                          | `later.action` ("Share a public version"), shown by FR-092; the offer decides the next screen. While the offer loads, a spinner replaces the glyph. If the offer fetch fails: `later.failed` with `failed.done`                                                                                                                                                            |
| Age question (after `403 ageConfirmNeeded` at Publish; a second `403` shows **reuse** `failed.body`) | `ageConfirm.title`, `ageConfirm.body`, `ageConfirm.yes`, `ageConfirm.notNow`, recorded as `ageConfirm.v1`                                                                                                                                                                                                                                                                  |
| Public page                                                                                          | `credit.written`, `credit.basedOn` (free site), `review.licence`, `publicPage.report`                                                                                                                                                                                                                                                                                      |

The strings are in `research.md` R8, the single source of the copy. The `budget.allowance` variant of the draft is not used: the writer
is never charged to a cook's uses (FR-081).

### Key Entities

- **Import choice**: the cook's answer for one import item: `private`, `public` or `both`. Stored on the item.
- **Public version**: a recipe row owned by the cook, public, label "Steps written by Commise", licence CC BY-SA 4.0,
  linked to its import item (or, on the later route, its private copy) and its source record, and (Both) to the private copy.
- **Public-version job**: one writer job for one import item or one private copy: `pending`, `writing`, `ready`, `checkRefused`,
  `budgetSpent`, `failed`, `cancelled`, `published`.
- **Source record**: the append-only evidence of FR-080.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: In a human audit of 200 public versions, 0 drop or change an amount, time, temperature or ingredient
  from the cook's copy. The audit also counts the safety lines (`027-FR-041` categories 2 to 7) in each version and finds
  each one kept.
- **SC-002**: 0 public versions are published whose wording check against their source exceeds the threshold, at any
  save (measured from the source records).
- **SC-003**: 0 public versions exist from an opted-out publisher, paid content
  younger than `PAID_CONTENT_HOLD_MONTHS`, or a clearly read paid signature recipe from a single source.
- **SC-004**: 95% of public versions are ready for review within 30 seconds of the choice.
- **SC-005**: Each choice state is reachable and announced on web, iOS and Android, at 320 CSS px with no horizontal
  scroll, and at the largest text size.
- **SC-006**: The feature's spend never takes the ADR-0024 pool past its ceiling (the counter is the control).
- **SC-007** (hypothesis, read at day 30): at least 30% of third-party imports choose "For everyone" or "Both".

## Assumptions

- The engine of 027 is good enough on the facts sheet and the source step text (027-FR-035). 027's bake-off measures it.
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
3. **ADR-0024 §3**: a third ceiling-denial exception (this call site, terminal). Owed.
4. **`016-FR-009`**: "no publication surface for a user under 16". Interim exception (FR-016, C-17): until 016's age
   assurance ships, a cook who confirms "I'm 16 or over" at Publish can publish. It ends when 016's age assurance
   ships and the `under16` offer reason returns. Task T150 removes it.

## Amendments

[ADR-0093](../../docs/architecture/decisions/0093-imported-recipes-go-public-only-as-a-commise-written-version.md)
carries the amendments to 004, 016, 020, 021 and the paste design spec, except the two named under "Still owed" above (§4 writer input, §5 paid-list signal), which the feature ADR (T004) carries. 003B does not duplicate the rest.

Done: `010` US6 scenario 2 and `010-FR-042c` are amended for the dead-end screen only (FR-074, 2026-11-17).

Interim: `016-FR-009` has a deliberate exception for the age gate at Publish (FR-016, C-17). `016-FR-009` carries a
pointer to it. The exception ends when 016's age assurance ships and the `under16` offer reason returns (T150).

Still owed:

- ADR-0093 §4 says the writer sees facts only. This feature changes that: the writer reads the facts sheet and the
  source step text (`027-FR-035`, ruled 2026-11-17). `016-FR-077` already points to `027-FR-035`. The feature ADR
  records the amendment, owed (T004).
- ADR-0093 §5 and `016-FR-080` and `004-FR-014` say a domain on the paid list makes a site paid. This feature changes that: a paid-list
  domain alone is not a clear signal (FR-012, FR-012b), so no hold and no private-copy limit apply to it. The feature ADR
  records the amendment, owed (T004).
- At 3 attempts on the "For everyone" path the failed screen offers only `failed.done`, and the job's end clears the
  pasted text, so the cook's paste is gone. Whether `button.private` ("Save my copy") stays at 3 attempts, saving the
  private copy from the item before the clear, is not decided. Owed to the architect and the owner.
- ADR-0024 §3 (a third no-retry path) and the label, licence, provenance and stored-credit (`recipes.public_credit`)
  one-way doors (FR-060, FR-061, FR-062, data-model), in the feature ADR, owed (T004).

## Clarifications

### Session 2026-11-15 (speckit-clarify, no owner questions asked: each answer is the best default, "Assumed, owner to confirm")

- **C-1. Facts cards?** Ruled 2026-11-15: no facts cards anywhere. Paid sources go public only as a Commise-written
  page (FR-017). How a metered paywall is detected is assumed: page paywall markup. A paid-list entry marked
  metered is not a clear signal on its own (FR-012, FR-012b). Owner to confirm.
- **C-2. How is a US government work detected?** Assumed: a list of federal publisher domains kept as data. State and
  local `.gov` sites are not on it. Owner to confirm.
- **C-3. Does a cook's "I wrote this" lift the rewrite on a detected source?** Assumed: only with a live confirmed site
  claim. Owner to confirm.
- **C-4. Aggregator sites?** Ruled 2026-11-15: the normal rules apply.
- **C-5. Books and magazines?** Assumed: out of v1. 004's rules stand. Owner to confirm.
- **C-6. Bulk import?** Assumed: items save "Just for me". A public version is made later per recipe. No batch rewrite.
  Owner to confirm.
- **C-7. Retries of a refused model result?** Assumed: one automatic retry, then `checkRefused`, and the cook can "Try
  again" once more by hand (the retry route, FR-031). At most 3 attempts per job. Owner to confirm.
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
- **C-15. Who pays and how much?** Assumed: operating cost from the one $100 pool, own call site, bounded by the pool's ceiling,
  one public version per source page and 3 attempts per job. No daily cap (ruled 2026-11-15). Owner to confirm.
- **C-16. Stated AI opt-out on the page?** Assumed: only Private is offered, with its own line and no "later" promise. Owner to confirm.
- **C-17. Age?** Ruled 2026-11-17: publishing at 16 and over, checked at Publish (FR-016). The `under16` offer reason
  is not used until spec 016 adds it back. Until then this is a deliberate interim exception to `016-FR-009`, which spec 016's own age assurance closes (T150). App use at the higher of 13 and the market's digital-consent age.
- **C-18. Rewards and sale?** Assumed: none for a public version (FR-065). Owner to confirm.
- **C-19. Signature recipes and consensus?** Assumed: a signature recipe names the publisher or its brand in its title,
  or is on a signature list kept as data. Only a clearly read signal counts: an unread one does not make a recipe
  private (FR-012b). Until consensus recipes ship, a common paid dish is published from the
  cook's copy alone. Owner to confirm.
- **C-20. Which household view of a paid recipe?** Ruled 2026-11-15: the Commise-written version, or nothing
  without one. Assumed: on a "Just for me" paid copy, the household sees nothing. Owner to confirm.
- **C-21. Recent paid content.** Ruled 2026-11-15: 6 months, one named configurable constant
  (`PAID_CONTENT_HOLD_MONTHS`), counted from the publication date, else from the first import of that page by any
  cook.
- **C-22. Does the on-device AI tier write public versions?** Assumed: no. It serves extraction only. The writer stays
  on the server, so Publish re-checks one known result. Owner to confirm.
- **C-23. AI credit wording?** Ruled 2026-11-15: "Steps written by Commise with AI, checked by {cook}." Final
  wording settled 2026-11-17 (research R8).
- **C-24. Does making a public version cost an allowance unit?** Ruled 2026-11-17: no unit is spent. Making a public
  version is part of the original import, in the same import and on the later "Share a public version" route. The
  import's own unit and every existing import limit stay unchanged.
- **C-25. How long may a writer job run?** Assumed: 10 minutes in `pending` or `writing`, counted from when it last entered that state, then it ends `failed`. Owner to confirm.
- **C-26. Key custody for the wording fingerprint?** Assumed: a secret in AWS Secrets Manager under this feature's
  custody, with rotation that keeps old versions readable. A save with an old key version re-checks with that key.
  A key is never deleted, so a missing one is an operator fault: the save answers a retryable `checkUnavailable` and
  raises an alarm (FR-050a).
  Owner to confirm.
- **C-27. When is a page key released?** Assumed: on delete, a 020 rejection or a publisher
  opt-out, as FR-034a lists. Owner to confirm.
- **C-28. A Free cook with no free slot, where a public version already exists?** Decided, by the 2026-11-17 slot
  rulings: a public version never uses a private slot. The cook sees the existing public version and its link
  (`publicExists.*`). "Save my copy" shows only when a slot is free, which the screen reads from the same slot count as
  the choice screen (`publicExists` itself carries no slot fact, unlike `choice` and `publicOnly`, which differ by
  one). With no free slot the cook can open the public version, and the
  usual Free-limit path applies if they try to save from elsewhere, such as the editor. There is no dead end on this screen.
- **C-29. One key, two strings?** Decided: two keys, so each copy cell holds one string. `review.notNow` is "Keep it
  just for me" (public path) and `review.notNowBoth` is "Don’t publish" (Both path). The designer mirrors the split in
  the boards.
