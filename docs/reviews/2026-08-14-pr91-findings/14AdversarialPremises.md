# Adversarial review — premises and unstated assumptions

**Scope**: ADR-0019; the 2026-08-14 amendment to ADR-0017; the 004, 011 and 014 spec edits landed in
`4a979422`. Method: each load-bearing claim was tested against the rest of the corpus and against shipped
code, not against the prose. Verdicts are about whether the claim is _true_, not whether it is well written.

**Headline**: the boundary dispute ADR-0019 resolves is real and documented. Three of the four problems it
states as motivation are not — two are already solved in shipped code, one is already specified in the very
features it says are silent. Two normative rules (`sourceType` whitelisting, "011 owns no database") are
contradicted by the requirements they cite, in files edited in the same commit.

---

## P-1

**Premise.** "No in-flight status anywhere… Nothing in any spec told a client that work was underway, how far
it had got, or that it had failed — so every client's only option was to poll a terminal result."
(`docs/architecture/decisions/0019-recipe-import-spine.md:32-36`)

**Why it may be false.** Three specs already describe in-flight status for exactly these flows, and one of
them is 004's own product spec.

**Evidence.**

- `specs/004-recipe-importing/product-spec/wireframes/import-progress.md:1-29` — an **Import Progress**
  screen for J1/J2, with a plain-language stage ("Fetching the page…", "Reading your recipe…"), bounded
  backoff polling that "stops at a terminal state", a non-blocking navigate-away contract, a slow-import
  affordance, and the component-test state list `queued · running · succeeded · duplicate-found · failed ·
abandoned-on-unmount`.
- `specs/011-recipe-digitization/spec.md:203` (FR-013) — "Async OCR via SQS — API response is non-blocking;
  client polls `GET /api/v1/recipes/digitize/jobs/:id`"; `:267` (FR-029) — "`job_status` field on **every**
  response (`pending`/`processing`/`awaiting-correction`/`saved`/`discarded`)".
- `packages/schemas/food/src/schemas/foods.schema.ts:128-141` — the food service already answers `202` with a
  `PENDING`/`UNRESOLVED` body and an `estimatedWaitSeconds`, and `:143-152` ships
  `GET /api/v1/foods/{id}/status` returning the full lifecycle. Shipped, not specified.

**Verdict.** UNSUPPORTED. The gap was _push_ delivery of status, and cross-channel _uniformity_ of the stage
names — not the absence of status.

**What the doc should say instead.** "Three status models exist (004's polled progress screen, 011's
`job_status`, the food service's `202` + status endpoint) and they do not agree on stages or on transport.
This ADR unifies them and adds push." That is a defensible motivation; "nothing exists" is not, and it is the
claim that licensed inventing a sixth vocabulary rather than reconciling the three.

---

## P-2

**Premise.** "Nothing to hang status on. A recipe references ingredients by opaque `food_id`. If the
referenced food is not yet resolved there is no row to carry 'resolving', so the recipe could only store a
dangling id or nothing at all." (`0019:37-39`) — the sole stated motivation for §5's placeholder/shell model
(`0019:115-134`) and for `004-FR-050` (`specs/004-recipe-importing/spec.md:229-240`).

**Why it may be false.** Both halves of §5 are already implemented.

**Evidence.**

- `packages/services/recipe-service/src/database/schema/ingredients.ts:55-57` — the `ingredients` row carries
  `food_id` **and** `food_resolution_status`; `:35-41` enumerates `PENDING | UNRESOLVED | RESOLVED |
NOT_FOUND | FAILED`, constrained in the DB at `:70-73`. That _is_ the placeholder reference plus its status,
  readable from the database at any time.
- `ingredients.ts:5-7` — "`food_id` is an OPAQUE cross-service reference … **and NOT a cross-DB FK**." There
  is no referential integrity to dangle from; a `NULL`/pending `food_id` breaks nothing.
- `packages/schemas/food/src/schemas/foods.schema.ts:128-141` + `:240-258` — the food service already mints a
  row in a pending state on add-by-name and exposes its status. The "shell entry" exists today.

