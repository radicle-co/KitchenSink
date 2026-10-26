# Contract: Bulk import changes (spec FR-024, FR-024a, FR-025, ADR-0072, ADR-0073)

**Owner service**: `packages/services/recipe-service`, the `/api/v1/import` resource (ADR-0072 §1).

## The import view gains a per-item source flag

Each item in `GET /api/v1/import/{importId}` gains:

```text
sourceFlag: 'notNeeded'   // the item is headed private, or its label is private-only
          | 'checking'
          | 'clear'
          | 'forAPerson'  // possible or unchecked: saved as a draft; a person decides when the cook publishes it
          | 'detected'    // cannot be public; choices below
sourceChoices: Array<'keepPrivate' | 'skip'>   // empty unless the item is detected
```

- `sourceFlag` is a mapping over the same classifier as the recipe's `sourceCheck` (`sourceCheckReadingOf`), the
  way ADR-0072 §6's `importFlagOf` maps `identityReadingOf`. It is derived at read time and never stored.
- `keepPrivate` is offered only while the cook has a private slot free (ADR-0073 §8).
- There is no `confirm` choice. A `forAPerson` item is not the cook's to clear (owner ruling, 2026-10-26).
- The import view's `version` digest (ADR-0072 §2) includes each item's source flag, so a client sees the change when
  an outcome lands.

## Readiness (amends ADR-0072 §7)

An item whose chosen visibility is public is **not ready to save** until its source flag is known.

- `clear`: saved as ADR-0072 saves it.
- `forAPerson`: saved as a draft with its outcome. No referral is created until the cook publishes it (spec FR-016b).
- `detected`: never saved as public. It waits for the cook's choice.

## Recording the cook's choice

`POST /api/v1/import/{importId}/items/{ord}` gains an optional `sourceChoice: 'keepPrivate' | 'skip'`.

```text
409 SOURCE_CHOICE_NOT_OFFERED   the choice is not in the item's sourceChoices
409 PRIVATE_SLOTS_EXHAUSTED     keepPrivate with no slot free (ADR-0073 owns this code)
```

- `skip`: the item is not saved, and spends no allowance unit it has not already spent.

## Stopping

The cook stops an import by not calling `advance` (ADR-0072 §2): items already saved stay saved. No new route.

## The check is requested by `advance`

`advance` computes the digest of each item headed public and requests a check for it, through the same worker
message as the editor path ([workerAndModel.md](workerAndModel.md)). The rule-based detectors run inside `advance`
itself, so a rule-only `detected` is known before the model answers. A bulk-imported recipe carries no uploaded photos
at import time (the client sends recipes, ADR-0072 §1), so its first check is text only. Photos the cook adds later
change the digest and start a new check.
