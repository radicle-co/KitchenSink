# 24 — Adversarial review: the REVISED import/processing design (owner rulings D1–D6, 2026-08-14)

**Mode**: REVIEW, read-only, adversarial. **Posture**: default to "this is incoherent" and let the
evidence rescue it. **Target**: the replacement for
`docs/architecture/decisions/0019-recipe-import-spine.md`, before it is written down.

**Built on, not repeating**: `11-adversarial-004-011-split.md`, `12-adversarial-status-shells.md`,
`13-adversarial-topology.md`, `14-adversarial-premises.md`, `15-adversarial-food-recipe-model.md`.
Where one of those already settled a point I cite it by number rather than re-deriving it. Where the
revision **changes** the ground under a prior finding, I say which finding moves and which does not.

**Method**: every `file:line` below was opened and read on branch
`chore/code-quality-enforcement-phase-1-2` at `4a979422`. Nothing is quoted from an ADR's summary of
itself. Four external technology claims were checked against vendor documentation on 2026-08-14 and
are marked as such.

**Headline.** Three of the six rulings survive and two of those are materially better than what they
replace (**D3**, **D6-as-a-conclusion**, and the D4+D5 pairing, which is the first coherent
propagation story anyone has written for this seam). **D1 is a label, not a pattern, as stated — but
a real, nameable, already-shipped composition sits underneath it and the ADR should name that
instead.** **D2 is the most damaging ruling in the set**: it splits one user-visible capability into
three different products by platform, and the one adapter it demotes to "fallback" is the only one
that can do the thing feature 011 exists to do. **D6's sole surviving rationale is empirically wrong
about the mechanism it cites**, and extraction imports a distributed-erasure hazard nobody has priced.

---

## A-1 — "Per-domain async processors" (D1): is it a pattern, or a narrative over three workers?

**Claim attacked.** D1: a dedicated async processor per domain — recipe imports, food syncing, web
image OCR — each scaling independently, "one or more jobs/servers/functions as needed", converging
only at recipe creation; and "the pattern extends to any future feature needing async dedicated
processing."

**Attack.** Force the word _pattern_. Per the `design-pattern-contracts` skill §1, a composition is
fake if its parts cannot be tested or replaced independently — but the inverse failure is equally
real and is the one here: **parts that share nothing at all are not a composition, they are three
workers with a collective noun.** So: what do these three actually share — a contract, a base
abstraction, an operational shape, or a deployment mould? If the answer is "they are all
asynchronous", D1 is a taxonomy, and a taxonomy in an ADR is the thing report 14 P-5 caught ADR-0019
doing (borrowed criteria dressed as reasoning).

**Evidence.**

1. **As stated, the three share no deployment mould, and the repo already ships two incompatible
   ones.**
    - **Mould A — the long-running Fargate drainer.** Food's worker is an ECS task holding a
      _session-level Postgres advisory lock_ so exactly one instance drains
      (`packages/services/food-service/src/worker/worker-lock.ts:1-11`, `:15-19`), woken by
      `LISTEN fetch_queued` within ≤100 ms, with a periodic lease reaper and SIGTERM lease release
      (`packages/services/food-service/src/worker/worker-runtime.ts:1-11`, `:19-23`). Its queue is a
      _table_ (`fetch_queue`) with demand-weighted fairness, not SQS —
      `food-service-stack.ts:262-264` says so verbatim: _"EventBridge bus the worker uses to signal
      fetch lifecycle (**no SQS**)."_
    - **Mould B — the scheduled Lambda + SQS + DLQ.** `packages/services/recipe-workers/` ships six
      handlers, each its own `lambda.Function` with its own SQS/DLQ pair, VPC-attached for RDS
      (`src/handlers/{account-erasure-worker,archive-sweeper,erasure-orphan-sweeper,erasure-sweeper,handle-sync-worker,version-archive-worker}.ts`).

    Mould A **cannot** scale to "one or more jobs/servers as needed" — its correctness invariant is
    _exactly one drainer_, enforced by an advisory lock (`worker-lock.ts:1-6`). Mould B scales
    per-invocation. D1's phrase "each scaling independently" is therefore already false of one of the
    three domains it names, and the ADR does not notice, because it never says which mould a
    "processor" is.

2. **They do not share a queue technology, a trigger, or a state store.** Food: Postgres table +
   `LISTEN/NOTIFY` + EventBridge emission. Recipe workers: SQS + EventBridge schedule + outbox table.
   011's OCR: presigned S3 → S3 event → SQS Lambda (`specs/011-recipe-digitization/plan.md:12`,
   `:153`, `:385-388`). Three triggers, three stores.

3. **But a genuine shared shape DOES exist, it is already implemented twice, and it has a name.** It
   is not "per-domain processor"; it is **Transactional Outbox + at-least-once idempotent handler +
   guarded state machine + durable projection**, and the repo has written down its own contract for
   every part:
    - **Outbox.** `archive-sweeper.ts:11-29`, verbatim: _"`recipe-service` deliberately does NOT
      enqueue on save. It writes the `recipe_version_pending_archives` row and nothing else … So the
      ROW is the source of truth and the message is a derived artifact. That inversion is what makes
      the path durable end to end: a dropped message, a throttled send, or an SQS outage loses
      nothing, because the row survives and the next tick re-dispatches it."_
    - **Idempotent at-least-once handler.** Same docstring, `:26-29`: _"Duplicate dispatch is
      therefore expected and harmless … At-least-once is the right trade here — at-most-once would
      risk losing a snapshot."_
    - **Guarded state machine.** `FoodDao.setStatus` — a conditional `UPDATE … WHERE id = $1 AND
status IN (<LEGAL_PRIORS>)` that throws on `rowCount = 0`
      (`packages/services/food-service/src/foods/dao/food.dao.ts:182-188`, `:303-333`). Report 15
      called this "the strongest thing at this seam" and I agree.
    - **Durable projection.** `ingredients.food_resolution_status` +
      `ingredients.calories_per_100g` (`packages/services/recipe-service/src/database/schema/ingredients.ts:48-73`),
      and `recipes.current_version` as the per-entity monotonic counter report 12 A-1 already sited
      (`packages/services/recipe-service/src/database/schema/recipes.ts:132`).

    Each of those four parts is **independently testable and independently replaceable** — the outbox
    is tested without SQS, the handler is tested by replaying one message twice, the state machine is
    tested by attempting an illegal prior, the projection is read without any worker running. That is
    a real composition by the skill's own test.

4. **Where it lives is the question D1 does not answer, and it is answerable.** The four contracts
   above are policy, not infrastructure: they belong in a shared package alongside the ones already
   there (`packages/shared/recipe-core/`, `clerk-verify`, `nest-error-envelope`). The _runtime_ stays
   per-domain. That distinction — **shared contract, per-domain runtime** — is exactly what makes
   "per-domain processor" defensible; without it the phrase is a collective noun.

