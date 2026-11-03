# 0074 — The content source check: a hold in the read rule, decided by rules and people, never by the model alone

- **Status:** Accepted
- **Date:** 2026-10-26
- **Amended by:** [ADR-0082](0082-recipes-are-an-open-library-of-facts-cooks-words-and-gated-public-domain.md): the hold covers every door to public and fails closed, and a missing or unknown input reads as held (spec 020 section K). Every other part stands.
- **Amended by:** [ADR-0076](0076-founder-reviews-at-launch-with-a-paid-backup.md): who reviews at launch. The
  founder reviews, a paid backup covers, and a half-time reviewer is hired on a volume trigger. Every decision in
  this ADR stands. [ADR-0077](0077-recipe-rights-label-linked-cards-and-outside-copy-checks.md): for a recipe headed
  public, the check can compare it with its own import page and search the web for its method sentences. What those
  find goes to a person and never blocks. Staff review is a rights check only. Every other decision here stands.
- **Relates to:** spec [020](../../../specs/020-content-source-check/spec.md) and its
  [plan](../../../specs/020-content-source-check/plan.md), which carry the full requirements.
  [ADR-0024](0024-llm-spend-ceiling-reserve-then-settle.md): the one spend pool, its single grantee, and the paths
  that do not retry a denial. [ADR-0026](0026-two-engine-ingredient-parse-pipeline.md): a model never sees the claim
  under test. [ADR-0027](0027-ingredient-phrase-is-not-personal-data.md): the erasure guard's verdicts.
  [ADR-0023](0023-curator-declared-provenance.md): the provenance downgrade route.
  [ADR-0072](0072-bulk-recipe-import.md) §7: import readiness. [ADR-0073](0073-free-tier-private-slots.md): private
  slots. [ADR-0039](0039-database-role-split.md): table policy classes.
  [ADR-0058](0058-never-published-drafts-record-no-version.md): `first_published_at`.

## Context

When a cook makes a recipe public, Commise shows it to everyone. If it came from a cookbook or a paid site, that is a
copy of someone else's work, shown by us. Until now the only control was the cook's own statement, "I wrote this" or
"From a source" (ADR-0072 §9).

The owner ruled on 2026-10-26, in four rounds:

- When code can tell that a recipe is from a book or a paid site, it does not go public.
- When the AI cannot tell, a person decides before it goes public. A recipe skips review only when its text, each
  photo and its source reference all pass green.
- The check also looks in our own database for the same recipe or the same source, and at what a person decided.
- Reviewers are employees, never users.
- Fourth round, on a staff-architect REVIEW of the spec, four rulings:
    - Match effects are an ordered table (ruling 1).
    - A match greens a part only if the copy adds no new evidence and a person's latest decision on that content
      approved it. A green is never passed along (ruling 2).
    - Another cook's private recipe is never disclosed (ruling 3).
    - A private recipe is donated at erasure only if it passes (ruling 4).
- Fifth round: a recipe in review is neither public nor private, and a public one uses no slot (a later ruling the same
  day: a private bulk-import recipe in review holds its slot); the donation deadline is 14 days;
  no random sampling of green recipes for now; and the strict text rule stands.

The REVIEW found nine High defects in the first design. No test in the first design caught five of them:

- Erasure kept a held recipe as "truly public" and donated it.
- A switch back to shadow mode published every held recipe at once.
- A re-check that ran during a reviewer's clearance made the clearance apply to content nobody saw.
- A shared photo left a second recipe's outcome unfinished forever.
- A photo grant on a shared role was open to every function on that role.

This feature is not a legal shield. It lowers how many copies reach the public. Our protection is still hosting at a
user's direction and fast takedown (spec 016).

## Decision

### 1. The hold is part of the READ rule, written once, and the mode is stamped per outcome

A recipe is publicly visible only while its current content digest has an outcome that allows it. The digest covers
the text, the sorted photo hashes and the source statement, so a citation change needs a new outcome.

- The condition is **one exported Specification** in `recipe-core` (`holdSpecification.ts`), in two forms. One is a
  TypeScript predicate for `isRecipeViewableBy`. It is a required field, so every call site fails to compile until it
  supplies it. The other is SQL text (`SOURCE_CHECK_ALLOWS_SQL`), in the shape `PARSE_JOB_AGGREGATE_SQL` already uses.
  A parity test holds the two equal.
- The read rule's three SQL twins **and account erasure** use the SQL text. A guard fails any other SQL that reads the
  outcome table to decide visibility, because erasure's hand-written copy is the one that went wrong.
