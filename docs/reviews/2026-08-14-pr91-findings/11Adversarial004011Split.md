# 11 — Adversarial review: ADR-0019's 004/011 split

**Target**: `docs/architecture/decisions/0019-recipe-import-spine.md` (accepted 2026-08-14, commit `4a979422`)
plus the amendments it drove in `specs/004-recipe-importing/spec.md` (`FR-046`..`FR-051`, `FR-012` reassigned,
`D-001` superseded) and `specs/011-recipe-digitization/spec.md` ("Ownership of the photo channel").

**Posture**: refutation. Each attack below tries to break a load-bearing claim. Verdicts are `REFUTED`
(the claim is false as written), `WEAKENED` (true only under a narrowing the ADR does not state), or
`SURVIVES` (I could not break it, and the evidence that defeated the attack is named).

**Method**: every citation was opened and read. The ADR's own summary of itself was not used as evidence
about the specs, the plans, the task files, or the tree.

---

## A-1 — Is the post-extraction tail actually identical?

**Claim attacked.** ADR-0019 Context §2 (`0019:29-31`): _"The parsing differs; **everything after parsing is
identical** — validate, resolve ingredients to food entities, create recipes, report per-recipe outcome."_
Encoded as `004-FR-047` (`004/spec.md:211-216`): a channel's distinct responsibility is _"limited to producing
candidate recipe records from its source plus the `sourceType`"_.

**Attack.** Read 011's post-extraction path in full and find places where it diverges materially from
URL/file. If it does, the "one processor" is a wrong abstraction that will grow per-channel flags.

**Evidence.**

1. **Artifact retention is not merely different — it is opposite, and the amendment binds 011 to the wrong
   half.** `004/spec.md:318-321` (FR-018, D-005 at `004/spec.md:720-724`): the system _"MUST delete any OCR
   source image on confirm, discard, or expiry — whichever occurs first. The draft and its image share one
   lifetime: there is no state in which an image outlives the draft."_ `011/spec.md:213` (FR-018): _"Original
   photo retained in S3 **after save / discard** for archive."_ `011/spec.md:219` (FR-019) serves that photo
   from CloudFront on the **recipe detail** screen; `011/spec.md:224` (FR-022) retains a discarded job's object
   30 days; `011/spec.md:561` (TC-E2E-001) exits on _"original photo retrievable from CloudFront"_ **after** the
   recipe exists, and `011/spec.md:563` (TC-E2E-003) asserts _"saved photos retained, discarded photo retained
   for 30 d."_ The amendment at `011/spec.md:86-87` binds 011 to inherit 004's rule — _"deletion of OCR
   artifacts on draft expiry (`004-FR-018`)"_. Applied as written, 011's FR-018, FR-019, TC-E2E-001 and
   TC-E2E-003 become unsatisfiable **by construction**. The photo is the archive in 011 and a transient
   liability in 004; that is the whole difference between "import a recipe" and "digitise a heirloom".
2. **Confidence granularity is a different data shape, not a different value.** 004's staging row carries
   `field_confidence jsonb` — _"Per-field extraction confidence"_ (`004/plan.md:124`), and `004/spec.md:275-277`
   (FR-015) says "per-field". 011 needs **per token**, with enough structure to highlight tokens **over the
   original image** in a side-by-side view: `011/spec.md:199` (FR-009 per-token score), `:202` (FR-012 exposes
   it in `parsed_json`), `:211-212` (FR-011/FR-017 individually confirmable low-confidence tokens), `:258`
   (FR-025 icon+colour). A per-token, image-anchored confidence map is not a value `field_confidence` can hold.
   So the shared draft either grows a photo-only column (a flag on the shared abstraction) or 011 keeps its own
   store (see A-2).
3. **Quota accounting is already two rules inside 004 alone.** `004/spec.md:678-682` (D-013): a bulk file of up
   to 1,000 recipes _"counts as **one** import against the D-006 daily allowance"_ because it does no outbound
   fetch and no OCR. A 20-photo batch (`011/spec.md:188`, FR-003) is 20 paid OCR calls against a 50/day
   sub-quota and a 5/min burst limit (`004/spec.md:712-719`, D-006). "Quota enforcement written once"
   (`0019:56-57`) is therefore false at the point it matters: the bulk path's accounting rule is exactly
   inverted for the photo channel.