**Verdict: WEAKENED.** The _conclusion_ (three separate processors, not one shared bulk processor) is
right, and it is right for a reason D1 does not give: it is not "they are all async", it is that
**each domain's work item has a different durable owner and a different failure budget** — food owns
`fetch_queue` and a source-rate budget, recipe imports own `import_drafts` and a per-user quota, OCR
owns an image object and a vendor timeout. Three owners, three back-pressure regimes, one shared
delivery contract. The _framing_ fails: as stated, D1 names no contract, no abstraction, no mould,
and asserts an independent-scaling property that food's own advisory lock forbids.

**What must change.**

1. Rename the decision. It is not "per-domain async processors"; it is **"each domain owns its own
   work queue and its own drain runtime; all of them implement one delivery contract."** State the
   contract as the four-part composition in evidence 3, cite the two shipped implementations as its
   precedent, and say the contract lives in a shared package while the runtime does not.
2. Say **which mould each processor uses and why**, explicitly: food = single-drainer Fargate
   (advisory-locked, `worker-lock.ts:15-19`) and therefore does **not** scale horizontally; recipe
   import and OCR = Lambda/SQS. Delete "each scaling independently" or narrow it to the two that do.
3. Do **not** create a base class, an abstract `Processor`, or a framework. Report 13 A-6's finding
   stands: the shapes are already here. A shared _contract_ with three independent implementations is
   Ports & Adapters; a shared _base class_ over three different runtimes would be the Template Method
   breach in the skill §2 ("the base calls back into subclass state mid-flight").

---

## A-2 — Where exactly is the convergence seam?

**Claim attacked.** D1: the three processors converge **only at recipe creation**.

**Attack.** "Recipe creation" names a moment, not a mechanism. A shared service method, an internal
HTTP API, a queue and a library have four different coupling profiles and four different failure
semantics, and report 13 A-9 already established that this system has **no machine-to-machine
credential** for three of them. Also: report 11 A-1 showed the post-extraction paths genuinely
diverge before that point. Does narrowing the seam from "after parsing" to "at recipe creation"
actually close the divergences, or just move them?

**Evidence.**

1. **The narrowing genuinely fixes what report 11 A-1 broke.** A-1's five divergences were artifact
   retention (`004/spec.md:318-321` vs `011/spec.md:213,224`), per-token vs per-field confidence
   (`004/plan.md:124` vs `011/spec.md:199`), quota accounting (`004/spec.md:678-682` vs `:712-719`),
   the channel `CHECK` constraint (`004/plan.md:117`), and the correction state
   (`011/spec.md:210,221`). **Every one of those sits before recipe creation.** Moving the seam to
   "a completed, user-confirmed candidate plus its provenance" — which is precisely what A-1's "What
   must change" asked for — puts all five on the channel's own side. This ruling did the thing the
   prior review demanded. Credit where due.
2. **But the seam leaks in exactly one place, and it is the one that matters.** What crosses the seam
   is not only the candidate; it is the **`sourceType`**, and `004-FR-025`
   (`specs/004-recipe-importing/spec.md:294-298`) says two of the four values may be set _"**only**
   by the server from the channel it observed."_ If the seam is a network call from another
   deployable, the recipe service no longer observes the channel, and the receiver must trust the
   sender's word. That is A-4 below, and it is the seam's real content.
3. **The choice of mechanism is forced by evidence D1 does not cite.** A shared **library** is
   unavailable across a deployable boundary if the boundary exists at all. A **queue** cannot carry
   the user's credential: `packages/services/recipe-service/src/ingredients/food-service-clients.factory.ts:6-13`
   records that food's guard verifies a _Clerk_ token and _"a value that was never set anywhere and
   could not have worked if it had been, since a Clerk session token expires in ~60s"_, and `:68-71`
   — _"**There is deliberately no fallback credential.**"_ An **internal HTTP API** therefore needs a
   service principal, and the repo already has the template: `serviceErasureToken.ts:1-70` — asymmetric
   `EdDSA`, pinned issuer, per-target audience, capped lifetime, claims that _"bind the capability to
   a single event"_ — deployed and exercised end to end
   (`packages/services/recipe-service/__tests__/integration/account/service-erasure.integration.test.ts:275-279`,
   and the public key wired at `food-service-stack.ts:295-300`).
4. **Under D3 the question may dissolve entirely** — see A-6. If 011's OCR runs as a Lambda in
   `recipe-workers` rather than a separate deployable, "converge at recipe creation" becomes an
   **in-process call inside one transaction**, no credential, no network, no A-3/A-9 residue from the
   prior reviews. That is the cheapest correct answer and D3 is one sentence away from it.

**Verdict: SURVIVES as a seam location, UNSPECIFIED as a mechanism.** The location is now right and
is defensible against report 11 A-1. The mechanism is undecided, and it is a **one-way door**
(a service-principal token is a wire contract and a security boundary), so leaving it unstated is the
single highest-cost omission in the revised design.

**What must change.** Name the mechanism in one sentence, with its principal:

