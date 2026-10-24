# Phase 1 — Data Model: 015 Publishing Rewards

**Created**: 2026-08-22 · **Plan**: [`plan.md`](./plan.md) · **DDL**: [`migrations/forward.sql`](./migrations/forward.sql)
**Migration**: `0026_publishing_rewards.sql` — EXPAND-ONLY, verified on PG 16 and PG 18.6

> ⚠️ **Re-check the migration number before writing the file.** It has moved twice (0024 → 0025 → 0026) because
> concurrent sessions claimed those numbers. Never take it from a document.

---

## Entities

### `recipe_public_listings` — spec Key Entity _Publication_

The record that a recipe was made public by its owner, at a time, under an attestation.

| Field                     | Type                | Notes                                                                                        |
| ------------------------- | ------------------- | -------------------------------------------------------------------------------------------- |
| `id`                      | UUID PK             |                                                                                              |
| `recipe_id`               | UUID FK → `recipes` | `ON DELETE CASCADE`                                                                          |
| `owner_id`                | VARCHAR(255)        | App-user ULID from the token claim. **Never a FK** — there is no local users table (D2)      |
| `listed_at`               | TIMESTAMPTZ         |                                                                                              |
| `attestation_accepted_at` | TIMESTAMPTZ NULL    | `FR-002`. On the **act**, not the recipe, because `FR-022` ties retention to the publication |
| `eligibility_decision`    | TEXT                | `eligible` \| `ineligible` (+ `grandfathered` only if restitution is adopted)                |
| `eligibility_reason`      | TEXT                | `FR-003`/`FR-004` — provable after the fact that shown = applied = reported                  |
| `state`                   | TEXT                | `listed` \| `unlisted_by_owner` \| `removed_on_notice`                                       |

**Named, not `recipe_publications`.** `recipes.status` is already `NOT NULL DEFAULT 'published'` meaning _not a
draft_, and it is a security boundary. Two adjacent concepts named "published" is how an authz bug is written.

**Invariant** (`recipe_public_listings_attestation_required`): an `eligible` listing MUST carry an attestation.
Verified: eligible-without-attestation rejected, ineligible-without allowed.

### `reward_grants` — spec Key Entity _Reward Grant_

Append-only ledger. The **only** permitted mutation is setting `reversed_at` via `FR-016`.

| Field                             | Type                    | Notes                           |
| --------------------------------- | ----------------------- | ------------------------------- |
| `id`                              | UUID PK                 |                                 |
| `listing_id`                      | UUID FK → listings      | `ON DELETE CASCADE`             |
| `owner_id`                        | VARCHAR(255)            |                                 |
| `kind`                            | TEXT                    | `slot` \| `milestone`           |
| `amount`                          | INTEGER                 | `> 0`                           |
| `granted_at`                      | TIMESTAMPTZ             |                                 |
| `reversed_at` / `reversal_reason` | TIMESTAMPTZ / TEXT NULL | Coherent-or-both-null, enforced |

**`UNIQUE (listing_id, kind)`** is what makes `FR-005` (one grant per recipe lifetime) structural, and what
makes `FR-010b`'s retry **idempotent**. Verified: duplicate grant rejected.

**Balance is derived**: `SUM(amount) WHERE kind='slot' AND reversed_at IS NULL`. Never a mutable counter — a
counter drifts, and drift silently grants or denies privacy.

### `recipe_impact_signals`

| Field                       | Type        | Notes  |
| --------------------------- | ----------- | ------ |
| `recipe_id`                 | UUID PK FK  |        |
| `cook_count` / `save_count` | INTEGER     | `>= 0` |
| `updated_at`                | TIMESTAMPTZ |        |

⛔ **No rating columns.** `recipes.average_rating` / `recipes.rating_count` already exist, are maintained
**only** by `recipe_ratings_aggregate_refresh()`, and are guarded by `recipes_rating_aggregate_coherent`.
Ratings are read from `recipes`.

⛔ **Aggregate-only, permanently** (`012-FR-024`). No viewer id, visitor id, IP or session column may ever be
added. Asserted by `validation.sql` Q7 and guard test `TC015`.

### `contributor_standing`

| Field        | Type            | Notes  |
| ------------ | --------------- | ------ |
| `owner_id`   | VARCHAR(255) PK |        |
| `tier`       | SMALLINT        | `>= 0` |
| `updated_at` | TIMESTAMPTZ     |        |

**Monotonic by trigger** (`trg_contributor_standing_ratchet`), not by CHECK — the CHECK approach was tested and
defeated. `highest_tier_reached` was dropped as redundant: if tier can never fall, tier **is** the highest
reached.

---

## Amended existing type — not a new entity

`VisibilityPolicyInput` (`recipes/domain/visibilityPolicy.ts`) gains one **required** field:

```
hasAvailablePrivateSlot: boolean   // required, never optional
```

Required so that all four call sites — create, update, clone-default, set-visibility — become compile errors.
An optional field with a default would let them compile unchanged and silently keep the old behaviour.

The `user_created` + `private` branch changes from `isPremium` to `isPremium || hasAvailablePrivateSlot`.
**That branch is `001-FR-003`.** The C-004 docstring must be updated in the same commit or the file lies.

---

## State transitions

**Listing**: `listed` → `unlisted_by_owner` (owner action, grant untouched — `FR-012`) · `listed` →
`removed_on_notice` (`FR-016`, reverses _that_ grant only).

**Grant**: `granted` → `reversed` (takedown only). No other transition exists. Never deleted.

**Standing**: strictly non-decreasing. Enforced in the database.

**Obligation** (`FR-010b`): `owed` → `granted` (conditional write succeeded) · `owed` → `resolved_without_grant`
(rate limit or ceiling reached — a **terminal** outcome, not a retry-forever condition) · `owed` → `cancelled`
(account erased; a retry landing after erasure would breach `FR-021`).

---

## Erasure (`FR-021`, `FR-022`)

All four tables cascade from the **existing** recipe-service erasure path. A second erasure path MUST NOT be
created. Any outstanding `FR-010b` obligation is cancelled, not drained.
