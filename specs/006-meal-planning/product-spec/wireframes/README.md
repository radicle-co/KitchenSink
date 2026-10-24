# Wireframes: Meal Planning

**Branch**: `006-meal-planning`
**Date**: 2026-05-09 | **Reconciled**: 2026-08-02
**Status**: Draft — Phase 1 complete, both platforms covered
**Source**: [product-spec.md](../product-spec.md), [spec.md](../../spec.md), [plan.md](../../plan.md)

---

## Index

| File                                                   | Platform     | Description                                                                  | Key FRs / SC                         |
| ------------------------------------------------------ | ------------ | ---------------------------------------------------------------------------- | ------------------------------------ |
| [planner-week.md](./planner-week.md)                   | Web          | Week grid with drag **and keyboard** assignment, nutrition strip             | FR-022, 023, 024, 033, 037           |
| [planner-day-mobile.md](./planner-day-mobile.md)       | Mobile       | Day list with tap-to-assign and the recipe picker sheet — the mobile primary | FR-022, 023, 024, 030, 033, 034, 037 |
| [planner-month.md](./planner-month.md)                 | Web + Mobile | Month overview with day drill-in                                             | FR-022, 023, 034, 037                |
| [plan-create.md](./plan-create.md)                     | Web + Mobile | Empty state, creation dialog/screen, validation                              | FR-022, 034, 037                     |
| [plan-templates.md](./plan-templates.md)               | Web + Mobile | Save-as-template, apply, and the **skip report**                             | FR-028, 029, 032, 034                |
| [plan-shopping-handoff.md](./plan-shopping-handoff.md) | Web + Mobile | Coverage summary and the read projection handed to 007                       | FR-036, SC-006-001                   |

**Parity**: `CODING_STANDARDS §14.1` requires every user-facing surface on both platforms in the same release. The May
set was **five web frames and no mobile frame**; the mobile primary (`planner-day-mobile.md`) has been added and the
other four frames now show both platforms. No parity waiver is taken.

---

## FR Reference Key

| ID             | Requirement                                                                           | Phase |
| -------------- | ------------------------------------------------------------------------------------- | ----- |
| **FR-022**     | Create plans over a date range (≤ 90 days) with a chosen subset of meal slots         | 1     |
| **FR-023**     | Assign / move / remove a recipe in a (date, slot) cell, with servings and a note      | 1     |
| **FR-024**     | Per-day and whole-plan nutrition totals with a completeness flag                      | 1     |
| **FR-025**     | AI meal suggestions _(premium)_                                                       | **2** |
| **FR-026**     | Auto-generate a complete draft plan _(premium)_                                       | **2** |
| **FR-027**     | Food-waste optimization proposals _(premium)_                                         | **2** |
| **FR-028**     | Save a plan as a template and apply it to a new start date, with a skip report        | 1     |
| **FR-029**     | Owner-scoped access; another user's plan is indistinguishable from a non-existent one | 1     |
| **FR-030**     | Entry `servings` — the feature's family-sizing mechanism and nutrition multiplier     | 1     |
| **FR-031**     | Optional bounded per-entry note                                                       | 1     |
| **FR-032**     | `Idempotency-Key` on entry creation and template application                          | 1     |
| **FR-033**     | Orphaned entries — recipe no longer readable; detected on read, excluded from totals  | 1     |
| **FR-034**     | Ships on web **and** mobile; web drag + keyboard, mobile tap-to-assign                | 1     |
| **FR-035**     | Live Home widget replacing the `meal-plan` roadmap placeholder                        | 1     |
| **FR-036**     | Stable, versioned read projection for 007 / 009                                       | 1     |
| **FR-037**     | Calendar dates (`YYYY-MM-DD`), DST-safe; locale-aware first day of week               | 1     |
| **FR-038**     | Every user-facing string localized through `@commise/i18n`                            | 1     |
| **NFR-003**    | Accessible names via `getByRole`/`getByLabel`; keyboard equivalent for every drag     | —     |
| **NFR-004**    | State never conveyed by colour alone                                                  | —     |
| **SC-006-001** | Plan → grocery projection in under 10 minutes for a 7-day plan _(was SC-008)_         | —     |
| **SC-006-002** | Assign a recipe in ≤ 3 interactions, both platforms                                   | —     |
| **SC-006-004** | Every planner UI state has a passing component test on both platforms                 | —     |