> Recipe creation is reached through **one internal endpoint** on the recipe service,
> `POST /api/v1/imports/{importId}/candidates`, authenticated by an **asymmetric service-principal
> JWT** minted per the `serviceErasureToken` pattern (`packages/shared/recipe-core/src/serviceErasureToken.ts:41,49,65`)
> with `aud = recipe-service`, a capped lifetime, and claims binding it to **one `importId` and one
> `ownerId`** — never a static shared secret and never a trusted header (`CLAUDE.md`, PR #39).

Then state the entitlement rule that goes with it (A-4). If instead the OCR worker lands inside
`recipe-workers`, say **that**, and say the seam is a function call — and then delete the whole
credential paragraph rather than carrying an unused one.

---

## A-3 — D2's platform asymmetry: one user action, three different products

**Claim attacked.** D2: mobile does on-device OCR (Apple Vision / ML Kit) and submits raw text; web
uploads images, OCR'd server-side by Tesseract.js on Lambda behind 011's `OcrProvider` port; AWS
Textract becomes a fallback adapter, **not the default**.

**Attack.** "Import a recipe from a picture" is one user-facing capability.
`docs/CODING_STANDARDS.md:955-963` (§14.1, **Hard Rule**) requires it to ship to both platforms in the
same release and §14.2 (`:965-983`) makes shared code the default with **"API clients, hooks, query
definitions → shared package → No (transport may fork)"**. D2 forks not the transport but the
_algorithm_, and therefore the _result_. Does the same photo produce the same recipe?

**Evidence.**

1. **It does not, and the gap is not marginal — it is the feature's core use case.** 011 exists for
   handwritten heirloom cards: `011/spec.md:18` (_"handwritten cards"_), `:22` (_"No mainstream
   recipe app combines **high-quality handwriting OCR** …"_), `:128-129` (P10 Sage —
   _"reliable OCR on printed + **handwritten** text"_), `FR-008` at `:198` (**Must** —
   _"Recognise handwritten source text via the OCR provider's handwriting path"_), `SC-001` at `:525`
   (_"≥ 70 % of submissions"_), and R-001 at `:572` (_"Handwriting OCR accuracy … falls below SC-001
   — **High — kills heritage-archivist value prop**"_).
2. **Tesseract cannot do handwriting.** Checked against vendor/industry documentation on 2026-08-14:
   Tesseract was trained on printed fonts; clear block printing reaches ~65–85 % in ideal conditions,
   while normal cursive, slanted or messy handwriting drops to **~30–55 % or lower**, and cursive
   segmentation fails outright. Against `SC-001`'s ≥ 70 %, the **web** path fails the acceptance
   criterion by construction on the exact input class 011 was built for.
3. **Android's on-device path cannot do it either, and this is a category error in the ruling.**
   Checked against Google's own developer documentation on 2026-08-14: ML Kit ships **two different**
   APIs. _Text Recognition v2_ is the camera/image API and is a printed-text recogniser. _Digital Ink
   Recognition_ is the handwriting API — and it recognises _"text handwritten on a digital surface"_
   (stylus/touch strokes), **not** handwriting in a photograph. Google's docs draw the distinction
   explicitly. So "ML Kit" as an answer to "OCR a handwritten recipe card" resolves to the API that
   cannot see a card.
4. **iOS can do it, partially.** Apple's `VNRecognizeTextRequest` supports handwriting on recent iOS,
   **for a subset of languages**, queryable via `supportedRecognitionLanguages(for:revision:)`
   (checked 2026-08-14). So the capability exists on one platform, for some locales.
5. **Net: the same photograph yields four different outcomes** — iOS Vision (handwriting, some
   languages), Android ML Kit (printed only), Web Tesseract.js (printed, poor handwriting), Textract
   (printed + handwriting, demoted to "fallback"). Under §14.1 this is not one feature shipped to two
   platforms; it is three features sharing a button.
6. **The `OcrProvider` port survives and is the one part of D2 that is unambiguously right.** It is
   already specified with normalised confidence and a provider-agnostic result
   (`011/plan.md:38-40`, `:73-79`) and already has a rule forbidding its adapters from leaking vendor
   shapes (`011/plan.md:296-307`, `011/tasks.md:378-379`). Putting Tesseract behind it is a correct
   use of the port. **Making it the default is the defect**, not the port.
7. **A per-token confidence parity risk sits underneath.** The port _requires_ token-level confidence
   with bounding boxes when the provider supplies it (`011/plan.md:73-79`), and the correction UI
   renders it over the image (`011/spec.md:199`, `:202`, `:211-212`). Vision and Tesseract both expose
   per-unit confidence; whether ML Kit Text Recognition v2 exposes a comparable per-element
   confidence on Android is **not verified here** and is listed under _Not examined_. If it does not,
   Android loses the correction UI's core affordance, not just accuracy.

**Verdict: REFUTED as a product decision; the transport half SURVIVES.** Demoting the only
handwriting-capable adapter to a fallback, while promoting one engine that cannot do handwriting at
all (Tesseract) and one that is the wrong API for photographed handwriting (ML Kit Digital Ink),
inverts the feature's own **Must** requirement (`011/spec.md:198`) and its accepted risk register
(`:572`). D2 is not a cost optimisation of 011; it is a silent scope deletion of 011's differentiator.
Separately, it breaches `CODING_STANDARDS §14.1`'s lockstep rule in substance, and §14.2 permits a
transport fork, not an algorithm fork.

**What must change.**

1. **Keep Textract (or an equivalent handwriting-capable provider) as the DEFAULT for the handwriting
   class.** On-device and Tesseract are legitimate as a **fast path for printed text with an explicit
   escalation**: run cheap-first, and when the result's `overallConfidence` falls below a stated
   threshold, or the user taps "try harder", escalate to the handwriting provider. That keeps the
   cost saving, keeps `SC-001` reachable, and keeps one product.
2. **The spec MUST state a parity contract**, because §14.1 is a hard rule and the platforms are no
   longer running the same code. Minimum four clauses, each testable: (a) the **same `OcrProvider`
   result shape** on every platform, including token confidence and bboxes, or the correction UI is
   defined for the degraded case; (b) a **stated accuracy floor per platform**, measured against one
   shared benchmark photo set (011's R-001 already demands a benchmark — `:572`); (c) **one escalation
   rule**, shared, living in a shared package, not implemented twice; (d) the **user-visible
   consequence named** — whether the app tells the user which engine ran, and what "this photo may
   need the slower reader" looks like.
3. **Take the §14.1 waiver or close the gap.** `CODING_STANDARDS.md:963` requires a single-platform
   divergence to be _"recorded in the feature's `plan.md` Complexity Tracking table and approved in
   the PR description."_ If Android ships without photographed-handwriting support, that is a waiver
   and it must be written there. Silence is a rule violation, not a trade-off.

---

## A-4 — Does the raw-text channel weaken provenance? (D2, second half)

**Claim attacked.** D2: mobile submits raw text to "a new first-class raw-text import channel in
004", asserting text the server never saw an image for. The brief asks whether this reintroduces the
`004-FR-025` inversion that report 11 A-3 / report 14 P-3 already faulted.

**Attack.** Report 11 A-3 established that an import token saying _"create recipes as user X with
`sourceType = imported_physical`"_ is the exact classification `FR-025` forbids a caller to declare,
and that D-014's premium gate (`004/spec.md:670-677`) then has no enforcement point. D2 removes the
image from the server entirely, which makes the assertion _strictly weaker_: the server now has not
even a byte of evidence. On its face this is the same hole, worse.

**Evidence.**

1. **The channel is not new. 004 already has it, with a solved provenance model.** `FR-014a`
   (`004/spec.md:265-271`) governs _"any **manually pasted or typed** recipe the user attests
   originates from an external source"_ and requires **(a)** an explicit source attestation **and**
   **(b)** a source citation, classifies the result `imported_paid` where the source is not a publicly
   reachable web page, forbids publication, and makes automated heuristics a _"**secondary signal**"_
   that _"MUST NOT by itself reclassify a recipe or block a save."_ D-003 (`:608`) records the ruling.
   **A raw-text channel is a paste channel with a different keyboard.**
2. **`FR-025` already carves out exactly this case and states the test.** `004/spec.md:294-298`:
   _"A caller MAY declare only provenance that is **equally or more restrictive** than `user_created`
   — specifically the attested paid-source case (`FR-014a`). A caller MUST NOT be able to declare
   `imported_public` … or `imported_physical` (which would grant a free-tier caller a private recipe
   that C-004 reserves for premium)."_ The rule is not "the server must have seen the artifact"; it is
   **"a caller may not declare a provenance that GRANTS them something."** `imported_paid` grants
   nothing; `imported_physical` grants a premium-reserved capability. That distinction is the whole
   control, and it is already written.
3. **So the inversion is avoidable by construction, and only one thing creates it: letting the mobile
   channel assert `imported_physical`.** If it does, D-014's gate (`004/spec.md:670-677` —
   _"photo/OCR import and attested paid-source entry become premium-only"_) is enforced by the party
   being gated. If instead the mobile raw-text channel resolves to `imported_paid` under `FR-014a`'s
   attestation-plus-citation, `FR-025` holds **literally and unchanged**, no service principal is
   needed for it, and report 11 A-3's finding does not recur on this path.
4. **The residual is a copyright-laundering surface, not an entitlement bypass — and 004 already
   accepted it.** A user can OCR a cookbook page on-device and submit the text as `user_created`,
   then publish it, which `FR-013` (`004/spec.md:258-259`) forbids for physical-copy imports. But that
   is precisely the risk `FR-014a` + D-003 were written for, with heuristics as a secondary signal,
   and it is reachable today with a keyboard. D2 lowers the effort; it does not open a new class.
5. **One thing D2 genuinely does erode, and the rewritten ADR must say so.** D-014's stated rationale
   is two-part: _"it confines Textract spend to paying users, which retires the cost concern D-001
   opened"_ **and** the C-004 policy gate (`004/spec.md:670-677`). On-device OCR costs the platform
   nothing, so half of D-014's justification does not apply to the mobile path while the other half
   (non-public creation is premium) still does. The gate should stay — but the ADR must not keep
   citing the spend rationale for a path with no spend.
6. **The OCR sub-quota (`004-FR-022`, `004/spec.md:312-317`; D-006's 50/day + 5/min at `:712-719`)
   becomes unenforceable on the mobile path**, because the server never sees an OCR call. Report 14
   P-11 already recorded that 011 has no quota requirement at all. D2 makes that gap structural rather
   than an oversight.

**Verdict: WEAKENED, not refuted — and it is the ruling that is closest to being made correct by one
sentence.** The channel does not weaken provenance _if_ it is classified under the rule 004 already
has. It weakens it fatally _if_ it asserts `imported_physical`, which is what D2 implies by calling
it the mobile half of photo import.

**What must change.**

1. State it explicitly: **the mobile raw-text channel classifies as `imported_paid` under `FR-014a`
   (attestation + citation), never `imported_physical`.** Then `FR-025` is unamended and true as
   written, and the mobile path needs no service principal at all.
2. If the owner instead wants mobile photo-OCR to be a _premium_ capability with an
   `imported_physical` classification, then the entitlement decision **MUST be made while the user's
   token is live, at submission, by the recipe service reading `public_metadata`** (ADR-0017
   decision 3, `0017:70-75`) — never carried as a client claim. Say which.
3. Restate D-014's rationale for the split world: the gate is on **non-public creation**, not on OCR
   spend, and the spend argument now applies only to the server-side (web/Textract) path.
4. Give the raw-text channel a **quota rule**, since `FR-022`'s OCR sub-quota cannot see it. The
   honest answer is that it falls under the 200/day general allowance (`004/spec.md:712-719`) with no
   sub-quota, and the ADR should say that rather than leaving `FR-022` looking enforced.

---

## A-5 — Does D6 still hold once ADR-0019 shrinks?

**Claim attacked.** D6: 006 is extracted on **C-006-001**'s reasoning — _"`kitchensink_recipes` is
already operated on by **three scheduled destructive workers** (version-archive prune, GDPR erasure
sweep, orphan deletion) whose blast radius must not widen"_ (`specs/006-meal-planning/spec.md:38-42`)
— **not** on the amendment's reasoning at `0017:243-253`.

**Attack.** Report 13 A-5 and report 14 P-7 both killed the amendment's two stated reasons (reason 1
is self-citation of an ADR written hours earlier; reason 2 proves too much and applies identically to
007/009), and both nominated C-006-001 as the sound replacement. The revision adopts that. So the
only question left is: **is C-006-001 itself true?** Nobody has checked it against the workers.

**Evidence.**

1. **All three "destructive workers" are precisely scoped, and two are per-row.**
    - `version-archive-worker.ts:204` — `DELETE FROM recipe_versions WHERE id = ${versionId}`. One
      row, by primary key, per message.
    - `erasure-orphan-sweeper.ts:24-35` — operates on **S3 objects** under
      `recipes/{ownerId}/{removedRecipeId}/` prefixes, reconciled against a job row's captured
      `removed_recipe_ids`, and its docstring records that it was **narrowed** from an owner-prefix
      sweep precisely because the broader scope destroyed kept media: _"Sweeping the whole OWNER prefix
      — as this sweeper used to — would delete that kept media on the next tick."_ It touches no
      recipe table at all.
    - `account-erasure-worker.ts` is **hand-enumerated, table by table**:
      `DELETE FROM recipe_ratings WHERE user_id = …` (`:445`), `DELETE FROM recipes WHERE …` (`:460`,
      and `:373` insists it is `WHERE id = ANY(removed)`, _"NOT `WHERE owner_id`"_),
      `DELETE FROM collections WHERE owner_id = …` (`:463`), `DELETE FROM author_handles …` (`:474`).
      And decisively, `:378`: _"`ingredients` (shared, owner-less) is **deliberately untouched**."_
2. **Therefore the blast radius does not "widen" when a table is added — it widens only when an
   engineer types a new `DELETE` line.** The premise of C-006-001 describes a _database-wide_ sweep
   that does not exist. `account-erasure-worker.ts:378` is proof of the opposite discipline: a shared
   table sits in that same database today and is excluded by an explicit, documented decision.
3. **The reverse cost is real, large, and nobody has priced it.** Extraction makes **GDPR erasure a
   distributed problem.** Today one worker deletes an owner's recipes, ratings, collections and
   handles in **one transaction** with one give-up decision (`erasure-sweeper.ts:11-31` — the backstop,
   the staleness rule, the abandon logic). After extraction, `meal-plan-service` must build its own
   erasure job table, its own claim/backoff/give-up sweeper, its own service-principal auth
   (`serviceErasureToken.ts` again), its own orphan reconciliation — **and the completeness guarantee
   now spans a network boundary with no transaction.** That is roughly the machinery already proven
   hard enough to need four files and a dedicated token type. ADR-0017 named the mirror-image saving
   (`0017:88-92` — co-location _"deletes work rather than adding it"_: `ON DELETE CASCADE` retires
   006's orphan handler and `is_orphaned` column) and neither the amendment nor D6 revisits it.
4. **007 and 009 are still broken by the extraction and D6 does not mention them.** Report 13 A-4
   established it with seven citations; nothing in D6 repairs `specs/007-grocery-lists/plan.md:479`
   (`ON DELETE SET NULL` across databases) or `specs/009-nutrition-planning/tasks.md:56-58`
   (`meal_plan_nutrition_link` as a cross-database join table). Re-basing the reasoning on C-006-001
   does not make those two plans implementable.
5. **006's own plan still contradicts itself.** `specs/006-meal-planning/plan.md:384-386` —
   _"✅ **RESOLVED (2026-08-12) — `/api/v1/meal-plans/*` is owned by `@kitchensink/recipe-service`** …
   **No new deployable service is created for 006.**"_ — against `:720`, which argues for
   `@kitchensink/meal-plan-service` and prices the trade at _"a saving of ~$8/mo/stage."_ Report 13
   A-5 flagged this; it is unfixed.

**Verdict: REFUTED as re-derived on C-006-001 alone.** C-006-001's mechanism claim is false against
the code: no worker in `packages/services/recipe-workers/` has a blast radius that a new table would
enter, and one of them documents deliberately excluding a shared table already. The _conclusion_ may
still be the owner's to make — bounded context, release cadence, and the plain fact that
`recipe-service` is already carrying more than its name (`0017:126-130`) are all legitimate — but D6
as stated replaces two refuted reasons with a third that does not survive contact with
`account-erasure-worker.ts:373-378`.

**What must change.**

1. Do **not** cite the three sweepers as a blast-radius argument. Cite `account-erasure-worker.ts:378`
   in the ADR as the counter-evidence and say why the decision stands anyway.
2. If 006 is extracted, **price the distributed-erasure cost explicitly**: a second erasure job table,
   a second sweeper with its own give-up rule, a service-principal audience for `meal-plan-service`,
   and the loss of the single-transaction completeness guarantee. That is a **one-way door** (GDPR
   completeness across a service boundary) and it is currently invisible.
3. Follow ADR-0017's own house style, which report 14 P-14 and report 13 "where the design held" #2
   both praised (`0017:236-240`): record it as an **owner architectural decision**, not as the firing
   of a criterion. That sentence already exists in the tree and is the right template.
4. Reconcile `006/plan.md:384` with `:720`, and repair 007/009 per report 13 A-4, **before** any of
   the three is implemented.

---

## A-6 — D3 narrows 011, but the correction UI's API still has no home

**Claim attacked.** D3: 011 narrows to web image OCR + the correction UI, "on the Lambda/SQS shape its
own package table already names. No image-processing ECS service, no new ALB slot."

**Attack.** Check the package table. Does it name only a Lambda?

**Evidence.**

1. **The Lambda half of the claim is exactly right and is the strongest ruling in the set.**
   `011/spec.md:339` names `@kitchensink/digitization-workers` as _"Lambda — receives S3 key, runs …
   OCR"_; `011/plan.md:12` names the infrastructure as _"Lambda + SQS/DLQ + S3 + CloudFront"_; `:153`
   _"Job enqueued to SQS (`digitization-ocr` queue), Lambda worker processes OCR"_; `:385-388` an
   _"SQS-triggered worker, batched receive with partial failure reporting"_. D3 adopts, verbatim, the
   shape report 13 A-6 demonstrated the repo had already chosen and ADR-0019 had silently overridden.
   It deletes an ALB slot (scarce: `EPHEMERAL_SLOT_ORDER` is 3 of 8 today,
   `packages/infra/alb/src/listener-priority.ts:102`), a target group (report 13 A-2's non-adjustable
   ceiling), a per-PR ECS task (~$5.50–8.25/mo each, ADR-0010), a Dockerfile, a deploy job, a smoke
   test and a `CONTRACT_HASH` assertion. **This ruling alone repairs report 13 A-6, report 11 A-6 and
   report 14 P-5.**
2. **But the same package table names two more packages, and one of them is a NestJS service.**
   `011/spec.md:340` — `@kitchensink/digitization-service`, _"NestJS module — **`DigitizationJob`
   CRUD**, pre-signed URL minting, correction save"_; `:341` — `@kitchensink/circles-service`.
   `011/plan.md:12` says the same four packages and _"RDS-backed APIs"_. So "the shape its own package
   table already names" is a **Lambda plus a NestJS HTTP service**, and D3 quotes half of it.
3. **The correction UI is an HTTP surface with durable state, and D3 keeps it in scope.** `FR-013`
   (`011/spec.md:203`) — client polls `GET /api/v1/recipes/digitize/jobs/:id`; `FR-015` (`:210`) —
   `PATCH …/jobs/:id/correction`; `FR-021` (`:221`) — `POST …/save`; `FR-028` (`:265`) — **cursor
   pagination** over `…/jobs`; `FR-029` (`:267`) — a `job_status` on every response; `FR-036` (`:284`)
   — a daily purge of `raw_ocr_json` at 90 days on a **predicate over two columns with two clocks**
   (`C-005`). Reports 11 A-2, 13 A-7 and 14 P-4 all independently concluded that "owns no database" is
   not a property this feature can have. **D3 narrows the compute and leaves the state unassigned,
   which is the same omission in a smaller box.**
4. **There are exactly two defensible homes and D3 picks neither.** (a) API Gateway + Lambda over a
   `digitization` logical DB — the `identity-webhooks` mould, which costs zero ALB slots and which
   ADR-0006 makes free for the database (this is what report 13 A-7 recommended). (b) The recipe
   service owns `digitization_jobs` — which imports vendor PII and a **fourth** scheduled destructive
   job into `kitchensink_recipes`, and would be openly inconsistent with D6's stated rationale (A-5).

**Verdict: SURVIVES on compute, INCOMPLETE on state.** D3 is right and cheap and fixes three prior
findings. It is not yet a decision, because the thing 011 exists for — the correction UI
(`011/spec.md:26`, _"The differentiator is correction UX over a normalised schema"_) — needs a
queryable store and a query surface that D3 assigns to nobody.

**What must change.** One paragraph: **`digitization_jobs`, `raw_ocr_json`, per-token confidence and
the 90-day purge live in a `digitization` logical database (free per ADR-0006), fronted by API
Gateway + Lambda (the `identity-webhooks` mould), not by an ALB rule.** Then state the consequence
plainly — 011 owns a database, and the "no database" sentence from ADR-0019 is **withdrawn**, not
narrowed. Also say what happens to `@kitchensink/circles-service` under D3, since the package table
names it and D3's scope sentence does not.

---

## A-7 — D4: "nutrition is a LIVE REFERENCE" — against what?

**Claim attacked.** D4: nutrition is a live reference, not a snapshot.

**Attack.** Report 15 A-5 established that the shipped model is **already a snapshot — an undeclared
one**. D4 therefore is not a ratification; it is a **reversal of shipped behaviour**, and it needs
machinery that does not exist. Worse, it collides with two recorded decisions in other features.

**Evidence.**

1. **The stored copy exists and has exactly one writer.** `ingredients.calories_per_100g` and its
   three siblings are columns (`packages/services/recipe-service/src/database/schema/ingredients.ts:58-62`),
   written only by `IngredientsDal.updateResolution`
   (`packages/services/recipe-service/src/ingredients/dal/ingredients.dal.ts:363-385`), which is a bare
   `UPDATE … WHERE id = $1` with `COALESCE` and **no version or status predicate**. Report 12 A-3
   already filed the missing guard; it is unfixed and D4 makes it load-bearing.
2. **Upstream change is already detected and already re-enqueued — the propagation stops one hop
   short.** `ChangeRefreshConsumer` scans every `RESOLVED` food's backing items, compares
   `item_version`, and re-enqueues changed foods through the ordinary path
   (`packages/services/food-service/src/worker/change-refresh/change-refresh.consumer.ts:1-22`);
   `mergeChangedSources` rewrites the golden record in place and keeps the food `RESOLVED`. Report 15
   A-4(ii): _"There is **no path** by which that reaches `ingredients.calories_per_100g`."_ D4 is
   therefore a requirement for **the missing hop**, and it is a real, well-motivated requirement.
3. **D4 + D5 compose, and that is the best thing in the revised design.** A live reference needs a
   change stream from the food service; D5 provides one; food already emits `FoodFetchCompleted` on
   every terminal disposition through an injectable `EventBus` seam
   (`packages/services/food-service/src/events/food-event-emitter.ts:1-14`, `:19-24`) onto a real
   deployed bus (`food-service-stack.ts:266-268`). The two rulings together are the first coherent
   answer anyone has written to report 15 A-4(ii) and A-5. **Credit this explicitly in the ADR.**
4. **But "live" is not achievable for three of the four surfaces, and D4 must say so.**
    - **`recipes.lead_calories_per_serving`** is a denormalised headline recomputed only on the
      recipe's next write (`packages/services/recipe-service/src/database/schema/recipes.ts:124`;
      report 15 A-4 cites `migrations/0012_lead_calories_per_serving.sql:13`). Under a live reference
      the card and the detail **disagree indefinitely** — and
      `packages/shared/recipe-core/src/nutrition.ts:62-67` asserts they _"can never disagree."_ D4
      makes that docstring false at a higher rate; it does not make it true.
    - **Per-line user overrides are by design NOT live.** `recipe_ingredients.user_calories` et al.
      take strict priority over the catalog (`schema/ingredients.ts:97-127`;
      `packages/shared/recipe-core/src/nutrition.ts:1-16`). A "live" rule must exempt them explicitly.
    - **006 never calls the food service.** C-006-003 (`specs/006-meal-planning/spec.md:~52`) —
      _"Nutrition is aggregated from recipe-level nutrition, not from ingredients or the food
      service"_ — and its rollup is a _"pure read-time fold"_ over already-denormalised values
      (`specs/006-meal-planning/research.md:447`). So meal-plan totals track D4's liveness only to the
      freshness of the recipe layer, never better.
5. **And there is a product consequence D4 owes a sentence.** A saved heirloom recipe's calorie
   figure changing without the user touching it is a _feature_ for a USDA correction and a _defect_
   for a user who wrote the number down. 006 already reasoned about the mirror case and chose the
   other way for a _derived aggregate over a user-owned mutable entity_
   (`006/research.md:447` — _"A snapshot is a second source of truth that goes stale on every recipe
   edit"_). Report 15 A-5 showed these are different objects with opposite correct answers; D4 must
   say which object it is ruling on.

**Verdict: SURVIVES as a decision, UNDER-SPECIFIED as a rule.** D4 fixes a genuine, evidenced defect
(A-4(ii)) and pairs correctly with D5. It cannot be stated as a bare "nutrition is live", because
three of the four surfaces that display nutrition cannot be live and one of them must not be.

**What must change.**

1. Scope it: **"the recipe service's stored per-100g values are a _replica_ of the food golden record,
   kept current by consuming food's change stream (D5). Per-line user overrides are authoritative and
   are never refreshed. `recipes.lead_calories_per_serving` is a derived headline and is recomputed on
   ingredient-replica change, not only on recipe write."**
2. Make `updateResolution` a **guarded** write before any push consumer exists — a legal-priors
   predicate plus a monotonic `resolution_sequence`, with `rowCount = 0` meaning "stale write,
   ignored" (report 12 A-3, report 15 A-4). Two unsynchronised writers (the existing
   `IngredientsService.refreshStatus` poll and the new consumer) on one column, with no predicate, is
   a lost update by construction.
3. Add `resolved_at` and `food_item_version` to `ingredients` (report 15 A-4 item 2, A-5). **Persisted
   schema — one-way door — additive only.** Without a version there is no way to detect a stale
   replica and no way to answer "as of when?".
4. Correct or delete `nutrition.ts:62-67`'s "can never disagree" claim in the same change.

---

## A-8 — D5: "durable, grouped, guaranteed delivery, latest-in-group wins" is four properties, and two of them fight

**Claim attacked.** D5: a message substrate with those four properties is built in PR 91; food
produces to it; 014 later consumes.

**Attack.** Take the four adjectives literally against real transports and against 014's own contract.

**Evidence.**

1. **"Guaranteed delivery" and "latest-in-group wins" are contradictory as message-delivery
   properties.** Latest-wins means superseded messages are **not delivered** — that is the point. So
   the guarantee being offered is not "every message is delivered"; it is **"the latest state per key
   is eventually delivered at least once."** That is a _state-replication_ contract, not a queue
   contract. Naming it correctly matters, because it decides what a consumer may assume: a consumer of
   this substrate **may not count events, may not accumulate, and may not treat absence of a message
   as absence of a change.** The ADR must say that in those words or every consumer will get it wrong.
2. **No AWS messaging primitive provides latest-in-group-wins at delivery.** SQS FIFO preserves order
   within a `MessageGroupId` and delivers **every** message in it; SNS FIFO and EventBridge do not
   supersede either. Log compaction (Kafka/MSK) is a _retention_ property, and a live tail consumer
   still sees every record. So "latest-in-group wins" is necessarily implemented **by the consumer**,
   against a durable per-key watermark — which is exactly the mechanism report 12 A-2 found
   **unimplementable as 014-FR-045 currently writes it** (`specs/014-notification-service/spec.md:640-642`
   says "highest already observed"; `:657-660` says supersession "applies only among **pending**
   messages", so a redelivered stale sequence after an ack becomes a new pending notification — the
   exact regression). D5 does not repair that; it inherits it.
3. **"Grouped" has two incompatible answers and D5 names neither.** 014's grouping is **by
   recipient**: `FR-029` (`specs/014-notification-service/spec.md:418-427`) — _"the SQS FIFO ingest
   queue keyed on `MessageGroupId = recipient.id`"_ — because `FR-008` (`:355`) promises per-recipient
   FIFO. D4's propagation needs grouping **by entity** (`food_id`), because that is what
   latest-wins-per-key means. One message carries **one** `MessageGroupId`. So a single substrate
   cannot be both, and D5 asserts a single substrate.
4. **"Food produces to it; 014 later consumes" is forbidden by 014 and impossible for food.**
    - `014-FR-025` (`spec.md:383-387`), verbatim: _"It MUST NOT subscribe to producers' **domain
      events**. A domain event carries no recipient, and deriving one would require inspecting
      `payload` (forbidden by FR-023) or calling back into the producer."_ Food's `FoodFetchCompleted`
      is a domain event carrying `{eventId, timestamp, id, status}` and **no recipient**
      (`food-event-emitter.ts:49-59`).
    - Food **cannot** name a recipient, and the codebase says so in a schema docstring written as a
      correction of this exact error —
      `packages/services/food-service/src/db/schema/operational.ts:64-71`: _"**NOT** notification
      targeting — that intent was recorded here and is **IMPOSSIBLE** from this table:
      `FetchQueueDao.resolve` deletes every row for a food in the same transaction that completes it
      (DSN-10) … The recipe service owns the notification subscription set."_ The deletion is real:
      `fetch-queue.dao.ts:348-352` deletes `fetch_requesters` then `fetch_queue` in one transaction.
      Report 12 A-5 established this. D5 reverses it without naming the premise it is overturning.
5. **"Durable" is the one adjective with a real, shipped counter-example on both ends.** Food's
   emitter is fire-and-forget: `publishFoodFetchCompleted` and `publishFetchFailed` catch and
   **swallow** the put — _"a bus failure is logged via the optional error sink and **swallowed**"_
   (`food-event-emitter.ts:10-12`) — and the wired bus is `ConsoleEventBus`, i.e. today every food
   domain event is a `console.info` (report 12 A-4). And 014's _retention_ store is documented lossy:
   ADR-0016's Durability section (`0016:180-196`) — _"a node replacement, a failover, or a
   maintenance event can **drop retained notifications that this service has already told a producer
   it accepted** … a dropped pending notification is **unrecoverable and silent**."_ So "durable" must
   be supplied by an **outbox on the producer side**, which the repo already knows how to build
   (`archive-sweeper.ts:11-29`, A-1 evidence 3) and which ADR-0019 listed only as a _consequence_, not
   a decision (`0019:162-164`).
6. **What survives, and it is the correct core.** Two separate streams, each internally coherent:
    - **A food-change replication stream** — grouped by `food_id`, latest-wins, consumed by the recipe
      service to keep `ingredients` current (D4). This one genuinely wants a compacted/keyed shape and
      genuinely has no recipient. It is a **replicated key-value projection**, and the right name for
      it is a _change stream_, not a notification bus.
    - **A user-notification stream** — grouped by `recipient.id`, FIFO, envelopes only, produced by the
      **recipe service** (which owns the subscription set) and consumed by 014. `supersedes` belongs
      here (`014-FR-026`, `spec.md:387-398`), keyed on the entity, with the watermark question of
      report 12 A-2 answered rather than inherited.

**Verdict: REFUTED as one substrate; SURVIVES as two.** Every individual property D5 names is
achievable. They are not achievable **simultaneously on one stream with one grouping key**, and the
producer D5 nominates is the one the codebase has already recorded as unable to address a user.

**What must change.**

1. Split it, and name both: a **food-change stream** (key = `food_id`, latest-wins, consumer =
   recipe service, purpose = D4's replica) and a **notification envelope stream** (key =
   `recipient.id`, FIFO, producer = **recipe service**, consumer = 014). Say in one sentence that
   **014 never subscribes to food**, and cite `014-FR-025` and `operational.ts:64-71` so nobody
   re-derives it.
2. Promote the **transactional outbox from consequence to decision** on both producers: the state
   change and the outbox row commit in one transaction; a relay drains it; relay lag is alarmed; and
   `food-event-emitter.ts:10-12`'s swallow-and-continue is deleted. Cite `archive-sweeper.ts:11-29` as
   the in-repo precedent so this is a copy, not an invention.
3. State plainly that **latest-in-group-wins is a consumer-side rule over a durable per-key
   watermark**, not a transport feature, and say where the watermark lives and how long it outlives an
   ack (report 12 A-2 is unresolved and D5 inherits it).
4. Do **not** put 014 on 004's critical path. Report 13 A-8's requirement stands: 004 must ship with a
   readable projection (`GET /api/v1/imports/{importId}`) and be acceptance-complete with 014 absent;
   `packages/schemas/` today holds exactly `food`, `identity`, `recipe` — 014 has no service, no schema
   package and no client.

---

## What the rewritten ADR must contain

**Must contain — each of these is load-bearing and currently absent or wrong:**

1. **A named composition, not a taxonomy (A-1).** "Each domain owns its work queue and its drain
   runtime; all implement one delivery contract" — where the contract is **Transactional Outbox +
   idempotent at-least-once handler + guarded state machine + durable projection**, with the four
   in-repo precedents cited (`archive-sweeper.ts:11-29`, `food.dao.ts:182-188`/`:303-333`,
   `ingredients.ts:48-73`, `recipes.ts:132`). Shared **contract** in a shared package; **runtime**
   per-domain; **no base class**.
2. **The mould each processor uses, and the scaling truth (A-1).** Food = single-drainer Fargate,
   advisory-locked (`worker-lock.ts:15-19`) and therefore **not** horizontally scalable. Recipe
   import + OCR = Lambda/SQS.
3. **The convergence mechanism, named, with its principal (A-2).** One internal recipe-service
   endpoint; asymmetric service-principal JWT per `serviceErasureToken.ts:41,49,65` with a per-target
   audience and claims bound to one `importId` + one `ownerId`; or — if OCR lands in `recipe-workers`
   — an in-process call and no credential at all. **One-way door.**
4. **A cross-platform OCR parity contract (A-3).** Same `OcrProvider` result shape everywhere; a
   stated accuracy floor per platform against one shared benchmark set; **one** shared escalation rule
   to a handwriting-capable provider; and either handwriting parity or a §14.1 waiver recorded in
   `plan.md`'s Complexity Tracking table.
5. **The provenance rule for raw text, in FR-025's own vocabulary (A-4).** Mobile raw text is
   `imported_paid` under `FR-014a` attestation + citation — **never** `imported_physical`. If premium
   photo-import is wanted on mobile, the entitlement is read from the live user token at submission.
6. **The owner of `digitization_jobs` (A-6).** A `digitization` logical DB (free per ADR-0006) behind
   API Gateway + Lambda. State that "011 owns no database" is **withdrawn**, not narrowed.
7. **The nutrition rule, scoped (A-7).** Replica kept current from the change stream; user overrides
   authoritative and never refreshed; `lead_calories_per_serving` recomputed on replica change;
   `resolved_at` + `food_item_version` added to `ingredients` (**one-way door, additive**);
   `updateResolution` guarded by legal-priors + monotonic predicate.
8. **Two streams, not one (A-8).** Food-change (key `food_id`, latest-wins, consumer = recipe service)
   and notification envelopes (key `recipient.id`, FIFO, producer = **recipe service**, consumer =
   014). Outbox promoted to a decision. Latest-wins declared a consumer-side watermark rule.
9. **006's extraction recorded honestly (A-5).** Cite `account-erasure-worker.ts:373-378` as
   counter-evidence to C-006-001's mechanism, price the distributed-erasure cost, and record the
   ruling in ADR-0017's own amendment style as an **owner architectural decision**.
10. **A verbatim clarifications block for the 2026-08-14 session** (report 14 P-15). The repo's own
    practice is `specs/014-notification-service/spec.md:30-51`. Without it, "the owner decided this"
    is unfalsifiable and D1–D6 will be re-litigated by whoever reads them next.
11. **An explicit list of what was NOT decided**, so the next reader knows the difference between a
    ruling and an omission.
12. **A downstream reconciliation list** (report 11 A-7, report 14 P-13): `004/tasks.md:551` still
    builds T-018 (the OCR channel, "ships at launch"); `011/tasks.md:70,114` still create
    `digitization_jobs` inside `packages/services/digitization-service/`; `004/spec.md:6` still says
    "Ready for implementation". Either land those edits or say at the top that they are stale.

**Must NOT claim:**

1. **NOT** that "per-domain processor" is a design pattern, or that all three processors scale
   independently (`worker-lock.ts:15-19` forbids it for food).
2. **NOT** that D2 keeps one product across platforms without a parity contract and a waiver. And
   **NOT** that Tesseract.js or ML Kit satisfies `011-FR-008`'s handwriting **Must** — verified
   2026-08-14: Tesseract drops to ~30–55 % on cursive, and ML Kit's handwriting API (Digital Ink)
   reads stylus strokes, not photographs.
3. **NOT** that the raw-text channel is new (`004-FR-014a` is it) or that it may assert
   `imported_physical`.
4. **NOT** that any service "owns no database" (011's `FR-013/015/020/022/028/029/036` make it
   impossible — reports 11 A-2, 13 A-7, 14 P-4).
5. **NOT** that nutrition is simply "live" (three of four display surfaces cannot be, and per-line
   overrides must not be).
6. **NOT** that one substrate is durable + grouped + guaranteed-delivery + latest-in-group-wins, that
   food can address a user (`operational.ts:64-71`), or that 014 may subscribe to domain events
   (`014-FR-025`).
7. **NOT** that C-006-001's blast-radius premise holds (`account-erasure-worker.ts:373-378`).
8. **NOT** a "named exception to ADR-0017" for anything in 011 — `0017:217-221` explicitly declines to
   rule on 011, so no exception is available to take (report 11 A-6, report 14 P-5). If a deployable
   is wanted, record it as an owner decision with its own cost line.
9. **NOT** an ALB priority as a per-service constant anywhere (`CLAUDE.md`; the allocator in
   `packages/infra/alb/src/listener-priority.ts` is the only source).
10. **NOT** that the ruling is landed until the artifacts in item 12 above are reconciled.

---

## Where the revised design held

Stated plainly, because a review that only attacks is not one.

- **D3's Lambda/SQS shape is correct and cheap**, and it repairs report 13 A-6, report 11 A-6 and
  report 14 P-5 in one move. It adopts the shape `011/plan.md:12,153,385-388` already specified,
  costs zero ALB slots against a scarce allocator, and deletes a per-PR ECS task.
- **D1's conclusion — three processors, not one shared bulk processor — is right**, for a better
  reason than it gives: three different durable owners and three different back-pressure regimes
  (`fetch_queue` + source budget; `import_drafts` + per-user quota; an image object + a vendor
  timeout).
- **Narrowing the convergence seam to recipe creation is exactly what report 11 A-1 demanded**, and
  it moves all five of that finding's divergences onto the channel's own side.
- **D4 fixes a real, evidenced defect.** `ChangeRefreshConsumer` detects upstream change and stops
  one hop short of `ingredients` (report 15 A-4(ii)); D4 is the requirement for that hop.
- **D4 + D5 compose.** A live replica needs a change stream; food already emits through a real
  `EventBus` seam onto a deployed bus (`food-event-emitter.ts:19-24`, `food-service-stack.ts:266-268`).
  This is the first coherent propagation story in the corpus.
- **Rebasing D6 off the amendment's two refuted reasons is right**, even though the replacement
  reason also fails. Reasons 1 and 2 at `0017:243-253` were correctly abandoned.
- **The `OcrProvider` port is the right abstraction** and is already correctly contracted
  (`011/plan.md:38-40,73-79`, `011/tasks.md:378-379` — the vendor shape is boundary-validated and
  never converged, per `CODING_STANDARDS §15-d`). Putting Tesseract behind it is a correct _use_ of
  the port; only making it the default is wrong.
- **`FR-025`'s "equally or more restrictive" carve-out already solves the raw-text provenance
  question** (`004/spec.md:294-298` + `FR-014a` at `:265-271`). The revised design needs one sentence,
  not a new mechanism.

## Not examined

- **Whether ML Kit Text Recognition v2 exposes per-element confidence on Android.** Verified that
  Digital Ink ≠ photographed handwriting and that Vision's handwriting support is
  language-subset-limited (both 2026-08-14, vendor docs). Per-element confidence parity is **assumed
  unresolved** and decides whether Android can render 011's correction UI at all (A-3 evidence 7).
- **Tesseract.js on Lambda operationally** — traineddata size, cold start, memory, arm64. Only the
  accuracy claim was checked; the deployment feasibility is unassessed.
- **Any measurement.** No query run, no load test, no AWS API call, no benchmark photo set. Every
  scaling, cost and accuracy claim is reasoned from statement shape, vendor documentation and index
  definitions.
- **011's Family Circles half** and `@kitchensink/audience`, except to note D3's scope sentence does
  not say what happens to `circles-service`.
- **The v-model artifacts of 004 and 011** (`v-model/*` in both). Reports 11 A-7 and 14 P-13 counted
  the stale OCR references; the hazard and acceptance implications of D2's platform split are
  **entirely unassessed** and are likely the largest untracked consequence in this set.
- **006/007/009's plans beyond the citations in A-5.** Report 13 A-4's seven repairs are quoted, not
  re-derived.
- **Whether the D2 split changes 011's cost model.** On-device OCR is free to us and Tesseract on
  Lambda is near-free; no one has priced what escalation-to-Textract at the rate A-3's threshold
  implies actually costs, and D-014's premium gate was justified partly on that spend
  (`004/spec.md:670-677`).
- **PR 91's actual diff.** The branch carries 1,264 changed files; I read the ADR, the specs and the
  shipped code the rulings touch, not the diff.

**Confidence: High** for A-1, A-2, A-4, A-5, A-6 and A-8 — every claim is anchored to a file I opened,
and the two attacks that failed (A-2's seam location, A-6's compute shape) are recorded with what
defeated them. **Medium** for A-3, because the handwriting-capability claims rest on vendor
documentation read on 2026-08-14 rather than on a measured benchmark against this feature's own photo
set, and 011's R-001 already says that benchmark is owed. **Medium** for A-7's product half — whether
a saved recipe's numbers _should_ move is an owner call, not an engineering finding.
