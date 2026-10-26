# Contract: Bulk import changes (spec FR-024, FR-025, ADR-0072)

**Owner service**: `packages/services/recipe-service`, the `/api/v1/import` resource (ADR-0072 §1).

## The import view gains a per-item source flag

Each item in `GET /api/v1/import/{importId}` gains:

```text
sourceFlag: 'notNeeded'   // the item is headed private, or its label is private-only
          | 'checking'
          | 'clear'
          | 'possible'    // needs the cook's confirmation (WA-2)
          | 'detected'    // cannot be public; choices below
          | 'unchecked'   // needs the cook's confirmation
sourceChoices: Array<'keepPrivate' | 'skip' | 'confirm'>   // empty unless the cook must decide
```

- `sourceFlag` is a mapping over the same classifier as the recipe's `sourceCheck` (`sourceCheckReadingOf`), the
  way ADR-0072 §6's `importFlagOf` maps `identityReadingOf`. It is derived at read time and never stored.
- `keepPrivate` is offered only while the cook has a private slot free (the free-tier private slots ADR).
- The import view's `version` digest (ADR-0072 §2) includes each item's source flag, so a client sees the change when
  an outcome lands.

## Readiness (amends ADR-0072 §7)

An item whose chosen visibility is public is **not ready to save** until its source flag is `clear`, or `possible` /
`unchecked` with the cook's confirmation. A `detected` item is never saved as public.

## Recording the cook's choice

`POST /api/v1/import/{importId}/items/{ord}` gains an optional `sourceChoice: 'keepPrivate' | 'skip' | 'confirm'`.

```text
409 SOURCE_CHOICE_NOT_OFFERED   the choice is not in the item's sourceChoices
409 PRIVATE_SLOTS_EXHAUSTED     keepPrivate with no slot free (the slot ADR owns this code)
```

- `skip`: the item is not saved, and spends no allowance unit it has not already spent.
- `confirm`: recorded as the cook's confirmation for that item's digest.

## Stopping

The cook stops an import by not calling `advance` (ADR-0072 §2): items already saved stay saved. No new route.

## The check is requested by `advance`

`advance` computes the digest of each item headed public and requests a check for it, through the same worker
message as the editor path (contracts/workerAndModel.md). The rule-based detectors run inside `advance` itself, so a
rule-only `detected` is known before the model answers.
