# Research: Content Source Check

**Feature**: [spec.md](spec.md) | **Plan**: [plan.md](plan.md) | **Date**: 2026-10-26

Each section states the decision, why, and what was rejected. The owner answered both spec questions on 2026-10-26:
**Q1**, photos are in scope and anything the AI cannot decide goes to a person; **Q2**, a person decides the unsure
case. A second round the same day ruled on four readings: a spent budget waits for a person; a curator's grant is not
a review; a recipe skips review only when every part is green; and review time targets wait ("we can deal with
SLO/SLA later"), with reviewers always employees. A third ruling added the lookup in our own database (R-17).

## R-01. Where the model call runs, and under which grant

**Decision**: the model detector runs in `recipe-workers`, as a new entry `source-check` in `SPEND_CALL_SITES`
(`packages/shared/recipe-core/src/spend/spendArithmetic.ts`), under the existing verification role. It does not add a
second `bedrock:InvokeModel` grantee. The call goes through `gatedLlm.ts`, so it reserves before the call and settles
after, like the five call sites already there.

**Rationale**:

- recipe-service runs on Fargate and holds no Bedrock grant. The one grantee is the verification role (ADR-0024 layer
  4b), and `llmSpendGuards.test.ts` fails a second grantee by design.
- ADR-0024 §4c says a new consumer reopens the call-site list, not the pool. One $100 pool, attributed by call site.
- It is the sixth call site, not the fifth. The list already holds `verification-gate`, `ingredient-parse`,
  `foodness-validator`, `measurement-validator` and `paste-match-review`.

**It is its own function on the shared role.** Same role is not same function. The check gets its own Lambda, its own
SQS queue with a DLQ, and its own reserved concurrency from `consumerConcurrency.ts`. It does not share the verifier's
concurrency. `verificationRole` already backs two functions, so this is a known shape.

**Three guards move with it**:

- `llmSpendGuards.test.ts` pins layer 2 on one named function (`VERIFIER_FUNCTION`). It is extended to find every
  function on the grantee role, so a new function cannot escape the concurrency check.
- The function connects to the recipe database, so it is VPC-attached and adds a row to ADR-0004's NAT consumer table.
  `natEgressConsumers.test.ts` asserts that table in both directions.
- ADR-0024 §4c's amendment still says four call sites. It is corrected to six.

**Consequences accepted**:

- The check is asynchronous. A publish cannot wait on it inside the request, so the cook sees a "checking" state
  (spec FR-001, SC-005).
- It shares the one $100 pool with five other call sites. A large bulk import can use up the pool, and every
  check after that is `unchecked`. Attribution by call site shows who used it. It does not prevent it.
- Non-prod calls the provider ungated (ADR-0024 §3), and the stated non-prod bound was measured wrong (pr-91 spent
  $252.96). A new consumer adds to that exposure. Its own reserved concurrency of 1 in non-prod is the blast-radius
  bound.

**Rejected**:

- **A second grantee in recipe-service**: breaks layer 4b and its guard, and puts a Bedrock client in the request path.
- **A synchronous call from recipe-service through the worker**: a publish then hangs on model latency and on the
  queue, and a ceiling denial becomes a failed request.

## R-02. Where the publication hold lives

**Decision**: a per-recipe check row, read at query time (staff-architect PLANNING, option A).

- recipe-service writes `recipes.checked_content_digest` in the same transaction as any change to the checked content.
- The worker upserts `recipe_source_checks(recipe_id, content_digest)` with `allows`. It never writes the `recipes` row.
- The read rule adds one condition: a row exists for this recipe and its current digest, and it allows publication.
- Nobody flips visibility when a verdict lands. Visibility follows from the row.
- An edit to a public recipe changes the digest in the same transaction, so the recipe leaves public view at once
  (spec US6).
- The row points at the outcome actually produced, so a later model or rule change cannot hide the corpus (spec
  FR-002).

**Why per recipe and not per digest**: the outcome depends on the label and the cited host (spec FR-010). Evidence is
shared per digest; the outcome is not.

**Flip condition**: if search p95 with the extra `EXISTS` exceeds budget under k6, move to a fence column
(`recipes.cleared_digest`), at the cost of the worker writing `recipes`.

**Rejected**:

- **A new `RecipeStatus` value such as `pending_check`**: the status is a closed wire enum that installed clients
  switch over. A new value is a one-way door. It also puts two facts into one field: draft or published, and checked
  or not.
- **Relabelling to `imported_paid`**: permanent on a false positive, and it overwrites the cook's attestation
  (spec FR-014).
- **A fence column on `recipes`** (`cleared_digest`): no join on search, but the worker becomes a second writer of
  `recipes` and every writer needs compare-and-set. Kept as the flip option above.
- **A write-side refusal composed in front of C-004**: a `detected` recipe would make `create` and `setVisibility`
  throw, which breaks "never blocks a save" (spec FR-014). The hold is a read-side rule (spec FR-018).

## R-03. The rule-based detectors

**Decision**: pure functions in `recipe-core`, run on the full checked text, needing no network and no model.

| Detector             | How                                                                                                                                                                |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| ISBN                 | `isbn3` (MIT, maintained since 2019) parses ISBN-10 and ISBN-13 and validates the checksum. A string that fails the checksum is not evidence                       |
| Publisher, imprint   | Exact, case-insensitive phrase match against the rightsholder list (R-06), on word boundaries                                                                      |
| Copyright notice     | `©`, `(c)`, "Copyright" or "All rights reserved", with the holder phrase that follows. The holder is then matched against the rightsholder list                    |
| Page reference       | "page 112", "p. 45", "pp. 12–14", "see page", in recipe context                                                                                                    |
| Paid-site template   | Exact match against template strings on the rightsholder list (for example a site's own "Subscribe to read" or print footer)                                       |
| Cited paid-site host | The WHATWG `URL` parser reads the cited URL. `tldts`, already in the tree, gives its registrable domain. That domain is matched against the list's hosts. No fetch |

**Rationale**: library-first for the two parts that are easy to get wrong. ISBN checksums have two schemes and edge
cases (`X` check digit, 978/979 prefixes). Registrable-domain matching needs the public suffix list. The phrase and
regex detectors are small, pure and table-tested.

**Rejected**: a model-only check. A model's confidence is not calibrated, and a block that rests on it cannot be
explained or tested. Code-verifiable evidence is what makes `detected` defensible (spec FR-009, FR-010).

## R-04. The model detector

**Decision**:

- **Input**: the checked content only. One text call takes the checked text, in the user turn, verbatim. One call per
  photo takes the resized photo alone (R-07). Each system prompt is fixed and pinned by length and SHA-256, as
  `buildParsePrompt` is (ADR-0026). Each prompt builder takes one branded value and nothing else. Its parameter list is
  pinned in invariant position. A second parameter (a statement, a label, a rule result) then fails the build.
- **Text output**: a strict JSON object, parsed with zod, holding at most a fixed number of evidence items. Each item is
  a kind from a closed set, a field name and a quote.
- **Photo output**: a strict JSON object holding at most five signals from the closed set in spec FR-006a, and no free
  text. A style judgement cannot be expressed.
- **Verification**: each text quote is normalised (Unicode NFKC, whitespace collapsed) and searched for in the same
  normalised checked text. A quote that is not found is dropped and counted in a metric. A photo signal cannot be
  verified, so it is stored as unproven and can only send the recipe to a person.
- **Caps**: explicit `maxTokens` and a hard input cap on every call. Content over the cap is not sent (ADR-0024:
  reject, never truncate). Its outcome is `unchecked` (`tooLong`), unless the rule-based detectors found blocking
  evidence.

**Rationale**: the model widens recall. It can point at a publisher name not yet on the list, a headnote in a
publisher's voice, or a photographed book page. Every text quote is either proven or discarded, and every photo signal
goes to a person. Prompt injection can at worst hide evidence. It can never create a block or clear a photo.

**Rejected**: showing the model the cook's statement "for context". It is the claim under test. A model that sees it
agrees with it more often, and that bias looks like accuracy.

## R-05. Model choice and residency

**Decision**: a model that takes images and runs in the deploy region, so no residency approval is needed. That is
**Nova Lite v1**: it takes image input and stays in region. The staff-architect checked both facts against the Bedrock
model cards on 2026-10-26. The bake-off on the labeled set (R-08) can still pick Nova Micro for the text call, if it
matches Nova Lite there at a lower price. Nova Micro takes no images.

- **Approval is per model today, not per call site** (`spendArithmetic.ts`). Nova 2 Lite's approval for the parse leg
  would therefore silently cover this call site too. Spec FR-033 forbids that. Either this call site uses an in-region
  model (chosen), or the registry's approval gains a call-site scope first.

**Cost**: stated per check from the rate table in `spendArithmetic.ts` once the model is chosen. Checks run only for
recipes headed public, once per digest. Photos dominate the cost: a recipe can carry ten. R-07 bounds each one.

## R-06. The rightsholder list

**Decision**: one data table of markers. Each marker has a kind (`host`, `imprint`, `template`) and a value. It also
records who added it, when and why. An admin-scoped endpoint and an audit trail manage it. It serves both 020 and
`004-FR-014`'s paywall blocklist (004 D-004), which is specified but not built. A paid-site host is one fact, so it has
one row.

**Rationale**: DRY over knowledge. A host that blocks a URL import and a host that marks a cited link are the same
fact about the same site.

**Rejected**: a code constant. 004 D-004 already ruled that the list changes as an operational act, not a release.

## R-07. Photos (owner ruling Q1: in scope, unsure goes to a person)

**The constraint that shapes everything**: code cannot find a model's "quote" in an image. Text evidence is proven by
finding the quote in the text. Nothing like that exists for a photo. So under the owner's ruling a photo signal is the
clearest case of "the AI can't figure it out": it sends the recipe to a person, and it never blocks or clears on its
own (spec FR-006).

**Decision**:

- **What is read**: every photo the cook uploaded to a recipe headed public (`recipe_photos`), up to
  `MAX_RECIPE_PHOTOS` (10). Imported third-party photos are shown by reference and never stored (`016-FR-027`), so they
  are not read.
- **How**: one model call per photo. The call sends the photo's **check rendition**: a copy at a fixed maximum size,
  made by recipe-service with `sharp` when the upload is confirmed, beside the thumbnail it already makes. It is the
  cook's own photo, stored under the same owner erasure prefix, so erasure removes it with the photo. `016-FR-027c`
  forbids renditions of third-party photos, and those are never stored or checked.
- **Why at confirm, not in the worker**: resizing in the Lambda would put `sharp`'s native binary into a recipe-workers
  bundle, a build shape that package does not have. recipe-service already runs `sharp` for thumbnails.
- **What can come back**: only the five signals in spec FR-006a. Each becomes an unproven item, "for a person".
- **No OCR engine is added.** An OCR reading would let code prove some photo text, but the owner's ruling sends every
  photo signal to a person anyway, so OCR would change nothing that is decided. It would add a second vendor. If the
  owner later wants a photographed ISBN to block on its own, OCR is the way, and it reopens this section.
- **Digest**: the photo's `content_sha256` joins the content digest, so adding or replacing a photo starts a check and
  reordering does not.

**Costs that come with photos, and how each is handled**:

| Cost                                            | Handling                                                                                                                                                                    |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Image tokens are not bounded by a text byte cap | The check rendition has a fixed maximum size, so each photo has a token ceiling. Reserve the ceiling (spec FR-023a, workerAndModel.md)                                      |
| The worker needs the photo bytes                | A read grant on the check renditions in the photo bucket, and nothing else                                                                                                  |
| CloudFront serves photos as-is                  | A held recipe's photos are not on any public surface. If a recipe that was public becomes held, its photo paths are invalidated through `cdnInvalidation.ts` (spec FR-018b) |
| Reviewers must see photos they do not own       | Short-lived signed URLs on the scoped reviewer read                                                                                                                         |
| Most photos are food photos with no signal      | The closed signal set has no "looks professional". A plain dish photo returns no signal and costs a person nothing                                                          |

**What this makes impossible**: no photo can be held back by code alone, and no photo with a signal can be published
without a person. Every photographed cookbook page is a person's work. That is the ruling's intended cost, and R-10
sizes it.

## R-08. Measuring the check

**Decision**:

- **Labeled set**: at least 300 third-party items with markers, at least 300 own or public items, and a further
  group of third-party items with no markers. It includes photos: cooks' dish photos, photographed book pages and
  screenshots of paid sites. Kept outside the repository, access limited to the operator, pending counsel (spec
  FR-041).
- **Metrics**:
    - precision of `detected`, with a Wilson 95% interval (SC-001: point at least 97%, lower bound at least 95%)
    - recall on marked items (SC-002: at least 90%), and the share of book-page and paid-site photos sent to a person
      (SC-002: at least 90%)
    - recall on unmarked items, reported with no target (SC-003)
    - the share of own and public items that would go to a person. This is the false-alarm cost in reviewer time,
      and it feeds the forecast (R-10)
- **Minutes per referral**: measured by timing reviewers on a sample of shadow referrals, not assumed.
- **Duplicate pairs**: a second labeled set of recipe pairs measures the same-recipe lookup (R-17, SC-015): at least
  95% precision and 90% recall at the chosen thresholds.
- **Shadow mode first** (spec FR-019): the check records outcomes and holds nothing until the evaluation passes.
  Switching blocking on is a recorded operator act.
- **In production**: the appeal overturn rate is the live precision signal for `detected`, and the clear rate of
  check referrals is the live false-alarm signal for `possible`. A rising rate on either is an alert, not a dashboard
  number.

**Rationale**: a precision target without an interval is a claim about one lucky sample. 300 detections is roughly
what a 95% lower bound at a 97% point needs.

Inspection is not user evidence. This set measures detection. Whether cooks find holds fair, or the copy clear, needs
a study.

## R-09. Legal framing

These shape the design. Counsel confirms them (spec FR-041). This is not legal advice.

- **No duty to monitor.** 17 U.S.C. §512(m) says safe harbour does not depend on monitoring. The check is voluntary.
- **Knowledge.** Under §512(c)(1)(A), a host that knows, or is aware of facts that make infringement apparent, loses
  safe harbour unless it acts. Courts have read this as knowledge of specific infringing material (Viacom v. YouTube,
  2d Cir. 2012). Under Q2 a flagged recipe no longer publishes on the cook's word. The question moves to the reviewer:
  what standard does a person apply when they clear a flagged recipe, and does the record show it? That is the counsel
  item.
- **EU.** DSA Art. 7 says voluntary own-initiative checks do not by themselves cost a host its exemption, and Art. 8
  says there is no general monitoring duty. A hold restricts visibility, so Art. 17 requires a statement of reasons
  that includes the use of automated means. Whether a hold pending a person's decision already needs one is a counsel
  item.
- **Profiling.** GDPR Art. 22 is about decisions based solely on automated processing with legal or similarly
  significant effects. Every unsure case now goes to a person, and a `detected` hold can be appealed to one, so no
  hold rests solely on automated processing for long.
- **The check is not a shield** (016, finding 2). A `clear` outcome, or a person's clearance, is never evidence that a
  recipe is lawful.

## R-10. Review load, as information

The owner's rulings move every case the AI cannot decide to a person, and only an all-green recipe skips review. That
makes staff time the real limit on how fast unsure recipes go public. The owner ruled that targets wait ("we can deal
with SLO/SLA later"), so the plan measures the load and gates nothing on it.

**What makes a referral** (spec FR-016b: only on publish, never for a draft):

| Source                     | When                                                                 | Expected share                              |
| -------------------------- | -------------------------------------------------------------------- | ------------------------------------------- |
| `possible` from text       | page references, unlisted notices, model judgements, unproven quotes | measured in shadow mode                     |
| `possible` from a photo    | any photo signal                                                     | measured in shadow mode                     |
| `possible` from the source | an unreadable citation, a rights check that did not say public       | measured in shadow mode                     |
| `possible` from a match    | a near-duplicate of a blocked recipe, an internal copy               | measured in shadow mode                     |
| `unchecked`                | budget spent, content too long, check failed                         | near zero, except after the budget runs out |
| appeal                     | the cook asks                                                        | a fraction of holds                         |

**The forecast** (spec FR-039a): referrals per day = publishes per day × measured referral share + appeals per day.
Staff time = referrals × measured minutes per referral. No figure is assumed: shadow mode measures both. Three cases
are shown apart:

- **Ordinary publishing.**
- **A budget month.** When the $100 pool runs out, every publish without rule evidence becomes `unchecked` and a
  referral until the period ends (spec FR-020, confirmed by the owner). That is the worst steady load.
- **A curated book.** Curated recipes are reviewed like everyone else's (owner, 2026-10-26). Old cookbooks are full
  of page references, so close to every recipe in an imported book becomes a referral, at once. That is a one-time
  backlog per book (R-16).

**What lowers the load**, none of which publishes without a person:

- Same-recipe and same-source matches to a person's earlier approval (R-17). A second copy of an approved recipe from
  the same page needs no new review.
- A staff source decision (spec FR-050): approving a public-domain book or an openly licensed site once makes its
  recipes' source reference green.
- Raising the AI budget, which keeps a spent month from flooding the queue.
- Adding markers to the rightsholder list, so more cases become proven `detected` and fewer go to a person.
- Grouping one cook's, one import's or one book's referrals, so a reviewer decides them in one sitting (spec FR-030a).

**Not a lever**: auto-clearing old referrals, letting the cook clear their own, or counting an automated `clear` as
an approval. Each breaks the owner's rulings.

## R-11. Statement of reasons

**Decision**: a fixed, localised template filled from the evidence kinds and their fields. It names the action, the
ground, the facts, automated means and the redress (spec FR-028). It is delivered through 016's mechanism.

**Rationale**: model prose is AI-generated content shown to a user (`GR-010`, `016-FR-046`). It can misstate the
evidence, and counsel cannot approve it in advance. Counsel can approve a template.

## R-12. Failure and the spent budget

**Decision**:

- **Ceiling denial**: the rule-based detectors have already run. With no blocking evidence, the outcome is
  `unchecked` (`budgetSpent`), and a published recipe goes to a person (spec FR-020). This reads the Q1 ruling ("If the
  AI can't figure out … raise it to a human") onto the spent-budget case. It replaces, for this feature only, the
  general ruling that the cook is asked (ADR-0072 §10 keeps that ruling for matching). The owner confirmed this reading
  on 2026-10-26.
- **Next period**: at the change of period, every open referral with `unchecked` (`budgetSpent`) is checked again
  (spec FR-021). A `clear` result closes the referral with no person needed, which drains most of a budget month's
  queue on its own. The period key is captured at reserve, as ADR-0024 requires.
- **Unreadable counter**: transient, fails closed, retried under the queue's `maxReceiveCount`. When retries are
  spent, the DLQ handler writes `unchecked` (`checkFailed`) so no recipe waits in "checking" forever (spec FR-022). The
  DLQ has an active watcher.

## R-13. Where decisions and referrals are recorded

**Decision**: 020 keeps its decision and referral rows in the **recipe** database, next to the recipe they judge.
Decisions are kept for 016's period (`016-FR-052a`). 016's compliance history (`016-FR-053`) reads them through the
internal path 016 already plans. 016's statement-of-reasons **delivery** (in-app and email) is generalised to take a
decision from 020. Its `notice_decisions` table is not.

**Rationale**: `notice_decisions` has a NOT NULL foreign key to `notices`, and expects `automated_means` to be false.
A hold has no notice. Bending that table would change 016's evidence model for a case it was not built for.

**Rejected**: 016 generalising its decision table to "content decisions". Larger blast radius in an unbuilt feature,
and it puts recipe decisions in the identity database, away from the recipe.

**Consequence**: a reviewer needs a scoped read of a held recipe and its photos that they do not own. That read is
new, gated by 016's review scope (`016-FR-053g`), and audited (`016-FR-053f`).

## R-14. Shadow mode first

**Decision**: the first slice records outcomes and the referrals it would make (state `shadow`), and holds nothing.
It needs no 016 at all: no hold, so no statement of reasons, and no reviewer is asked. It produces the referral
forecast (R-10) and the duplicate-detection measurement (R-17). Turning blocking on is a recorded operator act in an
append-only ledger, allowed only when the evaluation passes (spec FR-019: SC-001, SC-002 and SC-015) and 016's
statement delivery and queue exist. The forecast is shown with it and gates nothing.

## R-15. Who can see a held recipe, and private slots

**Decision**: a held recipe is visible only to its owner. ADR-0073 counts a slot as a recipe with
`visibility = 'private'` that is not deleted, so a held recipe, which is public but hidden, uses no slot. That is the
same as a public draft.

**Risk recorded**: held and drafted recipes are owner-only and unmetered. A free cook can keep book recipes that way
without a slot. ADR-0073 accepted this for public drafts when it counted only `visibility = 'private'`. 020 adds no new
kind of gap, but more recipes now sit held while a person decides. Raised with the owner as a question on ADR-0073.

## R-16. The curated public-domain corpus

**Owner ruling, 2026-10-26: a curator's grant is NOT a review.** Curated recipes are checked and reviewed like everyone
else's (spec FR-003a). The earlier reading, that the grant counted as a person's decision, is withdrawn.

**What follows**:

- Old cookbooks carry page references, and a model judgement lands on most of them, so close to every curated recipe
  goes to staff. A whole book becomes a one-time backlog, and the book stays hidden until staff decide it.
- The forecast shows that backlog as its own case (spec FR-039a).
- Two things make it cheaper without breaking the ruling:
    - A staff **source decision** approving the book (its Gutenberg page or its ISBN) makes the source reference of
      every recipe from it green (spec FR-050). The text still needs to be green or decided.
    - The queue groups a book's referrals so one reviewer works through it in one sitting (spec FR-030a).
- The curated import tool has no production use today (its README says so), so this backlog lands only when a book is
  imported to production on purpose.

## R-17. Same recipe and same source in our own database

Owner, 2026-10-26: "As part of the review we should also check our own database to see if same recipe already exists
and was approved/passed or if recipes from the same source was approved/passed."

**Same recipe, library-first.**

- **Exact copies**: SHA-256 over the normalised match text (ingredient lines and steps, NFKC, lower-cased, numbers and
  whitespace collapsed). An index lookup.
- **Near copies**: Postgres **`pg_trgm`** finds candidates. It is maintained, ships with RDS, and is already installed
  in the recipe database (`0001_initial.sql`), so it adds no dependency. A GIN `gin_trgm_ops` index on the match text
  serves the `%` operator.
- **Confirmation**: trigram similarity over a whole recipe is pulled up by shared cooking words ("preheat the oven",
  "salt and pepper"), so a trigram score alone over-matches different recipes for the same dish. Each candidate is
  confirmed with Jaccard similarity over word 5-shingles of the two match texts, a set comparison of a few lines in
  code.
- **MinHash/SimHash considered and not chosen now**: they pay off when comparing against millions of documents
  without an index. Here the database already has the index, and the candidate set is small. If the corpus outgrows
  the GIN index, a maintained MinHash library is the next step, and this section reopens.
- **Thresholds are measured, not guessed**: the trigram candidate threshold and the shingle-Jaccard threshold are set
  in shadow mode on a labeled set of recipe pairs: exact copies, lightly edited copies (reordered steps, changed
  amounts, fixed typos), and different recipes for the same dish. They are chosen to meet SC-015 (at least 95%
  precision, at least 90% recall). No starting number is written here, on purpose.

**Same source.** A recipe's source keys are normalised once, on write:

| Key    | From                                                 | Normalisation                                                               |
| ------ | ---------------------------------------------------- | --------------------------------------------------------------------------- |
| `page` | the cited link                                       | WHATWG `URL`; lower-case host; drop `www.`, query, fragment, trailing slash |
| `host` | the cited link                                       | registrable domain via `tldts`                                              |
| `isbn` | the citation, or an ISBN the rules found in the text | ISBN-13 via `isbn3`                                                         |

**How a match counts.** Spec FR-047's table, decided by one pure function (`matchEffectOf`). Only a person's decision
on the matched recipe or source counts, so automated results never pass each other along. A match can turn a part
green, never a proven `detected`. A not-green match wins over a green one.

**Defaults chosen here, for the owner to confirm** (plan, open questions):

- Clearing or holding one recipe never approves or blocks its whole source. A source decision is a separate, explicit
  staff act (spec FR-050). Otherwise one reviewer's clearance of a single blog post would approve the whole blog.
- A near-duplicate of the cook's **own** recipe that a person approved counts as approved. A cook copying their own
  recipe is not an internal copy.
- An exact photo match on a person-approved recipe of the same cook or source makes that photo green.
- A clone's match to the recipe it was cloned from is ignored, neither a pass nor a flag.

**Private recipes.** They are searched as candidates, because a recipe a person held and its cook then made private
still carries that decision. A private recipe's content is never shown to anyone but staff, and staff see only its
decision, never its content (spec FR-049, FR-051). The cook whose recipe matched learns only that a person will check
where it came from.

**Is the stored data personal data?** The match text is a normalised copy of the cook's recipe text, which can hold a
family name or a story. ADR-0027 kept an ingredient phrase after erasure because a phrase alone says nothing about a
person. That reasoning does not reach a whole recipe. So the match text, its fingerprint and the source keys are the
cook's data: deleted with the recipe and with account erasure. A person's decision record keeps only the exact
fingerprint (a hash, no text) for its retention period, as part of the evidence of that decision (`016-FR-052a`).

**Where it runs.** In recipe-service at write time, with the rule-based detectors (spec FR-053). It needs no model and
no AI budget, so a match against a blocked recipe holds a recipe even in a budget month.

**Cost.** The GIN trigram index grows with the corpus and slows writes a little. The match text is capped in length.
k6 measures the write and lookup latency before blocking is switched on (quickstart).
