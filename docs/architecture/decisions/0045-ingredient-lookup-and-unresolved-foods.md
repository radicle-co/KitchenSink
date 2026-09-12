# 0045 — An ingredient line binds to a lookup, and a lookup is exactly one of a food, a variant or an unresolved food

- **Status**: Accepted

## Context

The owner stated the model in one sentence:

> Recipe has one or more ingredients. An ingredient has either a food or an unresolved_food.

The schema did not say that, and could not. Two tables carried the weight — `recipe_ingredients` (the
line) and a shared `ingredients` catalog — and between them they made three illegal states
representable:

1. **A binding to nothing.** `ingredients.food_id` is nullable, so a catalog row could reference no food
   at all. What that row MEANT was carried by a separate `is_user_entered` boolean, which nothing tied to
   the null.
2. **A resolved row with nothing to resolve to.** `food_resolution_status` could read `RESOLVED` beside a
   NULL `food_id` — a claim that a lookup succeeded, on a row holding no result. Nothing refused it.
3. **A name that disagreed with the thing it named.** `recipe_ingredients.ingredient_name` and
   `recipe_ingredients.is_user_entered` were denormalized copies of facts owned one table over, written by
   a different statement, with no constraint keeping the two in step.

Underneath all three sat a fourth problem, and it is the one that made this urgent: **the cascade's reason
was computed and then thrown away.** `IngredientsService` runs the resolution cascade, and when the
outcome is not `resolved` it returns `undefined` — discarding which tiers were consulted, which were
unavailable, whether several candidates tied, and whether the cook simply named a substance we were never
going to find. Every unresolved ingredient was therefore indistinguishable from every other, and no
retry, no operator view and no "we now know what this is" backfill could be built on a fact nobody kept.

`food_resolution_status` was the only place that could have held a reason, and migration 0023 had already
established that it must not: it is a SHARED, ownerless row deduped one per `food_id`, so a verdict
written there withdraws nutrition from every recipe in the system that references the same food.

## Decision

Three tables, and the sentence becomes the schema.

```
recipes 1 ── 1..* ingredients ──NOT NULL──> food_lookups ──> a root food   (opaque food_id text)
                                                         ──> a variant     (opaque food_variant_id text)
                                                         ──> unresolved_foods
                                            exactly one of the three
```

- **`ingredients` IS THE RECIPE LINE.** It replaces `recipe_ingredients`, carrying every one of its
  columns except `ingredient_name` and `is_user_entered`. It gains
  `food_lookup_id uuid NOT NULL REFERENCES food_lookups(id) ON DELETE RESTRICT`.
- **`food_lookups` IS THE BINDING.** It replaces the old shared catalog minus its `name`, and holds
  `food_id` and `food_variant_id` (opaque, may dangle), `unresolved_food_id`, `food_owner_id` and
  `created_at`. `food_owner_id` belongs to the root arm only (`food_lookups_owner_needs_a_root`), because only
  a root food can be a cook's private food. The old catalog's `prior_fraction` did not move: its only reader
  was the recipe-side name ranker, which the name's removal removes, and the consumption prior stays with the
  service that owns it.
- **`unresolved_foods` IS THE FAILURE RECORD** — the name that failed, the phrase it came from, the
  normalized key, a status, a reason code, the tiers consulted and unavailable, an attempt count, and
  operator-only detail.

Four things carry the design, and each is the reason a nearby alternative is wrong.

### The arm is derived, not declared

```sql
CONSTRAINT food_lookups_one_arm CHECK (num_nonnulls(food_id, food_variant_id, unresolved_food_id) = 1)
```

`num_nonnulls(...) = 1` states "exactly one" directly and never evaluates to NULL, so no row satisfies it by
accident. Two tempting spellings are wrong. `a IS NULL OR b IS NULL OR c IS NULL` admits the all-null row. The
two-arm idiom `(a IS NULL) <> (b IS NULL)` does not extend: chained over three columns it is a parity test,
not a count, and on Postgres 18 it admits the no-arm row and every two-arm row while refusing every
single-arm row. A variant is its own arm rather than a root with a qualifier, because a cook who picked a
variant chose that exact food, and the binding must say so for as long as the line exists.

