# 0101: A paste spends its import unit when it is saved, and a bulk file still pays when its lines are sent

- **Status:** Accepted
- **Date:** 2026-11-27
- **Amends:** [ADR-0072](0072-bulk-recipe-import.md) in three places:
    - §2, the sentence "The import pays for its items on the `bulk` channel (§8)": an item pays on the scope its
      `channel` names (decision 2).
    - §3, the paste bullet "PR C reads `view.allowance` and shows an immediate refusal": the client's "when the item
      is unpaid, shows a refusal at once ... and deletes the import" becomes a read-only room check at paste start
      (decision 4).
    - §8, the sentences "An item spends its unit at the first send of its lines for parsing" and "The plan decides
      the limit at the first send of a line": these hold for a `bulk` item only. For a `paste` item both happen at
      the save (decision 2). §8's "`advance` never answers `IMPORT_QUOTA_EXCEEDED`" still holds. The save
      of a paste item now answers it too (decision 3).
- **Relates to:** [ADR-0093](0093-imported-recipes-go-public-only-as-a-commise-written-version.md) §2: one import
  allowance, one pipeline, and a link import that fetches on the device first.
  [ADR-0073](0073-free-tier-private-slots.md): the allowance lock comes before the per-user recipe lock.
  [ADR-0035](0035-schema-stacks-decoupled-from-service-deploys.md): expand-only migrations.
  [ADR-0102](0102-public-versions-of-imported-recipes.md): the public version that a paste can end in.
- **Drivers:** owner ruling 2026-11-17 (spec 003B C-24): making a public version costs no unit of its own, and a paste
  spends its one unit only when it ends in a saved recipe. Spec 003B FR-016a and its data model ("Item channel",
  "Check relaxed", "Allowance").

## Context

ADR-0072 §8 charges an import item its unit when its lines are first sent for parsing, because LLM spend starts
there. That fits a bulk file: the cook chose to import it, and the file waits for room. A pasted recipe, a pasted link
and a share-button import are each a one-recipe import through the same route (ADR-0072 §3). With spec 003B the cook
can read the public version of a paste and then leave without saving anything. A charge at the first send spends a
unit on an import that ends in no recipe. Under the new rule no paste item is paid before it is saved, so ADR-0072
§3's client rule ("refuse when unpaid, then delete") refuses every paste.

The parse job of a paste exists before its unit is spent. The CHECK
`recipe_import_items_job_needs_payment` (migration 0059, `parse_job_id IS NULL OR allowance_spent_at IS NOT NULL`)
refuses that row today.

## Decision

1. **Two kinds of import item, told apart by a stored `channel`.** `recipe_import_items.channel` is `text NOT NULL
DEFAULT 'bulk'`, with `CHECK (channel IN ('bulk', 'paste'))` and `CHECK (channel = 'bulk' OR ordinal = 0)`. A file
   import creates `bulk` items. A pasted recipe, a pasted link and a share-button import each create one `paste` item,
   the only item of its import, and the create path refuses `paste` unless the import's `expectedTotal` is 1. The data
   layer writes `channel` on insert only, and a BEFORE UPDATE trigger refuses any change of it, in either direction.
   Every existing item reads `bulk`.
2. **A `bulk` item pays when its lines are first sent, as ADR-0072 §8 says. A `paste` item pays only when the import
   ends in a saved recipe.** "Saved" means a private copy, a published public version, or both, and both cost one unit.
   The charge runs in the save transaction, after the house lock order (import header, item, allowance, the ADR-0073
   recipe lock, the private recipe, then the public-version job). It locks the item `FOR UPDATE`. When
   `allowance_spent_at` is NULL it sets it and admits one unit, in the same transaction. The scope comes from the
   item's `channel`, the caller's plan and the principal kind, never from a fixed paste scope. When
   `allowance_spent_at` is already set, nothing is charged, so a replay never charges twice. Cancel, expiry and the
   job sweep spend nothing. Every save that ends a paste runs this one charge: keepPrivate, Publish on the public-only
   path, the import's private save, and the private save of the Both path.
3. **The refusal is the save's.** When the allowance refuses the unit, the save rolls back, nothing is saved, and the
   route answers the house `429 IMPORT_QUOTA_EXCEEDED` with `resetsAt`. `advance` still never answers it.
4. **The client checks room at paste start and changes nothing.** It reads `view.allowance` after the first `advance`.
   When the window has no room left, it tells the cook at once, with the reset time. It does not delete the import and
   charges nothing. The save is what refuses.
5. **The payment CHECK is relaxed for paste items only.** `recipe_import_items_job_needs_payment` becomes
   `parse_job_id IS NULL OR allowance_spent_at IS NOT NULL OR channel = 'paste'`. A `bulk` item with a parse job and
   no payment is still refused. The migration follows the twin pattern of migrations 0076 and 0077: the first file sets
   `SET LOCAL lock_timeout = '5s'`, adds `channel`, its two CHECKs `NOT VALID` and the trigger, and drops and re-adds
   the payment CHECK `NOT VALID`, in one transaction. The `_validate` twin validates all three CHECKs.
6. **The ledger table does not change.** `import_allowance_events` and its channel CHECK stay as they are. An import
   paste's unit, recorded on `bulk` until now, is recorded on `paste`, the item's `channel`.

## Consequences

- A paste that ends in no recipe costs no unit. Reading a public version and then leaving is free. Spec 003B FR-086's
  AI-use metric watches that loop. The shared spend ceiling (ADR-0024) bounds it.
- A cook can paste with no room left and learns at paste start. A cook whose room runs out during the paste learns at
  save, and the import stays in To review until the window has room or ADR-0072's 30-day purge removes it.
- The two kinds of item pay at different moments, and the stored `channel` is the only thing that says which. Code
  must read it, never infer it from `ordinal` or from the import's size.
- A parked paste counts toward `IMPORT_MAX_UNPAID_BYTES` (ADR-0072 §8) until it is saved.
- A paste item with a parse job and no payment is now a valid row. Readers of `allowance_spent_at` must not read NULL
  as "not parsed yet".

## One-way doors

- **The `channel` column and its values `bulk` and `paste`.** Once written, every item carries one. Renaming a value
  or making the column changeable means rewriting rows and the trigger.
- **The relaxed payment CHECK.** Tightening it again would refuse every paste item that is parsed and not yet saved.

## Alternatives

- **Charge at the first send for every item (ADR-0072 §8 unchanged).** Rejected by the owner ruling: an import that
  ends in no recipe would spend a unit.
- **Infer the kind of item from `ordinal = 0` or from a one-item import.** Rejected: a one-recipe file is a `bulk`
  import that pays on send. Only a stored fact keeps the two rules apart.
- **Drop the payment CHECK.** Rejected: it still holds for every `bulk` item, and a `bulk` item parsed without payment
  is a real defect.
