# Contract: Bulk import changes (spec FR-024, FR-024a, FR-025, ADR-0072, ADR-0073)

**Owner service**: `packages/services/recipe-service`, the `/api/v1/import` resource (ADR-0072 §1).

## The import view gains a per-item source flag

Each item in `GET /api/v1/import/{importId}` gains:

```text
sourceFlag: 'notNeeded'   // the item is headed private, or its label is private-only
          | 'checking'    // saved as a draft; the AI check runs after the save
          | 'clear'
          | 'forAPerson'  // possible or unchecked: a draft; a person decides when the cook publishes it
          | 'detected'    // the rules blocked it before the save; cannot be public; choices below
sourceChoices: Array<'keepPrivate' | 'skip'>   // empty unless the item is detected
```

- `sourceFlag` is a mapping over the same classifier as the recipe's `sourceCheck` (`sourceCheckReadingOf`), the
  way ADR-0072 §6's `importFlagOf` maps `identityReadingOf`. It is derived at read time and never stored.
- `keepPrivate` is offered only while the cook has a private slot free (ADR-0073 §8).
- There is no `confirm` choice. A `forAPerson` item is not the cook's to clear (owner ruling, 2026-10-26).
- The import view's `version` digest (ADR-0072 §2) includes each item's source flag, so a client sees the change when
  an outcome lands.

## Readiness (amends ADR-0072 §7)

An item whose chosen visibility is public is **not ready to save** until the rule-based detectors have run on it.
That is all it waits for (spec FR-024, review H8). The rules run inside `advance`, so in practice an item is never
held back by the check, only by its own lines.

- Not `detected`: saved as a draft, as ADR-0072 saves it. Its flag reads `checking` until the AI check lands, then
  `clear` or `forAPerson`. No referral is created until the cook publishes it (spec FR-016b).
- `detected`: never saved as public. It waits for the cook's choice.

⚠️ **The lookup in our own database is not part of readiness.** A match can never make an item `detected` (spec FR-010,
FR-047), so it cannot change whether an item may be saved. It runs in the worker with the model, after the save, keyed
by the saved recipe's id (spec FR-053). This is also what owner ruling 3 needs: the lookup never runs in a request.
The review's H8 wording ("rules plus the lookup") predates that ruling, and the ruling wins.

## Recording the cook's choice

`POST /api/v1/import/{importId}/items/{ord}` gains an optional `sourceChoice: 'keepPrivate' | 'skip'`.

```text
409 SOURCE_CHOICE_NOT_OFFERED   the choice is not in the item's sourceChoices
403 PRIVATE_SLOTS_FULL     keepPrivate with no slot free (ADR-0073 owns this code)
```

- `skip`: the item is not saved, and spends no allowance unit it has not already spent.

## Stopping

The cook stops an import by not calling `advance` (ADR-0072 §2): items already saved stay saved. No new route.

## The check is requested after the save

`advance` runs the rule-based detectors on each item headed public. A `detected` item is not saved and waits for the
cook. Every other item is saved as a draft, and in the same transaction recipe-service writes its check row, its
match fingerprint and source keys, and sends the worker message keyed by the **saved recipe's id**, as the editor path
does ([workerAndModel.md](workerAndModel.md)). A bulk-imported recipe carries no uploaded photos at import time (the
client sends recipes, ADR-0072 §1), so its first check is text only. Photos the cook adds later change the digest and
start a new check.