There is **no `kind` column**, no `food_resolution_status` and no `is_user_entered`. A discriminator is a
second statement of a fact the two reference columns already make, and a second statement can disagree
with the first — which is precisely how illegal states 1 and 2 above came to exist. The name a line
displays and whether it is user-entered are both read by FOLLOWING the binding.

### `RESOLVED` is unrepresentable

`unresolved_foods.status` is GENERATED from `reason_code`: each reason names exactly one of `PENDING`,
`UNRESOLVED`, `NOT_FOUND` and `FAILED`, so the two columns can never disagree and no writer computes the
status. The `CASE` is also the one statement of the closed reason set: an unknown reason generates NULL, and
`NOT NULL` refuses the row. `RESOLVED` is in no branch. A resolved binding points at a food and has **no row
in this table at all**, so a `RESOLVED` row here would record a failure that succeeded. This is the old
`food_resolution_status`'s illegal state removed by construction rather than by convention.

### A lookup failure is shared; an author's declaration is not

```sql
CREATE UNIQUE INDEX unresolved_foods_shared_failure_key_idx
    ON unresolved_foods (normalized_key) WHERE reason_code <> 'author_declared';
```

A real lookup failure is a shared fact ABOUT A PHRASE: every line that says "nutritional yeast" failed for
the same reason, so they converge on one row and ONE later resolution frees all of them. A cook's DECLARED
name is the opposite — two cooks writing "grandma's spice mix" do not mean the same substance, and
deduping them merges one person's ingredient into another's. The `WHERE` clause looks like a loosening and
is the only thing standing between the two.

### `cardinality`, and the NOT NULL that makes it safe

```sql
CHECK (reason_code <> 'cascade_unavailable' OR cardinality(tiers_unavailable) >= 1)
```

`array_length(tiers_unavailable, 1)` answers NULL for an empty array, and a CHECK that evaluates to NULL
is SATISFIED — so the obvious spelling admits the exact row this refuses, a `cascade_unavailable` naming
no unavailable tier. `cardinality('{}')` is 0, which fails. `cardinality(NULL)` is NULL, which does not,
so `tiers_unavailable text[] NOT NULL DEFAULT '{}'` is load-bearing ON THE CHECK rather than a tidy
default. The two are one decision.

### The failure record's other facts are constrained, and its detail stays free text

Three more CHECKs refuse rows that contradict their own reason. The food handle exists exactly for the two
reasons food is still working on (`awaiting_source`, `several_candidates`), because a pending reason with no
handle has nothing to poll and a settled reason with one points at a food nobody follows. The tiers named are
links of this cascade, and a tier was unavailable only if it was consulted. `detail` is bounded to 500
characters. `detail` stays free text on purpose (plan 002 R5): `reason_code` is the machine-readable code, and
`detail` is operator-only text that the service's repository never selects, so no read path can carry it to a
client.

### A shared failure is freed only by food, and a settle forwards

A shared failure is freed only by food-service's answer about that failure's own pending food or phrase, never
by one cook's personal cascade (plan 002 R13). The repository makes that impossible to skip: moving the lines
off a failure takes a `ResolvedHandle`, and only the food-admission policy can build one. A settle moves every
line on the failure to the bound root and deletes nothing.

A settle is a scoped exception to ADR-0034's save paths: it changes other cooks' lines and mints no recipe
version. So a save built from a read taken before the settle still names the failure. The failure record
therefore keeps the settle's target (`settled_lookup_id`, NULL while it stands, never set on a declaration),
and a line that names a settled failure is stored on the target. Two places do this. The line planner forwards
before the transaction, so the version check sees no ingredient edit and the search text and the version name
the food. The line write forwards again inside the transaction under a `FOR SHARE` read of the failure record,
which the settle locks `FOR UPDATE`. That pair orders a save and a settle both ways: a save already holding the
row makes the settle wait and then move the saved line, and a save arriving during a settle waits and then
reads the pointer. The line write takes that read before it deletes the recipe's old lines: the settle moves
those lines too, so a delete that ran first would leave each transaction waiting on the other.

