# Contract: Bulk import changes (spec FR-003b, FR-024–FR-025a, ADR-0072, ADR-0073)

**Owner service**: `packages/services/recipe-service`, the `/api/v1/import` resource (ADR-0072 §1).

Owner ruling, 2026-10-26: after the cook's match review, every imported recipe is saved **published** with the
visibility the cook chose, and is checked, public or private. All green: it goes straight to that visibility.
Otherwise: it waits "In review" for a person (ADR-0072 §3, spec FR-003b). It is never saved as a draft.

## The import view gains a per-item source flag

Each item in `GET /api/v1/import/{importId}` gains:

```text
sourceFlag: 'needsStatement' // no per-recipe statement yet: held in the import, not saved, uses no slot (FR-024b)
          | 'notChecked'     // a book or paid-site item: it goes straight to private (spec FR-003b)
          | 'checking'       // saved published; the AI check runs after the save
          | 'approved'       // every part green, or a person approved it: now public or private as chosen
          | 'inReview'       // waits for a person; owner-only, no slot, draft restrictions (001-FR-003b)
          | 'notApproved'    // the rules or a person did not approve it; it is the cook's private recipe
          | 'detected'       // the rules blocked it before the save; choices below
sourceChoices: Array<'keepPrivate' | 'skip'>   // empty unless the item is detected
```

- `sourceFlag` is a mapping over the same classifier as the recipe's `sourceCheck` (`sourceCheckReadingOf`), the way
  ADR-0072 §6's `importFlagOf` maps `identityReadingOf`. It is derived at read time and never stored.
- `inReview` carries no cause, the same as the recipe's own view (spec FR-016c).
- There is no `confirm` choice. An `inReview` item is not the cook's to clear (owner ruling, 2026-10-26).
- The import view's `version` digest (ADR-0072 §2) includes each item's source flag, so a client sees the change when
  an outcome lands.

## Readiness (amends ADR-0072 §7)

An item is **not ready to save** until three things are done: the cook reviewed its matches, the cook gave its
statement, and the rule-based detectors ran on it. It never waits for the lookup or the model (spec FR-024).

- Not `detected`: saved published with the chosen visibility (ADR-0072 §3). Its flag reads `checking`, then
  `approved` or `inReview`. A referral is created when the outcome is decided and not all green (spec FR-016b).
- `detected`: not saved. It waits for the cook's choice.
- No statement: not saved. It stays in the import as `needsStatement` (spec FR-024b).

⚠️ **The lookup in our own database is not part of readiness.** A match can never make an item `detected` (spec
FR-010, FR-047). So it cannot change whether an item is saved. It runs in the worker with the model, after the
save, keyed by the saved recipe's id (spec FR-053). This is also what owner ruling 3 needs: the lookup never runs in a
request.

## The slot pause (ADR-0073 §8, a default reading flagged for the owner)

When `advance` reaches a private item, it counts under ADR-0073's lock: the cook's private recipes that hold a slot,
plus their private recipes still in review, which are claims on a slot. With no free slot left on that count, the
import pauses and reports `used` and `limit`. The cook chooses to stop, or to make the rest public after one list and
one confirmation. A book or paid-site item can only be skipped, or the import stopped.

## Recording the cook's choice

`POST /api/v1/import/{importId}/items/{ord}` gains an optional `sourceChoice: 'keepPrivate' | 'skip'`.

```text
409 SOURCE_CHOICE_NOT_OFFERED   the choice is not in the item's sourceChoices
403 PRIVATE_SLOTS_FULL          keepPrivate with no free slot (ADR-0073 owns this code)
```

- `keepPrivate`: the item is saved private and is "not approved" at once. It needs a free slot, counted as the pause
  counts.
- `skip`: the item is not saved, and spends no allowance unit it has not already spent.

## Stopping

The cook stops an import by not calling `advance` (ADR-0072 §2): items already saved stay saved. No new route. The
import's working data, items under "Needs your statement" included, is purged 30 days after its last `advance`.

## The check is requested after the save

`advance` runs the rule-based detectors on each item. A `detected` item is not saved and waits for the cook. Every
other item with a statement is saved published, and in the same transaction recipe-service writes its check row
(stamped from the current mode), its match fingerprint and source keys, and sends the worker message keyed by the
**saved recipe's id**, as the editor path does ([workerAndModel.md](workerAndModel.md)). A bulk-imported recipe carries
no uploaded photos at import time (the client sends recipes, ADR-0072 §1), so its first check is text only. Photos the
cook adds later change the digest and start a new check.
