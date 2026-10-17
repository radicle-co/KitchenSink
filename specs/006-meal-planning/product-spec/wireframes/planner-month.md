# Wireframe: Planner Month (Web + Mobile)

**Branch**: `006-meal-planning` | **Date**: 2026-05-09 | **Reconciled**: 2026-08-02
**FRs**: [FR-022](../../spec.md#functional-requirements), [FR-023](../../spec.md#functional-requirements),
[FR-034](../../spec.md#functional-requirements), [FR-037](../../spec.md#functional-requirements),
[NFR-003](../../spec.md#non-functional-requirements-constitution-derived-v130),
[NFR-004](../../spec.md#non-functional-requirements-constitution-derived-v130)

> **Reconciliation note.** Removed from the May frame: **[Apply AI suggestions]** (Phase 2, C-006-009) and \*\*[Mark
>
> > leftovers]** (out of scope, C-006-008). **[Copy to next week]\*\* is reframed as the template flow (FR-028) — same user
> > intent, with a persistence model behind it. Added: the mobile frame, and the empty/partial/orphaned states the May
> > frame did not show.

---

## Web — month grid

```
+-----------------------------------------------------------------------------------------------+
| Commise Planner                                              [Week] [Month ✓]        [Profile] |
+-----------------------------------------------------------------------------------------------+
| June Family Plan · 1 – 30 Jun                        [Jump to today]   [Save as template]      |
+-----------------------------------------------------------------------------------------------+
| Mon          Tue          Wed          Thu          Fri          Sat          Sun              |
| +----------+ +----------+ +----------+ +----------+ +----------+ +----------+ +----------+     |
| | 1        | | 2        | | 3        | | 4        | | 5        | | 6        | | 7        |     |
| | 3 meals  | | 3 meals  | | 2 meals  | | 3 meals  | | 2 meals  | | — none   | | 3 meals  |     |
| | Tray Bake| | Pasta    | | Chili    | | Tray Bake| | Wraps    | |          | | Roast    |     |
| +----------+ +----------+ +----------+ +----------+ +----------+ +----------+ +----------+     |
| +----------+ +----------+ +----------+ +----------+ +----------+ +----------+ +----------+     |
| | 8        | | 9   ⓘ    | | 10       | | 11       | | 12       | | 13       | | 14       |     |
| | 3 meals  | | 3 meals  | | 3 meals  | | — none   | | 2 meals  | | 3 meals  | | 3 meals  |     |
| | Curry    | | Stir-fry | | Soup     | |          | | Tacos    | | Pizza    | | Roast    |     |
| +----------+ +----------+ +----------+ +----------+ +----------+ +----------+ +----------+     |
| … grid continues …                                                                             |
+-----------------------------------------------------------------------------------------------+
| Day detail — Tue 9 Jun                                                          [Close]        |
| Breakfast  Overnight Oats           ×1                                                         |
| Lunch      ⚠ Recipe unavailable     ×2      [Remove]                                           |
| Dinner     Stir-fry Noodles         ×4                                                         |
| ⓘ Estimate — some items not counted                                                            |
+-----------------------------------------------------------------------------------------------+
```

- Each cell shows a **meal count** plus one anchor (the dinner title) — density for scanning, not detail.
- `— none` for a day with no entries; never `0 meals` rendered as though it were data.
- `ⓘ` on a cell marks partial nutrition, repeated as a label in the detail panel (NFR-004).
- Columns start on the **locale's first day of week** (FR-037) — Monday here, Sunday for an `en-US` viewer. The May
  frame hard-coded Sunday-first, which FR-037 now forbids.
- Opening a day reveals the same slot model as the week view and drives the same command surface.

## Mobile — compact month

```
+------------------------------------------+
|  ‹  June Family Plan          [⋯]        |
+------------------------------------------+
| ◀      June 2026      ▶     [Week][Month]|
+------------------------------------------+
|  M    T    W    T    F    S    S         |
|  1    2    3    4    5    6    7         |
| ●●●  ●●●  ●●   ●●●  ●●   ·    ●●●        |
|                                          |
|  8    9    10   11   12   13   14        |
| ●●●  ●●●ⓘ ●●●   ·   ●●   ●●●  ●●●        |
|                                          |
| … grid continues …                       |
+------------------------------------------+
|  TUE 9 JUN                               |
|  ──────────────────────────────────      |
|  Breakfast  Overnight Oats        ×1     |
|  Lunch      ⚠ Recipe unavailable  ×2     |
|  Dinner     Stir-fry Noodles      ×4     |
|  ⓘ Estimate — some items not counted     |
|  [ Open in day view ]                    |
+------------------------------------------+
```

- Dots encode meal count (`●●●` = 3, `·` = none) **and** every cell carries an accessible label stating the count in
  words, so the dot pattern is never the only signal (NFR-004).
- Tapping a day expands the sheet below the grid; "Open in day view" jumps to
  [planner-day-mobile.md](./planner-day-mobile.md).

---

## States

| State                 | Web                                            | Mobile                 |
| --------------------- | ---------------------------------------------- | ---------------------- |
| Loading               | Skeleton grid, no counts                       | Skeleton dot grid      |
| Empty plan            | All cells `— none`                             | All cells `·`          |
| Populated             | As drawn                                       | As drawn               |
| Day with no entries   | `— none`                                       | `·`                    |
| Partial nutrition day | `ⓘ` + label in detail                          | `ⓘ` + label in sheet   |
| Orphaned entry        | `⚠ Recipe unavailable` in day detail           | Same, in the day sheet |
| Nutrition unavailable | Counts still render; totals read "unavailable" | Same                   |

Each requires a passing component test on its platform (SC-006-004).

## Accessibility (NFR-003)

- Day cell accessible name: **`{weekday} {date}, {n} meals planned`**, or **`{weekday} {date}, no meals planned`**.
- A partial day appends **`, nutrition is a partial estimate`**.
- On web the grid is a keyboard-navigable roving-focus region: arrow keys move by day, `Enter` opens the detail,
  `Escape` closes it.
- All copy resolves through `@commise/i18n` (FR-038).

## Out of frame

AI suggestions and leftovers (removed, see note); lock/finalize (C-006-007); goal indicators (owned by 009).