A settle is final. A settled failure is never settled again and never records another attempt, so one cook's
later add cannot move where every stale save forwards. A poll or an add that meets a settled failure answers
with its target. A settled failure also leaves the retry read.

## Alternatives rejected

**A line-level XOR** — put `food_id` and `unresolved_food_id` on `ingredients` and drop the middle table.
Rejected: a line could then exist bound to neither, which is the first illegal state re-created at a new
grain. `food_lookup_id NOT NULL` is what makes "an ingredient HAS a food or an unresolved food" a
statement the database enforces rather than a convention the service maintains. It also loses sharing —
two lines naming the same failure could not converge, so one resolution could not free both.

**A third `declared` arm** on `food_lookups`, so a cook's own name is neither a food nor a failure.
Rejected as unrepresentable once the name is derived: the arm exists to say where a line's NAME comes
from, and a declared name comes from the same place an unresolved one does — an `unresolved_foods` row.
The distinction that actually matters is WHY, which `reason_code = 'author_declared'` states, in the one
place the dedup index already has to consult.

**The food handle on the lookup row** — carry `food_handle_id` on `food_lookups` beside `food_id`.
Rejected: it preserves exactly the ambiguity being removed, because `food_id IS NULL` would once again
mean two different things, and it leaves `food_lookups_one_arm` with nothing to enforce. The handle
belongs on the failure record, where it describes a specific pending state of a specific unresolved thing.

**A multi-food junction** — let a line reference several candidate foods. Rejected on the owner's singular
phrasing: "either points to a food ... or a unresolved food item". Several candidates is a REASON a lookup
did not resolve (`several_candidates`), not a shape the binding takes; the shortlist that produced it
already has a home in `ingredient_resolutions.shortlist`.

## Consequences

### The greenfield exemption, and when it expires

ADR-0035's standing precondition is EXPAND-FIRST: a contracting migration ships a release LATER than the
code that stopped reading the column. `0051_ingredient_grain.sql` contracts and expands in one statement,
which that rule forbids. The exemption is that **production holds no recipe data** — the service has never
been deployed there — and a compatibility path for data that does not exist is a defect rather than
prudence, because it is dead code nobody can exercise, carried forever by readers who cannot tell that.

The exemption is a STAGE-SCOPED claim, checkable by asking whether recipe-service has production DNS, not
a permanent property of this schema — and the scope is what one step of the migration actually depends on,
so "production has no data" is NOT sufficient for a statement that scans a table previews have filled.
Three things follow:

- **The next migration touching these three tables after any production deploy is expand-first again, with
  no exemption and no appeal to this decision.**
- Non-prod previews (ADR-0006 gives each `pr-{N}` its own logical database) DO hold rows, and this
  migration resets them destructively. That is the accepted cost of a preview, not an oversight.
- **Every `ingredient_resolutions` row is deleted on a stage that holds them, and that is DATA LOSS, taken
  deliberately.** Each event is provenance for a binding the migration removes, so none of it still
  describes anything; the table carries no owner column, so it is not an erasure question. The deletion is
  also a precondition rather than housekeeping — the re-pointed foreign key is added `VALID`, which SCANS,
  and one surviving row holding a dead `ingredients.id` raises `23503` and rolls the whole migration back,
  wedging the stage behind its schema stack. Measured against a clone of a migrated database holding
  resolution events; a freshly migrated one has none, so no test tier could have found it.

ADR-0035 already records that a check over migration SQL for narrowing operations is owed. This is the
largest narrowing operation the repository has filed, which strengthens that case rather than weakening it.

### Constraints are `VALID`, diverging from the local convention

Migrations 0020, 0027 and 0030 declare their CHECKs `NOT VALID`, correctly: each was added to a table
already holding rows, where `NOT VALID` skips a full-table verification scan while still governing every
subsequent write. None of that applies to a table created empty in the same statement, where `NOT VALID`
buys nothing and tells every future reader of `pg_constraint` that some prefix of the data was never
checked — which would be false.