**Verdict.** UNSUPPORTED as a problem statement; the _design_ in §5 is SUPPORTED, because it is already
shipped. That is the issue: §5 is presented as a decision the owner made, when it is a description of
existing behaviour, and its stated justification is factually wrong about the code.

**What the doc should say instead.** "§5 ratifies the shipped model (`ingredients.food_resolution_status` +
the food service's pending record) as the normative one, and forbids a second status home." Then `FR-050`
must be written against the shipped vocabulary rather than introducing a new one (see P-8).

---

## P-3

**Premise.** "`sourceType` is **declared by the surface, never inferred from the payload**, and is
whitelisted server-side (004 `FR-025` — provenance is never mass-assigned)." (`0019:69-70`), made normative
at `specs/004-recipe-importing/spec.md:214-215` (FR-047) and exercised at
`specs/011-recipe-digitization/spec.md:75-77` ("submits… with `sourceType = imported_physical`").

**Why it may be false.** `FR-025` says the opposite of what it is cited for, and the channel move breaks the
condition `FR-025` relies on.

**Evidence.**

- `specs/004-recipe-importing/spec.md:294-298` (FR-025): "A caller MUST NOT be able to declare
  `imported_public` … or **`imported_physical`** (which would grant a free-tier caller a private recipe that
  C-004 reserves for premium). Those classifications are set **only by the server from the channel it
  observed**."
- `specs/004-recipe-importing/spec.md:285-289` (FR-028) keys the premium gate on exactly that value, and
  `:521` records `FR-025`/HAZ-057 as "the pattern GR-016 wants everywhere".
- After the move, the recipe service no longer observes the photo channel: a **separate deployable** posts
  candidates asserting `imported_physical` (`011:75-77`). The server-observed invariant is gone, and the
  transfer clause (`004:154-160`) puts the only remaining premium check inside the caller.

**Verdict.** UNSUPPORTED, and security-relevant. The ADR inverts the requirement it cites; `FR-047` then
makes the inversion normative; the net effect is that the entitlement gate on private-by-policy recipes is
enforced only by the party being gated.

**What the doc should say instead.** Distinguish the two cases `FR-025` already distinguishes:
caller-declarable provenance (`imported_paid` under attestation) versus server-set provenance
(`imported_public`, `imported_physical`). For the latter, name the mechanism that replaces "the channel the
server observed" — an authenticated service principal for the image service, an allowlist of which principal
may assert which `sourceType`, and a recipe-service-side entitlement check that does not trust the submitter.
Until that is written, this is an open question, not a decision.

---

## P-4

**Premise.** "A dedicated image-processing service **that owns NO database**… It holds no persistent state."
(`0019:76-86`), restated as normative in `specs/011-recipe-digitization/spec.md:65-74`.

**Why it may be false.** 011's own requirements — in the same file, left unamended by the same commit —
specify a job entity, its table, its CRUD, its pagination, its status field, and three separate retention
clocks over it.

**Evidence (all `specs/011-recipe-digitization/spec.md`).**

- `:220` FR-020 — "`DigitizationJob` stores `raw_ocr_json` and `parsed_json` **separately (auditable)**".
- `:346` Data model — "New tables (PostgreSQL 16, Drizzle): `circles`, `circle_members`,
  `circle_invitations`, **`digitization_jobs`**."
- `:340` — "`@kitchensink/digitization-service` … NestJS module — **`DigitizationJob` CRUD**, pre-signed URL
  minting, correction save."
- `:203` FR-013 (poll `GET …/jobs/:id`), `:210` FR-015 (`PATCH …/jobs/:id/correction`), `:224` FR-022
  (`DELETE …/jobs/:id` soft-deletes), `:265` FR-028 (cursor pagination over `…/jobs`), `:267` FR-029
  (`job_status` on every response), `:284` FR-036 (purge `digitization_jobs.raw_ocr_json` at 90 days),
  `:312` NFR-008 (a daily sweep over `digitization_jobs`).
- The workload requires it: `:145-147` US-001/US-002 specify a **side-by-side correction screen** the user
  returns to, over `:199-203` per-token confidence, across `:161` batches of up to 20 photos. Correction is
  durable, user-paced state between extraction and recipe creation. Something must hold it.