- It is not a write-side refusal, with three narrow exceptions that §3a lists. Otherwise a save, a publish and a
  visibility change never fail because of an outcome, and the cook's label never changes. A relabel to
  `imported_paid` makes a false positive permanent.
- **The enforcement mode is stamped on each outcome**, once, when its recipe is first headed for public view with that
  content. The read rule reads the stamp, never the current mode. So no mode change hides or reveals a recipe that
  already has an outcome.

### 2. Only the rule-based detectors can block, so `detected` is decided in the save

Every blocking kind is a list or pattern match that code can test: a valid ISBN, a listed publisher or imprint, a
copyright notice naming one, a paid-site template, a cited paid-site host. They run in recipe-service, in the save's
own transaction. A `detected` outcome is written there, with no message and no spend.

A model item is always "for a person". That holds **even if code finds its quote in the text**. A model's choice of
what to quote is not a list or a pattern. A CHECK on the judged items repeats this, and the weight table is an
exhaustive switch whose model arm has one value. A photo signal can never be proven by code, so it only ever sends a
recipe to a person.

### 3. A recipe skips review only when every part is green

`clear` is the conjunction of one green predicate per part: the text, each photo and the source reference. Three
things make a part not green: the model did not read it (budget, cap, failure), code did not find a model quote, or
any item at all. The owner confirmed this strict reading: text is green only when the model raised nothing at all.
Every outcome other than `clear` and `detected` waits for a staff reviewer. Nothing the cook does, no timer and no curator grant lifts
a hold.

`allows` has one author, the pure Policy `allowsPublication`. It is true for `clear`, or when a person cleared **that**
outcome on **that** evidence. The clearance stores the outcome and an evidence reference, so a re-check that replaces
the outcome also withdraws the clearance's effect. The next-period re-check never runs on a cleared outcome. The
re-check and a reviewer's decision each lock the referral row, then the outcome, and change it only by a
compare-and-set.

### 3a. In review, then public or not approved: review never becomes a free private store

Owner ruling, 2026-10-26: "The review process does not take a slot and doesn't become visible as public or private
until it's been approved. While it's in review it is labeled as such." The rest of this section follows from the
owner's rulings, as the coordinator relayed them the same day.

- **The cook-facing state is derived, not a new visibility value.** The stored visibility keeps what the cook asked
  for. After a publish the cook sees **Checking** for a short time (the floor of §7), then **Public** when the outcome
  allows it, or **In review** while a person has not decided. In review is neither public nor private: the read rule
  hides it, and ADR-0073 counts `visibility = 'private'` only, so it uses no slot. That keeps the hold in the read rule
  (§1), and it avoids a new value on a wire enum that installed clients switch over.
- **Not approved ends review.** A `detected` save, a person's non-approval and an upheld appeal each move the recipe to
  `private` in the same transaction, under ADR-0073's lock. It is never published with that content and never deleted
  by us. A person's decision moves it even with no free slot, and the cook is then over the limit, as after a
  downgrade (ADR-0073 §4). It keeps one appeal and a statement of reasons with a generic ground (DSA Art. 17 and 20).
- **The three write-side refusals**, each only while blocking is on:
    - bulk import's, for a `detected` item;
    - a `detected` save by a free cook with no free slot. Nothing is saved yet, and it matches ADR-0073's refusal of a
      book recipe with no slot. Without it, "I wrote this" over a book recipe would buy unlimited private storage,
      while the honest statement is refused. It answers `403 SOURCE_DETECTED_NO_PRIVATE_SLOT`, with ADR-0073's `used`
      and `limit`;
    - a change to public of content whose review ended without approval. A person's decision always ends review, and
      the same unchanged content cannot enter it again. It answers `403 SOURCE_CHECK_NOT_APPROVED`.
- **Each refusal is `403`, never `409`.** These refusals reach routes that installed apps already call, and the recipe
  client treats any unknown `409` as a version conflict, so an older app would open the conflict view. ADR-0073 chose
  `403` for `PRIVATE_SLOTS_FULL` for the same reason.
- **While in review the cook may** switch to Private (a free slot is needed, and the referral is withdrawn), go back to
  Draft (the referral is withdrawn), edit it (a new check replaces the referral, and the editor warns first), or
  delete it. A recipe keeps the queue place it had when it first entered review, so edits and trips through Draft
  never push it back.