### The derived discriminant needs ONE reader, and that is a requirement, not a style note

A union whose tag is derived from nullness only pays for itself if the derivation lives in exactly one
place. If several call sites each write `row.foodId !== null ? … : …`, the "no discriminator column"
decision has leaked into N sites that can each drift, and the cost of a union is paid with none of the
exhaustiveness. One function maps a `food_lookups` row to a tagged value
(`{ kind: 'root'; … } | { kind: 'variant'; … } | { kind: 'unresolved'; … }`, `schema/foodLookupArm.ts`), it
lives beside the schema, and every reader goes through it. That function is what makes the missing column a
feature rather than an omission.

### Capability moved, not merely deleted

Dropping the catalog's `name` takes `search_vector`, the three stored generated ranking columns
(`rank_folded`, `rank_tokens`, `rank_head`), `rank_tokens_of()`, the trigram index and the freeform-name
unique index with it. That is the substrate of the recipe-side ingredient search and suggest surfaces.

This is a deliberate collapse of a duplication rather than a loss: `ingredients/dal/ingredientRelevance.ts`
describes itself as a deliberate duplicate of food-service's `foodRelevance.ts`, ranking a local mirror of
names the food service owns. Ranking names is food-service's job, and the lexical resolution tier already
goes there through the gateway rather than reading the local copy. Re-homing those routes onto the food
service is a separate unit of work, and the wire contract it touches is governed by ADR-0014.

### A line's name is read, never stored

The recipe database holds no food names. A bound line's name comes from food-service at READ, through one
reader of line names, and an unresolved line's from `unresolved_foods.name`. There is no fallback of any
kind: when the viewer may not see the food the line reads `RESOLVED_UNAVAILABLE` with no name; when the food
is gone it reads `FOOD_REMOVED`, with a name only while food can still read it; and when food could not be
asked it reads `FOOD_UNREACHABLE` with no name. `FOOD_UNREACHABLE` is never collapsed into `FOOD_REMOVED`,
because an outage must not read as a permanent fact about a cook's recipe. Clients render a stand-in for a
line with no name and never invent one.

Two write surfaces are SHARED rather than private to the author: `recipes.ingredient_names_text` (search) and
every version snapshot. A private food's name is written to neither, even for its own author, because a
recipe's visibility can change after the write and a snapshot outlives the food. A backfill or repair can
therefore reach a name only by asking food again, since ADR-0006 forbids the join.

### A clone keeps its bindings, and a restore refuses rather than dropping a line

A clone keeps every binding, including a binding to the original cook's private food, which the cloner then
reads as `RESOLVED_UNAVAILABLE` with no name. Unbinding it would have discarded the only record of what the
line was. The clone response counts those lines for a one-time notice.

A restore takes each snapshot line's binding when it still exists, and otherwise re-resolves the line by the
name the version saved. A line with neither cannot be restored, and the whole restore is refused with
`409 VERSION_LINE_UNRESTORABLE`, naming the snapshot positions, before anything is written. Dropping the line
silently would make a restore that looks exact and is not.

### Rebinding one line is a command through the recipe update

`POST /recipes/{id}/ingredients/{position}/rebind` moves one line to another binding through the ordinary
recipe update, so it takes the same version check and makes a version. Its order is check, bind, correct,
repoint, then delete the binding it orphaned. It records a correction only when the line carries a phrase to
correct: an imported line's source phrase (whether the old binding failed or matched the wrong food), or else
the failed name of an unresolved binding. The correction is written before the repoint. It has no
create-my-own-food target: the picker's create followed by a catalog rebind reaches the same end state. A
moved line drops its transcription, because the transcription described the food it no longer names.

An ordinary recipe save records no correction, even when a line's binding changes. A save deletes and
re-inserts every line, so it cannot tell a cook's re-pick from a reorder, a restore, a stale save or an
adopted poll id, and a correction learned from any of those would teach the wrong food. So the teaching
requirement (plan 002 R17) is met only through the rebind command. An editor that uses the command must adopt
the version the command returns, or its next save meets a version conflict.