4. **A channel is not "an adapter plus a `sourceType` member".** `004/plan.md:117` gives `import_drafts` an
   `import_channel text NOT NULL` column _"CHECK-constrained to the channel set"_, separate from `source_type`
   (`:118`). Adding a channel is a migration against another feature's table, plus a chooser entry, plus quota
   and burst rules, plus a status emitter. `0019:57-58`'s "compile error at every `switch`" is real for the TS
   union and irrelevant to the `CHECK` constraint.
5. **There is an extra state between extraction and creation on the photo channel only.** 004's model is
   extract → draft → confirm (`004/spec.md:126-146`, C-006 at `:757`). 011's is extract → **correct** → save
   (`011/spec.md:210`, FR-015 `PATCH .../jobs/:id/correction`; `:221`, FR-021 `POST .../save` creates the
   Recipe). If the handoff to the shared processor happens at OCR completion, the user corrects in 011's UI and
   then confirms again in 004's draft UI — two reviews for one photo. If it happens after correction, the
   candidate is not "produced by extraction"; it is produced days later by a human.

**Verdict: WEAKENED.** The claim is true of the **last leg** and false of the leg the ADR actually draws.
Validate against `CreateRecipeRequest`, dedup, resolve ingredients to food entities, create recipes, report a
per-recipe outcome — that genuinely is identical across channels and genuinely is worth writing once. Staging
shape, review UX, artifact lifetime, quota accounting and job/batch state are not. The ADR put the seam at
"after parsing"; the evidence puts it at "after the candidate is complete and confirmed". I could not refute
the shared-tail idea itself — 004's own draft-and-confirm model (`004/spec.md:130`) already names that seam,
and it is the correct one.

**What must change.** Restate `FR-047` so the shared unit is the **confirm-and-create path** — "a completed
candidate recipe plus its provenance" — not "everything after parsing". Then 011 keeps its correction layer
and its artifacts, and still cannot fork recipe creation. Delete the inheritance of `004-FR-018` from
`011/spec.md:86-87` and state the photo channel's retention explicitly, because the two specs currently give
opposite MUSTs for the same event.

---

## A-2 — Is a stateless image-processing service coherent?

**Claim attacked.** `0019:84-86`: _"**It holds no persistent state.** Images in flight live in object storage;
the durable record of the import is the recipe service's."_ Repeated at `011/spec.md:65-74`.

**Attack.** 011 specifies durable, queryable, PII-bearing, differentially-retained state. Find where it lives.

**Evidence.**

1. **Two retention classes over one artifact, with different clocks.** `011/spec.md:42` (C-005): _"Purge
   `raw_ocr_json` after 90 days; **retain `parsed_json` for the lifetime of the job**."_ `011/spec.md:284`
   (FR-036) makes it a daily sweep with a purged-count metric; `:299` (NFR-008) and `:312` measure it as a sweep
   of `digitization_jobs` **where** `created_at < now() - 90d` **and** `raw_ocr_json IS NOT NULL`. That is a
   predicate over a queryable store with two columns on two clocks. An S3 lifecycle rule cannot express it
   without splitting the artifact into two objects and re-implementing the query.
2. **The poll, the list and the batch all require job state.** `011/spec.md:203` (FR-013): async OCR, _"client
   polls `GET /api/v1/recipes/digitize/jobs/:id`"_. `:266` (FR-028): `GET .../jobs` with **cursor pagination**,
   page size 20. `:267` (FR-029): a `job_status` of `pending|processing|awaiting-correction|saved|discarded` on
   every response. `:190` (FR-005) and `:160` (US-007): multi-page submissions linked by `batch_id` with a queue
   that surfaces a remaining count. Cursor pagination over a status enum is a database query.
3. **The correction UI is a resumable, human-latency state.** `011/spec.md:159-160` (US-007) has the user work
   through corrections one at a time; 004's draft lifetime is **7 days** (`004/spec.md:318-321`). Whatever holds
   `parsed_json` between OCR completion and the user's return holds it for days.