**Verdict.** UNSUPPORTED. This is the clearest case of a conversational phrase ("it shouldn't need its own
database") hardened into a MUST that the feature's own requirements cannot satisfy. A stateless OCR
_transform_ is defensible; "011's image service owns no database" is not, because 011's image half is a job
service, not a transform.

**What the doc should say instead.** Either (a) scope the rule honestly — "the **OCR execution** step is
stateless and horizontally scalable; job state, raw/parsed OCR JSON and correction state live in the
digitization service's own tables (011 FR-020, FR-036)" — or (b) if the owner truly ruled out a digitization
database, say which of 011 FR-013/015/020/022/028/029/036 are thereby **withdrawn**, and where correction
state lives instead. Leaving both texts standing means the next contributor picks one at random.

---

## P-5

**Premise.** The image service is "a **named exception** to ADR-0017's 'no new deployable' default, justified
on **three grounds ADR-0017 itself uses as its flip conditions**: the workload is CPU/GPU-shaped and bursty
rather than request-shaped, it carries a vendor dependency the recipe service should not link, and it scales
on a different axis from recipe CRUD." (`0019:79-82`, repeated at `011:66-71`)

**Why it may be false.** Three separate defects: ADR-0017 does not contain those flip conditions; ADR-0017
explicitly does not govern 011, so no "exception" is available to take; and the vendor-dependency ground is
contradicted by the record the same commit superseded.

**Evidence.**

- `docs/architecture/decisions/0017-…md:136-141` — the complete flip-condition table: **009** a DPIA/GDPR
  Article 9 isolation requirement; **007** inbound retailer surface (webhooks, per-user OAuth tokens);
  **006** write volume or scaling profile competing with recipe search; **010** marketplace payments. "CPU-
  shaped and bursty" and "vendor dependency" appear nowhere. Only "scaling profile" is a partial match, and
  it is 006's, about write volume, not about an image axis.
- `0017:217-221` — "**This ADR does not revisit 005, 011, 012 or 013**, each of which already names one or
  more new services in its own spec (`ai-service`, **`digitization-service`**, `circles-service`…). The same
  question this ADR answers … is worth asking of each of them before any is built. **It is not answered here,
  and no conclusion should be inferred from this ADR either way.**" 011 was never under the default; the
  "named exception" framing borrows ADR-0017's authority for a decision ADR-0017 refused to make.
- The vendor ground: `specs/004-recipe-importing/spec.md:581-585` (the struck-through D-001) records that
  Textract's "credentials are **IAM rather than a new vendor secret**, and `sharp` **is already a service
  dependency**", behind an `OcrProvider` port. That is the corpus's only evidence on the question and it
  points the other way.
- ADR-0017 demands a **cost** answer, not a taxonomy answer (`0017:37-46`: ≈$8.25/mo per open PR, ALB
  priority, logical DB, Dockerfile, deploy job, smoke test, schema + client package, `CONTRACT_HASH`
  assertion, against a $300/mo budget). `0019:157-159` lists the costs but never weighs them.

**Verdict.** UNSUPPORTED as reasoning; the _conclusion_ may still be right. This is retrofitted
justification: it cites a document that says it cannot be cited, against criteria that document does not
contain, using a ground the superseded decision already refuted.

**What the doc should say instead.** "ADR-0017 explicitly left 011 undecided. The owner has ruled that the
image branch is its own deployable. Here is the cost on ADR-0017's own terms (per stage, per open PR), and
here is why it is accepted: [the owner's actual reason]." If the actual reason is "I want the OCR workload
isolated", record that — it is a legitimate owner call and does not need borrowed criteria.

---

## P-6

**Premise.** "**One** additional deployable (011's image service)" (`0019:157`).

**Why it may be false.** The same ADR concedes a second one two sections earlier, 011 names three packages,
and the sibling amendment adds a fourth on the same day.

**Evidence.**

- `0019:88-90` — "011 **also** specifies Family Circles… That half is **a separate deployable** with its own
  tables."
- `specs/011-recipe-digitization/spec.md:28` — "**Three new packages**: `@kitchensink/digitization-workers`
  (Lambda), `@kitchensink/digitization-service` (NestJS), `@kitchensink/circles-service` (NestJS), plus
  shared `@kitchensink/audience`."
- `0017` Amendment (`:226-234`) — `@kitchensink/meal-plan-service`, a new deployable, same session.

**Verdict.** UNSUPPORTED as stated. The session's true delta is 2–4 deployables, and the accepted-costs
section understates it by at least half while both documents invoke a cost-minimising default.

**What the doc should say instead.** Count them: image service, circles service (011's own spec), meal-plan
service (0017 amendment), and say whether `digitization-workers` is a Lambda package or a fifth thing. Then
state the aggregate per-open-PR cost against the $300 budget. A cost-driven default deserves an accurate
arithmetic.

---

## P-7

**Premise.** The ADR-0017 amendment's two "engineering facts" _support_ extracting 006, and the amendment "is
**not** a precedent that each feature gets a service" (`0017:236-262`).

**Why it may be false.** The amendment opens by admitting its own trigger did not fire (`:236-240` — "it has
**not** been measured, because 006 is not implemented"), which is commendably honest and correctly noted in
the brief. The problem is what follows. Fact 1 (`:243-248`) cites ADR-0019 — a document written by the same
agent, in the same session, hours earlier — as external evidence that the recipe service grew. Fact 2
(`:249-253`, "extraction is cheapest before implementation") is a fully general argument: it applies with
_identical_ force to 007 and 009, which are equally unimplemented and equally unmigrated. The amendment then
denies the generalisation (`:257-262`) without saying what distinguishes 006 from 007/009 under its own
argument.

**Evidence.** `0017:236-240`, `:243-248`, `:249-253`, `:257-262`; and `0017:88-95`, which recorded that
co-locating 006 **deletes** work (`ON DELETE CASCADE` retires 006's orphan handler and `is_orphaned` column,
TASK-018) — a concrete cost the amendment does not revisit or price.

**Verdict.** WEAK. The decision is the owner's to make and the honesty about the unmet trigger is real. But
"two engineering facts support it" overstates: one is self-citation, the other proves too much, and neither
addresses the orphan-handler cost the original ADR quantified.

**What the doc should say instead.** Drop fact 2 or apply it consistently (and then say why 007/009 stay).
Replace fact 1's self-citation with the actual scope delta. Add the cost the original ADR identified: 006 in
its own service reinstates `is_orphaned` + the orphan handler, or accepts a dangling `recipe_id`.

---

## P-8

**Premise.** The five-stage vocabulary `queued | processing | succeeded | failed | errored` (`0019:97-103`)
is "**one contract**, authored once and generated into the schema package" (`0019:167-170`).

**Why it may be false.** It is the fourth vocabulary for this lifecycle, it was not reconciled with the three
that exist, and it cannot express two outcomes the same documents require.

**Evidence.**

- Shipped: `PENDING | UNRESOLVED | RESOLVED | NOT_FOUND | FAILED`
  (`packages/services/recipe-service/src/database/schema/ingredients.ts:35-41`, mirroring the food client's
  `FoodStatus`) — and `004-FR-049`/`FR-050` (`spec.md:225-240`) apply the new vocabulary to precisely these
  entities.
- `specs/011-recipe-digitization/spec.md:267` FR-029 — `pending | processing | **awaiting-correction** |
saved | discarded`. `awaiting-correction` is neither "in flight" nor terminal; the ADR's five stages cannot
  represent a photo import parked for human correction, which is 011's core state.
- `specs/004-recipe-importing/product-spec/wireframes/import-progress.md:24` — `queued · running ·
succeeded · **duplicate-found** · failed`, and `004-FR-027` (`spec.md:303-305`) _requires_ a per-recipe
  outcome of "**already existed**", routed to `import-conflict`. The ADR's `succeeded|failed|errored`
  triple collapses it into `succeeded` or a false `failed`.
- The `failed` vs `errored` split ("expected failure" vs "unexpected fault", `0019:102-103`) has no
  antecedent anywhere in the corpus and no consumer behaviour attached to the distinction.

**Verdict.** UNSUPPORTED as "one contract". A vocabulary that omits a required outcome and a required state,
while three incompatible vocabularies remain in force, is a fifth drift source, not a unification.

**What the doc should say instead.** Either adopt the shipped `FoodStatus` lifecycle and extend it, or state
the mapping table explicitly (new stage → `FoodStatus` → 011 `job_status` → the progress screen's states) and
mark the three existing vocabularies as superseded in their own documents. `duplicate` and
`awaiting-correction` need homes. And justify `failed`/`errored` with a consumer that behaves differently, or
drop one.

---

## P-9

**Premise.** Supersession must be decided by a producer-assigned monotonic sequence because "an at-least-once
bus delivers out of order, and last-write-wins on arrival order silently reverts `succeeded` to `processing`
on a redelivery" (`0019:105-110`; `014-FR-045`, `specs/014-notification-service/spec.md:637-651`).

**Why it may be false.** Three problems: the stated premise contradicts 014's own ordering guarantee; part of
the failure is already suppressed by 014's existing idempotency claim; and the mechanism as specified still
admits the failure it was invented to prevent.

**Evidence.**

- `014-FR-045` asserts "Both ingress paths are at-least-once and **neither guarantees order**"
  (`spec.md:642-644`). But `014-FR-008` (`:355`) — "The system **MUST guarantee per-recipient FIFO ordering**
  for `recipient.kind ∈ {user, group}`" — and `FR-029` (`:421-427`) — SQS FIFO on
  `MessageGroupId = recipient.id`, with EventBridge envelopes ordered by `occurredAt` **before** enqueue.
  Either FR-045's premise is wrong or FR-008 is being silently narrowed; FR-029 itself says that narrowing
  "MUST be [stated] explicitly rather than left to imply a guarantee the transport does not provide".
- Redelivery specifically is already handled: `FR-030` (`:428-432`) requires `idempotencyKey` derived from
  durable domain state, and `FR-038` (`:517-526`) keeps the `(producer, idempotencyKey)` claim alive
  **across an acknowledgement** precisely to "suppress a transport redelivery that arrives after a fast ack".
- The residual hole: FR-045 scopes supersession to **pending** messages (`:657-659`) — "a later `sequence`
  for the same key produces a **new** pending notification". Symmetrically, a _stale lower_ sequence arriving
  after the winner was acked finds no watermark and becomes a new pending notification. That is the exact
  regression — a finished import shown as still running — with an extra step.
- Name collision: `PendingNotification.sequence` already exists and is "monotonic per **delivering user**"
  (`:678-680`), and `FR-039` (`:527-532`) redelivers "in `sequence` order". `supersedes.sequence` is a
  different counter with the same name in the same envelope.

**Verdict.** WEAK. The concern is real and the sequence-over-arrival-order instinct is right, but the
mechanism is under-specified and its rationale misstates the service it is being added to.

**What the doc should say instead.** State the watermark's lifetime explicitly (it must outlive the pending
entry — at minimum for the `(producer, idempotencyKey)` claim window, ideally for the 72h retention).
Reconcile with FR-008 rather than contradicting it. Rename one of the two `sequence` fields.

---

## P-10

**Premise.** "The parsing differs; **everything after parsing is identical**" (`0019:29-30`), made normative
as "a channel's distinct responsibility is **limited to** producing candidate recipe records… plus the
`sourceType`" (`004-FR-047`, `spec.md:211-216`).

**Why it may be false.** At least five post-parse behaviours are channel-conditional today, and the ADR's own
transfer clause assigns a channel a sixth non-extraction responsibility.

**Evidence** (`specs/004-recipe-importing/spec.md`).

- `:312-317` FR-022 — a **tighter sub-quota for OCR imports specifically**, evaluated in the domain layer.
- `:285-289` FR-028 — the premium gate applies only to `imported_physical` and `imported_paid`.
- `:750-754` C-001 — dedup by canonicalized source URL, "applies to both website and Instagram imports"; it
  has no meaning for a photo or a file.
- `:258` — "Structured-file imports follow the ordinary `user_created` visibility rules"; `:249` FR-011 maps
  visibility per `sourceType`.
- `:154-160` transfer clause — 011 MUST enforce the premium gate, i.e. a channel owning a post-parse policy,
  which `FR-047` forbids in the same document.

**Verdict.** WEAK. The design (one path, `sourceType`-keyed policy) is sound; the premise as written
("identical", "limited to") is false and is what makes `FR-047` unsatisfiable alongside the transfer clause.

**What the doc should say instead.** "Everything after extraction runs in one processor. Where behaviour
differs by channel — quota, entitlement, dedup key, visibility — it is expressed as a policy keyed on
`sourceType` inside that processor, never as a second pipeline."

---

## P-11

**Premise.** "004's photo-specific _rules_ transfer with the channel and are **binding on 011**"
(`004:154-160`), and 011 "inherits rather than re-derives" them (`011:83-89`).

**Why it may be false.** 011's own text — unamended in the same commit — refuses or contradicts every one of
the four transferred provisions. The rules now belong to nobody.

**Evidence.**

| Transferred provision                                      | 004's rule                                                                                          | 011's standing text                                                                                                                                                               |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Premium gate on `imported_physical` (`004:285-289`, D-014) | MUST require active premium; channel absent from the advertised list otherwise                      | `011:52` prerequisite row: "**011 ships ungated if 010 is not yet live**"; `011:118` **Non-Goals**: "Subscription gating of digitization features — owned by 010"                 |
| OCR sub-quota (`004:312-317`)                              | tighter per-user daily OCR allowance, distinct error with `resetsAt`                                | 011 has **no quota requirement at all** (FR-001…FR-036)                                                                                                                           |
| Delete OCR artifacts on expiry (`004:318-321`)             | delete on confirm/discard/expiry, ≤7d, "**there is no state in which an image outlives the draft**" | `011:213` FR-018 "Original photo **retained in S3 after save / discard for archive**"; `:224` FR-022 "S3 object **retained 30 d**"; `:284` FR-036 raw OCR JSON purged at **90 d** |
| Vendor output is an untrusted boundary                     | parse with zod at the boundary                                                                      | 011 is silent; 004's own `tasks.md:564-571` holds the only worked statement of it, in a task that is now allegedly out of scope                                                   |

**Verdict.** UNSUPPORTED. A transfer clause that asserts inheritance without amending the receiving document
produces three direct contradictions on retention alone (7d vs indefinite vs 30d vs 90d) and silently drops
a premium gate that the receiving spec lists as a non-goal.

**What the doc should say instead.** Amend 011: add the quota FR, state which retention wins and withdraw the
losers by ID, and either accept the premium gate as an 011 requirement (contradicting `011:118`) or record
that the gate is **suspended** until 010 ships and say who bears the Textract spend meanwhile — which was
D-014's original purpose (`004:584-585`).

---

## P-12

**Premise.** "011 does **not** create its own path to a saved recipe" (`011:52`); everything after extraction
is 004's shared path and "011 MUST NOT build a second one" (`011:77-79`).

**Why it may be false.** 011's unamended FRs specify exactly that path, and its correction UX operates on the
draft — the part the ADR declares shared.

**Evidence.**

- `011:221` FR-021 — "`POST /…/save` **creates a `Recipe`** (owned by 001) and links via `recipe_id`";
  `:222` FR-021a and `:223` FR-021b add visibility and attribution rules to that creation path.
- `011:210` FR-015 — corrections via `PATCH …/jobs/:id/correction`, i.e. a mutable pre-creation record with
  per-token confidence (`:202` FR-012) and the original image alongside (`:209` FR-014).
- `004:146` — 004's drafts "are owner-scoped, expire (`FR-018`), and hold no recipe row until confirmed".

There are now **two** pre-creation records (004's import draft, 011's `DigitizationJob`) with different
lifetimes, different correction affordances and different retention clocks, and no document says which one
the user is looking at during a photo import. Either 004's shared draft grows OCR-specific fields (so it is
not channel-agnostic, contradicting P-10's premise) or 011 keeps its job store (contradicting P-4).

**Verdict.** UNSUPPORTED, and it is the load-bearing ambiguity of the whole ruling. It was resolved silently,
in the direction that was easiest to write.

**What the doc should say instead.** Name the handoff point precisely: does 011 submit **after** the user has
corrected (so 004 receives clean candidates and 011 owns the whole draft/correction lifecycle), or **before**
(so 004's draft carries confidence data)? Then say which FRs of 011 are withdrawn under the choice.

---

## P-13

**Premise.** The consequences of the ruling were traced. `004`'s amended scenario 4 asserts that asserting
OCR in 004 "would make 004's suite fail on a channel 004 no longer builds" (`004:90-92`), implying the suite
was consulted.

**Why it may be false.** Only `spec.md` was amended. Every downstream 004 artefact still specifies OCR as
in-scope-at-launch, and the new FRs arrive with no tasks, on a feature already 9/31 implemented.

**Evidence.**

- `specs/004-recipe-importing/tasks.md:551` — "**T-018 · OCR channel** _(D-001 — P1, **ships at launch**;
  premium-only per D-014)_", with `:69` `T-013 ──► T-018`, `:660` "Mobile camera capture wired to the OCR
  channel (T-018) — **shipping in this task**", `:820` the task table row, `:390` the expiry-sweep
  obligation, `:540-545` the premium-before-Textract integration test. 20 OCR/Textract references remain.
- Unamended too: `v-model/acceptance-plan.md` (16), `v-model/requirements.md` (12), `v-model/system-test.md`
  (5), `plan.md` (14), `product-spec/product-spec.md` (2), `product-spec/wireframes/import-photo.md`
  (a whole screen).
- `specs/004-recipe-importing/.forge-status.yml` — 004 is **in-progress**, 9 of 31 T-IDs complete. `FR-046`…
  `FR-051` add a chooser, a bulk processor contract, two message-emission obligations, a placeholder model
  and an idempotency rule, with **no task added** and no total change.
- Dependencies not recorded: `004:23-31`'s table lists 001/002/003/010 — no **011** (which `FR-046` now
  depends on for its "unavailable-until-011" state) and no **014** (which `FR-048`/`FR-049` depend on for
  delivery). 014's own dependency table (`014:8-16`) still does not list 004 or 011 as consumers.
- 014 is **Status: Draft** (`014:5`) and unimplemented, and `014-FR-041`/`FR-044` (`:553-566`, `:614-633`)
  require every producer to hold a registry entry with declared quota **magnitudes**. Two new producers are
  created with neither, and a 1,000-recipe import (`004:299`) emits thousands of publishes per user through a
  token bucket sized for notifications.

**Verdict.** UNSUPPORTED. The spec was amended in isolation and the consequences were asserted as settled.
The scenario-4 rationale is the tell: it invokes a test suite whose OCR assertions were left untouched.

**What the doc should say instead.** Either land the downstream edits (tasks, plan, v-model, wireframes,
dependency tables, a 014 registry entry with magnitudes) or state plainly at the top of the amendment: "004's
tasks.md, plan.md and v-model still specify T-018 and have **not** been reconciled; they are stale as of
2026-08-14 and reconciling them is tracked as [X]."

---

## P-14

**Premise (the strongest challenge).** ADR-0019 solves a real problem.

**Assessment.** Partly — and the part that is real needed roughly a paragraph.

**What is real.** The two-owners contradiction is genuine and citable: `git show 4a979422^:specs/011-…:51`
carried "Sibling boundary: 004 = structured/web-URL imports; 011 = unstructured photo imports" while
`004` D-001 (`spec.md:581-585`, struck) committed 004 to shipping photo/OCR at launch on Textract. Two
accepted specs owned one channel. A ruling was required, and "011 owns photo" is a reasonable one.

**What is manufactured around it.** Of the four problems in the Context section (`0019:22-39`): #1 is real;
#3 is false (P-1); #4 is false and its solution is shipped (P-2); #2 ("everything after parsing is
identical") is an overstatement that becomes an unsatisfiable MUST (P-10). So one real problem carries a
five-part normative spine, six new FRs across three specs, a new envelope field in a service that does not
exist yet, a new status vocabulary that cannot express two required outcomes, and two-to-four new
deployables — with the deployable exception justified by criteria fabricated for the purpose (P-5).

The tell is the direction of every silent resolution. Each ambiguity was closed the way that made the ADR
easier to write and larger in scope: 011 is stateless (so the ADR need not reconcile two draft models,
P-4/P-12); status is uniform (so the ADR need not map four vocabularies, P-8); the post-parse tail is
identical (so "one processor" is clean, P-10); the transfer clause is one paragraph (so 011 need not be
amended, P-11). None of these was the owner's to decide by omission.

**Verdict.** The _ruling_ is SUPPORTED. The _spine_ is WEAK: it is a boundary dispute answered with an
architecture, most of whose stated motivation does not survive contact with the corpus or the code.

**What the doc should say instead.** Split it. (1) A short ADR recording the ownership ruling, its two
consequences (D-001 superseded; 011 blocks on 004's processor), and the transfer table with 011 amended to
match. (2) A separate, later ADR for the status/progress model — one that starts from the three vocabularies
that exist and the placeholder model already shipped, and that waits until 014 is more than a draft.

---

## P-15

**Premise.** Every one of these documents attributes itself to an "owner ruling (2026-08-14)"
(`0019:5`, `0017:228`, `004:154`, `011:57`, `014:637`).

**Why it may be false.** Nothing records what the owner actually said. The repository's own practice is the
opposite: `specs/014-notification-service/spec.md:30-51` records a clarifications session with **verbatim**
owner quotes ("Keep the notification until the client indicates that it has been consumed or three days have
passed", "Dedup messages based on payload…", "use redis"), each followed by the FRs that make it normative.
No such session exists for 2026-08-14 in any of the five documents.

**Verdict.** WEAK as a defect in isolation, but it is what makes P-3, P-4, P-8 and P-11 unfalsifiable: there
is no artefact against which "the owner decided this" can be checked, so a phrase like "it shouldn't need its
own database" and a normative "the image-processing service owns NO database" are indistinguishable in the
record.

**What the doc should say instead.** Add a `### Session 2026-08-14` clarifications block to 004 (and cite it
from the others) with the ruling's verbatim content and an explicit list of what was **not** decided — at
minimum: the stage vocabulary, the supersession mechanism, whether 011 may hold job state, and whether the
premium gate survives the transfer.

---

## Premises that held

- **Two accepted specs each owned photo import.** Documented on both sides (`4a979422^:011:51` vs `004`
  D-001). This is the ruling's real justification and it is enough on its own.
- **A bulk file may carry up to 1,000 recipes.** `004:299-302` (FR-026) says exactly that; the scale claim in
  `0019:32-33` is accurate.
- **A shell entry is not a recipe written into the food database; the food DB keeps one writer.**
  (`0019:129-134`.) Defeated the challenge on shipped evidence: the food service already mints pending rows
  through its own add-by-name path (`packages/schemas/food/src/schemas/foods.schema.ts:128-141`,
  `:240-258`), and the recipe side holds only an opaque non-FK reference
  (`packages/services/recipe-service/src/database/schema/ingredients.ts:5-7, 55-57`). CLAUDE.md's
  method-not-a-substance prohibition is genuinely untouched. Correct, and correctly flagged.
- **A message is a notification of a committed state change, never the state itself** (`0019:124-127`).
  Independently reinforced by `014-FR-040`'s accepted residual risk — the pending store is ElastiCache with
  durability off by default and can silently drop accepted notifications
  (`specs/014-notification-service/spec.md:533-545`). The durable projection is not optional; the ADR is
  right that §5 is what makes §4 safe.
- **`sourceType` as an exhaustive union with the Visitor intent already satisfied by TS** (`0019:57-60`).
  Matches the shipped enum (`packages/services/recipe-service/src/database/schema/recipes.ts`,
  `packages/shared/recipe-core/src/recipe.types.ts`) and correctly declines to add dispatch machinery.
- **`supersedes` is not `idempotencyKey`** (`014-FR-045`, `spec.md:648-654`). The distinction — "have I seen
  THIS message" versus "is this still the current truth for this ENTITY" — is exactly right and survives
  every reading of FR-018/FR-037/FR-038.
- **Do not collapse the image service and Circles** (`0019:88-90`, `011:96-99`). Necessary, and the only
  place in the ruling where an ambiguity was closed _against_ the writer's convenience.
- **The ADR-0017 amendment's admission that its flip condition did not fire** (`0017:236-240`). Genuinely
  honest and it defeats the "dressed up as evidence" charge for that sentence specifically — the charge
  survives only against the two "engineering facts" that follow (P-7).