The delete runs after the repoint commits. Another cook's unsaved draft that still names the deleted binding
then fails its save with `400 UNKNOWN_INGREDIENT`, and a poll of that binding answers 404. Both are recoverable
by re-picking, and both are the cost of not keeping dead bindings.

### Erasure reaches the binding, and the phrase is out of scope by ruling

`food_owner_id` moved from the old catalog to `food_lookups`, so the account-erasure sweep's private-food
statement follows it: delete a binding the dead author owned when no `ingredients` LINE still references
it, retain it pseudonymously when one does. `ingredients.food_lookup_id` is `RESTRICT`, which refuses the
delete of a referenced binding — the same outcome the old column's `NO ACTION` produced, by a different
mechanism, and now unmissable because the column is also NOT NULL.

`unresolved_foods.name` and `unresolved_foods.source_phrase` carry cook-typed text and NO owner column, so
neither erasure-coverage vocabulary can see them and no sweep targets them. That is correct under ADR-0027
— an ingredient phrase is not personal data — and it is the case the coverage gate's own docstring
concedes it cannot mechanically check. It is recorded here because nothing else will.

### A declaration is not in the retry read

`unresolved_foods_status_attempted_idx (status, last_attempted_at)` serves the retry sweep — "what is still
unresolved, oldest attempt first". An `author_declared` row is `UNRESOLVED` and is not a lookup that can
later succeed: the cook named a substance and asked for it as written. The index therefore carries the same
`reason_code <> 'author_declared'` condition the shared-failure index does, plus `settled_lookup_id IS NULL`
for a failure food has answered, and the sweep reads only through it. No status was added for declarations,
so the ruled status set stays closed.

### Accepted residuals

- **An orphaned failure record.** A rebind deletes the unresolved binding it left, and that binding's failure
  record, but only when no line still references either (`deleteIfOrphanedFailure`); a concurrent save that
  references it first makes the delete a no-op. A binding orphaned any other way (a line removed in an
  ordinary save, a recipe deleted) keeps its failure record. A reaper is owed; nothing is incorrect meanwhile.
- **Declared names are never reclaimed.** A declaration is its own record for each line, has no owner, and no
  other cook can find it by search. Nothing deletes one when its line goes, so every test run that declares
  names adds rows nothing removes. The reaper above is also what closes this.
- **A settled failure keeps its phrase.** The dedup index covers settled records, so a later failure of the
  same phrase converges on the settled record and writes nothing, and its add is answered with the settle's
  target. If food later stops showing that target, the add is answered with the failure as it stands, and a
  new pending handle food issues for the phrase is not recorded. The curated catalog plan's KTD-8 plans a
  forward from a retired root to its successor, which would keep the target reachable in the usual case. Until
  it ships, and for a food removed with no forward, the cook rebinds the line.
- **Two spec documents now quote DDL for a table that no longer exists in that form.**
  `specTableCollisions.test.ts`'s register records 003's and 007's research documents quoting 001's shipped
  `ingredients` and `recipe_ingredients` DDL, and flags "a quoted shape can drift from the real one" as a
  residual risk. That risk is now a fact. The register's claims stay true — the documents did quote that
  DDL — so nothing fails, which is exactly why it is written down here instead.
- **A rename that is silent in one direction.** `recipe_ingredients` disappearing is loud — every
  reference is a compile error. `ingredients` SURVIVING WITH A DIFFERENT MEANING is not: a query that
  touches only `id` or `created_at` still compiles and is now asking a different table a different
  question. The same applies to the exported type name `IngredientRow`. Every reader of that table is
  audited by hand rather than by the compiler.
- **A variant binding carries no nutrition and no verification yet.** Both are read off a root food today;
  a variant is honoured as a binding and as a name, and the rest waits for the curated catalog's variant
  nutrition.
- **A resolution event may name an unresolved binding.** `ingredient_resolutions` re-points from the old
  catalog to `food_lookups` (0035's grain argument is unchanged — `food_lookups` IS the shared row the
  catalog was). Its new inhabitant is an event whose cascade ran, produced evidence, and produced no food.
  That is coherent, and it is written down here so nobody files it as corruption.
