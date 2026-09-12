# Wireframe: Plan Templates (Web + Mobile)

**Branch**: `006-meal-planning` | **Date**: 2026-05-09 | **Reconciled**: 2026-08-02
**FRs**: [FR-028](../../spec.md#functional-requirements), [FR-029](../../spec.md#functional-requirements),
[FR-032](../../spec.md#functional-requirements), [FR-034](../../spec.md#functional-requirements),
[FR-038](../../spec.md#functional-requirements),
[NFR-003](../../spec.md#non-functional-requirements-constitution-derived-v130)

> **Reconciliation note — the WARNING is closed.** This frame is no longer "inferred". Templates are a committed
> requirement, **FR-028**, promoted by spec Clarification C-006-008; the May file's warning ("must remain conditional
> until promoted to explicit FRs") stood unresolved for three months and is now resolved in favour of shipping.
> Removed from the frame: the **Repeat rule (Weekly / Biweekly)** control — recurrence is explicitly out of scope
> (C-006-008) — and **"Overwrite existing assigned slots?"**, since applying a template creates a **new** plan and never
> writes into an existing one, so there is nothing to overwrite. Added: the mobile frames and the **skip report**, which
> is the part that makes templates trustworthy.

---

## Web — template list

```
+-------------------------------------------------------------------------------------------+
| Plan templates                                                                            |
+-------------------------------------------------------------------------------------------+
| [ 🔍 Search templates…                                                                  ] |
|                                                                                           |
| +---------------------------+  +---------------------------+  +-------------------------+ |
| | Weeknight Family Basics   |  | High-Protein Workweek     |  | Two-Week Rotation       | |
| | 7 days · 18 meals         |  | 7 days · 21 meals         |  | 14 days · 36 meals      | |
| | Saved 2 weeks ago         |  | Saved 3 days ago          |  | Saved yesterday         | |
| | [Preview]  [Apply]        |  | [Preview]  [Apply]        |  | [Preview]  [Apply]      | |
| +---------------------------+  +---------------------------+  +-------------------------+ |
+-------------------------------------------------------------------------------------------+
```

Empty state: **"No templates yet — open a plan you like and choose _Save as template_."** No sample templates.

## Web — apply dialog

```
+-------------------------------------------------------------------------------------------+
| Apply "Weeknight Family Basics"                                                     [✕]   |
+-------------------------------------------------------------------------------------------+
| This creates a new plan. Your template is not changed.                                    |
|                                                                                           |
| New plan name *      [ Weeknight Family Basics — 1 Jun                                  ] |
| Starts *             [ Mon 1 Jun 2026 ]                                                   |
|                      Covers Mon 1 Jun – Sun 7 Jun (7 days)                                |
|                                                                                           |
|                                            [ Cancel ]        [ Create plan ]              |
+-------------------------------------------------------------------------------------------+
```

## Web — skip report (shown after applying, when anything was skipped)

```
+-------------------------------------------------------------------------------------------+
| Plan created — 2 meals could not be added                                           [✕]   |
+-------------------------------------------------------------------------------------------+
| ⚠  1 recipe is no longer available                                                        |
|      Tue lunch — the recipe was removed or is no longer shared with you                   |
| ⓘ  1 meal fell outside the new date range                                                 |
|      Day 8 dinner — this plan covers 7 days                                               |
|                                                                                           |
| 16 of 18 meals were added.                                                                |
|                                            [ Close ]        [ Open the plan ]             |
+-------------------------------------------------------------------------------------------+
```

**This dialog is the point of the feature.** A template that silently loses two dinners is what teaches users not to
trust templates; the counts and reasons are reported explicitly (FR-028, US-006-004 sc. 3 and 4).

## Mobile

```
+------------------------------------------+     +------------------------------------------+
|  ‹  Plan templates                       |     |          ▁▁▁▁▁▁▁▁▁▁▁▁▁▁                  |
+------------------------------------------+     |  Apply template                    [✕]   |
| ┌──────────────────────────────────────┐ |     |                                          |
| │ Weeknight Family Basics              │ |     |  Creates a new plan. Your template       |
| │ 7 days · 18 meals · saved 2 wks ago  │ |     |  is not changed.                         |
| │                    [Preview] [Apply] │ |     |                                          |
| └──────────────────────────────────────┘ |     |  New plan name *                         |
| ┌──────────────────────────────────────┐ |     |  ┌────────────────────────────────────┐  |
| │ High-Protein Workweek                │ |     |  │ Weeknight Family Basics — 1 Jun    │  |
| │ 7 days · 21 meals · saved 3 days ago │ |     |  └────────────────────────────────────┘  |
| │                    [Preview] [Apply] │ |     |  Starts *                                |
| └──────────────────────────────────────┘ |     |  ┌────────────────────────────────────┐  |
|                                          |     |  │ Mon 1 Jun 2026                   ▾ │  |
|                                          |     |  └────────────────────────────────────┘  |
|                                          |     |  Covers Mon 1 Jun – Sun 7 Jun (7 days)   |
|                                          |     |  ┌────────────────────────────────────┐  |
|                                          |     |  │           Create plan              │  |
|                                          |     |  └────────────────────────────────────┘  |
+------------------------------------------+     +------------------------------------------+
```

The skip report appears as a full-width sheet with the same content and the same two actions.

## Save as template (from a populated plan, both platforms)

```
+-------------------------------------------------------------------------------------------+
| Save as template                                                                    [✕]   |
+-------------------------------------------------------------------------------------------+
| Template name *      [ Weeknight Family Basics                                          ] |
|                      Saves 18 meals across 7 days, by position in the week —              |
|                      not by date, so you can apply it to any week.                        |
|                                            [ Cancel ]        [ Save template ]            |
+-------------------------------------------------------------------------------------------+
```

The explanatory line matters: it is the user-facing statement of **relative day offsets** (FR-028), which is what makes
a template re-appliable rather than a dated copy.

---

## States

| State                       | Presentation                                                                         |
| --------------------------- | ------------------------------------------------------------------------------------ |
| **Loading list**            | Skeleton cards, no fabricated names or counts                                        |
| **No templates**            | Empty state with a pointer to _Save as template_                                     |
| **Search returns nothing**  | "No templates match '{query}'" — distinct from the no-templates state                |
| **Applying**                | Busy button, dialog not dismissible, non-resubmittable (backed by `Idempotency-Key`) |
| **Applied cleanly**         | Toast + navigate to the new plan; no skip dialog                                     |
| **Applied with skips**      | Skip report dialog as drawn                                                          |
| **Apply failed**            | Error banner with Retry; no partial plan is left behind (the write is transactional) |
| **Save-as-template failed** | Inline error; the plan is untouched                                                  |

Every state needs a passing component test on both platforms (SC-006-004).

## Accessibility (NFR-003) and localization (FR-038)

- Template card accessible name: **`{name}, {n} days, {m} meals, saved {relative time}`**.
- The skip report is an alert dialog, focus-trapped, with its heading announced on open; each skipped item is a list
  item naming the day, slot and reason in text (not colour or icon alone — NFR-004).
- "Covers … (n days)" is a live region that updates with the start date.
- All copy through `@commise/i18n`; relative times are locale-formatted.

## Out of frame

Recurrence / repeat rules (C-006-008); overwrite-into-existing-plan (templates always create a new plan); lock
(C-006-007).
