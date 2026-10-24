# 12 — Adversarial review: superseding status messages (ADR-0019 §4) and status shells (§5)

**Posture**: refutation, not validation. Every claim below is anchored to code or spec text that was
opened and read. Where an attack failed, the evidence that defeated it is stated.

**Scope**: `docs/architecture/decisions/0019-recipe-import-spine.md` §4 (lines 92–113) and §5 (lines
115–134); `specs/014-notification-service/spec.md` FR-026 (387–398) and FR-045 (637–661);
`specs/004-recipe-importing/spec.md` FR-048–FR-051 (217–243).

---

## A-1 — The producer-assigned `sequence` is a counter the design never sites, and it collides with an existing field of the same name

**Claim attacked.** FR-026: _"`sequence` is a **monotonically increasing integer assigned by the
producer** for that key"_ (`specs/014-notification-service/spec.md:395-396`), and ADR-0019 §4:
_"supersession is decided by a monotonic sequence carried in the envelope"_
(`docs/architecture/decisions/0019-recipe-import-spine.md:108-110`).

**Attack.** A producer-assigned monotonic counter per `(recipient, key)` is durable state. Neither
document says where it lives, what makes it survive a worker restart, or what happens when two
workers advance the same entity. If it is derived from an in-process counter it collides on restart;
if from a clock it is not gap-free and is not monotonic across hosts; if from a DB column, that
column must exist. Second: the name `sequence` is already taken inside this same contract by a
**service-assigned** field with different ownership.

**Evidence.**

- **The recipe half has a counter and the ADR does not name it.** `recipes.current_version`
  (`packages/services/recipe-service/src/database/schema/recipes.ts:132`) is a durable
  `integer NOT NULL DEFAULT 1`, already CAS-updated, per recipe, surviving restarts. It is exactly the
  primitive FR-048 asks for and neither FR-048 nor ADR-0019 §4 mentions it.
- **The food-item half has no counter at all.** The recipe-side projection of a food item is
  `ingredients`, which carries `created_at` and **no** `updated_at` and **no** version column
  (`packages/services/recipe-service/src/database/schema/ingredients.ts:50-68`). There is nothing to
  derive a sequence from.
- **The food-side row has only a timestamp.** `food.updated_at`
  (`packages/services/food-service/src/db/schema/food.ts:102`) is `timestamptz`, not gap-free, not
  unique, and set by `now()` inside `setStatus` (`.../foods/dao/food.dao.ts:303-330`) — usable as a
  high-water mark only if the contract accepts a non-integer and accepts clock behaviour as a
  correctness input, which FR-026 (`integer`) does not.
- **Name collision inside one contract.** `PendingNotification` already has a field named `sequence`,
  and the spec goes out of its way to define its ownership: _"`sequence` is monotonic per DELIVERING
  USER, not per `recipient.id`"_ (`specs/014-notification-service/spec.md:678-679`), assigned by the
  service inside the ingest script — _"payload-dedup claim, **`sequence` assignment**, envelope write,
  pending insert — runs as one Lua script"_
  (`docs/architecture/decisions/0016-notification-retention-payload-dedup-and-valkey.md:169-172`).
  FR-012/FR-034/SC-012 all say "in `sequence` order" (`spec.md:528`, `:994`) and now read ambiguously.
  ADR-0014/GR-015 exist to stop exactly this: one generated wire contract with two differently-owned
  fields spelled the same way.

**Verdict.** **SURVIVES** for the food-item half and for the naming; **WEAKENED** for the recipe half
— `recipes.current_version` defeats "there is no durable counter" for recipes, and the primitive is
therefore not inherently a trap, only an unsited one.

**What must change.**

1. Bind `supersedes.sequence` to a **named durable column per entity type** in FR-048/FR-049 —
   `recipes.current_version` for recipes; a new `ingredients.resolution_sequence` (or `updated_at`
   promoted to a monotonic integer) for food items. A sequence with no named home is not a contract.
2. Rename one of the two `sequence` fields (`supersedes.sequence` → `supersedes.version` is the
   cheaper rename) before either is generated into `@kitchensink/schema-*`. This is a **one-way door**:
   it is a wire field.
3. State the multi-worker rule: whoever writes the entity row assigns the sequence in the same
   statement that writes it, so two workers cannot mint the same value.

---

## A-2 — FR-045 is self-contradictory and, as written, permits the exact regression it exists to prevent