4. **011's own plan and task file give that state a database — in the service the ADR forbids one to.**
   `011/plan.md:12`: four new packages _"adds Drizzle schema for circles and digitization jobs … RDS-backed
   APIs"_. `011/plan.md:94`: _"**Storage**: RDS PostgreSQL 16"_. `011/plan.md:163-172`: the `digitization_jobs`
   table with `raw_ocr_json`, `parsed_json`, `state`, `batch_id`, `recipe_id`. `011/plan.md:191`: _"011 stores
   its OCR-specific state in its **own** `digitization_jobs` table"_. `011/plan.md:197`, `:202-203`: the purge
   process and two indexes. `011/tasks.md:70` (T-011) creates the migration at
   `packages/services/digitization-service/src/db/migrations/011_004_create_digitization_jobs.sql`;
   `011/tasks.md:114` (T-037) builds the state machine over it. None of this was amended — commit `4a979422`
   touched only `011/spec.md` (+56 lines) and `004/spec.md` (+107).
5. **The ADR's own rejected alternative is what the unamended plan builds.** `0019:146-147`: _"**Give the image
   service a database.** Rejected: it would create a second durable record of an import."_ 004 already has
   `import_drafts` **with `ocr_object_key`** — _"S3 key of the source image; deleted no later than expiry"_
   (`004/plan.md:127`) — and `import_jobs`, _"async job state for the **fetch/OCR channels**"_
   (`004/plan.md:130-131`). So the tree's current design has **two** staging stores for one photo import, in two
   databases, which is precisely the outcome the ADR rejects.
6. **Relocating the state does not rescue the rule; it moves the problem into the service the ADR was
   protecting.** If `digitization_jobs` moves to the recipe database, then OCR PII (`raw_ocr_json`), per-token
   confidence, the 90-day purge job and the vendor's output shape all land in `@kitchensink/recipe-service` —
   the coupling `0019:143-145` rejected under _"Put image processing inside the recipe service"_. The ADR split
   the **compute** out and left the **data** unassigned.

**Verdict: REFUTED as written.** "Owns no database" is not a property this feature can have; the state is
mandatory (C-005, FR-013, FR-028, FR-029, FR-005) and the ADR assigns it to no one. The claim is salvageable
only by relocation, and the ADR names neither the destination nor the consequence.

**What must change.** Name the owner of `digitization_jobs` explicitly, and record the consequence of that
choice (vendor PII in the recipe DB, or a database on the image path). See A-5/A-6 for the option the ADR did
not consider, which makes the question easy.

---

## A-3 — Does the handoff actually work?

**Claim attacked.** `0019:81-83` / `011/spec.md:75-79`: the image service _"submits the resulting candidates to
**004's bulk import processor** (`004-FR-047`) with `sourceType = imported_physical`"_.

**Attack.** What identity does an asynchronous, user-absent worker present to the recipe service, and what stops
that same call from being forged?

**Evidence.**

1. **The repo's default cross-service pattern cannot carry it.** `packages/services/recipe-service/src/config/config.types.ts:403`:
   _"**There is deliberately NO `FOOD_SERVICE_TOKEN`.** Food's `FoodAuthGuard` verifies a *Clerk* token, and a
   long-lived static env string cannot satisfy that verifier (session tokens live ~60s) … Recipe now forwards
   the CALLER's own verified token instead."_ Regression-locked at
   `packages/services/recipe-service/infra/__tests__/recipe-service-stack.test.ts:254` and
   `src/config/__tests__/load-config.test.ts:101`. 011's path is pre-signed upload → SQS → Lambda OCR
   (`011/spec.md:203`, `011/plan.md:150-154`), then a correction the user returns to later. A ~60-second Clerk
   session token is gone long before the submission.
2. **A machine path does exist, and the ADR does not use it.** `packages/shared/recipe-core/src/serviceErasureToken.ts:1-70`
   defines an internal **asymmetric** service-principal JWT — pinned issuer, per-target audience (`:41`, `:49`),
   `EdDSA` only (`:65`), a capped lifetime, and claims that _"bind the capability to a single event"_ (one
   `ownerId`, one `eventId`). It is exercised end to end at
   `packages/services/recipe-service/__tests__/integration/account/service-erasure.integration.test.ts:275-279`.
   So my "unimplementable" thesis fails: the pattern is proven and generalisable.
