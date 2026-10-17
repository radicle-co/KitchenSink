# 09 — Data model review (ADR-0019 §5 placeholders + shell entries, and existing schema defects)

**Scope**: recipe service (`packages/services/recipe-service/src/database/`) and food service
(`packages/services/food-service/src/db/`) schemas + hand-authored migration SQL, read from source only.
**No database was connected to and nothing was mutated.** Every claim below is verified against a file, and
every absence is proven with a search whose command is shown.

**Read first**: ADR-0019 (whole), ADR-0014, ADR-0015, ADR-0017, ADR-0018, and CLAUDE.md's rule that the food
service is the ingredient service, its DB has exactly one writer (the USDA/source pipeline), and a recipe is
never written back into it.

---

## Executive frame — what already exists

ADR-0019 §5 reads as though it introduces a new model. **Most of the mechanism it describes already ships.**
The precise delta matters, because "build the shell-entry model" and "close four gaps in the shell-entry
model that already ships" are very different plans.

| ADR-0019 §5 requirement                                         | Status today                                                                                                           | Evidence                                                                                       |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Recipe stores a **placeholder reference** to an unresolved food | **EXISTS.** `ingredients.food_id` (opaque, no cross-DB FK) + `ingredients.food_resolution_status`                      | `recipe-service/src/database/schema/ingredients.ts:55-56`, `migrations/0001_initial.sql:74-86` |
| Food DB holds a **shell entry** carrying processing status      | **EXISTS.** `food` row inserted `status='PENDING'` by `FoodDao.createByName`                                           | `food-service/src/db/schema/food.ts:84-95`, `foods/dao/food.dao.ts:239-289`                    |
| Status readable from the DB at any time                         | **EXISTS on both sides** (food `status` column; recipe-side `food_resolution_status` projection)                       | as above                                                                                       |
| Guarded status transitions                                      | **EXISTS food-side only** (`LEGAL_PRIORS` conditional UPDATE). **ABSENT recipe-side** — bare UPDATE                    | `food.dao.ts:182-333` vs `ingredients/dal/ingredients.dal.ts:363-385`                          |
| Terminal state + TTL/tombstone                                  | **EXISTS food-side** (`tombstoned_at`, `FOOD_NOT_FOUND_TTL_DAYS`). **ABSENT recipe-side**                              | `food.ts:100`, `food.dao.ts:209`                                                               |
| Per-**recipe** status during bulk import                        | **ABSENT — nothing exists.** No `import_jobs`, `import_drafts`, `bulk_import`, or any import table                     | search in F-DB5                                                                                |
| Supersession by a **monotonic sequence**                        | **ABSENT everywhere** — no sequence/version column on either status projection                                         | search in F-DB7                                                                                |
| "Read current status of all entities in this import"            | **NO SUCH QUERY IS SUPPORTABLE** — no import-scoping column exists, and no index on either status column serves a scan | F-DB4, F-DB5                                                                                   |

The ADR is therefore mostly **correct about the design and wrong about the novelty**. The work is: (1) prove
the single-writer rule survives (F-DB1), (2) close the four integrity gaps the existing shell model already
has (F-DB2, F-DB3, F-DB6, F-DB9), and (3) build the genuinely-new per-entity import status (F-DB5, F-DB7).

---

## F-DB1 — The shell entry does NOT create a second writer today, and the exact mechanism that keeps it that way is load-bearing and undocumented

**Severity**: Critical (as a constraint to preserve — no defect today)
**File/Table**: `food` (food service), `ingredients` (recipe service)

**Problem.** ADR-0019 §5's warning box asserts that a shell "is created and advanced by the food service's own
resolution pipeline" and that "the food database still has exactly one writer". That assertion is **true
today**, and I verified the whole path — but the ADR never names _what makes it true_, so a plausible
implementation of the ADR breaks it.

What actually holds the line:

1. **No client of the food service holds a connection to `kitchensink_food`.** The recipe service reaches it
   only over HTTP through `@kitchensink/food-service-client`
   (`recipe-service/src/ingredients/ingredients.service.ts:370`, `:404`, `:342`). Verified there is no second
   Drizzle client or pool pointed at the food schema outside the food service:
   `find packages -type d -name database -not -path "*/node_modules/*"` returns only
   `identity/src/database`, `food-service/src/database`, `recipe-service/src/database`.
2. **The shell row is inserted _inside the food service_, by its own DAO**, in response to
   `POST /api/v1/foods` — `FoodsController.addByName` → `FoodsService.addByName` →
   `FoodDao.createByName` (`foods.controller.ts:101-111`, `foods.service.ts:207-236`,
   `food.dao.ts:239-289`). The caller supplies a **name**, never a row and never a status.