---

## State coverage matrix

`CODING_STANDARDS §7.1` requires a component test for **every** UI path/state on **each** platform — not a
representative sample. These are the states the frames define; `tasks.md` carries one test task per cell.

| State                      | week (web) | day (mobile) | month | create | templates | handoff |
| -------------------------- | :--------: | :----------: | :---: | :----: | :-------: | :-----: |
| Loading                    |     ✔      |      ✔       |   ✔   |   —    |     ✔     |    ✔    |
| Empty (no plans / no data) |     ✔      |      ✔       |   ✔   |   ✔    |     ✔     |    ✔    |
| Populated                  |     ✔      |      ✔       |   ✔   |   —    |     ✔     |    ✔    |
| Saving / optimistic        |     ✔      |      ✔       |   —   |   ✔    |     ✔     |    —    |
| Save or submit failed      |     ✔      |      ✔       |   —   |   ✔    |     ✔     |    ✔    |
| Validation error           |     —      |      —       |   —   |   ✔    |     —     |    —    |
| Orphaned entry             |     ✔      |      ✔       |   ✔   |   —    | ✔ (skip)  |    ✔    |
| Partial nutrition          |     ✔      |      ✔       |   ✔   |   —    |     —     |    —    |
| Day with no entries        |     ✔      |      ✔       |   ✔   |   —    |     —     |    —    |
| Dependency unavailable     |     ✔      |      ✔       |   ✔   |   —    |     —     |    ✔    |
| Offline                    |     —      |      ✔       |   —   |   —    |     —     |    —    |
| Feature not yet available  |     —      |      —       |   —   |   —    |     —     |    ✔    |

---

## Removed from the May set, and why

Recorded so these do not get re-added by someone reading an older artifact:

| Element                                             | Where it was   | Why removed                                                                                                                                          |
| --------------------------------------------------- | -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `[Lock Plan]` / "Status: Editable" / lock checkbox  | week, handoff  | Lock dropped — its only purpose was freezing a plan for 007, which does not exist (C-006-007)                                                        |
| `[AI Suggest]` `[Auto-Generate]` `[Optimize Waste]` | week, month    | Phase 2 (C-006-009). No disabled placeholder ships: an inert premium control for a feature with no enforceable entitlement is worse than its absence |
| Ingredient manifest preview                         | handoff        | 006 hands over entries, not aggregated ingredients — 007 owns those rules (R-8)                                                                      |
| `[Mark leftovers]` / carry-forward notes            | month, handoff | Leftovers out of scope (C-006-008)                                                                                                                   |
| Repeat rule (Weekly / Biweekly)                     | templates      | Recurrence out of scope (C-006-008)                                                                                                                  |
| "Overwrite existing assigned slots?"                | templates      | Applying a template always creates a **new** plan; nothing to overwrite                                                                              |
| Goal deltas / nutrition-plan link                   | week, create   | Targets and compliance belong to 009                                                                                                                 |
| Plan type (Weekly ▼), family-size preset            | create         | Redundant with the date range; family sizing is entry `servings` (FR-030)                                                                            |
| "Completion estimate: 8m 35s"                       | handoff        | SC-006-001 is a telemetry metric, not user-facing chrome                                                                                             |
| Fibre in nutrition readouts                         | week           | Not carried by the shipped recipe nutrition model (C-006-004)                                                                                        |

## Resolved warning

The May `WARNING` — that `plan-templates.md` was "inferred" pending FR promotion — is **closed**. Templates are
**FR-028**, promoted by spec Clarification C-006-008. Recurrence, the other half of that warning, is explicitly out of
scope rather than left conditional.
