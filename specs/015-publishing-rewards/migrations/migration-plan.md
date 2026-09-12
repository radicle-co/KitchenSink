# Migration Plan — 015 Publishing Rewards

**Phase**: 5.5 (conditional — triggered: [`plan.md`](../plan.md) §4 defines a data model)
**Migration**: `0026_publishing_rewards.sql` · **Created**: 2026-08-22
**Character**: EXPAND-ONLY, additive, zero-downtime. No column is dropped, narrowed, or retyped.

---

## 1. What this migration does

Four new tables, one nullable column. Nothing existing is modified in place, so old and new code can run
concurrently against the migrated schema — the ADR-0022 expand-first precondition holds trivially.

| Object                   | Kind         | Zero-downtime?                 |
| ------------------------ | ------------ | ------------------------------ |
| `recipe_public_listings` | CREATE TABLE | ✅ additive                    |
| `reward_grants`          | CREATE TABLE | ✅ additive                    |
| `recipe_impact_signals`  | CREATE TABLE | ✅ additive                    |
| `contributor_standing`   | CREATE TABLE | ✅ additive                    |
| indexes                  | CREATE INDEX | ✅ small tables, created empty |

**No `CREATE INDEX CONCURRENTLY` is needed** — every index is built on a table created empty in the same
transaction, so there is no lock to avoid.

## 2. Three corrections to `plan.md` §4, found by reading the live schema

### 2.1 The migration number was wrong — `0024` is taken twice

`0024_ingredient_rank_terms.sql` (`9545447c`) and `0024_ingredient_source_line.sql` (`6a3bf118`) are **both
committed**. This is tolerated by design and is _not_ a live bug: `src/lambdas/migrate/handler.ts` discovers
`*.sql`, `.sort()`s by **filename**, and journals into `schema_migrations` keyed on the **full filename**
(`name TEXT PRIMARY KEY`). The numeric prefix is a sort key, not an identity. 015 takes **`0026`**.

> **Update — the collision in R5 actually happened, within the hour.** A concurrent session shipped
> `5cd53969` ("give two colliding migrations distinct numbers"), renumbering
> `0024_ingredient_rank_terms.sql` → **`0025`**. That took the number this plan had just claimed. 015 moves to
> `0026`. This is why R5 is rated Medium and not Low: with multiple sessions live in one worktree, the next
> free migration number is not stable, and it must be re-checked immediately before the file is written —
> never taken from a plan document.

### 2.2 `recipe_impact_signals` MUST NOT hold rating aggregates

`recipes.average_rating` and `recipes.rating_count` already exist (0010 migration), are maintained **only** by
the `recipe_ratings_aggregate_refresh()` trigger — _never_ by application code — and are guarded by
`recipes_rating_aggregate_coherent`. Duplicating them into a second table would create a second source of
truth for the same knowledge, with no trigger keeping it honest.

**Corrected**: `recipe_impact_signals` carries only the genuinely new facts — `cook_count`, `save_count`.
Ratings are **read from `recipes`**. `standingLadder.ts` therefore takes rating inputs from the existing
aggregate, not from this table.

### 2.3 `recipe_publications` collides with an existing security concept — renamed

`recipes.status` is already `NOT NULL DEFAULT 'published'`, and its comment calls it _"a SECURITY boundary
orthogonal to visibility and deleted_at. A draft is owner-only regardless of visibility."_

So in this codebase **`published` already means "not a draft"** — which is _not_ what 015 means by publishing
(making a recipe public). A table named `recipe_publications` sitting next to `status = 'published'` would
invite exactly the confusion that is most expensive here, because one of the two concepts is a security
boundary.

**Corrected**: the table is **`recipe_public_listings`** — the record that a recipe was listed publicly, by
whom, when, and under what attestation. The spec's Key Entity keeps the name _Publication_; only the physical
table is disambiguated.

### 2.4 The ratchet was enforced by a CHECK, and the CHECK did not work

`plan.md` §4 specified `contributor_standing` with `highest_tier_reached` and
`CHECK (tier >= highest_tier_reached)`, described as making `FR-007i` "structural rather than disciplined".
**It was tested against a live Postgres and it failed.**

```
INSERT INTO contributor_standing (owner_id, tier, highest_tier_reached) VALUES ('u1', 3, 3);
UPDATE contributor_standing SET tier = 1 WHERE owner_id = 'u1';                          -- rejected ✅
UPDATE contributor_standing SET tier = 1, highest_tier_reached = 1 WHERE owner_id = 'u1';-- ACCEPTED ❌
-- result: tier 3 → 1. FR-007i violated.
```

