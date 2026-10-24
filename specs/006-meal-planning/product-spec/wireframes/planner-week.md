# Wireframe: Planner Week (Web)

**Branch**: `006-meal-planning` | **Date**: 2026-05-09 | **Reconciled**: 2026-08-02
**Platform**: Web (Next.js). Mobile counterpart: [planner-day-mobile.md](./planner-day-mobile.md)
**FRs**: [FR-022](../../spec.md#functional-requirements), [FR-023](../../spec.md#functional-requirements),
[FR-024](../../spec.md#functional-requirements), [FR-033](../../spec.md#functional-requirements),
[FR-034](../../spec.md#functional-requirements), [FR-037](../../spec.md#functional-requirements),
[FR-038](../../spec.md#functional-requirements),
[NFR-003](../../spec.md#non-functional-requirements-constitution-derived-v130),
[NFR-004](../../spec.md#non-functional-requirements-constitution-derived-v130)

> **Reconciliation note.** Removed from the May frame: the **[Lock Plan]** control and the "Status: Editable" chip
> (lock dropped, spec C-006-007); the **[AI Suggest] / [Auto-Generate] / [Optimize Waste]** toolbar (Phase 2, deferred,
> C-006-009 — shipping the buttons disabled would advertise a feature that cannot be entitled); and **goal delta**
> readouts (targets belong to 009). Added: the partial-estimate treatment, the orphaned-entry treatment, and the
> keyboard interaction, none of which the May frame showed.

---

## Populated state

```
+--------------------------------------------------------------------------------------------------+
| Commise Planner                                              [Week] [Month]            [Profile]  |
+--------------------------------------------------------------------------------------------------+
| Family Week 19 · Mon 11 – Sun 17 May                       [Save as template]  [Shopping list →]  |
+--------------------------------------------------------------------------------------------------+
| Recipe sidebar                       |  Mon 11    Tue 12    Wed 13    Thu 14    Fri 15   ...      |
| +---------------------------------+  | +-------+ +-------+ +-------+ +-------+ +-------+          |
| | Search recipes…                 |  | Breakfast                                                  |
| +---------------------------------+  | | +   | | Oats  | | +   | | Oats  | | +   |               |
| | ⠿ Veggie Burrito                |  | +-------+ +-------+ +-------+ +-------+ +-------+          |
| | ⠿ Lemon Chicken Tray Bake       |  | Lunch                                                      |
| | ⠿ Leftover Chili Bowls          |  | | Chili | | +   | | Wrap  | | +   | | Chili |             |
| | ⠿ Pasta Primavera               |  | |  ×2   | |     | |  ×2   | |     | |  ×2   |             |
| +---------------------------------+  | +-------+ +-------+ +-------+ +-------+ +-------+          |
|                                      | Dinner                                                     |
|                                      | | Tray  | | Pasta | | +   | | Tray  | | ⚠     |            |
|                                      | | Bake  | |       | |     | | Bake  | | Recipe|            |
|                                      | |  ×4   | |  ×4   | |     | |  ×4   | | unavail|           |
|                                      | +-------+ +-------+ +-------+ +-------+ +-------+          |
|                                      | (no Snack row — this plan did not select snacks)           |
+--------------------------------------+-------------------------------------------------------------+
| Nutrition  (aria-label="Plan nutrition summary")                                                   |
| Mon 2,150 kcal · 132g P · 210g C · 79g F        Tue 1,980 kcal · 118g P · 195g C · 71g F           |
| Wed — no meals planned                          Fri ⓘ Estimate — some items not counted            |
| Plan total: 14,600 kcal · 890g P · 1,410g C · 520g F                                               |
+--------------------------------------------------------------------------------------------------+
```

Notes on what the frame encodes:

- **Only the plan's configured slots render.** This plan chose breakfast/lunch/dinner, so there is no empty snack row
  taking a quarter of the grid (FR-022).
- **Day columns start on the locale's first day of week** — Monday here, Sunday for a `en-US` viewer. Not hard-coded
  (FR-037).
- **`×N` is the entry's servings** (FR-030), the multiplier for that entry's nutrition contribution.
- **Wed shows "no meals planned", not `0 kcal`.** A zero would read as a genuine zero-calorie day (US-006-003 sc. 3).
- **Fri is a partial estimate** because one of its entries is orphaned — labelled with an icon **and** text, never
  colour alone (NFR-004).

---

## States

Each state below requires a passing component test (NFR-005, SC-006-004).

| State                     | Presentation                                                                                                                               |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| **Loading**               | Skeleton grid matching the final column/row shape. **No fabricated values** — the same discipline 001 CR-001 applies to Home placeholders. |
| **Empty plan**            | Grid renders with all cells in the `+` add state; sidebar prompts "Drag a recipe, or press Space on a recipe to place it".                 |
| **No plans at all**       | Not this screen — the planner index shows "Create your first plan" (see [plan-create.md](./plan-create.md)).                               |
| **Populated**             | As drawn above.                                                                                                                            |
| **Saving (optimistic)**   | The placed card renders immediately at reduced emphasis with an accessible "Saving…" announcement.                                         |
| **Save failed**           | Card stays in place, marked with an inline "Couldn't save — Retry" control. The user's placement is never discarded.                       |
| **Orphaned entry**        | `⚠ Recipe unavailable` label + icon, card shell retained, still removable, excluded from totals (FR-033).                                  |
| **Partial nutrition**     | `ⓘ Estimate — some items not counted` on the affected day and on the plan total.                                                           |
| **Nutrition unavailable** | Recipe service degraded: entries still render; the nutrition strip reads "Nutrition unavailable" with a Retry. Never `0`.                  |

---

## Interaction and accessibility (NFR-003)

- Empty slot accessible name: **`Add recipe to {slot} on {weekday} {date}`**.
- Recipe card accessible name: **`{recipeName}, draggable. Press Space to place.`**
- Assigned entry accessible name: **`{recipeName}, {slot} on {weekday} {date}, {n} servings`**.
- **Keyboard path is first-class, not a fallback**: `Tab` to a recipe → `Space` lifts → arrow keys traverse cells →
  `Space` drops → `Escape` cancels, with a live region announcing each transition. This is `@dnd-kit`'s keyboard sensor
  over the same machinery as pointer drag — the reason that library was chosen.
- Playwright drives this frame with `getByRole`/`getByLabel` only; `data-testid` and `page.waitForTimeout()` are banned.
- All strings resolve through `@commise/i18n` (FR-038) — none of the copy above is a literal in the component.

## Out of frame

- **Lock / finalize** — dropped (C-006-007).
- **AI suggest / auto-generate / optimize waste** — Phase 2 (C-006-009). No disabled placeholder ships: an inert premium
  button for a feature with no enforceable entitlement is worse than its absence.
- **Goal deltas / macro targets** — owned by 009.
- **Fibre** — not carried by the shipped recipe nutrition model (C-006-004).