**Bulk imports are checked whatever their visibility** (owner ruling, 2026-10-26, ADR-0072 §3). After the cook's match
review, each imported recipe is saved published with the visibility the cook chose. It goes straight to that
visibility when every part is green, and waits in review for a person otherwise, private ones included. A recipe in
review, of either visibility, has a draft's restrictions (spec 001 FR-003b). A public one in review uses no slot. A
private one holds its slot from the save until a person checks it (owner ruling, 2026-10-26, ADR-0073 §11), so the
ordinary slot count already counts it. "In review" is defined by the check row, not by the stored visibility, and it
is one exported predicate, `IN_REVIEW_SQL`, beside `SOURCE_CHECK_ALLOWS_SQL`. The cook-facing state, the pickers and
every feature gate read it. An imported recipe stays subject to review until its content is first
approved, so switching visibility or a trip through Draft cannot skip it. Recipes a cook makes private in the editor
are still not checked. A book or paid-site import goes straight to private, with no check, because its statement
already names the source and it can never be public (owner ruling, 2026-10-26).

So a recipe leaves review only by approval, by a decision that makes it private and costs a slot, by the cook's own
move to Private or Draft, or by deletion. A draft uses no slot, but it can be used for nothing except editing (owner
ruling, 2026-10-26, ADR-0073 §12), so the Draft exit is not a free private store either. The rule-blocked publish
refusal never stops a draft save, for the same reason.

**A rejection tells the cook why** (owner ruling, 2026-10-26). "In review" and "Checking" stay generic. A person who
does not approve a recipe picks one reason from a fixed list (`book`, `paidSite`, `notYours`, `printedPage`, `other`,
localised under `recipe.review.reason.*`) and may add a note, which the cook sees word for word. A separate staff note
never reaches the cook. The other recipe is never named or linked. `notYours` is offered only when the matched recipe
is another cook's and is public at the moment of the decision. The decision route enforces this, not only the screen,
so the rule of §7 holds.

### 4. Evidence is stored per part: model evidence shared by content, rule evidence per check

Model evidence is a content-addressed cache, shared by every recipe with the same part, keyed by everything that can
change the answer: the part's digest, the model, the system prompt's SHA-256, the output schema version and the photo
rendition version. It holds no user id, no quote, no marker text, no text and no photo, so it survives erasure as
retained by ruling.

Rule evidence is cheap. It depends on the citation, the label and the live rightsholder list. So it is worked out on
every check and stored with that recipe's outcome. That recipe's judged items carry the markers the same-items rule
needs (§5), and they are erased with the recipe.

Two recipes that share a part never pay twice. A worker claims a part with a **lease** before any reservation. When a
part's evidence lands, the same transaction sends the check again for every outcome still waiting on it (a fan-in).
That rerun does the cheap steps again and finds the evidence there, so an outcome is always worked out by its own run,
in one place. A sweep re-drives what the fan-in misses.

### 5. A match counts only through a person's own latest decision, in a fixed order

The lookup searches our own database for the same recipe (an exact fingerprint, and near copies) and the same source
(page, host or ISBN keys). `matchEffectOf` is an **ordered decision table**: for each candidate, the first row that
applies decides.

| #   | When                                                                                                                                                                                        | Effect on the part |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| 1   | The candidate is this recipe, or in its clone tree (ancestors to the root, and every recipe with that root)                                                                                 | None               |
| 2   | The latest decision on the candidate's matched content is a hold: by a person, or `detected` and not overturned. A hold hash kept after erasure counts                                      | Not green          |
| 3   | A person's latest decision on the matched content cleared it. The copy adds no new evidence. The candidate is the same cook's, or shares a cited page or ISBN key and is not `user_created` | Green              |
| 4   | The candidate is another cook's private recipe                                                                                                                                              | Not green          |
| 5   | The candidate is another cook's public recipe sharing no cited page or ISBN key, or it is `user_created`: an internal copy                                                                  | Not green          |
| 6   | Anything else: an automated clear only, the same cook's with no person decision, a shared key with no person decision                                                                       | None               |

- Rows 2, 4 and 5 count only a candidate **first published before** this recipe. A recipe never published is never
  one.
- **The same-items rule** (ruling 2): row 3 needs every item in the copy's part to appear in the approved version, by
  kind and normalised marker. Free-text markers are compared by digest, so a different copyright holder is a different
  item.
- **No passing along** (ruling 2): row 3 needs a person's own decision on the candidate's matched digest. A candidate
  allowed only because a match greened it is row 6.
- Per part, effects combine as a lattice join: not green beats green, and green beats none. A blocking rule item makes
  the outcome `detected` whatever any match says.
- Source decisions sit beside the table: a staff block on one of the recipe's keys makes the source reference not
  green, and a staff approval makes it green. Retiring or reversing a source decision changes no outcome already
  produced and undoes no person's decision. Clearing one recipe never approves its source.
