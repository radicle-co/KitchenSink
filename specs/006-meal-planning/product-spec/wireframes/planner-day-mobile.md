# Wireframe: Planner Day List (Mobile)

**Branch**: `006-meal-planning` | **Date**: 2026-08-02 (new)
**Platform**: Mobile (Expo / React Native). Web counterpart: [planner-week.md](./planner-week.md)
**FRs**: [FR-022](../../spec.md#functional-requirements), [FR-023](../../spec.md#functional-requirements),
[FR-024](../../spec.md#functional-requirements), [FR-030](../../spec.md#functional-requirements),
[FR-033](../../spec.md#functional-requirements), [FR-034](../../spec.md#functional-requirements),
[FR-037](../../spec.md#functional-requirements), [FR-038](../../spec.md#functional-requirements),
[NFR-003](../../spec.md#non-functional-requirements-constitution-derived-v130),
[NFR-004](../../spec.md#non-functional-requirements-constitution-derived-v130)

> **Why this file exists.** The May wireframe set had **five web frames and no mobile frame at all**, while
> `CODING_STANDARDS §14.1` makes web+mobile parity a hard rule and directs reviewers to reject task lists missing the
> mobile counterpart. This is the mobile primary surface. It is a **replacement** for the week grid, not a squeezed
> version of it: seven columns are unreadable at phone width.

---

## Populated state

```
+------------------------------------------+
|  ‹  Family Week 19            [⋯]        |
|     Mon 11 – Sun 17 May                  |
+------------------------------------------+
| ◀   Week of 11 May   ▶      [Week][Month]|
+------------------------------------------+
|                                          |
|  MON 11                     2,150 kcal   |
|  ────────────────────────────────────    |
|  Breakfast                               |
|   ┌────────────────────────────────────┐ |
|   │ Overnight Oats              ×1     │ |
|   └────────────────────────────────────┘ |
|  Lunch                                   |
|   ┌────────────────────────────────────┐ |
|   │ Leftover Chili Bowls        ×2     │ |
|   └────────────────────────────────────┘ |
|  Dinner                                  |
|   ┌────────────────────────────────────┐ |
|   │ Lemon Chicken Tray Bake     ×4     │ |
|   └────────────────────────────────────┘ |
|                                          |
|  TUE 12                     1,980 kcal   |
|  ────────────────────────────────────    |
|  Breakfast                               |
|   ┌────────────────────────────────────┐ |
|   │            +  Add                  │ |
|   └────────────────────────────────────┘ |
|  Lunch                                   |
|   ┌────────────────────────────────────┐ |
|   │ ⚠ Recipe unavailable        ×2     │ |
|   └────────────────────────────────────┘ |
|  Dinner                                  |
|   ┌────────────────────────────────────┐ |
|   │ Pasta Primavera             ×4     │ |
|   └────────────────────────────────────┘ |
|  ⓘ Estimate — some items not counted     |
|                                          |
|  WED 13                  no meals planned|
|  ────────────────────────────────────    |
|                                          |
+------------------------------------------+
| Plan total   14,600 kcal · 890g P   ⌃    |
+------------------------------------------+
```

### Recipe picker sheet (tap an empty slot)

```
+------------------------------------------+
|                                          |
|          ▁▁▁▁▁▁▁▁▁▁▁▁▁▁                  |
|  Add to Lunch · Tue 12 May         [✕]   |
|  ┌────────────────────────────────────┐  |
|  │ 🔍 Search your recipes…            │  |
|  └────────────────────────────────────┘  |
|                                          |
|  Servings   [ − ]   2   [ + ]            |
|                                          |
|  ┌────────────────────────────────────┐  |
|  │ 🖼  Veggie Burrito         420 kcal │  |
|  ├────────────────────────────────────┤  |
|  │ 🖼  Pasta Primavera        610 kcal │  |
|  ├────────────────────────────────────┤  |
|  │ 🖼  Lemon Chicken          540 kcal │  |
|  └────────────────────────────────────┘  |
+------------------------------------------+
```

---

## Interaction model (FR-034)

| Action          | Gesture                                                                      |
| --------------- | ---------------------------------------------------------------------------- |
| Assign          | Tap an empty slot → picker sheet → choose recipe (servings set in the sheet) |
| Change servings | Tap an assigned entry → inline stepper                                       |
| Move            | Long-press an entry → "Move to…" → pick day/slot                             |
| Remove          | Long-press an entry → "Remove", or swipe the row                             |
| Change week     | Swipe horizontally, or the ◀ ▶ controls                                      |

**No drag-and-drop.** Dragging a card through a vertically scrolling list requires gesture arbitration that misfires
often enough to be a real usability cost, and tap-to-assign reaches SC-006-002 (≤ 3 interactions) more reliably:
tap slot → tap recipe = 2.

Both platforms call the same `useMealPlanBoard` command surface, so the write path, validation, idempotency and
resulting board state are identical. Tests assert board state, not gesture.

---

## States

Every state needs a passing `*.native.test.tsx` component test (NFR-005, SC-006-004), matching the web set one-for-one.

| State                     | Presentation                                                                                   |
| ------------------------- | ---------------------------------------------------------------------------------------------- |
| **Loading**               | Skeleton day sections. No fabricated numbers.                                                  |
| **Empty plan**            | Every slot shows `+ Add`; a one-line hint above the first day.                                 |
| **Populated**             | As drawn.                                                                                      |
| **Saving (optimistic)**   | Row renders immediately at reduced emphasis; accessible "Saving…" announcement.                |
| **Save failed**           | Row retained with an inline "Couldn't save — Retry"; the user's choice is never discarded.     |
| **Orphaned entry**        | `⚠ Recipe unavailable` + icon; still removable; excluded from totals (FR-033).                 |
| **Partial nutrition**     | `ⓘ Estimate — some items not counted` under the affected day and on the plan total.            |
| **Day with no entries**   | "no meals planned" — **not** `0 kcal` (US-006-003 sc. 3).                                      |
| **Nutrition unavailable** | Entries still render; the totals row reads "Nutrition unavailable" with Retry.                 |
| **Offline**               | Cached plan renders read-only with an offline banner; writes queue behind the idempotency key. |

---

## Accessibility (NFR-003 / NFR-004)

- Empty slot accessible label: **`Add recipe to {slot} on {weekday} {date}`** — the same string key as web.
- Entry accessible label: **`{recipeName}, {slot} on {weekday} {date}, {n} servings`**.
- Orphaned and partial states carry text **and** icon; colour alone is never the signal.
- Day sections are headings so screen-reader users can navigate day-to-day.
- Maestro flows drive this frame by accessible label; all copy resolves through `@commise/i18n` (FR-038).

## Out of frame

Lock/finalize (C-006-007); AI controls (Phase 2, C-006-009); goal deltas (009); fibre (C-006-004).