3. **But the capability being minted is far stronger than erasure's, and the ADR mints it blind.** An import
   token says "create recipes as user X **with `sourceType = imported_physical`**". That is the exact
   classification `004-FR-025` forbids a caller to declare: `004/spec.md:294-298` — _"A caller MUST NOT be able
   to declare … `imported_physical` (which would grant a free-tier caller a private recipe that C-004 reserves
   for premium). Those classifications are set **only** by the server from the channel it observed."_ The whole
   point of the split is that the server no longer observes the channel.
4. **The premium gate loses its enforcement point.** `004/spec.md:285-289` (FR-028) and D-014
   (`004/spec.md:670-677`) make `imported_physical` premium-only; ADR-0017 decision 3
   (`0017:70-75`) puts the entitlement in the **Clerk session token's** `public_metadata`, read by a shared
   guard. An async worker holding no user token cannot read that claim, and the bulk processor is being asked to
   trust the submitter's word for both the provenance **and** the entitlement. Meanwhile `011/spec.md:53` still
   says 011 _"ships ungated if 010 is not yet live"_ — unamended, and now contradicting the inherited gate at
   `011/spec.md:84-86`.

**Verdict: WEAKENED, not refuted — and the residue is a security-relevant hole.** The handoff is
implementable (the erasure-token pattern is the template), but as written it is unspecified in the one
dimension that decides whether `FR-025`'s whitelist and D-014's premium gate still hold. A reader following the
service's documented default — forward the caller's token — builds something that cannot work; a reader
following the ADR literally builds an endpoint that accepts a client-declared `imported_physical`.

**What must change.** State the principal. If it is a service token, say so, name the audience, say who mints
it, and say how the **entitlement decision** is carried (it must be decided while the user's token is live, at
enqueue, and bound into the token — not re-derived at submission). If it is the user's token, say how it
survives an async pipeline, because today it does not.

---

## A-4 — Is the sequencing right?

**Claim attacked.** `0019:74-75`: _"011 lands after 004 and adds the image branch."_ `011/spec.md:52` upgrades
004 from **complements** to **blocks**.

**Attack.** Does making 011 depend on 004 create a worse critical path than leaving photo in 004?

**Evidence.**

1. **At milestone granularity the change is small.** `specs/v1-launch-plan.md:37` puts 004 in `M1` and `:44`
   puts 011 in `M2`; `:336` records _"`011` Recipe Digitization assigned to `M2`, runs in parallel with `M3`"_;
   `:323` includes both in the Beta scope. 011 was already downstream of 004 in time. My "new critical path"
   attack fails on this evidence.
2. **What the change actually costs is a milestone of dead affordance and a re-planned feature.** Photo import
   was fully specified, provider-chosen and task-broken in 004: `004/tasks.md:551` — _"T-018 · OCR channel
   (D-001 — P1, **ships at launch**; premium-only per D-014)"_ — with `POST /import/photo` (`:558`), mobile
   camera capture (`:660`), a Maestro flow (`:666`) and a row in the task table (`:820`). 011's photo half now
   cannot start until 004's `FR-047` processor exists **and** accepts `imported_physical`, and 004 ships a
   visibly disabled photo entry for the whole of `M1` (`004/spec.md:204-210`).
3. **The dependency is declared but not registered.** `specs/governance-rules.md:154` (AC-003-b) requires
   `cross-feature-FR-index.md` to be updated _"whenever a cross-feature FR reference is added"_. 011 now cites
   `004-FR-047`, `004-FR-048` and `004-FR-050` (`011/spec.md:75`, `:91-93`); the index carries three `004-FR`
   rows and none of them (`specs/cross-feature-FR-index.md:31,34,40`).

**Verdict: SURVIVES (narrowly).** The evidence that defeated my attack is `v1-launch-plan.md:37,44,336` — the
ordering the ADR imposes matches the ordering the launch plan already had, so no new critical path is created.
The residual cost is real but is a consequence of the ownership choice (A-5), not of the sequencing decision.

**What must change.** Register the new cross-feature citations per AC-003-b, and mark 004's `FR-046` disabled
state as a scheduled removal tied to 011 rather than a permanent capability.