**Claim attacked.** FR-045: _"A message whose `sequence` is lower than or equal to the highest already
observed for its `(recipient, key)` MUST be discarded"_ (`spec.md:640-642`) versus, twelve lines
later, _"Supersession applies only among **pending** messages. A message already acked is settled; a
later `sequence` for the same key produces a **new** pending notification"_ (`spec.md:657-660`).

**Attack.** "Highest already observed" requires a durable high-water mark per `(recipient, key)` that
outlives the pending entry. "Applies only among pending" says the state dies with the pending entry.
Take the ADR's own motivating scenario: `processing` (seq 3) then `succeeded` (seq 4); the client acks
seq 4; the bus redelivers seq 3. Under the second sentence the pending set is empty, seq 3 has no
peer, and it is admitted as **a new pending notification** — the user's finished import reverts to
"running", permanently, since nothing later corrects it. That is verbatim the failure FR-045 quotes as
its justification (`spec.md:645-648`).

**Evidence.**

- Both sentences are in FR-045, `specs/014-notification-service/spec.md:640-642` and `:657-660`.
- If the high-water mark is instead made durable, it lands in the FR-040 store, which the spec itself
  records as lossy: _"a node replacement or failover can drop retained notifications this service
  already told a producer it had accepted … the loss is unrecoverable and silent"_ (`spec.md:537-541`,
  and `ADR-0016:186-196`). A supersession guard whose state is in a documented-lossy cache is a guard
  that fails open into the same regression.
- FR-045 also names no atomicity, while ADR-0016 is emphatic that the accept path is **one Lua script
  in one slot** and that _"a second `{…}` anywhere in the key moves it to a different slot"_
  (`ADR-0016:167-172`). A supersession key built from a producer-supplied entity `key`
  (`notif:sup:{u:USER}:{ENTITY-KEY}`) introduces a second brace group and lands in a different slot,
  so the compare-and-set cannot be in the same script as the pending insert. Two ingress workers
  handling seq 3 and seq 4 concurrently can then interleave and leave seq 3 retained.

**Verdict.** **SURVIVES.** FR-045 is not implementable as written.

**What must change.**