A row-level `CHECK` only ever sees the candidate row. "Never decreases" compares **OLD to NEW** — it is a
_transition_ constraint, and in Postgres that means a **trigger**. Lowering both columns in one statement
satisfies the predicate trivially.

**Corrected**: `highest_tier_reached` is dropped (redundant — if tier can never fall, tier _is_ the highest
ever reached) and monotonicity is enforced by `trg_contributor_standing_ratchet`, a `BEFORE UPDATE` trigger
raising `check_violation`. Re-tested: the attack above is now rejected, and legitimate upward transitions
still succeed.

**The general lesson, worth carrying**: any invariant phrased as "never decreases", "never reverts", "only
ever grows" cannot be a CHECK. `FR-007i` governs the whole feature, so this shape will recur.

## 2.5 Verification performed

Not reasoned — executed. Applied to throwaway databases on **both** engines, against a minimal `recipes`
stub so the FKs resolve:

| Check                                           |     PG 16     | PG 18.6 |
| ----------------------------------------------- | :-----------: | :-----: |
| `forward.sql` applies clean                     |      ✅       |   ✅    |
| Ratchet rejects `SET tier = 1`                  |      ✅       |   ✅    |
| Ratchet rejects the both-columns attack         | ✅ (post-fix) |   ✅    |
| Legitimate tier raise succeeds                  |      ✅       |   ✅    |
| `FR-002` eligible-without-attestation rejected  |      ✅       |    —    |
| `FR-002` ineligible-without-attestation allowed |      ✅       |    —    |
| `FR-005` duplicate slot grant rejected          |      ✅       |    —    |
| Reversal-without-reason rejected                |      ✅       |    —    |
| `Q6` `FR-001` returns 0                         |      ✅       |    —    |
| `rollback.sql` applies clean                    |       —       |   ✅    |

PG18 was included because the platform is mid-upgrade (`21ddb4d2`, `dfcd1cbd` move RDS to PG 18). Nothing in
this migration touches a PG18 behaviour change — notably it uses **no generated columns**, so the
virtual-by-default change does not apply.

## 3. ⛔ The grandfathering decision — REQUIRED before the backfill ships

**Corrected 2026-08-22 (owner).** An earlier draft of this section framed this as a **capability** problem —
that affected users "cannot make private content they never chose to publish." That was wrong twice over:

1. **The path to privacy exists for everyone.** That is the whole feature: publish an eligible recipe, earn
   slots (`FR-007a`). An existing user is not locked out; they face exactly the same forward terms as a new
   one.
