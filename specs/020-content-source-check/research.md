# Research: Content Source Check

**Feature**: [spec.md](spec.md) | **Plan**: [plan.md](plan.md) | **Date**: 2026-10-26

Each section states the decision, why, and what was rejected. Two spec questions are open (Q1, Q2). This plan uses
the recommended answers as labelled working assumptions: **WA-1** (Q1 = A for this release: text only, including OCR
text, and images later) and **WA-2** (Q2 = A, a `possible` outcome asks the cook to confirm). R-10 shows what changes under another answer.

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

- recipe-service writes `recipes.checked_text_digest` in the same transaction as any change to the checked text.
- The worker upserts `recipe_source_checks(recipe_id, text_digest)` with `allows`. It never writes the `recipes` row.
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

- **Input**: the checked text only, in the user turn, verbatim. The system prompt is fixed and pinned by length and
  SHA-256, as `buildParsePrompt` is (ADR-0026). The prompt builder takes the text and nothing else. Its parameter list
  is pinned in invariant position. A second parameter (a statement, a label, a rule result) then fails the build.
- **Output**: a strict JSON object, parsed with zod, holding at most a fixed number of evidence items. Each item is a
  kind from a closed set, a field name and a quote.
- **Verification**: each quote is normalised (Unicode NFKC, whitespace collapsed) and searched for in the same
  normalised checked text. A quote that is not found is dropped and counted in a metric. Kind and blocking status
  come from the code table, never from the model.
- **Caps**: explicit `maxTokens` and a hard input cap. A recipe over the cap is not sent (ADR-0024: reject, never
  truncate). Its outcome is `unchecked` (`tooLong`), unless the rule-based detectors found blocking evidence.

**Rationale**: the model widens recall. It can point at a publisher name not yet on the list, or a headnote in a
publisher's voice. Every quote it returns is either proven or discarded. Prompt injection can at worst hide
evidence, never create a block.

**Rejected**: showing the model the cook's statement "for context". It is the claim under test. A model that sees it
agrees with it more often, and that bias looks like accuracy.

## R-05. Model choice and residency

**Decision**: a model that runs in the deploy region, so no residency approval is needed. Under WA-1 (text only)
that is **Nova Micro**. If images are added later, **Nova Lite v1** takes image input and also stays in region. The
staff-architect checked both against the Bedrock model cards on 2026-10-26. The final pick follows a bake-off on the
labeled set (R-08).

- **Approval is per model today, not per call site** (`spendArithmetic.ts`). Nova 2 Lite's approval for the parse leg
  would therefore silently cover this call site too. Spec FR-033 forbids that. Either this call site uses an in-region
  model (chosen), or the registry's approval gains a call-site scope first.

**Cost**: stated per check from the rate table in `spendArithmetic.ts` once the model is chosen. Checks run only for
recipes headed public, once per digest, so the volume is bounded by publications, not by imports.

## R-06. The rightsholder list

**Decision**: one data table of markers. Each marker has a kind (`host`, `imprint`, `template`) and a value. It also
records who added it, when and why. An admin-scoped endpoint and an audit trail manage it. It serves both 020 and
`004-FR-014`'s paywall blocklist (004 D-004), which is specified but not built. A paid-site host is one fact, so it has
one row.

**Rationale**: DRY over knowledge. A host that blocks a URL import and a host that marks a cited link are the same
fact about the same site.

**Rejected**: a code constant. 004 D-004 already ruled that the list changes as an operational act, not a release.

## R-07. Images (working assumption WA-1: not in this release)

**Finding that changed the recommendation for Q1**: code cannot find a model's "quote" in an image. With a model-only
reading, an image can reach `possible` but never `detected` under spec FR-009. Three more costs come with images:

- Image tokens are not bounded by the spend gate's input cap, which is a byte bound on text. Each image needs its own
  token bound before a reservation means anything.
- The worker needs a read grant on the photo bucket.
- A held photo is still served as-is by the media distribution, so holding it means a CloudFront invalidation.

**Decision**: text only in this release, including text that OCR produced. Images follow once 011's OCR engine
(ADR-0019 §1) exists: then an image is `detected` when its OCR text holds rule-based blocking evidence, and the
model can add only non-blocking image evidence.

**Scope**: images the cook uploads (`recipe_photos`). Imported third-party photos are shown by reference and never
stored (`016-FR-027`). They are not checked. A `detected` image is withheld from the public recipe; the recipe can
go public without it.

## R-08. Measuring the check

**Decision**:

- **Labeled set**: at least 300 third-party items with markers, at least 300 own or public items, and a further
  group of third-party items with no markers. Kept outside the repository, access limited to the operator, pending
  counsel (spec FR-041).
- **Metrics**:
    - precision of `detected`, with a Wilson 95% interval (SC-001: point at least 97%, lower bound at least 95%)
    - recall on marked items (SC-002: at least 90%)
    - recall on unmarked items, reported with no target (SC-003)
- **Shadow mode first** (spec FR-019): the check records outcomes and holds nothing until the evaluation passes.
  Switching blocking on is a recorded operator act.