1. Decide explicitly: either the high-water mark is **durable and survives ack** (then say where it
   lives, how long it is kept, and how it is bounded per `(recipient, key)` — this is unbounded growth
   ADR-0016's retention model does not cover), or supersession is **best-effort within the pending
   window** and the DB projection is the only correctness guarantee (then §4 must stop claiming it
   prevents the regression).
2. Fold the supersession compare into ADR-0016's single-slot accept script, and state the key
   construction so the hash-tag rule is not violated. Escape or hash the producer-supplied entity key.
3. Add the acceptance test that is missing: publish seq 3, seq 4, ack, redeliver seq 3, assert the
   client's terminal state is unchanged.

---

## A-3 — Supersession protects the message and leaves the projection — the declared source of truth — unguarded

**Claim attacked.** ADR-0019 §5: _"Status is therefore readable from the database at any time … the
message is a notification of a committed state change, never the state itself"_
(`ADR-0019:123-127`), and FR-050's same wording (`specs/004-recipe-importing/spec.md:229-235`).

**Attack.** If the DB is the source of truth, ordering must be enforced **at the write to the DB**.
FR-045 orders the transport. The write is unordered, ungated, and about to acquire a second writer.

**Evidence.**

- `IngredientsDal.updateResolution`
  (`packages/services/recipe-service/src/ingredients/dal/ingredients.dal.ts:363-385`) is a bare
  `UPDATE ingredients SET food_resolution_status = $1 … WHERE id = $2` — no prior-status predicate,
  no version predicate, no `RETURNING` check for a no-op. Any caller can write any status over any
  status.
- The food service does the opposite for the same concept: `setStatus` gates on `LEGAL_PRIORS` and
  treats `rowCount = 0` as an error (`packages/services/food-service/src/foods/dao/food.dao.ts:182-188`,
  `:303-330`). The two halves of §5 have opposite write disciplines for the same state machine.
- A **second writer is already live**: `IngredientsService.refreshStatus`
  (`packages/services/recipe-service/src/ingredients/ingredients.service.ts:395-422`) polls
  `foodClient.getStatus` and calls `updateResolution` with whatever it read. Add the §4 push consumer
  and two unsynchronised writers race on one column; the notification service can supersede perfectly
  and still lose, because the poll wrote a staler value afterwards.
- The status vocabularies do not even align: `food_status` is
  `PENDING|UNRESOLVED|RESOLVED|NOT_FOUND|FAILED` (`food.ts:44`, mirrored at `ingredients.ts:35-41`),
  while §4's stage table is `queued|processing|succeeded|failed|errored` (`ADR-0019:97-103`). No
  mapping is specified, and `UNRESOLVED` — which requires user disambiguation
  (`ingredients.service.ts:20-21`) — is neither `succeeded` nor `failed` nor `processing`. §4's table
  cannot express a shipped state.

**Verdict.** **SURVIVES.** §4's stated purpose (never regress a terminal state) is not achieved by §4,
because the state that matters is written outside it.

**What must change.**

1. Gate `updateResolution` the way `setStatus` is gated — a legal-priors predicate **and** a
   `resolution_sequence` monotonic predicate in the `WHERE`, with `rowCount = 0` meaning "stale write,
   ignored" rather than "row missing". This is required whether or not §4 ships.
2. Add the status-vocabulary mapping to the ADR as a total function from `food_status` to the stage
   union, including where `UNRESOLVED` lands, or drop the second vocabulary.

---

## A-4 — The ADR requires a dual-write and does not require an outbox; the shipped emitter already loses events silently

**Claim attacked.** ADR-0019 Consequences: _"Every emitting service now owns an outbox/publish path
and its failure modes"_ (`ADR-0019:162-164`) — stated as an accepted **cost**, not as a decision, with
no numbered requirement anywhere in §4 or §5.

**Attack.** §4 mandates a committed state change **and** an emitted message across two systems with no
transactional boundary named. The repo's own normative doc names the fix
(`docs/engineering/ENGINEERING_EXCELLENCE.md`: _"Use the transactional outbox for the dual-write
problem: write business row + event in one transaction, relay asynchronously — eliminates 'committed
the row, lost the event.'"_). Because the ADR only lists it as a consequence, the existing
fire-and-forget shape satisfies the ADR as written.

**Evidence.**

- `FoodEventEmitter.publishFoodFetchCompleted` and `publishFetchFailed`
  (`packages/services/food-service/src/events/food-event-emitter.ts:169-177`, `:186-194`) `try`/`catch`
  the put and **swallow** it: _"Both publishes are fire-and-forget: a bus failure is logged via the
  optional error sink and swallowed"_ (`:10-12`). The state change commits; the event can vanish.
- The wired bus is `ConsoleEventBus` (`.../events/food-event-emitter.ts:202-215`), injected
  unconditionally at `packages/services/food-service/src/worker/main.ts:64`. Today every food domain
  event is a `console.info`. `@aws-sdk/client-eventbridge` is a dependency of no package in the repo
  (grep over all `package.json`, no hits).
- No outbox table exists in either schema: food has 13 tables
  (`food-service/src/db/schema/{food,operational,food-candidates}.ts`), recipe has 12
  (`recipe-service/src/database/schema/*.ts`); none is an outbox and none is an import table.

**Verdict.** **SURVIVES.** The ADR is incomplete in a way that produces silent status loss, and the
loss mode is already implemented.

**What must change.** Promote the outbox from a consequence to a numbered decision: the status row and
the outbox row are written in **one transaction** with the state change (inside `setStatus`'s and
`updateResolution`'s transaction boundary), a relay drains it, relay lag is alarmed, and the emitter's
swallow-and-continue is deleted. Note this is a real ADR-0017 cost: a relay is a new runtime concern in
two services.

---

## A-5 — Nobody can emit the per-food-item message, and the codebase already recorded that as a decided fact

**Claim attacked.** ADR-0019 §4: _"the **owning service** emits a status message per entity — per
recipe, and per food item"_ (`ADR-0019:93-95`), combined with §5's _"created and advanced by the food
service's own resolution pipeline"_ (`ADR-0019:131-133`) and 004 FR-049's unattributed _"System MUST
emit … per food item"_ (`specs/004-recipe-importing/spec.md:225-228`). Read together these point the
food-item emission at the food service.

**Attack.** The food service cannot name a recipient, and the repository has already written that
down, in the schema, as a correction of this exact mistake.

**Evidence.**

- `packages/services/food-service/src/db/schema/operational.ts:64-71`, verbatim: _"**NOT** notification
  targeting — that intent was recorded here and is **IMPOSSIBLE** from this table: `FetchQueueDao.resolve`
  deletes every row for a food in the same transaction that completes it (DSN-10), so a completion
  notifier reading recipients here races its own deletion. The recipe service owns the notification
  subscription set (014 T-044). This comment previously claimed 'WebSocket targeting' and is what
  pointed 003's US-9 at the wrong service."_
- The deletion is real: `resolve()` deletes `fetch_requesters` then `fetch_queue` in one transaction
  (`packages/services/food-service/src/foods/dao/fetch-queue.dao.ts:348-353`).
- 014 already ruled on it three times: _"published by the **recipe service**, not the food service
  (outbox)"_ (`specs/014-notification-service/plan.md`, integration table), the same in
  `specs/014-notification-service/review.md`, and in `spec.md`'s 003 dependency row.
- The food service also has no user linkage outside `fetch_requesters` — no owner/user/account column
  in any of its 13 tables (grep over `food-service/src/db/schema/`).
- Even the existing event is unusable as an envelope: `FoodFetchCompleted` is a **domain event**
  (`food-event-emitter.ts:49-59`, carrying `id`/`status` and no recipient), and FR-025 forbids the
  notification service from subscribing to domain events — _"It MUST NOT subscribe to producers' domain
  events. A domain event carries no recipient"_ (`specs/014-notification-service/spec.md:384-387`).

**Verdict.** **SURVIVES.** ADR-0019 §4 + §5, read as written, reverse a decision the codebase records
in a schema docstring and 014 records in three artifacts, without naming the premise it is overturning.

**What must change.** §4 must state explicitly: **the recipe service emits food-item status**, because
it owns the `ingredients` placeholder and the subscription set; the food service emits nothing to
users. Then §5's "advanced by the food service's own resolution pipeline" needs the follow-on sentence
that the recipe service observes that advance (poll or event) and emits. Without that sentence the ADR
is a trap for whoever implements FR-049.

---

## A-6 — Does §5 make §4 pointless? Partly — a working pull already ships, and 014 must not be on 004's critical path

**Claim attacked.** ADR-0019 §4's premise: _"Nothing in any spec told a client that work was underway
… so every client's only option was to poll a terminal result"_ (`ADR-0019:32-36`).

**Attack.** The premise is false as stated. A non-terminal poll ships, works, and writes the
projection. If the DB is authoritative (§5) and a poll exists, §4 buys latency, not correctness — and
it puts an entirely unimplemented service on the critical path of a launch feature.

**Evidence.**

- `IngredientsService.refreshStatus` (`packages/services/recipe-service/src/ingredients/ingredients.service.ts:395-422`)
  re-reads `foodClient.getStatus`, persists nutrition on `RESOLVED`, and _"otherwise just advances the
  stored status"_ (`:18-19`) — i.e. it already surfaces `PENDING`/`UNRESOLVED`, not a terminal-only
  result. `addByName` already returns a non-terminal status _"so the picker can render a 'nutrition
  pending' state"_ (`:14-17`).
- Feature 014 has **no implementation**: `packages/services/` contains `food`, `food-service`,
  `identity`, `identity-webhooks`, `recipe-service`, `recipe-workers` — no notification service, and no
  package references one.
- The 014 store is documented-lossy (`spec.md:537-541`), so the message layer cannot be the guarantee
  even once built.

**Counter-evidence that defeats the strong form of this attack.** The poll does not scale to the case
§4 exists for. It is per-ingredient (`refreshStatus(caller, id)`), so a 1,000-recipe import
(`specs/004-recipe-importing/spec.md:299`, D-013 at `:678`) at ~10 ingredients per recipe is ~10,000
client-driven round trips, each re-reading the food service. And every food call is made **as the
caller** — _"Food-service verifies a Clerk token, so the only credential that can satisfy it is the
requesting user's own"_ (`ingredients.service.ts:26-32`) — so nothing can poll on behalf of a
disconnected user. A bounded aggregate read is genuinely missing.

**Verdict.** **WEAKENED**, not refuted. §4 is not redundant, but its stated premise is wrong and its
sequencing is wrong.

**What must change.**

1. Correct §4's Context: a non-terminal status poll ships (`refreshStatus`); the gap is a **bounded
   per-import aggregate read**, not the absence of status.
2. Make it explicit and testable that **no 004 acceptance criterion depends on 014**. 004 ships the
   projection plus one aggregate endpoint (`GET /imports/{id}` returning per-recipe and per-ingredient
   status in one read); 014 makes it live. Today ADR-0019 §4 reads as a hard dependency on an
   unimplemented service, and `docs/architecture/decisions/0019-...:112-113` assigns 004 the duty of
   emitting into it.

---

## A-7 — The shell entry does not breach the single-writer rule; §5 presents shipped behaviour as a new decision

**Claim attacked.** ADR-0019 §5's boxed warning: _"A shell is a food in a pending state, created and
advanced by the food service's own resolution pipeline … The food database still has exactly one
writer"_ (`ADR-0019:129-134`), against CLAUDE.md's _"the food DB keeps a SINGLE writer, the USDA/source
pipeline"_.

**Attack.** A shell created because a recipe referenced an unresolved ingredient is created **on the
recipe's behalf**; "the food service's own pipeline creates it" is a rationalisation for a
recipe-triggered write.

**Evidence that defeats the attack.**

- The mechanism ships and predates this ADR. `FoodDao.createByName`
  (`packages/services/food-service/src/foods/dao/food.dao.ts:239-289`) inserts a row with
  `status = 'PENDING'` on an external caller's request; `food.status` defaults to `'PENDING'`
  (`db/schema/food.ts:95`) and the enum's first member is `PENDING` (`:44`). The recipe service already
  drives it: _"`addByName` — `foodClient.addByName` returns `202` (`PENDING`/`UNRESOLVED`)"_
  (`ingredients.service.ts:14-17`).
- The single-writer rule is about **content**, and it holds: every scalar, nutrient, portion and
  category value carries a `source_id` FK constrained to a `food_sources` row of the same food
  (`db/schema/food.ts:228-232`, `:263-267`, `:294-298`), and `food_sources.source` is the
  `food_source` enum whose only member is `usda` (`:50`). A caller can create a **name**; only the
  source pipeline can create **substance**. The recipe→food direction is unchanged and no recipe is
  registered as a food.

**Verdict.** **REFUTED** as a single-writer breach.

**Residual that survives.** §5 is written as a decision and is largely a description of shipped code —
`food.status` shells, the `LEGAL_PRIORS` machine, `ingredients.food_id` +
`ingredients.food_resolution_status` (`recipe-service/src/database/schema/ingredients.ts:53-56`) all
exist. The ADR cites none of them. An ADR that re-decides what ships, without saying so, invites an
implementer to build a second mechanism beside the first. **What must change**: §5 must say "this
ships; here is what is new" and name the genuinely new parts — the import linkage, the sequence
column, and the write gate (A-3).

---

## A-8 — Nobody owns the garbage: shells are never deleted, the catalog is globally unique-named and ownerless

**Claim attacked.** §5's shell entry as a durable projection, at 004's bulk scale (up to 1,000 recipes
per file, `specs/004-recipe-importing/spec.md:299`, `:678`).

**Attack.** 1,000 imported recipes produce thousands of shells from unvalidated user text. Who deletes
them?

**Evidence.**

- **No deletion path exists.** There is no `DELETE FROM food` anywhere in
  `packages/services/food-service/src` (grep, excluding `dist`). The TTL is not a reaper: it only
  permits **reactivation** of a tombstoned row on the next `createByName`
  (`food.dao.ts:254-266`), and only `NOT_FOUND`/`FAILED` rows ever get a `tombstoned_at`
  (`:303-330`). A shell stuck at `PENDING` or `UNRESOLVED` is immortal.
- **The name space is global and unique.** `uniqueIndex('food_normalized_name_unique')`
  (`db/schema/food.ts:110`) — one row per normalized name for the whole platform. A misparsed
  ingredient line ("1/2 cup chopped fresh flat-leaf parsley") permanently occupies a global name.
- **There is no owner.** No user/owner/account column exists in any food table; the only user linkage
  is `fetch_requesters.requester_id`, which is deleted at completion
  (`fetch-queue.dao.ts:348-353`). After resolution nothing records who caused a row.
- **No import linkage exists on either side** to scope a cleanup: neither schema has an import table
  or an import id column (12 recipe tables, 13 food tables, enumerated above).

**Verdict.** **SURVIVES.** This is the strongest structural objection to §5 at bulk scale.

**What must change.**

1. An import linkage — an `imports` table in the recipe service and an import id on the ingredient
   placeholder — so unresolved artefacts of a failed import are attributable and reclaimable. §5
   without it is unbounded by construction.
2. A shell reclamation rule in ADR-0019 or ADR-0016's sibling: a `PENDING`/`UNRESOLVED` food with no
   `fetch_queue` row and no referencing `ingredients` row after N days is deleted, or is marked with an
   `origin`-style discriminator (`food.origin` already exists as precedent, `db/schema/food.ts:75`,
   `:99`) so it never competes with catalog rows.
3. A per-import cap on **new** shells, separate from the 1,000-recipe cap.

---

## A-9 — The bulk case fights the food service's fairness machinery, and demand weighting collapses

**Claim attacked.** §5's shells combined with 004's 1,000-recipe import; the ADR says nothing about
queue behaviour.

**Attack.** Every shell enqueues demand into a **demand-weighted, fairness-demoted** queue that was
tuned for interactive add-by-name, not bulk.

**Evidence.**

- `FetchQueueDao.leaseNext` (`packages/services/food-service/src/foods/dao/fetch-queue.dao.ts:214-257`)
  computes `demand` as `count(*) > FOOD_DEMOTE_THRESHOLD` **per requester** across all
  `pending`/`in_flight` rows, and branch 1 only leases foods that have at least one requester **not**
  in `over_demand`. A single import pushing thousands of shells puts its requester over the threshold
  immediately, so that requester is served only by branch 2 — the importing user is demoted behind
  every interactive user for the duration of their own import.
- Priority is `request_count DESC` where `request_count` is the **distinct requester count**
  (`:92`, `:96`, `db/schema/operational.ts:79-92`). Bulk shells are requested by exactly one requester,
  so every one of them sorts at `request_count = 1` — the bottom band. Demand weighting is inert for
  precisely the workload §5 introduces.
- If the import instead runs as a service principal (the food guard accepts `svc_*` — see
  `packages/services/food-service/src/auth/authenticated-principal.ts:40-55` and the guard test naming
  `svc_recipe_import` at `src/auth/__tests__/food-auth.guard.test.ts:141`), then **all** imports from
  **all** users collapse into one requester bucket: one demotion starves every import globally, and
  `fetch_requesters` loses the user identity that A-5 already showed is needed.
- The DAO records its own residual: _"the claim is still linear in `fetch_requesters` ROWS"_
  (`fetch-queue.dao.ts:195-199`) — bulk import is the workload that makes that term grow.

**Verdict.** **SURVIVES.** Not addressed in ADR-0019, 004, or 003.

**What must change.** §5 must state which principal a bulk import resolves under and what queue class
its shells enter. The defensible shape is a separate low-priority lane for bulk-origin shells so they
never contend with interactive add-by-name, with the importing user's own interactive requests
unaffected — and a measured claim, not an assumed one, before 1,000-recipe imports ship.

---

## A-10 — The typeahead leak is real, but it is §5's _recipe_ placeholder, not the food shell

**Claim attacked.** The prior finding that "unresolved shells leak into every user's ingredient
typeahead".

**Attack on the attack.** Check which surface actually leaks before asserting it of the shell.

**Evidence.**

- **The food catalog does not leak.** Both branches of `FoodSearchDao.search` filter
  `WHERE status = 'RESOLVED'`
  (`packages/services/food-service/src/foods/dao/food-search.dao.ts:221`, `:255`). A `PENDING` shell is
  invisible to food-service search. The blended typeahead's catalog section is therefore clean.
- **The recipe placeholder does leak.** `IngredientsDal.search`
  (`packages/services/recipe-service/src/ingredients/dal/ingredients.dal.ts:149-170`) filters on the
  query text only — no `food_resolution_status` predicate, no `is_user_entered` predicate, no owner
  predicate. `IngredientsService.suggest` blends that unfiltered local result with the catalog
  (`ingredients.service.ts:186-201`), and the local section is described as the floor that always
  renders.
- **The `ingredients` table is ownerless.** No user/owner column
  (`recipe-service/src/database/schema/ingredients.ts:48-88`); `idx_ingredients_food_id` and
  `idx_ingredients_freeform_name` are **global** uniques, so one user's placeholder is one platform-wide
  row that every other user's typeahead can match.

**Verdict.** **SURVIVES, restated.** The multi-tenant data-quality exposure is real and is created by
§5's _first_ bullet ("the recipe stores a placeholder reference"), not its second. Stating it of the
shell would have been wrong and would have sent the fix to the wrong service.

**What must change.** `IngredientsDal.search` must exclude non-terminal placeholders (or rank them
last and scope them to the creating user) before bulk import multiplies them by three orders of
magnitude. This is a defect **today**, independent of ADR-0019, and bulk import is what makes it
user-visible.

---

## A-11 — Lock contention and index bloat at 1,000 recipes: mostly not the problem

**Claim attacked.** That bulk shell creation will contend on locks and bloat indexes.

**Attack.** ~10,000 `createByName` calls, each a transaction plus an advisory lock plus an upsert into
a table carrying five indexes including two trigram indexes and a GIN over a generated `tsvector`.

**Evidence that defeats most of it.**

- The advisory lock is **per normalized name**, transaction-scoped:
  `pg_advisory_xact_lock(LOCK_CLASS_DEDUP, hashtext(normalized_name))` (`food.dao.ts:244`). Different
  names never contend; identical names are exactly the case where the second caller's work collapses
  to an id lookup via `ON CONFLICT` (`:247-278`). Bulk imports repeat common names heavily, which this
  path handles by design.
- A batch endpoint already exists with a configured cap (`FOOD_MAX_BATCH_NAMES`,
  `packages/services/food-service/src/foods/foods.schema.ts:264-273`), and names are length-bounded
  (`.max(MAX_FOOD_NAME_LENGTH)`, `:254`, `:273`).
- Index cost is real but small at this scale: five indexes on `food` (`db/schema/food.ts:109-130`),
  ~10⁴ rows per bulk import.

**Verdict.** **REFUTED** for lock contention and index bloat in isolation. The durable problems are
A-8 (never deleted, globally unique names, no owner) and A-9 (fairness collapse), not write throughput.

**What must change.** Nothing on these grounds. Do not spend design budget here; spend it on A-8/A-9.

---

## Where the design held

- **The shell is not a single-writer violation** (A-7). The provenance FKs (`food.ts:228-232`,
  `:263-267`, `:294-298`) confine substance to the source pipeline; a caller-created row is a name and
  a lifecycle state. The ADR's boxed prohibition is correct, and no recipe is registered as a food.
- **The food catalog does not leak unresolved rows** (A-10). `status = 'RESOLVED'` is enforced in both
  search branches (`food-search.dao.ts:221`, `:255`).
- **§4's rejection of arrival-order last-write-wins is correct reasoning** (`ADR-0019:108-110`). The
  named failure — a redelivered `processing` overwriting `succeeded` — is real on an at-least-once
  unordered bus, and the distinction FR-045 draws between `idempotencyKey` ("seen this message?") and
  supersession ("still current for this entity?") is sound and worth keeping (`spec.md:649-655`).
- **§4's rejection of accumulating events** is correct: 1,000 recipes × N stages is an unbounded feed
  and pushing that reconciliation into every client is worse.
- **A durable counter exists for the recipe half** (`recipes.current_version`, `recipes.ts:132`), so
  the primitive is siteable rather than inherently a distributed-systems trap — which is why A-1's
  verdict is "unsited", not "unworkable".
- **§5's core assertion is right**: the projection must exist and must not disagree with the stream.
  Every objection above is about the projection being _underspecified and unguarded_, not about it
  being wrong to have.
- **Lock/index throughput** (A-11) is a non-issue at the stated scale.

## Not examined

- `specs/004-recipe-importing/plan.md` and `tasks.md` (only `spec.md` was read) — a task may already
  carry the import table or the sequence column that A-1/A-8 say are missing.
- `specs/014-notification-service/plan.md` beyond the three lines matched on producer ownership;
  `tasks.md`, `v-model/`, `verify-report.md` unread.
- ADR-0016 in full (read: §5, §6 Atomicity, and the Durability section, `:155-196`).
- Feature 011's specs — the image branch and Family Circles were out of scope for this review.
- Runtime behaviour: no query was executed, no plan captured, no load test run. Every scaling claim
  (A-9) is reasoned from statement shape and index definitions, not measured.
- `.github` CI wiring and whether any gate would catch the FR-045 contradiction.
- Whether ADR-0019 is committed on this branch or proposed in the PR under review.