2. **Free users already have a private-in-effect state** — `status = 'draft'` is **not** premium-gated, and a
   draft is owner-only regardless of visibility (`recipePredicates.ts`: _"a `draft` is owner-only REGARDLESS
   of visibility"_). It is a degraded state — `status` defaults to `'published'`, so the normal path through
   the wizard publishes, and staying private means never finishing the recipe — but it is not nothing.

**What actually remains is an equity question, not a lockout.** Under `FR-005` a recipe earns **at most once
in its lifetime**, and pre-existing public recipes have no listing row and no grant — so they are **spent**.
They can never earn. A user who already contributed 30 recipes to the public corpus and a newcomer with zero
both have to write a _new_ recipe to get their first slot; the newcomer is granted 2 slots for the act the
existing user already performed 30 times, uncompensated.

That is the whole of it. It is a goodwill and fairness call, and "do nothing" is a legitimate answer.

| Option                                                                                                             | Effect                                                                                                                   | Cost                                                                                                                           |
| ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| **C. Do nothing** _(now the default)_                                                                              | The programme is forward-looking. Everyone gets identical terms from launch; past contribution is simply not retroactive | The most prolific early contributors get least from the change. A visible "I gave you 30 recipes and got nothing" grievance    |
| **A. Flat restitution** — 1 slot per pre-existing eligible public `user_created` recipe                            | Recognises past contribution cheaply and boundedly                                                                       | Does not match the schedule, so it is a _different_ currency rate than everyone else gets                                      |
| **B. Retroactive schedule** — run the `FR-007a` bands over the pre-existing corpus (2 each for the first 10, etc.) | The most coherent: past publications count exactly as if the programme had always existed                                | Generous — a user with 70 public recipes maxes the 50-slot ceiling instantly, and the slot economy is over for them on day one |

**Recommendation: C, unless the goodwill matters more than the simplicity** — and it might. The earlier
recommendation of A was written under the mistaken capability framing and should not be read as standing.
If restitution _is_ wanted, **B is more defensible than A**: it applies one rule to everybody rather than
inventing a second exchange rate for legacy users.

### 3.1 What restitution would require structurally — and why the first draft of the backfill was incoherent

The backfill in `forward.sql` §4 marked its listings `eligibility_decision = 'ineligible'` purely to satisfy
`recipe_public_listings_attestation_required`, then granted a slot against them. **Ineligible means earns
nothing.** A slot grant hanging off an ineligible listing contradicts the model, and `reward_grants_kind_check`
would reject a distinct `'restitution'` kind anyway. Any real implementation of A or B needs three changes,
which are now written into the commented block so they travel with it:

1. A third `eligibility_decision` value, **`'grandfathered'`** — honest about what it is: a real historical
   publication carrying no attestation, because nobody was asked for one.
2. `'restitution'` added to `reward_grants_kind_check`, so restitution is never mistaken for a scheduled
   grant when the ledger is read.
3. **An explicit `SC-002` carve-out in `spec.md`.** SC-002 says _100% of published recipes that earned a
   reward have a recorded authorship attestation_. Restitution grants would breach it as written. The
   qualification needed is "earned **under the reward schedule**" — and that must be an owner decision
   recorded as a clarification, not a quiet edit to a success criterion.

**Why this does not reopen the inducement hazard**: inducement is _prospective_. You cannot induce someone to
do something they have already done. A restitution grant for a publication that happened before the programme
existed cannot have motivated that publication, so `FR-001`'s control is not weakened by it. This is the one
place in the feature where granting without attestation is defensible — and it is defensible only because the
act is in the past.

## 4. Ordering, backfill, and idempotency

1. Tables + constraints + indexes (`forward.sql` §1–§3). Idempotent via `IF NOT EXISTS`.
2. **Restitution backfill** (`forward.sql` §4) — _gated on §3's decision, currently commented out_.
   Idempotent via `ON CONFLICT DO NOTHING` on a natural key, so a re-run cannot double-grant.
3. No data is read by new code until the application deploy completes; ADR-0022's in-stack Trigger already
   orders migration-before-service, so there is no window where new code meets the old schema.

**No separate backfill job.** The restitution set is bounded by existing recipe rows and is a single
`INSERT … SELECT`. If the recipe table grows large enough that this becomes a long transaction, batch it by
`owner_id` — but at current scale a single statement is correct and simpler.

## 5. Rollback

`rollback.sql` drops the four tables. This is safe **only while no application code reads them** — i.e. before
or concurrently with reverting the service deploy.

⚠️ **Rollback is destructive to earned state.** Dropping `reward_grants` destroys every slot grant, and
`FR-007b` makes those permanent. After the feature has been live to real users, **do not roll back the
schema** — roll back the _application_ and leave the tables in place. They are additive and inert without the
code reading them. `rollback.sql` exists for the pre-launch window only, and says so in its header.

## 6. Risk matrix

| #   | Risk                                                  | Likelihood                                      | Impact                                       | Mitigation                                                                                        |
| --- | ----------------------------------------------------- | ----------------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| R1  | Rollback run after launch destroys permanent grants   | Low                                             | **Severe** — violates `FR-007b` irreversibly | Header warning in `rollback.sql`; revert the app, not the schema                                  |
| R2  | Restitution backfill run without the §3 decision      | Medium                                          | High — grants slots nobody authorised        | Shipped commented out; `validation.sql` Q5 detects it ran                                         |
| R3  | Backfill double-runs and double-grants                | Low                                             | Medium                                       | Natural-key unique index + `ON CONFLICT DO NOTHING`                                               |
| R4  | Ratchet CHECK rejects a legitimate write              | Low                                             | Medium                                       | It is intended to; `TC011` asserts the rejection is the _only_ failure mode                       |
| R5  | `0025` collides with a concurrent session's migration | **Medium** — two sessions are live in this tree | Medium                                       | Re-check the directory immediately before writing; the runner tolerates duplicate prefixes (§2.1) |
| R6  | Materialized slot balance drifts from the ledger      | Medium                                          | **High** — silently grants or denies privacy | Ledger is source of truth; `validation.sql` Q3 reconciles                                         |