---

## A-5 — Steelman: "004 keeps photo import; 011 is cut to Circles + correction UX"

**Claim attacked.** `0019:140-142`, the one-line rejection: _"011's photo depth … is a product in its own right
and far exceeds 004's single `FR-012`. Cutting it discards the differentiator 011 exists for."_

**Attack.** Build the strongest version of the rejected alternative and see whether it beats the accepted
decision.

**The alternative, stated precisely.** 004 owns capture → OCR → **draft**, as one more channel into the
staging table it already has. 011 owns (a) the correction layer — side-by-side, per-token confidence,
accept-all, batch queue — rendered over 004's draft, (b) handwriting/provider depth as a capability of that
same channel, and (c) Family Circles. Nothing is cut from 011's product surface; what moves is **ownership of
the pipe**, not the depth.

**Evidence for it.**

1. **The ADR's rejection contradicts 011's own research.** `011/spec.md:26`: _"Cookmate has correction UX but no
   social layer; Google Lens has best-in-class handwriting OCR but no recipe normalisation. **The differentiator
   is correction UX over a normalised schema.**"_ By 011's own statement the differentiator is the correction
   layer over a normalised schema — which is what this alternative gives it — not ownership of the OCR call.
2. **004's staging row was already built for it.** `004/plan.md:127` already carries `ocr_object_key`;
   `004/plan.md:130-131` already scopes `import_jobs` to _"the fetch/**OCR** channels"_; `004/spec.md:144`
   records that the draft model exists partly to _"collapse what were previously two separate flows (OCR's
   review step and URL import's optional preview) into one"_. The alternative keeps one staging entity, one
   owner, one retention rule, one quota evaluator — and A-1's divergences reduce to one nullable
   token-confidence payload on a row that already has a channel discriminator.
3. **It needs no new deployable and no new trust boundary.** No ALB listener priority (ADR-0003), no per-PR ECS
   task (≈ $8.25/mo each, ADR-0010, quoted at `0017:44-48`), no schema package, no `CONTRACT_HASH` boot
   assertion, and — decisively — **no cross-service submission credential**, so A-3 disappears entirely and
   `FR-025`'s "set only by the server from the channel it observed" stays literally true.
4. **The bursty-CPU argument does not require a service.** See A-6.
5. **The migration cost is zero in one direction and large in the other.** 004's OCR work is already written:
   25 OCR/photo references in `tasks.md`, 18 in `plan.md`, 30 in `v-model/acceptance-plan.md`, 42 in
   `v-model/traceability-matrix.md` (counted 2026-08-14 via `rg -c`). The accepted decision invalidates all of
   it and has not paid for that yet (A-7). The alternative invalidates none of it.

**Evidence against it (honest counter).** Two things genuinely favour the accepted decision. First, 011's photo
surface really is larger than 004's `FR-012` sentence, and if 004 owns the channel then 004's `M1` scope grows
to include a channel whose acceptance bar (`SC-002` explicitly excludes OCR — `004/spec.md:738-740`) it cannot
measure. Second, one team owning "photo end to end" is the Conway-aligned cut; splitting capture from
correction across two features means every photo-channel change touches both. Neither is fatal — 004 can ship
the printed-card path and 011 can deepen it — but they are real.

**Verdict: the alternative BEATS the accepted decision on cost, on trust boundary, and on artifact coherence,
and loses on scope-of-`M1` and team locality.** The ADR's stated reason for rejecting it — that it discards
011's differentiator — is **REFUTED** by `011/spec.md:26`. A one-line rejection of the cheaper option, on a
premise the feature's own research contradicts, is not a decision that has been made; it is one that has been
skipped.

**What must change.** Either adopt the alternative, or re-reject it on the two grounds that actually survive
(M1 scope, team locality) and record the costs it avoids so the trade is visible.

---

## A-6 — The "named exception" to ADR-0017 mis-cites it, and the option space omits `recipe-workers`