- The label of a private candidate is never evidence. A near copy of another cook's private book recipe is row 4, not
  `detected`.

### 6. The lookup runs in the worker, before any spend

recipe-service writes the fingerprint and source keys in the content transaction, and does no lookup in the request.
The worker runs it after it re-derives the digest and before it claims or reserves anything. Near copies come from
Postgres `pg_trgm` (maintained, already installed) under `SET LOCAL pg_trgm.similarity_threshold`, confirmed by word
shingle Jaccard. Thresholds are measured on a labeled pairs set.

A GIN trigram index over whole recipes is the wrong shape at scale, because common trigrams match nearly everything.
So a LOCAL e2e benchmark at the projected corpus size gates blocking. If it fails, MinHash signatures with an LSH band
table replace the GIN index. Both are derived indexes rebuilt from the stored match text, so the flip changes no user
data. MinHash is not used now. We found no JavaScript MinHash library whose maintenance we can confirm, and the
library-first rule forbids a hand-rolled one without that check.

### 7. Another cook's private recipe is never disclosed (ruling 3)

Private recipes are candidates. A cook never learns anything about another cook's private recipe, or that it exists.

- **One message for every cause while in review** (owner ruling, 2026-10-26). A recipe in review shows "In review: a person will
  check this before it goes public", with no outcome value, reason or part result. A match, public or private, a
  source decision, a page reference, a photo signal and a spent budget all look the same. There is no field that says
  why anything is green or not.
- The worker runs **the same steps whatever the lookup finds**, and writes the outcome only once every part is read,
  so the time to an outcome does not show whether a match exists.
- **No outcome is revealed before a floor.** Model evidence is a shared cache, so an exact copy of a recipe checked
  before gets its answer in milliseconds, and that recipe can be another cook's private recipe. So every outcome the
  worker produces carries a `reveal_at`, the start of its check plus a floor measured from an uncached check. Neither
  the cook's view nor the hold Specification moves before it. A rule-only `detected` is exempt, because it reads only
  the cook's own content.
- A rejection's statement of reasons takes one reason from a fixed list and the reviewer's note. It never names or
  links another recipe, and `notYours` is refused for a private match (§3a). The staff note never reaches the cook.
- A private candidate with no person decision can only send a recipe to a person.
- Staff see the match and its earlier decision, never a private recipe's content.

### 8. The switch moves one way out of shadow, and `paused` is its rollback

Blocking starts in shadow mode, before launch, and switches on only after the labeled-set evaluation and the
duplicate measurement pass. The ledger is append-only (a `dictionary` table under ADR-0039: SELECT and INSERT only).
The legal moves are `shadow` → `blocking`, `blocking` → `paused` and `paused` → `blocking`. A trigger under a lock
refuses every other move, a return to `shadow` included, because a CHECK cannot see the row before it. The mode is
stamped per outcome (§1). So `paused` stops new holds and keeps existing ones. And switching blocking on never hides a
recipe that is already public.

### 9. Erasure keeps only what the hold allows, and donation passes the same check (ruling 4)

- Erasure's "truly public" predicate is `public AND published AND` the hold Specification. A held public recipe is
  deleted with the account.
- A private recipe the cook elects to donate is checked at election. If every part is green it is donated. If not, a
  person decides, and the erasure waits for that person for at most **14 days** (owner ruling, 2026-10-26). That leaves
  about sixteen days of GDPR Art. 12(3)'s one month for the rest of the erasure. The account is closed meanwhile. A
  recipe still waiting after 14 days is deleted. An elected recipe already in review waits the same way. A
  not-approved recipe is never donated, because its content has a final decision. The cook is told all this at
  election, before they confirm.
- The existing erasure transaction keeps its shape. It gains the SQL text and a wait before its recipe phase.
- A deleted recipe is a tombstone. Its match rows go and its live referrals close in the same transaction, so a
  deleted recipe matches nothing.
- A decision record is kept for spec 016's period and then purged. Only a **hold** decision keeps the text
  fingerprint, a versioned hash, so a kept hash can only ever send a copy to a person. ADR-0027 records the erasure
  guard's third map, for this time-boxed retention.

### 10. Spend: a new call site under the one grantee, with a photo read scoped by function

- The model call is a new entry in `SPEND_CALL_SITES` under the existing verification role, with its own Lambda,
  queue, DLQ and reserved concurrency. No second Bedrock grantee.
