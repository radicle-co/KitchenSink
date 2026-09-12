# Wireframe: Plan Create (Web + Mobile)

**Branch**: `006-meal-planning` | **Date**: 2026-05-09 | **Reconciled**: 2026-08-02
**FRs**: [FR-022](../../spec.md#functional-requirements), [FR-034](../../spec.md#functional-requirements),
[FR-037](../../spec.md#functional-requirements), [FR-038](../../spec.md#functional-requirements),
[NFR-003](../../spec.md#non-functional-requirements-constitution-derived-v130)

> **Reconciliation note.** Removed: **Plan type (Weekly ▼)** — redundant with the date range, and it was a stored column
> with no behaviour attached; **Nutrition goals / linked nutrition plan** — targets belong to 009, which does not exist;
> **Family size preset** — resolved to per-entry `servings` (FR-030), so a plan-level household number would be a second
> source of truth for the same idea. Added: the empty-state entry point, the mobile frame, and validation states.

---

## Entry point — planner index, no plans yet

```
+-----------------------------------------------------------------------------------------+
| Meal Plans                                                        [Create plan]         |
+-----------------------------------------------------------------------------------------+
|                                                                                         |
|                              🗓  No meal plans yet                                       |
|                    Plan a week of meals and see how it adds up.                         |
|                                                                                         |
|                              [ Create your first plan ]                                 |
|                                                                                         |
+-----------------------------------------------------------------------------------------+
```

This is a genuine empty state, not a blank grid, and shows **no sample data** — the same rule 001 CR-001 applies to
Home placeholders (US-006-001 sc. 4).

---

## Web — create dialog

```
+-----------------------------------------------------------------------------------------+
| Create meal plan                                                                  [✕]   |
+-----------------------------------------------------------------------------------------+
| Plan name *                    [ Family Week 19                                       ] |
|                                                                                         |
| Dates *                        [ Mon 11 May 2026 ]  →  [ Sun 17 May 2026 ]              |
|                                7 days                                                   |
|                                                                                         |
| Meal slots *                   [x] Breakfast  [x] Lunch  [x] Dinner  [ ] Snack          |
|                                Only the slots you pick appear in the planner.           |
|                                                                                         |
|                                              [ Cancel ]      [ Create plan ]            |
+-----------------------------------------------------------------------------------------+
```

## Mobile — create screen

```
+------------------------------------------+
|  ✕   Create meal plan                    |
+------------------------------------------+
|                                          |
|  Plan name *                             |
|  ┌────────────────────────────────────┐  |
|  │ Family Week 19                     │  |
|  └────────────────────────────────────┘  |
|                                          |
|  Starts *                                |
|  ┌────────────────────────────────────┐  |
|  │ Mon 11 May 2026                  ▾ │  |
|  └────────────────────────────────────┘  |
|  Ends *                                  |
|  ┌────────────────────────────────────┐  |
|  │ Sun 17 May 2026                  ▾ │  |
|  └────────────────────────────────────┘  |
|  7 days                                  |
|                                          |
|  Meal slots *                            |
|  [✓] Breakfast   [✓] Lunch               |
|  [✓] Dinner      [ ] Snack               |
|  Only the slots you pick appear in       |
|  the planner.                            |
|                                          |
|  ┌────────────────────────────────────┐  |
|  │           Create plan              │  |
|  └────────────────────────────────────┘  |
+------------------------------------------+
```

---

## Validation and states

All validation is asserted at the API edge as well as the client; the client never carries the only copy of a rule.

| State                     | Presentation                                                                                 |
| ------------------------- | -------------------------------------------------------------------------------------------- |
| **Pristine**              | Submit disabled until name, both dates and ≥ 1 slot are present.                             |
| **End before start**      | Inline error on the end-date field: "End date must be on or after the start date." (FR-022)  |
| **Span over 90 days**     | Inline error: "A plan can cover at most 90 days. This range is {n}." (FR-022)                |
| **No slot selected**      | Inline error: "Pick at least one meal slot."                                                 |
| **Submitting**            | Button shows a busy state and is disabled; the form is not re-submittable.                   |
| **Server rejected (422)** | The field-level message from the error envelope's `details` is bound to the offending field. |
| **Server error (5xx)**    | Non-destructive banner with Retry; entered values are preserved.                             |
| **Day count preview**     | "{n} days" updates live as dates change — the cheapest way to catch a mis-picked year.       |

Each state requires a passing component test on **both** platforms (SC-006-004).

---

## Accessibility (NFR-003) and localization (FR-038)

- Every field has a visible label bound to its control; errors are associated via `aria-describedby` and announced.
- Date controls are keyboard-operable and typeable, not pointer-only calendars.
- The "7 days" derived text is a live region so a screen-reader user hears the span change.
- Dates render in the active locale, and **calendar dates are `YYYY-MM-DD` on the wire** — never instants (FR-037), so
  a plan created at 23:00 in UTC−5 covers the days the user picked.
- All copy resolves through `@commise/i18n`.

## Out of frame

Plan type, nutrition goals, family-size preset (all removed, see note); recurrence (C-006-008); lock (C-006-007).