**Claim attacked.** `0019:78-82`: the image service _"is a **named exception** to ADR-0017's 'no new
deployable' default, justified on **three grounds ADR-0017 itself uses as its flip conditions**: the workload
is CPU/GPU-shaped and bursty rather than request-shaped, it carries a vendor dependency the recipe service
should not link, and it scales on a different axis from recipe CRUD."_ Repeated at `011/spec.md:66-70`.

**Attack.** Read ADR-0017's flip conditions and its scope, then read the tree for the shape the ADR did not
consider.

**Evidence.**

1. **ADR-0017's flip conditions are not those three.** `0017:132-141` lists exactly four, one per feature: 009 →
   _"a DPIA … requires physical isolation of GDPR Article 9 health data"_; 007 → _"retailer integration grows
   **inbound** surface"_; 006 → _"a write volume or a scaling profile that competes with recipe search"_; 010 →
   _"marketplace payments"_. "CPU-shaped and bursty" and "carries a vendor dependency" appear nowhere. Only the
   006 row resembles the third ground, and `0017:236-239` says of it, in the amendment, that the trigger has
   **not** fired and the extraction is _"an **owner architectural decision**, not the firing of the recorded
   trigger … recorded as such rather than dressed up as evidence."_ ADR-0019 does the opposite: it dresses an
   owner decision as the firing of a criterion that does not exist.
2. **011 needed no exception, because ADR-0017 does not govern it.** `0017:217-221`: _"**This ADR does not
   revisit 005, 011, 012 or 013** … The same question this ADR answers … is worth asking of each of them before
   any is built. It is **not** answered here, and no conclusion should be inferred from this ADR either way."_
   Claiming an exception to a decision that explicitly declines to rule imports authority that was never
   granted, and it hides the fact that the "does this need its own deployable?" question ADR-0017 asked of 011
   **still has not been answered on its merits**.
3. **The option the ADR never considered already exists and already ships.** ADR-0017 decision 5
   (`0017:77-80`): _"The retailer adapters (007) and the compliance rollup (009) run in
   `@kitchensink/recipe-workers`, **not** in the API process … the existing worker package is where
   asynchronous work already lives."_ That package is real: `packages/services/recipe-workers/` with six
   handlers (`src/handlers/{account-erasure-worker,archive-sweeper,erasure-orphan-sweeper,erasure-sweeper,handle-sync-worker,version-archive-worker}.ts`),
   its own CDK stack provisioning **six separate `lambda.Function`s** with per-worker SQS + DLQ pairs
   (`infra/lib/recipe-workers-stack.ts:453,474,519,573,599,631`), and direct DB access (`drizzle-orm`, `pg`,
   `@aws-sdk/rds-signer` in `package.json:22-34`). 004's own spec already names it as the non-HTTP deployable in
   scope (`004/spec.md:381`). 011's plan already puts OCR in a Lambda (`011/plan.md:12`,
   `@kitchensink/digitization-workers`).
4. **A `recipe-workers` OCR handler satisfies every ground the ADR cites.** Bursty and CPU-shaped → Lambda,
   scaled per-invocation, isolated from the API process. Vendor dependency the recipe service should not link →
   its own esbuild bundle in its own function; the ECS API image never links Textract. Scales on a different
   axis than recipe CRUD → it already does; that is what the six existing functions are. And it costs **zero**
   ALB priorities, **zero** per-PR ECS tasks, **zero** schema packages, **zero** `CONTRACT_HASH` assertions and
   **zero** cross-service credentials — while giving `digitization_jobs` an obvious home with a transactional
   handoff instead of an authenticated network one.

**Verdict: REFUTED.** Both halves of the justification fail: the cited criteria are not ADR-0017's, and the
cheapest shape that meets every stated ground was not evaluated. The consequence is not merely rhetorical — the
ADR accepts a recurring bill and a new trust boundary against a comparison it never ran.

**What must change.** Either evaluate `@kitchensink/recipe-workers` explicitly and record why it loses, or
adopt it. If a separate deployable is still wanted, restate the justification as an owner decision in
ADR-0017's amendment style (`0017:236-239`), not as the firing of criteria ADR-0017 does not contain.

---

## A-7 — The amendment stopped at `spec.md`; every implementable artifact still says the opposite

**Claim attacked.** That the ruling is recorded. `004/spec.md:6` still reads _"**Status**: Ready for
implementation — all revalidation gates resolved."_