3. **Every subsequent advance is also food-service-internal and transition-guarded.**
   `FoodDao.setStatus` runs a conditional `UPDATE … WHERE id = $1 AND status IN (<legal priors>)` and throws
   `IllegalStatusTransitionError` on `rowCount = 0` (`food.dao.ts:303-333`), with the legal set declared once
   at `food.dao.ts:182-188`. No HTTP route lets a caller set a status: the only status-affecting routes are
   `POST /` (add), `POST /batch`, `POST /:id/refetch` (admin scope), and `PATCH /:id` (pick a candidate from
   _this food's own_ candidate set, validated against `food_candidates`) —
   `foods.controller.ts:100-181`, `foods.service.ts:318+`.
4. **The recipe service's copy is a read-through PROJECTION, not a write.** `ingredients.food_resolution_status`
   is only ever written from a value the food service returned (`ingredients.service.ts:296-297`, `:380`,
   `:406-411`, `:418-419`).

**Why it matters.** ADR-0019 §4 introduces a **push** channel (status messages) alongside today's **pull**
(`GET /{id}/status`). The obvious way to implement "the food DB carries the shell's status" for a bulk import
is a batch upsert into `food` from the import processor — because there is no batch status _read_ on the food
contract today (F-DB16), so a 1,000-recipe import resolving 4,000 ingredient lines has no efficient read path
and the pressure to write directly is real. That would be a second writer, and it would bypass `LEGAL_PRIORS`
entirely.

**Recommended model / fix — state these as invariants in the plan, not as prose in an ADR:**

- **W1.** `kitchensink_food` has exactly one connection origin: the food service (API + its Fargate worker +
  its migrate Lambda). Enforce it operationally, not by convention — the per-stage DB credential for the food
  schema is not granted to the recipe service's task role. (Ownership check: `sre-1` / `devops-1-devops-engineer`.)
- **W2.** A shell is created **only** by `POST /api/v1/foods` or `POST /api/v1/foods/batch`. The bulk import
  processor uses the **existing batch add** (`FoodClient.batch`, `packages/clients/food-service/src/client.ts:167`),
  which already caps at `FOOD_MAX_BATCH_NAMES` and already does intra-batch dedup
  (`foods.service.ts:248-297`). It does not get a new "internal" write route.
- **W3.** A status message the food service emits is a **notification of a committed transition**, emitted
  from inside `setStatus`'s transaction boundary (or an outbox row written in it) — never a channel through
  which a status arrives.
- **W4.** The recipe service's `ingredients.food_resolution_status` is explicitly designated a **read model**.
  It is written only from a food-service-originated value (pull or push), and never from recipe-side inference.

**Flip condition for W1/W2**: if per-shell write latency at 1,000-recipe scale proves the HTTP hop
untenable, the correct escape is a **food-service-owned bulk endpoint** (`POST /api/v1/foods/bulk` with a
higher cap), not a shared connection. Direct writes stay forbidden.

**Verified**: read of all four call paths named above; `grep -rn "insert(food)" packages/services/food-service/src`
(only the DAO); no food-schema Drizzle client outside the food service.

---

## F-DB2 — An enqueue shed by backpressure leaves a permanently-PENDING orphan shell, and nothing sweeps it

**Severity**: High
**File/Table**: `food` — `packages/services/food-service/src/foods/foods.service.ts:207-236` and `:248-297`

**Problem.** The row is inserted **before** admission is checked:

```ts
// foods.service.ts:208-216
const result = await this.foodDao.createByName({ normalizedName: normalizeName(name), displayName: name });

if (result.created || result.reactivated) {
    await this.admission.admit(requesterId);        // ← throws 503 here
    await this.enqueue.publishFoodRequested({ … }); // ← never runs
```

`AdmissionService.admit` throws `FetchUnavailableError` (→ 503) at the depth ceiling or on flood-shed
(`admission.service.ts:59-73`). When it throws, the `food` row is **already committed** (`createByName` runs
its own transaction, `food.dao.ts:243`), so the outcome is a `food` row at `status='PENDING'` with **no
`fetch_queue` row and no `fetch_requesters` row**. `batchAdd` has the identical ordering at
`foods.service.ts:264` vs `:287`, and it is worse: it commits up to `FOOD_MAX_BATCH_NAMES` shells and then
sheds the whole batch.

Nothing reclaims it. The only reaper is `FetchQueueDao.reapExpiredLeases`, which reverts stale `in_flight`
**queue** rows (`fetch-queue.dao.ts:7`, `:148-202`) — it cannot see a food that has no queue row. Proven
absent: `grep -rn "LEFT JOIN fetch_queue\|NOT EXISTS" packages/services/food-service/src` returns only a
planner comment in `fetch-queue.dao.ts:164` and the migrate Lambda's `schema_migrations` DDL. There is no
sweep over `food WHERE status='PENDING'`.

**Why it matters.** Today this is a latent orphan that only surfaces as a `GET /{id}` returning `202
{status:'PENDING'}` forever. **ADR-0019 §5 promotes it to a user-visible permanent lie**: the recipe holds a
placeholder reference, the DB says "processing", and a client that connects mid-import renders a spinner that
never resolves. §5 is explicitly the fallback for a status message that is never emitted — so the fallback
itself must not be able to stick.

Bulk import makes it routine rather than rare: a 1,000-recipe file is precisely the workload that drives
`fetch_queue` depth past `FOOD_MAX_QUEUE_DEPTH` (10,000 default) and past the 0.9 near-ceiling flood-shed,
and the flood-shed targets exactly the requester doing the import.

**Recommended model or fix.**

1. **Order the operations so the durable row is never ahead of its queue entry.** Admit _first_
   (`admit` reads only `fetch_queue`/`fetch_requesters`, so it is safe to run before the row exists), then
   `createByName` + `publishFoodRequested` **in one transaction**. That requires `createByName` to accept an
   ambient transaction rather than opening its own — a real refactor, and the correct one.
2. If (1) is deferred, add a **shell reaper**: a periodic job in the food worker that transitions
   `food` rows to `FAILED` where `status='PENDING'` AND `created_at < now() - <shell-stall-interval>` AND
   `NOT EXISTS (SELECT 1 FROM fetch_queue q WHERE q.food_id = food.id)`. It must go through
   `FoodDao.setStatus` (`PENDING → FAILED` is legal, `food.dao.ts:187`) so the tombstone and the emitted
   status message both happen. Supporting index: see F-DB15.
3. Either way, the recipe side needs a **stall deadline** (F-DB4) so a shell that stops advancing renders as
   stalled rather than as in-flight forever.

**Verified**: read of `foods.service.ts:207-297`, `admission.service.ts:59-93`, `food.dao.ts:239-289`,
`fetch-queue.dao.ts` header; absence search shown above.

---

## F-DB3 — `ingredients` can represent four illegal placeholder states; nothing forbids them

**Severity**: High
**File/Table**: `ingredients` — `packages/services/recipe-service/src/database/schema/ingredients.ts:48-88`,
`packages/services/recipe-service/src/database/migrations/0001_initial.sql:74-87`

**Problem.** Three columns encode one fact, and no constraint ties them:

```sql
"food_id"                text,          -- nullable
"food_resolution_status" text,          -- nullable
"is_user_entered"        boolean DEFAULT false NOT NULL,
CONSTRAINT "ingredients_food_resolution_status_check"
    CHECK ("food_resolution_status" IN ('PENDING','UNRESOLVED','RESOLVED','NOT_FOUND','FAILED'))
```

That CHECK constrains the _domain_ of a stated status and nothing else (`NULL IN (…)` is `NULL`, which passes).
The complete constraint inventory for both ingredient tables is two rows —
`grep -rn "CONSTRAINT\|CHECK" migrations/*.sql | grep -i ingredient` returns exactly
`0001_initial.sql:85` (the status domain) and `0001_initial.sql:104`
(`recipe_ingredients_quantity_positive`). So these are all representable:

| Illegal state                                              | Meaning                                                                                                   |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `food_id IS NOT NULL` AND `food_resolution_status IS NULL` | A placeholder reference with **no status at all** — unrenderable                                          |
| `food_id IS NOT NULL` AND `is_user_entered = true`         | Simultaneously food-backed and freeform; both dedup keys apply                                            |
| `food_id IS NULL` AND `food_resolution_status IS NOT NULL` | A status for nothing                                                                                      |
| `food_id IS NULL` AND `is_user_entered = false`            | Neither food-backed nor freeform — matches **neither** partial unique index, so it dedups against nothing |

The fourth is the dangerous one: both dedup uniques are partial
(`idx_ingredients_food_id … WHERE food_id IS NOT NULL`, `idx_ingredients_freeform_name … WHERE is_user_entered = true`,
`ingredients.ts:77-84`, `0006_ingredient_dedup_unique.sql:19-27`), so a row in that state is invisible to both
race guards and can duplicate without limit.

**Why it matters.** ADR-0019 §5 makes `ingredients` the durable projection a client renders in-flight state
from. If the placeholder's shape is not an invariant, the render is a guess. Make illegal states
unrepresentable — this is the single cheapest correctness win in the whole review, and it is a pure
constraint-add with a backfill.

**Recommended model or fix.** Replace the three loose columns' implicit contract with an explicit one:

```sql
-- 1. cleanup first (a constraint on dirty data fails the deploy)
UPDATE ingredients SET food_resolution_status = 'PENDING'
 WHERE food_id IS NOT NULL AND food_resolution_status IS NULL;
UPDATE ingredients SET food_resolution_status = NULL
 WHERE food_id IS NULL AND food_resolution_status IS NOT NULL;
-- inspect and repair (do NOT auto-delete) any row with food_id IS NULL AND is_user_entered = false

-- 2. then the invariant
ALTER TABLE ingredients ADD CONSTRAINT ingredients_backing_coherent CHECK (
    (food_id IS NOT NULL AND food_resolution_status IS NOT NULL AND is_user_entered = false)
 OR (food_id IS     NULL AND food_resolution_status IS     NULL AND is_user_entered = true )
);
```

This is the same discipline `recipes_rating_aggregate_coherent` already applies to the rating aggregate
(`recipes.ts:160`) — the precedent exists in this schema; it was simply not applied here.

**⚠ Data-loss/deploy risk**: this is a constraint over existing production rows. It **requires** a count of
each violating class taken first, a repair migration ahead of the constraint, and a tested rollback
(`ALTER TABLE … DROP CONSTRAINT`). Add it `NOT VALID` then `VALIDATE CONSTRAINT` in a second step so the
`ACCESS EXCLUSIVE` full-table scan does not block writes.

**Verified**: read of `ingredients.ts:48-88` and `0001_initial.sql:74-105`; constraint inventory search shown.

---

## F-DB4 — The recipe-side status projection has no index and no freshness anchor, so ADR-0019 §5's "read state at any time" is a table scan of unknown staleness

**Severity**: High
**File/Table**: `ingredients` — `ingredients.ts:69-87`, `0001_initial.sql:172-174`, `0006_ingredient_dedup_unique.sql`

**Problem — two halves.**

_No index._ The complete index set on `ingredients` is: `idx_ingredients_search_vector` (GIN tsvector),
`idx_ingredients_food_id` (unique partial on `food_id`), `idx_ingredients_freeform_name` (unique partial on
`lower(name)`), `idx_ingredients_name_trgm` (GIN trigram). Proven:
`grep -n "ingredients" 0001_initial.sql 0006_*.sql 0009_*.sql | grep -i index` — four indexes, none on
`food_resolution_status`. So _any_ query of the form "which of my ingredients are still unresolved" is a
sequential scan of a **globally shared, ownerless** catalog table. ADR-0019 asks for exactly that query,
scoped to an import of up to 1,000 recipes.

_No freshness anchor._ `ingredients` has `created_at` and **no `updated_at`**
(`ingredients.ts:67`; confirm: `grep -n "updated_at" migrations/*.sql` lists `0005`, `0004`, `0001:48/118/145`,
`0010:55` — none of them the `ingredients` block at `0001:74-87`). So a `PENDING` row is indistinguishable
from a `PENDING` row that stopped advancing an hour ago. A client "rendering correct state from a read" cannot
tell in-flight from stalled, which is precisely the state F-DB2 produces.

**Why it matters.** §5 exists so a client that connects mid-import, or after a dropped connection, renders
correctly _without_ the message stream. A projection that cannot be queried by status, and that carries no
notion of when it last moved, does not deliver that.

**Recommended model or fix.**

```sql
ALTER TABLE ingredients ADD COLUMN status_updated_at timestamptz NOT NULL DEFAULT now();

-- the "still in flight" access path: partial, so it stays tiny as the catalog grows
CREATE INDEX idx_ingredients_unresolved
    ON ingredients (food_resolution_status, status_updated_at)
    WHERE food_resolution_status IN ('PENDING', 'UNRESOLVED');
```

Partial on the non-terminal set deliberately: a healthy catalog is overwhelmingly `RESOLVED`, so a full index
would be mostly dead entries paid for on every write. `status_updated_at` is written by `updateResolution`
(and only there), and is what a stall deadline compares against.

Whether ce-plan _also_ needs an import-scoped index depends on decision **D-2** below — if per-entity import
status lives in its own table, that table carries the index and `ingredients` needs only the two above.

**Verified**: index inventory searches shown; `ingredients.ts:67` column list; `updateResolution` at
`ingredients.dal.ts:363-385` writes no timestamp.

---

## F-DB5 — Nothing exists for per-recipe bulk-import status; 004's plan names two tables and specifies DDL for only one, and neither is per-entity

**Severity**: High
**File/Table**: recipe service — no table exists

**Problem.** ADR-0019 §4 requires a status message **per entity — per recipe, and per food item** — and §5
requires that status be readable from the DB. On the recipe side there is nothing to read it from.

Proven absent:
`grep -rniE "import_job|bulk_import|import_batch|importJob|recipe_imports|import_item" --include="*.ts" --include="*.sql" packages/services`
→ **zero matches** (excluding `node_modules`/`dist`).
`grep -rn "import_id|importId|import_batch_id" …` → **zero matches**. No column anywhere links a recipe, an
ingredient, or a food to an import.

The schema barrel (`recipe-service/src/database/schema/index.ts:9-79`) lists the complete table set: `recipes`,
`recipe_steps`, `ingredients`, `recipe_ingredients`, `recipe_versions`, `recipe_version_pending_archives`,
`recipe_photos`, `recipe_ratings`, `author_handles`, `collections`, `recipe_collections`,
`account_erasure_jobs`. Migration head is `0018_erasure_audit_trigger_source.sql`.

004's plan (`specs/004-recipe-importing/plan.md`) proposes:

- `import_drafts` — full column table at `plan.md:111-128`. Per **draft**, one row per candidate recipe. Its
  `status` domain is `open`/`confirmed`/`expired` (`plan.md:116`) — a **staging lifecycle**, not ADR-0019 §4's
  `queued`/`processing`/`succeeded`/`failed`/`errored` **processing** lifecycle. Two different facts.
- `import_jobs` — **one sentence, no column table** (`plan.md:130-131`): "async job state for the fetch/OCR
  channels (`queued`/`running`/`succeeded`/`failed`), carrying `draft_id` on success and a `RecipeErrorCode`
  on failure, plus the `idempotency_key`." Note `running`, where ADR-0019 §4 says `processing`, and note the
  absence of `errored` — ADR-0019 distinguishes expected failure from unexpected fault and 004 does not.
- `paywalled_domains` — full table, unrelated to status.

So the per-**job** shape is under-specified and the per-**entity** shape does not exist at all. A `202`-style
job row cannot answer "recipe 417 of 1,000 failed because its ingredient lines could not be parsed", which is
what §4's supersession model and `confirm-bulk`'s `207 Multi-Status` body (`plan.md:~230`) both assume.

**Why it matters.** This is the genuinely new modelling work in ADR-0019, and it is the part with no
precedent to copy. Getting it wrong costs a migration on a table that will be the highest-write table in the
recipe DB (1,000 rows per import × transitions).

**Recommended model or fix.** Two tables, not three, and the per-entity one is where the design effort goes:

```sql
-- the import itself: one row per submitted file/URL/batch
CREATE TABLE import_jobs (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id         varchar(255) NOT NULL,          -- app-user ULID, no FK (D2)
    source_type      text NOT NULL,                  -- provenance, whitelisted server-side (ADR-0019 §2)
    import_channel   text NOT NULL,                  -- url | file | instagram | photo
    idempotency_key  text NOT NULL,
    status           text NOT NULL DEFAULT 'queued',
    entity_count     integer NOT NULL DEFAULT 0,     -- denormalized total, for a cheap progress read
    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT import_jobs_status_check
        CHECK (status IN ('queued','processing','succeeded','failed','errored'))
);
CREATE UNIQUE INDEX import_jobs_owner_idempotency_unique ON import_jobs (owner_id, idempotency_key);

-- the per-entity status ADR-0019 §4/§5 actually require
CREATE TABLE import_entities (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    import_job_id  uuid NOT NULL REFERENCES import_jobs(id) ON DELETE CASCADE,
    entity_kind    text NOT NULL,                    -- 'recipe' | 'food'
    ordinal        integer NOT NULL,                 -- position in the source file (stable, user-facing)
    -- resolved targets, both nullable until the entity lands:
    recipe_id      uuid REFERENCES recipes(id) ON DELETE SET NULL,
    ingredient_id  uuid REFERENCES ingredients(id) ON DELETE SET NULL,
    status         text NOT NULL DEFAULT 'queued',
    stage          text,                             -- the current stage carried by 'processing'
    error_code     text,                             -- a RecipeErrorCode on failed/errored
    sequence       bigint NOT NULL DEFAULT 0,        -- supersession key (ADR-0019 §4) — see F-DB7
    created_at     timestamptz NOT NULL DEFAULT now(),
    updated_at     timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT import_entities_status_check
        CHECK (status IN ('queued','processing','succeeded','failed','errored')),
    CONSTRAINT import_entities_kind_check CHECK (entity_kind IN ('recipe','food')),
    -- terminal-failure states carry a reason; success does not carry one
    CONSTRAINT import_entities_error_coherent CHECK (
        (status IN ('failed','errored')) = (error_code IS NOT NULL)
    )
);
CREATE UNIQUE INDEX import_entities_job_kind_ordinal_unique
    ON import_entities (import_job_id, entity_kind, ordinal);

-- THE index ADR-0019 §5 asks for: "current status of all entities in this import"
CREATE INDEX idx_import_entities_job_status ON import_entities (import_job_id, status);
-- the live-progress read ("what is still moving"), partial so it shrinks as the import completes
CREATE INDEX idx_import_entities_active
    ON import_entities (import_job_id) WHERE status IN ('queued','processing');
```

`(import_job_id, status)` is the index for the whole-import read; the partial is for the poll. Both are cheap.
`ON DELETE SET NULL` on `recipe_id` (not `CASCADE`) is deliberate: deleting an imported recipe must not erase
the record that the import produced it.

**Note the ownership boundary**: these tables live in the **recipe** service per ADR-0017 §"no new deployable".
No import table goes in the food DB — the food side's shell status is the `food` row itself, and the recipe
side's per-food entity row points at `ingredients`, not at `food`.

**Verified**: absence searches shown; `schema/index.ts:9-79`; migration directory listing (head `0018`);
`specs/004-recipe-importing/plan.md:111-131`.

---

## F-DB6 — Unresolved shells are published to every user's ingredient typeahead; a 1,000-recipe import pollutes the shared catalog for the whole platform

**Severity**: High
**File/Table**: `ingredients` — `ingredients.dal.ts:149-170`, `ingredients.service.ts:181-183`, `:214-245`

**Problem.** `ingredients` is explicitly a **shared, ownerless catalog** — "The `ingredients` table is a
**shared catalog** with no `owner_id` … so no ownership predicate is applied here" (`ingredients.dal.ts:17-18`).
`IngredientsDal.search` filters on **relevance only**:

```sql
-- ingredients.dal.ts:155-167
WHERE search_vector @@ plainto_tsquery('english', $1)
   OR $1 <% name
   OR name ILIKE $2
```

No predicate on `food_resolution_status`, none on `is_user_entered`. It backs both
`GET /api/v1/ingredients/search` (`ingredients.service.ts:181`) and the blended typeahead's local section
(`ingredients.service.ts:222-223`).

So the moment `addByName` writes a food-backed row at `PENDING` (`ingredients.service.ts:377-381`), that name
is a suggestion **for every user on the platform** — carrying no nutrition, possibly destined for `NOT_FOUND`
or `FAILED`, and possibly a typo or a private phrase from someone's recipe.

**Why it matters.** This is a live defect at today's one-ingredient-at-a-time volume. ADR-0019's bulk import
multiplies it by up to 1,000 recipes × N ingredient lines **per file**. A single user importing a messy export
seeds the global autocomplete with thousands of unresolvable strings, and the trigram/FTS ranking has no
signal to push them down. It is simultaneously a data-quality failure and an information leak from one user's
recipes into another user's suggestion list.

**Recommended model or fix.**

1. **Exclude terminal-failure rows from suggestion reads** — `food_resolution_status NOT IN ('NOT_FOUND','FAILED')`
   (a `NULL` status is a freeform row and stays eligible). Non-negotiable.
2. **Decide `PENDING`/`UNRESOLVED` deliberately** — see decision **D-5**. My recommendation: suppress them
   from _other users'_ suggestions and show them to the requesting owner, which needs a
   `first_requested_by varchar(255)` column on `ingredients` (a provenance stamp, not ownership — the catalog
   row stays shared). The alternative, suppressing them from everyone, is simpler and I would accept it if the
   owner does not want a new column.
3. Fold the predicate into the partial index of F-DB4 so the exclusion is free.

**Verified**: read of `ingredients.dal.ts:131-170` (full `search` body) and both call sites
(`ingredients.service.ts:181-183`, `:222-223`); `createFoodBacked` writes non-terminal statuses at
`ingredients.dal.ts:319-352` / `ingredients.service.ts:368-382`.

---

## F-DB7 — Recipe-side status transitions are unguarded and carry no sequence, so ADR-0019 §4's at-least-once, out-of-order delivery will silently revert `RESOLVED` to `PENDING`

**Severity**: High
**File/Table**: `ingredients` — `ingredients.dal.ts:363-385`

**Problem.** `updateResolution` is an unconditional UPDATE:

```sql
-- ingredients.dal.ts:372-382
UPDATE ingredients SET
    food_resolution_status = $1,
    calories_per_100g  = COALESCE($2, calories_per_100g),
    …
WHERE id = $6
```

No prior-status predicate. Contrast the food service, which does this correctly: `FoodDao.setStatus` gates on
a declared legal-prior set and rejects an illegal transition without mutating
(`food.dao.ts:182-188` for `LEGAL_PRIORS`, `:313-324` for the guarded UPDATE + `rowCount` check).

Today the only writers are the pull paths (`refreshStatus`, `addByFoodId`), which read-then-write within one
request, so reversion is rare. **ADR-0019 §4 changes that**: it introduces an at-least-once bus, states
outright that "Ordering is **not** assumed", and requires supersession "decided by a monotonic sequence
carried in the envelope, not by arrival order". There is no sequence column on `ingredients`, and no
sequence in any published contract — `grep -rn "sequence\|seq\b" packages/schemas/recipe/src/schemas/*.ts`
returns three unrelated prose matches (`search.schema.ts:61`, `api-error.schema.ts:102`,
`collections.schema.ts:183`) and nothing structural.

The ADR names the exact failure — "last-write-wins on arrival order silently reverts `succeeded` to
`processing` on a redelivery" — and the recipe schema is currently built to produce it.

**Why it matters.** A reverted status is worse than a missing one: the durable projection and the event stream
disagree, which is the one thing §5 exists to prevent. And a reverted `RESOLVED` also strands nutrition
(`updateResolution` COALESCEs nutrition, so the numbers survive while the status regresses — an incoherent row
that renders "pending" over real data).

**Recommended model or fix.**

```sql
ALTER TABLE ingredients ADD COLUMN resolution_sequence bigint NOT NULL DEFAULT 0;
```

and make every status write guarded and monotonic:

```sql
UPDATE ingredients SET
    food_resolution_status = $1,
    resolution_sequence    = $2,
    status_updated_at      = now(),
    …
WHERE id = $n AND resolution_sequence < $2
```

A stale redelivery matches no row (`rowCount = 0`) and is a **successful no-op**, which is exactly the
idempotency ADR-0019's closing "Required by this ADR" bullet demands. The sequence value comes from the
envelope, which per ADR-0014 is authored once as zod in the emitting service and generated into the schema
package — it is **not** two hand-written status shapes (see decision **D-4**).

Note this is a _different_ mechanism from `LEGAL_PRIORS`, and both are wanted: the sequence guard handles
delivery disorder, the legal-prior set handles semantic illegality. The food service has the second and needs
the first; the recipe service has neither.

**Verified**: read of `updateResolution` (`ingredients.dal.ts:363-385`) — no `WHERE` term beyond `id`;
`LEGAL_PRIORS` + guarded UPDATE at `food.dao.ts:182-188`, `:303-333`; sequence-absence search shown;
ADR-0019 lines 105-110 for the requirement.

---

## F-DB8 — No status history exists on either side; the one field that could explain a failure is cleared on the next retry

**Severity**: Medium
**File/Table**: `fetch_queue` (food), `ingredients` (recipe)

**Problem.** Neither status projection retains anything about how it got to its current state.

- Food side: `fetch_queue.last_error` exists (`operational.ts:41`) but is **cleared on every reactivation** —
  `UPDATE fetch_queue SET status='pending', attempts=0, leased_at=NULL, last_error=NULL, …`
  (`enqueue.emitter.ts:145-148`; same in `fetch-queue.dao.ts:122`). And the queue row is **deleted** when the
  food resolves or tombstones (`fetch-queue.dao.ts:7` — "`resolve`/`tombstone` remove the row"), so after the
  fact there is no record at all. `food.tombstoned_at` survives, but it is a timestamp with no reason.
- Recipe side: nothing. No `last_error`, no attempt count, no transition log.

**Why it matters.** ADR-0019 §4's supersession model is explicitly _lossy by design_ — "Messages for one entity
supersede prior messages" — and the ADR justifies that on boundedness. That is the right call for the **live
feed**. But it means the message stream is not a debugging record either, so if the durable projection also
keeps nothing, a failed 1,000-recipe import is unexplainable after the fact. "Recipe 417 failed" with no
reason and no history is a support ticket nobody can close.

**Recommended model or fix.** Do **not** build a transition-event table for its own sake (that is the
unbounded accumulation §4 rejects, moved into the DB). Instead put the minimum debuggable state on the
per-entity row itself:

- `error_code text` and `error_detail text` (already in the F-DB5 sketch — `error_code` with the coherence
  CHECK), holding the **latest terminal** reason.
- `attempts integer NOT NULL DEFAULT 0` on `import_entities`, incremented on each retry — the precedent is
  `account_erasure_jobs.attempts` / `last_error` (`account.ts:74-75`).
- `status_updated_at timestamptz` (F-DB4), so "how long has it been here" is answerable.

That is bounded (one row per entity, forever) and answers the three questions that actually get asked: what
state, since when, and why. Full transition history, if it is ever wanted, belongs in structured logs with the
`import_job_id` as the correlation key — not in Postgres.

**Verified**: `operational.ts:41`; `enqueue.emitter.ts:142-158`; `fetch-queue.dao.ts:1-10` header;
`account.ts:74-75`; recipe-side absence — the `ingredients` column list at `ingredients.ts:51-68` has no error
or attempt column.

---

## F-DB9 — A never-resolvable ingredient name is re-enqueued forever, and bulk import turns that into a queue-flooding loop

**Severity**: Medium (High under ADR-0019's bulk workload)
**File/Table**: `food` — `food.dao.ts:239-289`, `foods.service.ts:207-236`

**Problem.** `createByName` reactivates a terminal shell past its TTL:

```sql
-- food.dao.ts:254-266
ON CONFLICT (normalized_name) DO UPDATE SET
    status = CASE WHEN food.status IN ('NOT_FOUND','FAILED')
                   AND food.tombstoned_at < now() - <FOOD_NOT_FOUND_TTL_DAYS>
             THEN 'PENDING'::food_status ELSE food.status END, …
```

That is correct for a food the USDA might _later_ add. It is wrong for a name that will never be a food. The
dedup key is `normalizeName` = `trim → collapse whitespace → lowercase` (`merge/merge-engine.ts:130-132`) —
no accent folding, no singularization, no parsing. So `"grandma's secret sauce"`, `"a pinch of love"`,
`"1 cup flour"` (if the import passes an unparsed line) each become a permanent global shell that cycles
`PENDING → FAILED → (30d) → PENDING` every time anyone imports a recipe containing it. There is no
`consecutive_failures` counter and no permanent-failure state:
`food_status` is `PENDING | UNRESOLVED | RESOLVED | NOT_FOUND | FAILED` (`food.ts:44`) — `FAILED` is
explicitly _reactivatable_ (`LEGAL_PRIORS.PENDING = ['FAILED','NOT_FOUND']`, `food.dao.ts:183`).

**Why it matters.** At today's volume this is a slow drip. A 1,000-recipe import is a burst of thousands of
distinct names, a large fraction of which are user-authored prose rather than catalog foods. Each one burns a
`fetch_queue` slot against `FOOD_MAX_QUEUE_DEPTH`, a source-API call against the rolling-60-minute limiter
(`source_call_log`, `operational.ts:107-115`), and — via F-DB2 — risks committing a shell it then sheds.

Also note the display-name asymmetry: `createByName`'s `ON CONFLICT DO UPDATE` never touches `name`
(`food.dao.ts:254-266`), so the first writer's capitalization wins forever. Harmless, but worth knowing before
someone "fixes" it into a merge-winner and reopens FR-MRG-2.

**Recommended model or fix.**

1. Add `consecutive_failures integer NOT NULL DEFAULT 0` to `food`, incremented by `setStatus` on a terminal
   transition and reset on `RESOLVED`. Suppress reactivation above a threshold (a name that has failed N
   times against every source is not going to start resolving), while leaving admin `POST /:id/refetch`
   (`foods.controller.ts:138`) able to override — that route already requires `FOOD_ADMIN_SCOPE`.
2. **Parse before you enqueue.** The bulk import processor must send a normalized _ingredient name_, never a
   raw recipe line. This is a recipe-service responsibility and belongs in the extraction adapter contract,
   not in the food service. Get it wrong and every mitigation above is treating a symptom.

**Verified**: `food.dao.ts:239-289` (the upsert), `:182-188` (legal priors), `food.ts:44` (status domain),
`merge-engine.ts:130-132` (`normalizeName`), `operational.ts:107-115` (call ledger).

---

## F-DB10 — `recipe_versions.created_by` has no index; the handle fan-out and the GDPR erasure sweep both sequentially scan the largest table

**Severity**: Medium
**File/Table**: `recipe_versions` — `versions.ts:44-78`

**Problem.** The index set is exactly three:
`recipe_versions_recipe_version_unique (recipe_id, version_number)`, `idx_recipe_versions_recipe_id`,
`idx_recipe_versions_snapshot` (GIN) — `versions.ts:72-77`. Proven absent:
`grep -rn "created_by" migrations/*.sql | grep -i index` → **no output**.

But `created_by` is a query key in at least one shipped hot path:

```ts
// authors/dal/author-handles.dal.ts:94-102 — inside applyRename's transaction
await tx
    .update(recipeVersions)
    .set({ editorHandle: event.displayName })
    .where(and(eq(recipeVersions.createdBy, event.userId), sql`… IS DISTINCT FROM …`));
```

`recipe_versions` holds up to 10 rows per recipe plus a full JSONB snapshot each (`versions.ts:53`), making it
the largest table in the recipe DB by a wide margin. Every display-name change seq-scans it, inside a
transaction that also updates `recipes`.

`author_handles` is documented as the **fourth GDPR erasure root** (`author-handles.ts:18`), and
`recipe_ratings.user_id` carries an index explicitly _because_ "without this index that delete is a Seq Scan
of every rating in the system" (`ratings.ts:40-42`). The identical reasoning applies to
`recipe_versions.created_by` and was not applied.

**Recommended fix.** `CREATE INDEX CONCURRENTLY idx_recipe_versions_created_by ON recipe_versions (created_by);`
— `CONCURRENTLY` because this table is large and the build must not take a write lock. (`CONCURRENTLY` cannot
run inside a transaction block; the migration runner must be checked for that — see "Not examined".)

**Verified**: `versions.ts:72-77`; absence search shown; `author-handles.dal.ts:94-102`; `ratings.ts:40-42`
for the established precedent.

---

## F-DB11 — The handle fan-out's `UPDATE recipes` cannot use `idx_recipes_owner_id`, because that index is partial and the query is not

**Severity**: Medium
**File/Table**: `recipes` — `recipes.ts:169-171`, `authors/dal/author-handles.dal.ts:84-92`

**Problem.** The owner index is partial:

```ts
// recipes.ts:169-171
index('idx_recipes_owner_id').on(table.ownerId).where(sql`${table.deletedAt} IS NULL`),
```

(created plain in `0001`, redefined partial in `0002_soft_delete` — `recipes.ts:167-168`.) The fan-out
predicate is:

```ts
// author-handles.dal.ts:87-92
.where(and(eq(recipes.ownerId, event.userId), sql`${recipes.authorHandle} IS DISTINCT FROM …`))
```

`owner_id = $1` does not imply `deleted_at IS NULL`, so Postgres cannot prove the partial index covers the
query and will not use it. Result: a full scan of `recipes` on every rename, in the same transaction as
F-DB10's scan of `recipe_versions`.

**Why it matters.** Correctness is fine — a tombstoned recipe _should_ get the new handle, since it can be
restored. It is a cost defect that compounds with F-DB10 in one transaction, and it will not show up in tests.

**Recommended fix.** Cheapest and most honest: add `isNull(recipes.deletedAt)` to the fan-out predicate and
accept that a restored tombstone may carry a stale handle (it is refreshed on its next write, and the
`recipes.author_handle` column is documented as best-effort denormalization, `recipes.ts:126-129`). If stale
handles on restore are unacceptable, add a second plain index on `owner_id` — mirroring exactly what
`idx_erasure_jobs_owner_id` already does for the same reason (`account.ts:129-133`, whose comment spells out
this identical partial-index-miss). I prefer the predicate change: one fewer index on the hottest table.

**Verified**: `recipes.ts:167-171`; `author-handles.dal.ts:84-92`; `account.ts:129-133` for the precedent.

---

## F-DB12 — Two `recipes` indexes no longer match the shipped read predicate: one has a stale partial condition, the other is unusable

**Severity**: Medium
**File/Table**: `recipes` — `recipes.ts:172`, `:177-179`

**Problem.** The authoritative read predicate is composed in one place:

```ts
// recipes/dal/recipe-predicates.ts:59-61
and(activeRecipe(), viewableBy(viewerId), publishedOrOwnedBy(viewerId));
// = deleted_at IS NULL
//   AND (visibility = 'public' OR owner_id = $1)
//   AND (status = 'published' OR owner_id = $1)
```

Against that:

- **`idx_recipes_public_recent`** — `ON (visibility, created_at DESC) WHERE visibility = 'public'`
  (`recipes.ts:177-179`). Its predicate was written in `0001`, **before** `deleted_at` (`0002_soft_delete`)
  and **before** `status` (`0013_recipe_draft_status`). It therefore indexes tombstoned rows and unpublished
  drafts, both of which every read then discards on a heap recheck. The two filters it omits are exactly the
  two whose row counts grow monotonically.
- **`idx_recipes_visibility`** — a plain btree on a 2-value column (`recipes.ts:172`). At any realistic
  distribution the planner will not choose it; it is write amplification on the hottest table with no read to
  justify it. It is fully subsumed by `idx_recipes_public_recent`.

**Recommended fix.**

```sql
DROP INDEX idx_recipes_visibility;
DROP INDEX idx_recipes_public_recent;
CREATE INDEX CONCURRENTLY idx_recipes_public_recent
    ON recipes (created_at DESC)
    WHERE visibility = 'public' AND status = 'published' AND deleted_at IS NULL;
```

`visibility` leaves the key columns (it is constant within the partial index, so it was dead key bytes).

**⚠ Confidence caveat, stated plainly**: I could **not** run `EXPLAIN (ANALYZE, BUFFERS)` — the task forbids
connecting to the live DB, and the shape claim above is derived from the index definition versus the shipped
predicate, not from a measured plan. **Before merging this change, capture a plan** for the public-feed read
on a representative dataset, both before and after. The `DROP` half in particular should not ship on
reasoning alone. `packages/services/recipe-service/tests/` already contains an access-path integration test
pattern for exactly this (the food service's `food-search-access-path.integration.test.ts`, referenced at
`food.ts:126`) — copy it.

**Verified**: `recipes.ts:166-180` (index list); `recipe-predicates.ts:22-61` (the predicate);
`0002_soft_delete.sql` and `0013_recipe_draft_status.sql:18` for the two columns added after the index.

---

## F-DB13 — `recipe_ingredients` denormalizes `is_user_entered` with nothing keeping it in sync, and its four nutrition columns accept negatives

**Severity**: Low–Medium
**File/Table**: `recipe_ingredients` — `ingredients.ts:97-127`, `0001_initial.sql:89-105`

**Problem — two independent issues.**

_Unsynchronized denormalization._ `recipe_ingredients.is_user_entered` (`ingredients.ts:114`) duplicates
`ingredients.is_user_entered` (`ingredients.ts:57`). There is no trigger, no FK-with-included-column, and no
CHECK relating them — the only trigger in this schema is the ratings aggregate
(`0010_ratings_difficulty_cover.sql`, documented at `ratings.ts:11-14`). So the two can disagree, and no read
would notice. Unlike `ingredient_name` (a genuine point-in-time display snapshot, `ingredients.ts:113`),
`is_user_entered` is not a snapshot of anything — it is a copy of a fact that lives elsewhere, which is a DRY
violation on _knowledge_.

_Missing non-negativity constraints._ `user_calories`, `user_protein_g`, `user_carbs_g`, `user_fat_g`
(`ingredients.ts:117-120`, `0001_initial.sql:100-103`) have no CHECK. The only constraint on the table is
`recipe_ingredients_quantity_positive` (`0001_initial.sql:104`). The food service constrains the same class of
value — `food_nutrients_amount_nonneg` with the comment "rejects a sign/parse error before it corrupts the
record" (`food.ts:227`, and `food_portions_gram_weight_pos` at `:262`). The recipe service does not, so a
negative user-supplied calorie value flows straight into `recipes.lead_calories_per_serving`
(`recipes.ts:124`) and the per-serving nutrition aggregate.

**Why it matters for ADR-0019.** Bulk import is the first path that writes these columns **without a human
looking at the form**. Whatever validation currently lives in the API layer is the only thing standing between
an extracted-from-a-web-page number and the aggregate — and ADR-0019 §"Required by this ADR" plus ADR-0015
both say the boundary parse is mandatory precisely because the input is hostile. A DB-level CHECK is the
backstop for the case where an extraction adapter is added and its zod is not.

**Recommended fix.**

```sql
ALTER TABLE recipe_ingredients
    ADD CONSTRAINT recipe_ingredients_user_nutrition_nonneg CHECK (
        (user_calories  IS NULL OR user_calories  >= 0) AND
        (user_protein_g IS NULL OR user_protein_g >= 0) AND
        (user_carbs_g   IS NULL OR user_carbs_g   >= 0) AND
        (user_fat_g     IS NULL OR user_fat_g     >= 0)
    );
```

(preceded by a violation count; add `NOT VALID` then `VALIDATE`.) For the denormalization: either drop
`recipe_ingredients.is_user_entered` and read it through the `ingredient_id` join, or document it as a
deliberate point-in-time snapshot the way `ingredient_name` is. Do not leave it undeclared.

**Verified**: `ingredients.ts:97-127`; `0001_initial.sql:89-105`; constraint inventory search (F-DB3);
`food.ts:227`, `:262` for the food service's equivalent.

---

## F-DB14 — 28 of 29 foreign keys the 007 / 009 documents assert do not exist, and ~15 of them cross a database boundary and can never exist

**Severity**: High (spec defect blocking implementation of both features)
**File/Table**: 007 grocery lists, 009 nutrition planning — spec/plan/research documents vs the shipped
recipe, food and identity schemas

**Problem.** Both features' documents describe their data model as SQL DDL with inline `REFERENCES` clauses.
Almost none of it is buildable.

_Ownership._ ADR-0017 assigns both to **`@kitchensink/recipe-service`** / `@kitchensink/schema-recipe`
(`0017:55-56`), rejecting the `packages/services/grocery-service/…` and `packages/services/nutrition-service/…`
layouts the specs assume (`0017:24-25`). Neither feature has a `data-model.md`; the model lives in `plan.md`
§2, `research/research.md`, and `v-model/*`.

_Nothing is built._ No 007 or 009 table exists in any schema. Proven with one command over all three shipped
databases' Drizzle schemas **and** hand-authored migrations:

```
$ grep -rniE "grocery_list|user_pantry_items|grocery_product_map|nutrition_plan|nutrition_compliance|trainer_client|meal_plan|meal_slot" \
    packages/services/recipe-service/src/database/ packages/services/food-service/src/db/ \
    packages/shared/identity-db/src/ packages/services/identity/src/
EXIT=1   # no output
```

_The three databases are three databases._ `DataStack` creates `kitchensink_identity`, `kitchensink_food` and
`kitchensink_recipes` as separate **logical databases** on one shared RDS instance
(`packages/infra/global/lib/platform/data-stack.ts:116`, `:122`, `:127`). Postgres has no cross-database
references, so sharing an instance changes nothing: a FK across these is impossible, full stop.

**Of 29 FK/relationship assertions, exactly one exists.** The three classes of impossible claim:

**(A) FKs to `users(id)` — identity's database.** `007/plan.md:48`, `007/research/research.md:529`,
`009/plan.md:45,46,91,92`, `009/research.md:384,386,430,431`. The recipe service has **decided, shipped and
test-asserted** the opposite: no local `users` table, identity carried as an un-FK'd `varchar(255)` app-user
ULID (`schema/index.ts:5-7`, `recipes.ts:75`, `collections.ts:55`, `ratings.ts:29`, `account.ts:72`), with
`src/database/__tests__/schema.test.ts:76-91` asserting the barrel exports no `users` table and that
`owner_id` is `varchar(255)`. **006's spec already caught this exact defect for itself** — `specs/006-meal-planning/spec.md:47-49`:
_"The pre-reconciliation draft specified `REFERENCES users(id)` and `REFERENCES recipes(id)`; both are
unenforceable here."_ 007 and 009 never received that correction.

**(B) FKs to a food entity — the food database.** `007/plan.md:61` (`usda_fdc_id INT REFERENCES foods(fdc_id)`,
indexed at `:417`, restated as a storage assertion at `007/spec.md:186`), `007/research/research.md:515,542`.
Wrong four ways: the table is `food` not `foods` (`food-service/src/db/schema/food.ts:84`); its PK is
`id text` — a ULID, not an int (`:87`); **there is no `fdc_id` column at all**
(`grep -rn "fdc" food-service/src/db/schema/*.ts` → `food.ts:7` and `:142`, both doc comments); and it is a
different database. The correct pattern is one comment away in the same service —
`recipe-service/src/database/schema/ingredients.ts:53-55`: _"Opaque reference to the food service (003)
golden record by its internal ULID. **NEVER a USDA fdcId; not a cross-DB FK.**"_ The two 007 documents also
disagree with each other on the type (`INT` in `plan.md`, `UUID` in `research.md`).

**(C) FKs to `meal_plans(id)` — and this class became impossible _two days ago_.** `007/plan.md:49,479`,
`007/research/research.md:530`, `009/plan.md:67`, `009/research.md:423`. **ADR-0017's Amendment (2026-08-14),
`0017:223-262`, extracts 006 into `@kitchensink/meal-plan-service` — a new deployable with its own database**
(007, 009 and 010 explicitly unchanged, `0017:229-234`). These FKs were intra-DB and legal when ADR-0017 was
accepted on 2026-08-12; the amendment made them cross-service.

Both features are now **internally contradictory** about it: `007/v-model/module-design.md:945-966` already
fetches meal plans over HTTP via `MEAL_PLAN_SERVICE_URL`, and `009/v-model/module-design.md:911,950` via
`MEAL_PLANNING_BASE_URL`, while their `plan.md` files still assert a foreign key to the same data.
`007/tasks.md:427` still justifies co-location with _"one database, so `meal_plan_entries → recipes` stays a
foreign key instead of a network hop"_ — falsified. And `009/spec.md:90-92` still carries the
"two halves of one calculation, splitting them puts a transaction boundary through the middle of a single
user-visible number" argument, inherited verbatim from `0017:93-95` — **the split it warns against has now
happened**, so 009's stated design premise is false and its compliance-rollup design needs re-deciding, not
just re-wording.

**Legal once built** (intra-recipe-DB): `grocery_list_items → grocery_lists ON DELETE CASCADE`
(`007/plan.md:60`), `meal_plan_nutrition_link → nutrition_plans` (`009/plan.md:68`),
`nutrition_compliance → nutrition_plans` (`009/plan.md:75`).

**Already exists** (the one true claim): `recipe_ingredients.recipe_id → recipes.id ON DELETE CASCADE`
(`007/research/research.md:514`) — real at `ingredients.ts:103-104` / `0001_initial.sql:92`. Note the same
research block at `:515` invents a `recipe_ingredients.food_id UUID REFERENCES foods(id)` column; the shipped
`recipe_ingredients` has **no `food_id` column** at all (`ingredients.ts:97-125`) — `food_id` lives on
`ingredients` as un-FK'd `text` (`ingredients.ts:55`).

**Also: table names drift inside each feature's own documents.** 009 names its link table three ways
(`meal_plan_nutrition_link` in `plan.md:67`, `nutrition_plan_meal_plans` in `research.md:422`,
`meal_plan_links` in `v-model/architecture-design.md:30`) and its consent table two
(`trainer_clients` `plan.md:91` vs `trainer_client_consents` `v-model/architecture-design.md:35`). 007 names
`grocery_product_map` at `plan.md:412` with no DDL body at all. And `009/plan.md` disagrees with
`009/research.md` on column names for the same table (`user_id`/`trainer_id` vs `owner_id`/`created_by_id`).

**Why it matters.** These are not cosmetic. `007/tasks.md:97-100` and `009/tasks.md:55-58` make "tables
created with correct FKs" a migration acceptance criterion and declare a dependency on a 006 migration that
is now in another service's database. An implementer following the plan writes a migration that **fails at
deploy** — or, worse, quietly drops the constraint and ships an unenforced reference with nothing
reconciling it.

**Recommended model or fix** (this is a spec-correction task before any code, and it is `staff-architect` +
`be-1` work, not a schema change):

1. **Rewrite every class-A/B/C `REFERENCES` as an opaque un-FK'd identifier**, matching the shipped pattern:
   user → `varchar(255)` app-user ULID, no FK; food → `text` opaque food-service ULID, no FK; meal plan →
   `uuid`/`text` opaque meal-plan-service id, no FK. Copy 006's correction wording verbatim
   (`006/spec.md:47-49`) so all three features say the same thing the same way.
2. **For each de-FK'd reference, name what replaces referential integrity.** A FK is not just a constraint,
   it is a deletion policy — `ON DELETE CASCADE`/`SET NULL` was doing real work in these plans. Removing the
   FK without naming the reconciliation (an erasure fan-out, a periodic orphan sweep, a tolerated dangling
   read) silently deletes the guarantee. The food side has **no** such mechanism today (F-DB2, F-DB9); do not
   assume one exists.
3. **Reconcile 009's premise with the amendment.** `009/spec.md:90-92`'s co-location argument is dead. The
   compliance rollup now spans two services; decide deliberately whether it reads meal plans over HTTP,
   consumes a projection, or the number's definition changes — and record it.
4. **Converge each feature's table names to one spelling** before a migration is written, and give both
   features a real `data-model.md` rather than three partially-disagreeing DDL blocks.

**Verified**: `0017:24-25`, `:55-56`, `:93-95`, `:223-262` (amendment, read in full);
`data-stack.ts:116,122,127`; `schema.test.ts:76-91`; `ingredients.ts:53-55`, `:97-125`;
`food.ts:84,87` + `fdc` search; `007/plan.md:44-62`; the absence search shown above. The per-claim sweep of
all 29 assertions was performed by a delegated read-only search over `specs/007-grocery-lists/**` and
`specs/009-nutrition-planning/**`; the structural facts it rests on (ownership, DB separation, no-users-table,
food PK shape, the ADR-0017 amendment, `007/plan.md`'s DDL block) were re-verified directly here.

---

## F-DB15 — `food_status_idx` is the wrong shape for any shell sweep or shell-status scan

**Severity**: Low–Medium
**File/Table**: `food` — `food.ts:111`, `0000_food_schema.sql:181`

**Problem.** `CREATE INDEX "food_status_idx" ON "food" USING btree ("status")` — a plain btree on a
five-value enum over what will be the largest table in the food DB (the bulk USDA seed alone is ~8k+ golden
records per the Stage-1 note at `ingredients.service.ts:190`). Low-cardinality btrees are rarely chosen by the
planner, and every query that would actually want this index also has a time bound:

- F-DB2's orphan-shell sweep: `status='PENDING' AND created_at < now() - …`
- ADR-0019's "which shells are still processing": `status IN ('PENDING','UNRESOLVED')`
- the existing TTL reactivation logic: `status IN ('NOT_FOUND','FAILED') AND tombstoned_at < …`
  (`food.dao.ts:256-266`)

None of them is served well by `(status)` alone.

**Recommended fix.** Replace with two partial indexes matching the actual predicates:

```sql
CREATE INDEX CONCURRENTLY food_pending_created_idx ON food (created_at)
    WHERE status IN ('PENDING','UNRESOLVED');
CREATE INDEX CONCURRENTLY food_terminal_tombstoned_idx ON food (tombstoned_at)
    WHERE status IN ('NOT_FOUND','FAILED');
DROP INDEX food_status_idx;
```

Both stay small: in a healthy catalog almost every row is `RESOLVED` and appears in neither.

**Same caveat as F-DB12**: no plan was captured. Validate with `EXPLAIN (ANALYZE, BUFFERS)` on a
representative dataset before dropping `food_status_idx`.

**Verified**: `food.ts:109-130`; `0000_food_schema.sql:181-184`; the three predicates cited.

---

## F-DB16 — The food contract has a batch WRITE but no batch STATUS READ, which is the pressure that will break the single-writer rule

**Severity**: Medium (design risk, not a defect)
**File/Table**: `@kitchensink/schema-food` / `FoodClient`

**Problem.** The client surface is: `addByName`, `batch`, `getById`, `getStatus`, `getCandidates`, `search`,
`resolve` (`packages/clients/food-service/src/client.ts:153-273`). `batch` adds up to `FOOD_MAX_BATCH_NAMES`
names in one call (`:167`), but **status is readable only one id at a time** (`getStatus`, `:222`). There is
no `POST /api/v1/foods/status` taking an id array.

So a bulk import that creates 4,000 shells has a one-call write path and a 4,000-call read path.

**Why it matters.** This is the concrete mechanism by which F-DB1's single-writer rule gets broken: faced with
4,000 round-trips, the tempting fix is to read the food DB directly. It is also why ADR-0019 §5's recipe-side
projection is not merely a nicety — it is the _only_ efficient way to answer "status of everything in this
import", which is why F-DB4's index is load-bearing rather than an optimization.

**Recommended fix.** Two things, in this order:

1. **The recipe-side projection is the primary read.** `ingredients.food_resolution_status` + the F-DB4 index
   answers the whole-import status query with one local query and zero cross-service calls. This is what
   ADR-0019 §5 is _for_; make it explicit in the plan so nobody reaches across.
2. **Add a batch status read to the food contract anyway**, for reconciliation — a periodic re-read that
   repairs a projection that drifted because a status message was lost. Authored as zod in the food service
   per ADR-0014, generated into `@kitchensink/schema-food`; cap it at the same
   `FOOD_MAX_BATCH_NAMES` and note (as `boundedNames` already does, `foods.controller.ts:270-279`) that the
   cap is runtime configuration and stays out of the published schema.

**Verified**: `packages/clients/food-service/src/client.ts:153-273` (full public method list);
`foods.controller.ts:88-181` (full route list — no batch status route).

---

# Decisions ce-plan must make

Each has my recommendation and the condition under which I would flip it.

### D-1 — Does the shell entry stay the **existing** `food` PENDING row, or does ADR-0019 introduce a new table?

**Recommendation: reuse the existing `food` row.** It already carries the exact five-state lifecycle
(`food.ts:44`), a guarded transition set (`food.dao.ts:182-188`), a tombstone TTL, a global dedup key, and a
disambiguation side-table (`food_candidates`). A parallel "shell" table would be a second representation of
food identity — the worst possible duplication in this schema, and it would reopen the recipe-as-food
prohibition by creating a food-adjacent table whose ownership is ambiguous.
**Flip if**: a shell needs attributes a real food must never have (e.g. a requesting-import id). Even then,
prefer a _side table keyed by `food.id`_ over a rival entity.

### D-2 — Where does per-entity import status live: on `recipes`/`ingredients`, or in its own `import_entities` table?

**Recommendation: its own table (F-DB5).** Three reasons. (a) A failed entity has **no** `recipes` row to hang
status on — that is exactly the case ADR-0019 §4 must report, and a column on `recipes` cannot represent it.
(b) Import status is transient and high-write; `recipes` is the hottest read table and does not want the
write amplification or the index. (c) Status must survive the entity: "recipe 417 failed" has to remain
readable after the user deletes recipe 417.
**Flip if**: the owner rules that per-entity status is ephemeral and lives only in the message stream — which
contradicts ADR-0019 §5 and would need an ADR amendment, not a plan decision.

### D-3 — Is the per-food import entity row keyed to `ingredients.id` or to the opaque `food_id`?

**Recommendation: `ingredients.id`, with a real FK (`ON DELETE SET NULL`).** `food_id` is opaque and lives in
another database; a FK is impossible (`ingredients.ts:5-7`) and an unenforced text reference is a dangling
pointer waiting to happen. The `ingredients` row is the recipe service's own projection of the shell, it is
already uniquely keyed on `food_id` (`ingredients.ts:77-79`), and it is where the status the client renders
actually lives.
**Flip if**: the import must record a food it never admitted into the catalog. I do not think that case
exists — `addByName` creates the `ingredients` row unconditionally (`ingredients.service.ts:368-382`).

### D-4 — Is the status envelope ONE contract shared by both emitting services, or one per service?

**Recommendation: one contract, and the tie-break is not obvious.** ADR-0019's "Required by this ADR" is
explicit: "The status envelope, its stage vocabulary, and its supersession key are **one contract**". But
ADR-0018 just ruled the _opposite_ way for webhook dedup — one table per sender — on the grounds that the two
tables change for different reasons (`0018:36-42`). The distinction that reconciles them: ADR-0018 is about
**durable storage of different subjects**; ADR-0019 is about **one wire envelope carrying a discriminated
payload**. A recipe's status and a food's status genuinely _are_ the same fact ("entity X in import Y is now
Z"), differing only in the payload — a discriminated union on `entityKind`, which is Visitor intent already
satisfied by TS.
**Concretely**: author the envelope once in the **recipe** service (it owns the import spine per §1),
generate into `@kitchensink/schema-recipe`, and have the food service _consume_ it for its per-food emissions.
**Flip if**: the food service must emit status for work that has no import — refresh-scan, admin refetch — in
which case it needs its own envelope and the shared one covers only the import-scoped case. **This is likely,
and ce-plan should check it before committing.**

### D-5 — Are `PENDING` / `UNRESOLVED` shells visible in the ingredient typeahead, and to whom?

**Recommendation: terminal-failure rows excluded from everyone (non-negotiable); non-terminal rows visible
only to the user who requested them**, via a new `ingredients.first_requested_by varchar(255)` provenance
stamp. Otherwise one user's 1,000-recipe import degrades every other user's autocomplete (F-DB6).
**Flip if**: the owner does not want a new column on the shared catalog — then suppress non-terminal rows from
_all_ suggestion reads. Slightly worse UX for the importing user; still far better than today.

### D-6 — Guarded-transition mechanism on the recipe side: legal-prior set, monotonic sequence, or both?

**Recommendation: both, and they are not redundant.** The sequence guard
(`WHERE resolution_sequence < $n`) handles **delivery disorder** — ADR-0019 §4's stated requirement. A legal-
prior set handles **semantic illegality** (`RESOLVED → PENDING` should be impossible regardless of sequence).
The food service has the second and lacks the first (`food.dao.ts:182-188`); the recipe service has neither
(F-DB7). Implement the sequence guard first — it is what the ADR mandates — and mirror `LEGAL_PRIORS` second.
**Flip if**: the bus guarantees per-entity FIFO ordering. It does not — ADR-0019 line 108 says so outright.

### D-7 — What sweeps a shell that never resolves, and after how long?

**Recommendation: a food-worker periodic sweep transitioning stalled `PENDING` shells to `FAILED` through
`FoodDao.setStatus`** (so the tombstone and the status emission both happen), with the stall interval as a
validated env setting alongside `FOOD_NOT_FOUND_TTL_DAYS` — using the same `settingFromEnv` reader the other
knobs use (`food.dao.ts:209`), never a SQL literal (the comment at `food.dao.ts:166-174` records what happened
last time a knob was baked into statement text). Pair it with the F-DB15 index and F-DB9's
`consecutive_failures` cap.
**Flip if**: F-DB2 is fixed at the source (admit-before-create, one transaction) **and** the worker is proven
to always reach a terminal state — then the sweep is a belt-and-braces backstop rather than the primary
mechanism, and its interval can be much longer.

### D-8 — Does `import_entities` carry a full transition history?

**Recommendation: no.** Current status + `error_code` + `attempts` + `status_updated_at` on the row (F-DB8);
full history to structured logs keyed by `import_job_id`. An unbounded per-entity event table is the
accumulation ADR-0019 §4 rejects, relocated into Postgres, and at 1,000 entities × N transitions per import it
would quickly dominate the recipe DB's write volume.
**Flip if**: a compliance or support requirement demands a durable audit of every transition — in which case
it is an append-only table with an explicit retention policy (the precedent is ADR-0016's retention model),
not an unbounded log.

### D-9 — Retention: when are `import_jobs` / `import_entities` rows deleted?

**Recommendation: decide it now, in the same migration that creates the tables.** At 1,000 entities per
import this is the fastest-growing table in the recipe DB and it has **no** natural deletion trigger — the
`recipes` cascade does not remove it (`ON DELETE SET NULL` per F-DB5, deliberately). Suggested: retain
terminal jobs 90 days, then delete job + cascade entities; index `(status, created_at)` to support the sweep.
It must also be an **account-erasure root** — `owner_id` is user data, and the recipe service already has four
such roots (`recipes`, `collections`, `recipe_ratings.user_id`, `author_handles` — `author-handles.ts:18`).
Adding a fifth without wiring it into the erasure worker is a GDPR gap.
**Flip if**: the owner wants permanent import history — then partition by month rather than delete, and say so
before the table exists, because retrofitting partitioning is a rewrite.

### D-10 — Does the 006 extraction change where ADR-0019's import spine, or 007/009's tables, land?

**Recommendation: no for the spine, yes for the 007/009 documents.** ADR-0017's Amendment (2026-08-14,
`0017:223-262`) moves 006 to `@kitchensink/meal-plan-service` with its own database, and cites **ADR-0019
itself** as reason #1 — the recipe service's scope grew, so "one more module" is a different proposition now
(`0017:246-251`). The amendment explicitly leaves 007, 009 and 010 where they are (`0017:229-234`), and the
import spine is unambiguously recipe-service work under ADR-0019 §1. But the amendment silently invalidates a
whole class of 007/009 FK (F-DB14 class C) and falsifies 009's stated design premise, and neither document has
been updated.
**Concretely for ce-plan**: the import spine is unaffected; **do not** let 007/009 be planned off their
current documents until F-DB14 is resolved. Watch for the second-order effect the amendment did not
discuss — the recipe service is accumulating import, grocery and nutrition alongside recipe CRUD and search,
which is precisely the growth the amendment used to justify moving 006 out.
**Flip if**: the owner extends the extraction to 007/009 as well. That would be a _different_ ADR, and it
would make the F-DB14 class-C rewrite mandatory rather than merely correct.

---

# Not examined

Stated explicitly so nobody reads absence as clearance.

- **No database was connected to, and no query plan was captured.** Every index recommendation (F-DB4, F-DB10,
  F-DB11, F-DB12, F-DB15) is reasoned from the index definition versus the shipped predicate. **The two
  `DROP INDEX` recommendations (F-DB12, F-DB15) must not ship without a before/after
  `EXPLAIN (ANALYZE, BUFFERS)` on representative data.** No `pg_stat_statements`, no `pgbench`, no table or
  index size figures — so "largest table" claims (F-DB10, F-DB15) are structural inferences, not measurements.
- **The identity service schema** (`packages/services/identity/src/database/`) — not read. ADR-0018's
  `webhook_events` / `stripe_webhook_events` and `packages/shared/identity-db/` were not audited; the F-DB14
  identity-side claims rest on ADR text, not on that schema.
- **`recipe-workers`** (`packages/services/recipe-workers/src/`) — only `archive-sweeper.ts` was glanced at
  for the outbox pattern. Its handlers issue raw SQL with no Drizzle schema
  (`archive-sweeper.ts:31`), so there may be query patterns whose index needs I did not check.
- **Migration-runner mechanics.** I did not verify whether the in-VPC runner executes each migration inside a
  transaction. `CREATE INDEX CONCURRENTLY` cannot run in one, so every `CONCURRENTLY` recommendation above is
  conditional on that check (`food-service/src/lambdas/migrate/handler.ts` and the recipe equivalent).
- **Drizzle-vs-SQL parity** was spot-checked (`ingredients`, `recipes`, `food`, `fetch_requesters` rekey) but
  not exhaustively diffed table by table. The schema files assert the SQL is authoritative
  (`recipes.ts:4-5`, `food.ts:9-11`); a full parity audit is a separate task.
- **`recipe_version_pending_archives`, `recipe_photos`, `collections`, `recipe_collections`,
  `author_handles`** were read for defects but **not** analyzed against 004/011 requirements — 011's photo
  branch will touch `recipe_photos`, and the "no persistent state" rule for the image service
  (ADR-0019 §3) was not verified against any proposed schema, because none exists yet.
- **011's Family Circles half** (ADR-0019 §3's warning box) — a separate deployable with its own tables. Not
  examined at all; it needs its own data-model review.
- **Feature 006 (meal planning)** — not examined. It is now its own deployable with its own database
  (ADR-0017 amendment, `0017:223-262`) and has no shipped schema, so a 006 data-model review — plus a
  combined 006/007/009 pass covering the now-cross-service joins — is a separate task and a prerequisite to
  building any of the three.
- **The 007/009 per-claim spec sweep was delegated**, not performed line-by-line here. Its structural
  foundations were re-verified directly (see F-DB14 "Verified"), but I did not personally open every one of
  the ~14 spec/research/v-model files it cites. Treat the individual line numbers in F-DB14's tables as
  second-hand and re-check before acting on any single one.
- **Test fixtures and seed data** (`database/seed.ts`, `__fixtures__/`) — not audited for the constraint
  violations F-DB3 and F-DB13 would newly reject. Adding those constraints may break seeds.
- **Live data.** No counts were taken of rows violating the proposed constraints (F-DB3, F-DB13). Those counts
  are a **prerequisite** to writing either migration, and taking them requires a read-only connection, which
  this review was scoped not to make.

---

**Confidence**: High on everything verified from source (F-DB1–F-DB11, F-DB13, F-DB16 — all cite exact
file:line and every absence claim shows its search). High on F-DB14's structural conclusions (ownership, DB
separation, no-users-table, food PK shape, the ADR-0017 amendment) which were re-verified directly; medium on
its individual per-claim line numbers, which are second-hand. **Medium** on F-DB12 and F-DB15, which are
index-shape judgements made without a query plan, and which say so in place.

**Sources inspected**: `docs/architecture/decisions/0019-recipe-import-spine.md` (full),
`0017` (§ownership table, flip conditions, and the 2026-08-14 amendment in full), `0018` (context/decision);
`packages/services/recipe-service/src/database/schema/*.ts` (all 9 files) and `migrations/*.sql`
(0001, 0002, 0006, 0009, 0013 — headers/relevant blocks) and `__tests__/schema.test.ts:74-92`;
`packages/services/food-service/src/db/schema/*.ts` (all 4) and `migrations/0000`, `0002`, `0003`, `0004`;
`recipe-service/src/ingredients/{ingredients.service.ts, dal/ingredients.dal.ts, ingredients.controller.ts}`;
`recipe-service/src/recipes/dal/recipe-predicates.ts`; `recipe-service/src/authors/dal/author-handles.dal.ts`;
`food-service/src/foods/{foods.controller.ts, foods.service.ts, admission.service.ts, enqueue.emitter.ts,
user-erasure.service.ts, dao/food.dao.ts, dao/fetch-queue.dao.ts, merge/merge-engine.ts}`;
`packages/clients/food-service/src/client.ts`; `packages/schemas/food/src/schemas/foods.schema.ts`;
`packages/infra/global/lib/platform/data-stack.ts:114-128`;
`specs/004-recipe-importing/plan.md` §2–§3; `specs/007-grocery-lists/plan.md` §2 and (delegated)
`specs/00{7,9}/**` FK claims.

**Recommended follow-on agents**: `be-1` for the constraint/index migrations (F-DB3, F-DB4, F-DB10, F-DB13)
and the admit-before-create refactor (F-DB2); `staff-architect` for the F-DB14 spec correction and decisions
D-2/D-4/D-10; `per-1` to capture the query plans F-DB12 and F-DB15 depend on; `sre-1` for the connection-grant
enforcement of the single-writer rule (F-DB1 W1); `dpo-1` for D-9's erasure-root wiring.