- **In production**: the appeal overturn rate is the live precision signal. A rising overturn rate is an alert, not a
  dashboard number.

**Rationale**: a precision target without an interval is a claim about one lucky sample. 300 detections is roughly
what a 95% lower bound at a 97% point needs.

Inspection is not user evidence. This set measures detection. Whether cooks find holds fair, or the copy clear, needs
a study.

## R-09. Legal framing

These shape the design. Counsel confirms them (spec FR-041). This is not legal advice.

- **No duty to monitor.** 17 U.S.C. §512(m) says safe harbour does not depend on monitoring. The check is voluntary.
- **Red-flag knowledge.** Under §512(c)(1)(A)(ii), a host that is aware of facts that make infringement apparent loses
  safe harbour. Courts have read this as awareness of specific infringing material (Viacom v. YouTube, 2d Cir. 2012). A
  `possible` signal followed by publication is the case to ask counsel about. A `detected` hold is the opposite case:
  we act on what we found.
- **EU.** DSA Art. 7 says voluntary own-initiative checks do not by themselves cost a host its exemption, and Art. 8
  says there is no general monitoring duty. A hold restricts visibility, so Art. 17 requires a statement of reasons
  that includes the use of automated means.
- **Profiling.** GDPR Art. 22 is about decisions with legal or similarly significant effects. Holding a recipe back
  from public view is unlikely to reach that, but the appeal to a person is offered anyway.
- **The check is not a shield** (016, finding 2). A `clear` outcome is never evidence that a recipe is lawful.

## R-10. If the owner answers Q1 or Q2 differently

| Answer | What changes                                                                                                          |
| ------ | --------------------------------------------------------------------------------------------------------------------- |
| Q1 = B | Needs OCR, a per-image token bound, a photo-bucket grant and CloudFront invalidation (R-07). Model moves to Nova Lite |
| Q1 = C | As B, and a `detected` image holds the whole recipe                                                                   |
| Q2 = B | A `possible` recipe is held and goes to the reviewer queue. Queue volume grows with `possible` outcomes               |
| Q2 = C | No cook confirmation. `possible` publishes at once and is sampled for audit. The confirmation record is not needed    |

## R-11. Statement of reasons

**Decision**: a fixed, localised template filled from the evidence kinds and their fields. It names the action, the
ground, the facts, automated means and the redress (spec FR-028). It is delivered through 016's mechanism.

**Rationale**: model prose is AI-generated content shown to a user (`GR-010`, `016-FR-046`). It can misstate the
evidence, and counsel cannot approve it in advance. Counsel can approve a template.

## R-12. Failure and the spent budget

**Decision**:

- **Ceiling denial**: the rule-based detectors have already run. With no blocking evidence, the outcome is
  `unchecked` (`budgetSpent`) and the cook is asked (spec FR-020). Unlike the save path, this is not retried until
  the period ends: it follows the owner's ruling for AI-dependent steps (ADR-0072 §10).
- **Next period**: at the change of period, public recipes with `unchecked` (`budgetSpent`) are queued for a check
  (spec FR-021). The period key is captured at reserve, as ADR-0024 requires.
- **Unreadable counter**: transient, fails closed, retried under the queue's `maxReceiveCount`. When retries are
  spent, the DLQ handler writes `unchecked` (`checkFailed`) so no recipe waits forever (spec FR-022). The DLQ has an
  active watcher.

## R-13. Where hold and appeal decisions are recorded

**Decision**: 020 keeps its decision, confirmation and appeal rows in the **recipe** database, next to the recipe they
judge, kept for 016's period (`016-FR-052a`). 016's compliance history (`016-FR-053`) reads them through the internal
path 016 already plans. 016's statement-of-reasons **delivery** (in-app and email) is generalised to take a decision
from 020. Its `notice_decisions` table is not.

**Rationale**: `notice_decisions` has a NOT NULL foreign key to `notices`, and expects `automated_means` to be false.
A hold has no notice. Bending that table would change 016's evidence model for a case it was not built for.

**Rejected**: 016 generalising its decision table to "content decisions". Larger blast radius in an unbuilt feature,
and it puts recipe decisions in the identity database, away from the recipe.

**Consequence**: a reviewer needs a scoped read of a held recipe they do not own. That read is new, gated by 016's
review scope (`016-FR-053g`), and audited (`016-FR-053f`).

## R-14. Shadow mode first

**Decision**: the first slice records outcomes and holds nothing. It needs no 016 at all: no hold, so no statement of
reasons and no appeal. Turning blocking on is a recorded operator act in an append-only ledger, allowed only when the
evaluation passes (spec FR-019) and when 016's statement delivery and queue exist.

## R-15. Who can see a held recipe, and private slots

**Decision**: a held recipe is visible only to its owner, like a draft. Whether it uses a private slot follows the
free-tier private slots ADR's answer for owner-only drafts. 020 adds no new rule.

**Risk recorded**: if owner-only drafts use no slot, a held recipe is an unmetered place to keep book recipes. That
hole already exists for drafts. Raised as a question for the slots ADR.