**Attack.** Follow the ruling into the documents an implementer actually executes.

**Evidence.** `git show 4a979422 --stat` touched, for these two features, only `004/spec.md` (+107),
`011/spec.md` (+56) and two `.forge-status.yml`. Consequently:

1. `004/tasks.md:551` still specifies **T-018 · OCR channel (D-001 — P1, ships at launch)** with `POST
/import/photo` (`:558`), mobile camera capture (`:660`), `import-photo-flow.yaml` (`:666`) and a table row
   (`:820`). An agent executing `tasks.md` builds the channel the ADR says 004 does not build.
2. `011/tasks.md:70,114` still create and drive `digitization_jobs` inside
   `packages/services/digitization-service/`, contradicting `0019:84`.
3. `004/spec.md:526-534` — inside the section the same commit rewrote — still enumerates `.../import/photo` as
   one of 004's own async ingress endpoints; `:698-702` (D-008) still requires `Idempotency-Key` on
   `POST /import/{url,instagram,photo}`; `:712-719` (D-006) still assigns 004 the `5/min` photo throttle.
4. Six new **MUST** requirements (`FR-046`..`FR-051`) landed with no `plan.md` entry, no task, no v-model
   requirement and no acceptance procedure in either feature.
5. `FR-050` imposes work on a **third** service — the food catalogue must hold shell entries advanced by its own
   resolution pipeline (`004/spec.md:229-240`, `0019:118-134`) — and `rg "shell entr"` across `specs/` matches
   only `004/spec.md`. 003 has no counterpart requirement and food has no owner for it.

**Verdict: REFUTED (that the design is landed).** The ruling exists in prose in two files and is contradicted by
every artifact downstream of them. `004/spec.md:6`'s "Ready for implementation" is false as of this commit.

**What must change.** Retire T-018 from `004/tasks.md` (and its traceability rows), repoint 011's plan/tasks
once A-2's ownership question is answered, task `FR-046`..`FR-051`, and file the food-side shell-entry
requirement in 003 or withdraw `FR-050`.

---

## A-8 — "`sourceType` declared by the surface, never inferred"

**Claim attacked.** `0019:63-70` and `004-FR-047` (`004/spec.md:214-215`): _"`sourceType` MUST be **declared by
the invoking surface and whitelisted server-side** (`FR-025`), never inferred from the payload."_

**Attack.** Check it against the two rules it cites and against 004's format-detection requirement.

**Evidence.**

1. **It contradicts the rule it cites, in the same document.** `004/spec.md:294-298` (FR-025): a caller _"MUST
   NOT be able to declare `imported_public` … or `imported_physical` … Those classifications are set **only** by
   the server from the channel it observed."_ FR-047 authorises the declaration FR-025 forbids for two of the
   four `sourceType` values, and the photo handoff (A-3) is exactly the case where the forbidden one is
   declared.
