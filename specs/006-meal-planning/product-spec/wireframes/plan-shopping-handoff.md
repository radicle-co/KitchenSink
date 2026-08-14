# Wireframe: Shopping Handoff (Web + Mobile)

**Branch**: `006-meal-planning` | **Date**: 2026-05-09 | **Reconciled**: 2026-08-02
**FRs/SC**: [FR-036](../../spec.md#functional-requirements), [FR-034](../../spec.md#functional-requirements),
[FR-038](../../spec.md#functional-requirements), [SC-006-001](../../spec.md#measurable-outcomes),
[NFR-003](../../spec.md#non-functional-requirements-constitution-derived-v130)

> **Reconciliation note — this frame shrank a lot, on purpose.** Removed: the **Ingredient Manifest Preview**
> (chicken 1.8 kg, garlic 22 cloves…) — 006 does **not** aggregate ingredients; that is 007's job, and 007 owns the
> dedup, unit-merge and pantry rules that make it non-trivial (research R-8); the **"Lock plan after handoff"**
> checkbox — lock is dropped (C-006-007); **"Include leftover carry-forward notes"** — leftovers are out of scope
> (C-006-008); and the **"Completion estimate: 8m 35s"** readout — SC-006-001 is a product metric measured from
> telemetry, not a number to display back to the user mid-flow.
>
> What is left is what 006 actually owns: a coverage summary and a handoff. **Feature 007 does not exist yet**, so in
> Phase 1 the primary action surfaces the projection and is disabled with an explanatory state until 007 ships.

---

## Web — handoff panel

```
+-------------------------------------------------------------------------------------------+
| Shopping list from this plan                                                        [✕]   |
+-------------------------------------------------------------------------------------------+
| Family Week 19 · Mon 11 – Sun 17 May                                                      |
|                                                                                           |
| 18 of 21 meals planned                                                                    |
| Not yet planned:  Tue breakfast · Thu lunch · Sun dinner       [ Go to planner ]          |
|                                                                                           |
| ⚠  1 meal has an unavailable recipe and will be left out                                  |
|      Fri dinner                                                 [ Review ]                |
|                                                                                           |
| Shopping lists arrive with the grocery feature. For now you can                           |
| review what this plan covers.                                                             |
|                                                                                           |
| [ Back to planner ]                                     [ Create shopping list ]  ⓘ       |
|                                                          (available when grocery ships)   |
+-------------------------------------------------------------------------------------------+
```

## Mobile

```
+------------------------------------------+
|  ‹  Shopping list                        |
+------------------------------------------+
|  Family Week 19                          |
|  Mon 11 – Sun 17 May                     |
|                                          |
|  18 of 21 meals planned                  |
|                                          |
|  Not yet planned                         |
|   · Tue breakfast                        |
|   · Thu lunch                            |
|   · Sun dinner                           |
|            [ Go to planner ]             |
|                                          |
|  ⚠ 1 meal has an unavailable recipe      |
|    and will be left out — Fri dinner     |
|            [ Review ]                    |
|                                          |
|  Shopping lists arrive with the          |
|  grocery feature.                        |
|                                          |
|  ┌────────────────────────────────────┐  |
|  │      Create shopping list          │  |
|  │      (available when grocery ships)│  |
|  └────────────────────────────────────┘  |
+------------------------------------------+
```

---

## What 006 hands over (FR-036)

The projection behind this screen, and the whole of 006's contribution to the grocery workflow:

```jsonc
{
    "planId": "…",
    "version": "v1",
    "dateRange": { "start": "2026-05-11", "end": "2026-05-17" },
    "entries": [
        { "recipeId": "…", "date": "2026-05-11", "mealSlot": "dinner", "servings": 4 },
        // … one per non-orphaned entry
    ],
}
```

No ingredients, no quantities, no units, no dedup. 007 reads this and applies its own rules. Versioned additively so a
new optional field never breaks a consumer.

---

## States

| State                           | Presentation                                                                                                  |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| **Loading**                     | Skeleton summary; no fabricated counts                                                                        |
| **Fully planned**               | "21 of 21 meals planned"; no gap list                                                                         |
| **Partially planned**           | Gap list with a direct route back to the planner (as drawn)                                                   |
| **Contains orphaned entries**   | Warning naming the affected meals, with a Review action; they are excluded from the projection                |
| **Empty plan**                  | "No meals planned yet" + a route to the planner; the primary action is unavailable                            |
| **007 not available** (Phase 1) | Primary action disabled with the explanatory line, not hidden — hiding it would make the workflow look broken |
| **Projection request failed**   | Error banner with Retry; the plan is untouched                                                                |

Every state needs a passing component test on both platforms (SC-006-004).

## Accessibility (NFR-003) and localization (FR-038)

- The gap list is a real list; each item names the day and slot in text.
- The orphan warning carries an icon **and** text (NFR-004) and is announced as an alert.
- The disabled primary action has an `aria-describedby` pointing at the "available when grocery ships" explanation, so
  the reason is available to screen-reader users rather than implied by the disabled styling.
- All copy through `@commise/i18n`.

## Out of frame

Ingredient manifest, dedup preview, lock, leftovers, live workflow timer — all removed (see note). Retailer integration
and list ownership belong to 007.
