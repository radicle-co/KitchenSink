# 0050 — The food catalog is curated roots and their variants, stored by item, with nutrition owned by a root or a variant

- **Status:** Proposed
- **Date:** 2026-10-01
- **Owner rulings:** nutrition is owned by a root or a variant, never by an item (2026-09-29). Nothing is live and no
  database holds data that matters, so the storage change ships as one migration with no backfill (2026-09-26 and
  2026-09-27). A
  variant has no state: whether its numbers describe the cooked food is a fact of its label (2026-09-30).
- **Amends:** [ADR-0035](0035-schema-stacks-decoupled-from-service-deploys.md)'s expand-first rule, for one migration,
  until go-live.
- **Relates to:** [ADR-0029](0029-authored-foods-substances-only.md) (an authored food's values carry no citation),
  [ADR-0051](0051-catalog-seed-is-a-deploy-step.md) (who writes the catalog),
  [ADR-0052](0052-food-data-sources.md) (where cited numbers come from).
- **Plan:** `docs/plans/2026-09-26-001-feat-curated-food-catalog-seed-plan.md` (KTD-6 to KTD-9, KTD-12, KTD-19,
  KTD-20, U1, U4)

## Context

The food catalog held one row per USDA item. A cook searching "chicken breast" saw dozens of near-identical USDA
descriptions, and nothing said which ones were the same food in another cut or state. The curated seed groups the
2,641 foods a cook names into roots. Every USDA item for the same food goes under its root as a variant. A variant's
label is a list of ordered parts, such as cut, bone, skin and cooking method.

Two facts shape the storage. When a curator merges, splits or aliases foods, a USDA item moves between roots. Every
source and portion row must move with it. And a variant's numbers are not its item's numbers: two
variants can share an item through an alias, and a root that stands for no USDA item cites another source.

## Decision

1. **A root is a food, and a variant is a specialization of one root.** `food` is the root. `food_variant` points to
   its root. The parts of a variant are keyed `(variant_id, attribute, ordinal)`. The `food_variant_attribute`
   enum's declaration order is the contract order (naming rule 24), and a new attribute is added `BEFORE 'origin'` in
   its own migration. A variant has no state column.
2. **Storage is keyed by item, except nutrition.** `food_item` is the unit that sources, portions, field provenance
   and category assignments attach to. Every root and every variant has exactly one item. A declared merge
   re-parents all four tables by re-pointing one item. A root that stands for no USDA item gets an item keyed by
   its seed key, with no source row.
3. **Nutrition is owned by a root or a variant.** `food_nutrition` has one header row per owner, with `food_id` and
   `food_variant_id` as real foreign keys under `CHECK (num_nonnulls(food_id, food_variant_id) = 1)`. Values and
   citations key on the header alone. A citation is a source item or a manufacturer label, read off its columns. A
   NULL citation means the food's author wrote the value, and is admitted only under an authored food. A food with no
   numbers has no header. A merge does not carry nutrition with the item: the applier rewrites it on the new variant.
4. **Retirement forwards, and never withdraws.** A root or variant that a declared change removes gets `retired_at`
   and a `food_forward` row to its successor. A root or variant that leaves the seed with no successor gets
   `retired_at` and no forward (owner, 2026-10-01). It leaves search, but it keeps answering as itself, with its own
   name and numbers, for the recipe lines bound to it. Ids are found by natural key, retired rows included, and are
   never minted twice for one key. A root's seed key is frozen at its first commit.
5. **Seed ownership is a fact on the item.** `food_item.seed_owned` is immutable after insert. A statement trigger on
   each guarded table checks `session_user`, so a cascade cannot launder a write, and refuses the seeder on a row that
   is not seed-owned. Two named exceptions let the seeder take over an unauthored live food, each in one transaction.
   When a seed root claims its name, the seeder retires it and forwards it. When the seed wants a source key it holds
   (owner, 2026-10-01), the seeder also releases that source row and the rows citing it. A deferred check proves at
   commit that a seed-owned row now holds the released key.
6. **Cited numbers come from committed extracts.** Each cited source has one extract that holds only the cited rows,
   pinned with its upstream file by SHA-256 and rebuilt byte for byte by a hand-run extractor. ADR-0052 records the
   sources and the policy that picks one.
7. **The storage change is one migration with no backfill.** No database holds data that matters, so the migration
   that replaces item-keyed nutrition and adds roots, variants and parts is not split into expand and contract steps.
   This exception to ADR-0035 expires at go-live. Every later catalog migration is expand-first.

### Rejected alternatives

- **Nutrition keyed by item.** Two variants that share an item through an alias then share numbers that are not the
  same, and a root citing another source has nowhere to hold its citation.
- **A state column on the variant (raw, cooked, prepared).** The cooking method is already a part of the label, and a
  second statement of it can disagree with the first.
- **A polymorphic owner (`owner_kind`, `owner_id`).** It cannot be a foreign key, so a deleted owner leaves its
  numbers behind. Two real foreign keys under one CHECK can.
- **Withdrawing a retired root.** A recipe that names it then loses its food. A forward keeps every saved id
  resolvable, and a retired entry with no successor answers as itself.

## Consequences

**Positive**

- A cook sees one food per substance, with its variants beside it.
- A curator's merge moves every row that follows an item in one statement.
- Every saved food id stays resolvable after any declared change.

**Negative, accepted**

- The single migration cannot be rolled back by a contract step. Before go-live that costs nothing, and after go-live
  the exception no longer applies.
- The applier, not the database, carries nutrition across a merge, so a merge is only as correct as the applier.
  The verifier recomputes the expected state in SQL from the committed bytes and compares it in both directions.

**Guards**

- The verifier (plan KTD-3, U6) compares every live root, variant, part, per-item row and nutrition row against the
  committed seed.
- The enum-order parity test holds the attribute order to naming rule 24.
- A LOCAL e2e guard finds every table with a foreign-key path to `food_item`, `food` or `food_variant`, and asserts
  that each one is in exactly one set of the catalog registry (plan KTD-13).
