# Research: Content Source Check

**Feature**: [spec.md](spec.md) | **Plan**: [plan.md](plan.md) | **Date**: 2026-10-26

Each section states the decision, why, and what was rejected. The owner answered both spec questions on 2026-10-26:
**Q1**, photos are in scope and anything the AI cannot decide goes to a person; **Q2**, a person decides the unsure
case. A second round the same day ruled on four readings: a spent budget waits for a person; a curator's grant is not
a review; a recipe skips review only when every part is green; and review time targets wait ("we can deal with
SLO/SLA later"), with reviewers always employees. A third ruling added the lookup in our own database (R-17). A fourth
round answered the staff-architect REVIEW's four questions: match precedence, the same-items rule, private-recipe
non-disclosure, and donation at erasure (R-17, R-18, R-19). The decision is recorded in
[ADR-0074](../../docs/architecture/decisions/0074-content-source-check.md).

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
  `foodness-validator`, `measurement-validator` and `paste-match-review`. `SPEND_CALL_SITES` is the authority for the
  list, and ADR-0024 §4c now names it rather than a count.

**It is its own function on the shared role.** Same role is not same function. The check gets its own Lambda, its own
SQS queue with a DLQ, and its own reserved concurrency from `consumerConcurrency.ts`. It does not share the verifier's
concurrency. `verificationRole` already backs two functions, so this is a known shape.

**Five guards move with it**:

- `llmSpendGuards.test.ts` pins layer 2 on one named function (`VERIFIER_FUNCTION`). It is extended to find every
  function on the grantee role, so a new function cannot escape the concurrency check.
- The function connects to the recipe database, so it is VPC-attached and adds a row to ADR-0004's NAT consumer table.
  `natEgressConsumers.test.ts` asserts that table in both directions.
- ADR-0024 §4c's roster said four call sites. It now names `SPEND_CALL_SITES` as the authority.
- **The photo read is scoped to this function** (review H9). Same role is not same function, and a grant on the role
  reaches every function on it. So the read of the check renditions carries a `lambda:SourceFunctionArn` condition
  naming this function. AWS documents that Lambda adds this key to every AWS call function code makes, and that it
  works in identity policies ([AWS](https://docs.aws.amazon.com/lambda/latest/dg/permissions-source-function-arn.html)).
  The statement sits in its own `iam.Policy` with the ARN built from the fixed function name, which avoids a CDK
  dependency cycle. An infra guard asserts the condition. The media bucket uses S3-managed keys, so no KMS grant is
  owed.
- **The model is pinned to an in-region registry entry** for this call site (spec FR-033), by a guard, so a parameter
  change cannot route cooks' photos to another region.

**Consequences accepted**:

- The model check is asynchronous. A publish cannot wait on it inside the request, so the cook sees a "checking"
  state (spec FR-001, SC-005). A rule-only `detected` is the exception: it is decided in the save (R-03).
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

**The hold condition is written once** (review H6). It is a Specification with two forms in
`recipe-core/src/sourceCheck/holdSpecification.ts`: a TypeScript predicate for `isRecipeViewableBy`, and an exported
SQL text for the three SQL twins and for account erasure. `recipe-core` already exports SQL text that both deployables
import (`PARSE_JOB_AGGREGATE_SQL`), so this needs no new package and no drizzle in `recipe-core`. A parity test holds
the two forms equal, and a guard fails a fifth hand-written copy. Before this, erasure's `ownerOnly` predicate
(`accountErasureWorker.ts`) treated a held recipe as truly public and would have donated it.

**The enforcement mode is stamped per outcome, not read per query** (review H5). If the read rule read the latest
ledger row, a return to `shadow` would publish every held recipe at once, `detected` ones included. So each outcome
row gets `enforced` once, at its first public moment, from the mode then. The read rule reads the stamp. That gives
`paused` its meaning (new outcomes hold nothing, old holds stay), and it gives spec FR-019's "never hides at once"
for free. Rejected: a one-way switch with no pause, because an operator then has no rollback short of a release.

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

**Rationale**: library-first for the parts that are easy to get wrong. ISBN checksums have two schemes and edge cases
(`X` check digit, 978/979 prefixes). Registrable-domain matching needs the public suffix list. URL normalisation has
many edge cases, so the page key uses `normalize-url` (R-17). The phrase and regex detectors are small, pure and
table-tested.

**Two dependencies were wrongly described as already present.** `tldts` is in the tree only through `jsdom`, a test
dependency, and `normalize-url` only through other packages. Both are declared directly in `recipe-core`, at their
current major.

**Only these detectors block** (review H4). Every blocking kind is a list or pattern match code can test. A model's
choice of what to quote is neither, so a model item, even one whose quote code finds, only sends a recipe to a person.
That also makes `detected` known in the save, with no wait and no spend.

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
  normalised checked text. A quote that is not found is dropped and counted in a metric. A quote that is found is kept
  as a span, and still only sends the recipe to a person. A photo signal cannot be verified, so it is stored as
  unproven and can only send the recipe to a person.
- **Keying**: a finished model run is shared under a key of the part, the model, the prompt's SHA-256, the output
  schema version and, for a photo, the rendition version (review M3). Rule evidence is not shared: it depends on the
  citation, the label and the live list, and it costs nothing to work out again.
- **Caps**: explicit `maxTokens` and a hard input cap on every call. Content over the cap is not sent (ADR-0024:
  reject, never truncate). Its outcome is `unchecked` (`tooLong`), unless the rule-based detectors found blocking
  evidence.

**Rationale**: the model widens recall. It can point at a publisher name not yet on the list, a headnote in a
publisher's voice, or a photographed book page. Every text quote is either proven or discarded, and everything the
model finds goes to a person. Prompt injection can at worst hide evidence. It can never create a block or clear a
photo.

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
| The worker needs the photo bytes                | A read grant on the check renditions in the photo bucket, and nothing else, scoped to the source-check function by `lambda:SourceFunctionArn` (R-01)                        |
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
  `unchecked` (`budgetSpent`), and a published recipe goes to a person (spec FR-020). **The denial is not retried**
  (review M6). A retry would only sit in the queue until the month ends, and the person already has the case. That
  makes this call site the second path in ADR-0024 §3 that does not retry a denial, after the parse-job line, and §3
  records it. The period is captured at reserve and stored with the denial, so `budgetSpent` reads as spent only
  while its period is current. This reads the Q1 ruling ("If the
  AI can't figure out … raise it to a human") onto the spent-budget case. It replaces, for this feature only, the
  general ruling that the cook is asked (ADR-0072 §10 keeps that ruling for matching). The owner confirmed this reading
  on 2026-10-26.
- **Next period**: once its period has passed, every `unchecked` (`budgetSpent`) outcome that no person cleared is
  checked again (spec FR-021). A `clear` result closes the referral with no person needed, which drains most of a
  budget month's queue on its own. The re-check locks the referral row first and changes the outcome only by a
  compare-and-set that requires `cleared_at IS NULL`, so it cannot overwrite a reviewer (R-20).
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

**The switch cannot undo holds** (review H5). The modes are `shadow`, `blocking` and `paused`. The legal moves are
`shadow` → `blocking`, `blocking` → `paused` and `paused` → `blocking`, enforced by a trigger under a lock, because a
CHECK cannot see the previous row. Each outcome carries the mode stamped at its first public moment (R-02), so
`paused` stops new holds and keeps existing ones. The ledger is a `dictionary` table under ADR-0039's table policy:
the service role holds SELECT and INSERT only.

## R-15. In review, not approved, and private slots (owner ruling, 2026-10-26)

Owner, 2026-10-26: "The review process does not take a slot and doesn't become visible as public or private until it's
been approved. While it's in review it is labeled as such."

**Decision** (spec FR-014a):

- **In review** is a derived state, not a new visibility value. The stored visibility keeps what the cook asked for
  (`public`), the read rule hides the recipe, and the cook sees "In review". ADR-0073 counts `visibility = 'private'`
  only, so a recipe in review uses no slot, as the owner ruled. This keeps ADR-0074's "the hold lives in the read rule"
  design: nothing in the ruling needs a new enum value, and a new value would be a one-way door on a wire enum that
  installed clients switch over.
- **Not approved** ends review. The rules blocking a save, a person's non-approval, and an upheld appeal each move the
  recipe to `private` in the same transaction, so it counts as a slot. It is never published with that content and
  never deleted by us. A person's decision moves it even with no free slot, and the cook is then over the limit, as
  after a downgrade (ADR-0073 §4). It keeps one appeal and a statement of reasons.
- **The one place that refuses**: a `detected` save by a free cook with no free slot. Nothing is saved yet, so
  refusing loses nothing, and it matches ADR-0073's refusal of a book recipe with no slot and bulk import's refusal of
  a `detected` item (spec FR-025). Without it, writing "I wrote this" over a book recipe would buy unlimited private
  storage, because each `detected` save would land private over the limit, while the honest statement is refused.
- **No re-entry.** A person's decision always ends review, and the same unchanged content cannot enter review again:
  a change to public of that content is refused. Edited content has a new digest and a new check.
- **No stretching.** A recipe keeps the queue place it had when it first entered review, across edits and trips
  through Draft. So review always reaches a person's decision, and it cannot become a free private store.

**Private bulk imports are reviewed too** (owner ruling, 2026-10-26). Every imported recipe, public or private, is
saved published and checked. A private one in review is defined by its check row, not its visibility, so ADR-0073's
count leaves it out through `IN_REVIEW_SQL`. The cost is real and accepted by the ruling: private recipes now reach
the model and, when not green, a person, which 016 finding 1 had avoided for the editor path. Editor-made private
recipes are still not checked.

**The Draft path is closed** (owner ruling, 2026-10-26, `001-FR-003b`, ADR-0073 §12). A draft uses no slot, and a
cook may move a recipe from In review back to Draft. But a draft cannot be used in meal planning, collections, the
planned AI assistant, cooking mode or a shopping list, and opening it opens the editor. So a draft is somewhere to
write, not somewhere to keep a usable library, and it is not a free private store.

**Rejected**:

- **A new `inReview` visibility value.** A wire one-way door that puts two facts in one field.
- **Leave a not-approved recipe owner-only until the cook chooses.** That is the free private store the ruling closes.
- **Delete a not-approved recipe when the cook has no slot.** The owner ruled it is never deleted by us.

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
and was approved/passed or if recipes from the same source was approved/passed." The fourth round of rulings (spec
Clarifications) settled how a match counts.

**Where it runs** (review M1, owner ruling 3). recipe-service writes the fingerprint and source keys in the content
transaction, and does no lookup in the request. The worker runs the lookup after it re-derives the digest and before
it claims or reserves anything. So a lookup costs no AI budget, runs in a budget month, adds no latency to a save, and
leaves nothing a cook can time.

**Same recipe, library-first.**

- **Exact copies**: SHA-256 over the normalised match text (ingredient lines and steps, NFKC, lower-cased, numbers and
  whitespace collapsed), versioned `v1:`. An index lookup.
- **Near copies, this release**: Postgres **`pg_trgm`** finds candidates. It is maintained, ships with RDS, and is
  already installed in the recipe database (`0001_initial.sql`), so it adds no dependency. A GIN `gin_trgm_ops` index on
  the match text serves the `%` operator. The lookup's transaction opens with `SET LOCAL pg_trgm.similarity_threshold`,
  so it never depends on a session default.
- **Confirmation**: trigram similarity over a whole recipe is pulled up by shared cooking words ("preheat the oven",
  "salt and pepper"), so a trigram score alone over-matches different recipes for the same dish. Each candidate is
  confirmed with Jaccard similarity over word 5-shingles of the two match texts.
- **At scale, MinHash with LSH bands.** A GIN trigram index over long documents returns more candidates as the corpus
  grows, because common trigrams match nearly everything. MinHash signatures with an LSH band table bound the
  candidate set by design. So the plan requires a LOCAL e2e benchmark of the lookup at the projected corpus size before
  blocking is switched on, and flips the candidate source to a `recipe_match_bands` table if it fails its budget.
  Shingle Jaccard still confirms. Both are derived indexes rebuilt from `match_text`, so the flip changes no stored
  user data.
- **Why not MinHash now.** A search on 2026-10-26 found no JavaScript MinHash library whose maintenance could be
  confirmed (the `minhash` package is at 0.0.9, and others showed no recent releases). The library-first rule forbids
  hand-rolling it without that check, and `pg_trgm` is maintained and already installed. The library is chosen at the
  flip, after a fresh check.
- **Thresholds are measured, not guessed**: both thresholds are set in shadow mode on a labeled set of recipe pairs:
  exact copies, lightly edited copies (reordered steps, changed amounts, fixed typos), and different recipes for the
  same dish. They are chosen to meet SC-015. No starting number is written here, on purpose.
- **The projected corpus size** is recorded in the plan at BLUEPRINT. Until then the benchmark runs at one million
  fingerprint rows, a planning figure chosen to sit well past launch, not a forecast.

**Same source.** A recipe's source keys are normalised once, on write:

| Key    | From                                                 | Normalisation                                                                                               |
| ------ | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `page` | the cited link                                       | `normalize-url`, options pinned in one place: lower-case host, drop `www.`, query, fragment, trailing slash |
| `host` | the cited link                                       | registrable domain via `tldts`                                                                              |
| `isbn` | the citation, or an ISBN the rules found in the text | ISBN-13 via `isbn3`                                                                                         |

**Which candidates count** (review H3, M7):

- The recipe itself, and its whole clone tree, are left out: ancestors through the `cloned_from_id` chain to the root,
  and every recipe with the same root. Two clones of one public recipe are near each other because of the recipe they
  share, not because one copied the other. The walk is a recursive CTE with a depth cap and a `CYCLE` clause.
- A candidate can send a recipe to a person only if it was first published before it (`first_published_at`, which the
  `recipes_first_published_at_ratchet` trigger sets once). A recipe never published is never such a candidate.
- Every private recipe is searched (owner ruling 3). A never-published private draft can therefore have no effect.

**How a match counts.** Spec FR-047 is an ordered decision table: the first row that applies decides. It replaces the
earlier table, whose rows overlapped (review H1): "near copy of an approved recipe from the same source" and "near copy
of another cook's public recipe" were both true of the same case, with opposite effects. Owner ruling 1 settles it: a
shared cited page or ISBN key, on a candidate that is not `user_created`, makes it an approved match. Per part, effects
combine in one order, `notGreen` over `green` over `none`.

**What a match may green** (review H2, owner ruling 2):

- **The same-items rule.** The copy may carry no evidence item the approved version lacked. Two items are the same
  when they share a kind and a normalised marker. Free-text kinds (a copyright holder, a model quote) are compared by a
  digest of the normalised text, kept on the recipe's own judged items and erased with it. Without the digest, a copy
  with a different copyright holder would have matched on kind alone.
- **No passing along.** The approval must be a person's own latest decision on the matched content digest. A recipe
  that is allowed only because a match greened it gives nothing to a third recipe.

**Private recipes** (owner ruling 3): see R-19.

**Defaults that still stand from the third round**:

- Clearing or holding one recipe never approves or blocks its whole source. A source decision is a separate, explicit
  staff act (spec FR-050). Otherwise one reviewer's clearance of a single blog post would approve the whole blog.
- Retiring or reversing a source decision changes no outcome already produced and undoes no person's past decision. It
  changes only what later checks find. We agree with the review's recommendation, so this is decided, not open.
- A near copy of the cook's **own** recipe that a person approved counts as approved, under the same-items rule.
- A near copy of a recipe the check held (`detected`) and no person overturned goes to a person. That closes the
  "strip the ISBN and publish again" route.
- The label of a private candidate is never used as evidence (spec FR-055). A near copy of another cook's private book
  recipe goes to a person like any private match. It never becomes `detected` and never names a book, because that
  would let one cook's private library shape another cook's outcome beyond sending it to a person.

**Is the stored data personal data?** The match text is a normalised copy of the cook's recipe text, which can hold a
family name or a story. ADR-0027 kept an ingredient phrase after erasure because a phrase alone says nothing about a
person. That reasoning does not reach a whole recipe. So the match text, its fingerprint and the source keys are the
cook's data: removed at a tombstone, a hard purge and account erasure. A **hold** decision keeps only the exact
fingerprint (a versioned hash, no text) for its retention period, so it can still send an exact copy of a held recipe
to a person. A clearance keeps no hash, so a kept hash can never green anything (review M4).

## R-18. Donation at account erasure (owner ruling 4)

**The defect** (review H6). Erasure's `ownerOnly` predicate (`accountErasureWorker.ts`) keeps every recipe that is
`public AND published`. A held recipe is exactly that, so erasure kept it as truly public, and the donation flip made
any elected recipe public with no check.

**Decision**:

- The erasure worker uses the hold Specification's SQL text (R-02). "Truly public" becomes `public AND published AND
allowed`.
- At election, each elected recipe that is not already allowed is checked, like any recipe headed public. All green:
  donatable. Not green: a `donation` referral.
- If any donation referral exists, the erasure job waits for its recipe phase until every one is decided or the
  **donation deadline** passes. The account is closed meanwhile. The decision on the last donation referral re-enqueues
  the job, and the sweeper claims it at the deadline. Then the existing transaction runs. A recipe the hold
  Specification does not allow is deleted with no extra logic: a held public recipe, an elected recipe a person held,
  and one still undecided.
- The cook is told all this at election, before they confirm. The election screen is in the account closure plan
  (U3b), and spec FR-044a lists its amendment.

**The deadline: 14 days** (owner ruling, 2026-10-26). GDPR Art. 12(3) gives one month from the request. Fourteen days
leaves about sixteen for the rest of the erasure, the identity scrub and the Clerk deletion included. A donated recipe
still waiting for staff after 14 days is deleted. Counsel confirms it is not undue delay (spec FR-041). A not-approved
recipe is never donated, and an elected recipe already in review waits the same 14 days.

**Rejected**:

- **Erase at once and keep the pending recipes, pseudonymised, until a person decides.** It removes the wait, but it
  needs a second recipe phase, a second scoped object sweep and a second removed-set capture, and it keeps the cook's
  content after their account is gone. Kept as the fallback if counsel calls the wait undue delay.
- **Wait for staff without a deadline.** The owner ruled that erasure does not wait forever.
- **Never donate a private recipe.** The owner ruled that one that passes may be donated.

**A statement for an erased cook.** A person's hold during the wait can be emailed while the account still exists.
After the identity record is scrubbed there is nobody to deliver to, so the decision row records
`statement_undeliverable`. Counsel confirms that this is enough (spec FR-041).

## R-19. Another cook's private recipe is never disclosed (owner ruling 3)

**Decision**: private recipes are candidates, and nothing a cook sees depends on whether a match was private.

- **One message for every cause** (owner ruling, 2026-10-26). A recipe in review shows the cook "In review: a person
  will check this before it goes public", and nothing else: no outcome value, no reason, no part result. A match, a
  source decision, a page reference, a photo signal and a spent budget look the same. There is no `greenBy` field. A
  person's **rejection** is the one exception (owner ruling, 2026-10-26): it gives one reason from a fixed list and
  the reviewer's note, word for word, and never names or links another recipe.
- **`notYours` only for a public match.** "It copies a recipe that is not yours" could otherwise tell a cook that a
  private recipe like theirs exists. So the decision route offers it only when the matched recipe is another cook's
  and is public at the moment of the decision, and refuses it otherwise, whatever the screen sent. A cook told
  `notYours` is always pointing at a recipe they could find themselves.
- **The same steps every time.** The lookup runs in the worker. The worker never skips or shortens a model call
  because of a match, and writes the outcome only once every part is read. So the time to an outcome does not depend
  on a match.
- **A floor on the time to an outcome.** Model evidence is shared, so a cook who pastes the exact text, or uploads the
  exact photo, of a recipe checked before gets a cached answer in milliseconds. That recipe can be another cook's
  private recipe, so the speed alone would show it exists. Every worker-produced outcome is therefore held back to a
  floor from the start of its check, set from the measured time of an uncached check. A rule-only `detected` is exempt,
  because it reads only the cook's own content.
- **A closed ground and a generic fact.** A reviewer chooses the cook-facing ground from a closed set, and a match is
  always stated as the one generic fact. The reviewer's own words are an internal note. So a reviewer cannot disclose
  the match by typing it. Counsel is asked whether the generic fact satisfies DSA Art. 17(3)(b) (spec FR-041).
- **A private recipe with no person decision only routes.** It can send the new recipe to a person and never makes
  anything green (FR-047 row 4).
- **Staff see the match and its earlier decision**, never a private recipe's content.

**What is left, and why it is accepted.** While a recipe is in review, a cook learns only that a person will check,
never what or whose. A rejection tells them which of five reasons applied, and the note is written under a guideline
never to identify another cook or recipe. A note is free text, so that guideline is a staff control, not a technical
one. They know
their own text, so they can guess at a cause, but nothing the product shows confirms it. The owner ruled on
2026-10-26 not to add cover traffic (a random sample of all-green recipes sent to a person) for now, and accepted this
residual.

## R-20. Races and shared parts

**A reviewer and a re-check on one outcome** (review H7). A reviewer could clear an `unchecked` outcome while the
next-period re-check replaced it with a fresh `possible`, and the stale clearance would then allow content no person
saw. So:

- A clearance stores the outcome and the evidence reference it cleared, and allows only while both still hold.
- The re-check runs only on an outcome no person cleared (`cleared_at IS NULL`).
- Both writers lock the referral row, then the outcome row, and change the outcome only by a compare-and-set.
- A referral is created only once an outcome is decided.

**Two recipes that share a photo** (review M2). With one claim per part, the second recipe's worker found the photo
claimed and stopped, and nothing ever finished its outcome. So:

- A claim has a lease, so a dead worker's claim can be taken over.
- Each outcome lists the parts it waits on. When a part's evidence lands, the same transaction sends a fresh check
  request for every outcome that was waiting on it. That is the fan-in. It does not write another recipe's outcome:
  the lookup result and the marker digests belong to that recipe's own run, so the rerun does the cheap steps again
  and spends nothing.
- The sweeper re-drives anything the fan-in missed, inside the 24-hour limit.