2. **"Never inferred from the payload" is the wrong rule for format.** `004/spec.md:188-190` (FR-019): file type
   _"MUST be determined by content inspection (magic bytes), not by the client-supplied filename or MIME type"_,
   reinforced at `:552` (_"`IMPORT_UNSUPPORTED_FORMAT` is decided by **magic bytes**, not by a declared content
   type"_). Format must be inferred **precisely because** the declaration is untrustworthy. The ADR's blanket
   phrasing, applied consistently, reverses a security control.
3. **The design underneath is fine and is already built.** `004/plan.md:117-118` keeps `import_channel`
   (CHECK-constrained) separate from `source_type` (_"Provenance classification decided at draft time"_). The
   surface declares the **channel** by choosing an endpoint; the server **derives** provenance from the channel
   it served; the parser **infers** the format from bytes. Three different things.

**Verdict: WEAKENED.** The chooser and the no-omni-input rule survive untouched — I could not break them, and
`004/plan.md:117-118` shows the separation they need already exists. The ADR's one-sentence formulation is what
fails: it conflates channel, provenance and format, and as written it authorises a mass-assignment `FR-025`
exists to prevent.

**What must change.** Reword to: _the surface declares the **channel**; the server derives `sourceType` from the
channel it served (`FR-025` unchanged); the **format** is determined by content inspection (`FR-019`)._

---

## A-9 — "Present the unavailable method with a reason"

**Claim attacked.** `004-FR-046` (`004/spec.md:204-210`): a method not available in the current build _"MUST be
shown in a visibly unavailable state with the reason, **not** omitted and **not** rendered as a control that
does nothing."_

**Attack.** Check it against 004's other MUST about the same channel and the same user.

**Evidence.** `004/spec.md:288-289` (FR-028): for a caller without the premium entitlement, the channel _"MUST
also be **absent from the advertised channel list** for such a caller, so no unusable affordance is rendered."_
Photo is premium-only (D-014, `004/spec.md:670-677`), and until 010 ships premium is derived from the signed
token's `permissions` (`004/spec.md:30`) — so free-tier users exist at launch. For that user and that method,
`FR-046` says _show it disabled with a reason_ and `FR-028` says _do not show it_. Both are MUST, in one spec,
about one control. `011/spec.md:53` adds a third position — 011 _"ships ungated if 010 is not yet live"_ —
unamended and now contradicting the gate it was told to inherit at `011/spec.md:84-86`.

**Verdict: REFUTED as a coherent requirement pair.** The honest-unavailability principle is right; the two MUSTs
cannot both be satisfied. Note the reasons differ in kind — "not built yet" is a product state every user
shares, "not entitled" is a per-caller state — which is what makes a single rule wrong.

**What must change.** Split the rule: **capability-absent** (not built, or capability-flagged off) → shown
disabled with a reason; **caller-not-entitled** → shown with the upgrade path, or omitted, but pick one and
delete the other clause from `FR-028`. Then fix `011/spec.md:53`.

---

## Where the design held

Stated plainly, because a review that only attacks is not a review.

- **The shared confirm-and-create path is right.** Four channels each writing recipes, dedup, provenance and
  per-recipe outcome would drift; `004/spec.md:130`'s draft-and-confirm model already forces a single write
  path, and the ADR is correct to make that explicit. My attack failed on the last leg (A-1) — only on where
  the seam is drawn.
- **The method chooser, and the refusal of an omni-input, survive intact.** I found no evidence against them.
  `004/plan.md:117` shows the channel discriminator they imply already exists.
- **Supersession by a producer-assigned monotonic sequence, not arrival order** (`0019:105-110`, `004-FR-048`).
  I tried to break this and could not: `specs/014-notification-service/spec.md` (amended in the same commit)
  defines `supersedes` as `{ key, sequence }` with a producer-assigned integer, and the at-least-once,
  out-of-order premise is the one this repo already operates on. The failure mode it names — a redelivered
  `processing` overwriting a terminal `succeeded` — is real and the control is the right one.
- **The durable projection alongside the event stream** (`0019:118-127`, `FR-050`). The reasoning that a client
  connecting mid-import must read state rather than replay messages is sound, and the shell-entry prohibition
  (`0019:129-134`) correctly preserves `CLAUDE.md`'s recipe-is-not-a-food rule with the food DB's single
  writer intact. My only finding is that `FR-050`'s food-side obligation has no owner (A-7.5).
- **The two-owners problem was real.** `0019:24-27` is accurate: `011/spec.md:52` (pre-amendment, per
  `git show 4a979422`) declared the boundary while `004`'s D-001 committed 004 to the same channel. Something
  had to be ruled. The criticism above is of the ruling's shape, not of the decision to rule.

## Not examined

- `docs/architecture/decisions/0016` (notification retention/dedup) beyond the `supersedes` field, and 014's
  delivery half — I read only the amended envelope FR.
- 011's Family Circles half (FR-031..FR-035, `@kitchensink/audience`) — out of scope for this split, and
  unaffected by it except that it shares a feature number with a channel whose ownership is now contested.
- The v-model artifacts of either feature (`004/v-model/*`, `011/v-model/*`) beyond counting OCR references;
  the acceptance and hazard implications of moving the channel are unassessed.
- Whether AWS Textract remains the right provider (011 Q-001), and any cost modelling of OCR at 20-photo batch
  volumes.
- Any runtime behaviour: nothing here is implemented, so no claim in this review is empirically tested against
  a running system.