- A ceiling denial on this call site is **not retried**. The part reads `budgetSpent` for the period captured at
  reserve, and a person decides. After the period ends, the part is checked again. ADR-0024 §3 records this as its
  second path that does not retry a denial.
- The read of the photo check renditions sits on the shared role, so it carries a `lambda:SourceFunctionArn` condition
  naming the source-check function, read-only on the rendition prefix, in its own `iam.Policy`. An infra guard asserts
  it. ADR-0024 layer 4b records it.
- A guard pins this call site's model to an in-region registry entry.

## Consequences

- A save fails because of the check only in the three refusals of §3a, and no write path can go around the hold.
- A `detected` recipe is known when the save returns. Bulk import waits only for the rules (ADR-0072 §7), and every
  other item is saved published and checked after, public or private.
- Most unsure cases become staff work. Shadow mode forecasts that load as information, and it gates nothing.
- A copy of a recipe a person approved, from the same page or book, goes public without a second review, unless it
  adds evidence.
- Erasure can wait for a person, for a bounded time, when a cook elects to donate a recipe that needs one.
- The model's value is `possible`, never `detected`. A publisher the model keeps finding goes on the list.

## One-way doors

- **The three digests and their `v1:` versions.** A change of field list or normalisation is a new version, and it
  makes every stored digest stale at once.
- **The cook-facing contract:** the outcome, reason, part reason and note values. Installed clients switch over them.
  The absence of any field that says why a part is green is part of the contract (§7).
- **The decision table's row order** (§5). Reordering rows changes outcomes for content already checked the next time
  it is checked.
- **The kept hold hash.** A decision row keeps it for years. Its version prefix lets a later normalisation exist beside
  it.

## Residual risks

- **Unmarked copies pass.** A cookbook recipe typed out without its markers, with a plain dish photo, usually reads
  `clear`. The evaluation reports this, and no claim hides it.
- **Non-disclosure leaves one accepted residual.** While in review, a cook learns only that a person will check, never
  what or whose. A rejection gives one of five reasons, and its note rests on a staff guideline, not on code.
  The owner ruled on 2026-10-26 not to add cover traffic, such as a random sample of all-green recipes sent to a
  person, for now.
- **A cook can end up over the private limit.** A person's non-approval makes the recipe private even with no free
  slot. The number of such recipes is bounded by staff decisions, not by the cook.
- **Publishing first evades the original.** `first_published_at` is set once. A cook who publishes a placeholder early
  and pastes another cook's recipe into it later is treated as the earlier of the two. The honest original is then the
  one sent to a person at its next check. To order by the latest content change instead flags every original each
  time a copy is edited first.
- **The lookup's cost at scale is unmeasured** until the benchmark runs.
- **The timing floor makes every checked recipe wait at least that long**, even one whose answer was cached. That is
  the price of not showing a cook whether an exact copy exists.
- **The queue has no automatic way out.** With one reviewer, a busy week, a spent AI budget or one curated book can
  hold recipes for a long time. The per-cook cap only defers.
- **Counsel items stay open:** the standard for a reviewer's clearance, a statement for a pending hold, the generic
  match fact under DSA Art. 17(3)(b), whether 14 days is undue delay for a donation, and a statement owed to an erased
  cook.

## Alternatives

- **A new `RecipeStatus` value, such as `pending_check`.** It is a closed wire enum that installed clients switch
  over, and it puts two facts in one field.
- **Relabel a `detected` recipe to `imported_paid`.** Permanent on a false positive, and it overwrites the cook's
  statement, which spec 016 makes the controlling record.
- **A new `inReview` visibility value.** A wire one-way door that puts two facts in one field. The derived state does
  the same job.
- **Leave a not-approved recipe owner-only until the cook chooses.** That is the free private store the owner's ruling
  closes.
- **Read the current mode in the read rule.** One insert back to `shadow` publishes every held recipe.
- **A switch with no pause.** No rollback short of a release.
- **Let a proven model quote block.** It makes the model an author of `detected`, and puts a model call in front of a
  decision that code makes in the save.
- **Look up our own database in the request.** It adds latency to every save, and its timing shows the cook whether
  a match exists.
- **Count any earlier clear as an approval.** Automated results then pass each other along with no person in the
  loop.
- **One claim per part with no lease and no fan-in.** The second recipe that shares a photo waits forever.
- **A photo grant on the role with no function condition.** Every function on the shared role can then read cooks'
  photos.
- **Erase at once and keep elected recipes, pseudonymised, until a person decides.** It needs a second recipe phase
  and keeps content after the account is gone. Kept as the fallback if counsel calls the wait undue delay.
