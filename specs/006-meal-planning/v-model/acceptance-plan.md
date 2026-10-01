# Acceptance Test Plan: Meal Planning

**Feature Branch**: `006-meal-planning`
**Created**: 2026-05-09 | **Regenerated**: 2026-08-02
**Status**: Draft
**Source**: [`v-model/requirements.md`](./requirements.md), [`v-model/system-test.md`](./system-test.md),
[`product-spec/user-journey.md`](../product-spec/user-journey.md)

## Overview

Maps every Phase-1 requirement to BDD acceptance scenarios with pass criteria. Acceptance tests are written from the
**user's** point of view and are the final demonstration that the feature does what the spec promised.

> **Regeneration note.** The May plan described "two tiers: free and premium". That framing is retired for Phase 1 —
> **no premium surface ships** (spec C-006-009), so there is no tier split to accept. In its place, this plan adds the
> two dimensions the May version had no scenarios for at all: **mobile** (a hard rule, `§14.1`) and **degraded
> behaviour** (what the user sees when the recipe service is down or a recipe has vanished). Those are not edge cases
> here; they are the states a planner spends real time in.

**ID Schema**

- **Acceptance Test Case**: `AT-006-{X}` — X sequential.
- **Acceptance Test Scenario**: `ATS-006-{X}{#}`.

Every scenario states its platform. A scenario marked **both** must pass on web (Playwright) **and** mobile (Maestro).

---

## AT-006-A — Create and manage a meal plan

**Requirements**: REQ-001, REQ-002, REQ-009, REQ-018, REQ-CN-002, REQ-CN-005 · **Story**: US-006-001

| ID         | Scenario                                                                                                                                     | Platform | Pass criteria                                           |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------- |
| ATS-006-A1 | **Given** a signed-in user with no plans, **when** they open the planner, **then** they see "Create your first plan" and no fabricated data  | both     | Empty state visible; no sample plan, no zeroed totals   |
| ATS-006-A2 | **Given** the create form, **when** they name a plan, pick Mon–Sun and tick breakfast/lunch/dinner, **then** the plan opens as an empty grid | both     | Grid shows 7 days × **3** slot rows — **no snack row**  |
| ATS-006-A3 | **Given** the create form, **when** the end date precedes the start, **then** an inline error names the field and nothing is created         | both     | Error text present; plan list unchanged                 |
| ATS-006-A4 | **Given** the create form, **when** a 91-day range is chosen, **then** an error states the 90-day maximum                                    | both     | Error states the limit explicitly                       |
| ATS-006-A5 | **Given** a user in a Sunday-first locale, **when** they open a week, **then** the first column is Sunday; in a Monday-first locale, Monday  | both     | Column order follows locale, not a hard-coded default   |
| ATS-006-A6 | **Given** a plan created at 23:00 local time, **when** reopened next morning, **then** it covers exactly the days chosen                     | both     | Day count unchanged across the time-zone boundary       |
| ATS-006-A7 | **Given** user B has a plan, **when** user A opens its URL, **then** A sees the same "not found" as for a made-up id                         | web      | Response and message identical; existence not disclosed |

---

## AT-006-B — Assign recipes to meal slots

**Requirements**: REQ-003, REQ-015, REQ-016, REQ-021, REQ-022, REQ-CN-005, REQ-CN-008, REQ-CN-010, REQ-CN-011, REQ-CN-012 · **Story**: US-006-002

| ID          | Scenario                                                                                                                                  | Platform | Pass criteria                                      |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------- | -------- | -------------------------------------------------- |
| ATS-006-B1  | **Given** an open plan, **when** the user drags a recipe onto Tuesday dinner, **then** it appears there and survives a reload             | web      | Entry persists                                     |
| ATS-006-B2  | **Given** an open plan, **when** the user taps Tuesday dinner and picks a recipe from the sheet, **then** it appears there                | mobile   | Entry persists; **≤ 3 interactions** (SC-006-002)  |
| ATS-006-B3  | **Given** a keyboard-only user, **when** they Tab to a recipe, press Space, arrow to a cell and press Space, **then** the entry is placed | web      | **No pointer used**; each step announced (NFR-003) |
| ATS-006-B4  | **Given** an assigned entry, **when** servings are set to 4, **then** the value persists and that day's totals rise accordingly           | both     | Totals reflect ×4                                  |
| ATS-006-B5  | **Given** an assigned entry, **when** a note "omit onions" is added, **then** it is stored and shown verbatim                             | both     | Text unchanged                                     |
| ATS-006-B6  | **Given** an assigned entry, **when** it is moved to another cell, **then** it appears once, in the new cell                              | both     | No duplicate                                       |
| ATS-006-B7  | **Given** an assigned entry, **when** it is removed, **then** it disappears and totals recompute                                          | both     | Entry gone; totals updated                         |
| ATS-006-B8  | **Given** a flaky connection, **when** the user taps assign twice for the same action, **then** exactly one entry results                 | mobile   | One entry (REQ-015)                                |
| ATS-006-B9  | **Given** a plan, **when** the same recipe is assigned to Monday and Thursday dinner, **then** both persist                               | both     | Repeats are allowed, not a conflict                |
| ATS-006-B10 | **Given** an assignment that fails to save, **then** the user sees an inline retry and their placement is not lost                        | both     | Card remains; retry offered                        |

---

## AT-006-C — See nutrition for the plan

**Requirements**: REQ-004, REQ-005, REQ-009, REQ-010, REQ-014, REQ-NF-004, REQ-NF-006 · **Story**: US-006-003

| ID         | Scenario                                                                                                                        | Platform | Pass criteria                                 |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------- | -------- | --------------------------------------------- |
| ATS-006-C1 | **Given** a day with three recipes of known macros, **then** the day shows the sum of (per-serving × servings)                  | both     | Values match a hand-computed total            |
| ATS-006-C2 | **Given** a day with **no** entries, **then** it shows "no meals planned" — **not** `0 kcal`                                    | both     | No zero is rendered anywhere on that day      |
| ATS-006-C3 | **Given** a recipe whose own nutrition is incomplete, **then** the day is labelled a partial estimate with an icon **and** text | both     | Label readable with colour disabled (NFR-004) |
| ATS-006-C4 | **Given** a whole plan, **then** a plan total is shown, marked partial if any day is                                            | both     | Total present and correctly flagged           |
| ATS-006-C5 | **Given** a 30-day plan at full density, **when** opened, **then** it loads within the performance budget                       | both     | p95 ≤ 500 ms server-side (SC-006-003)         |
| ATS-006-C6 | **Given** a recipe is edited elsewhere, **when** the plan is reopened, **then** totals reflect the **new** values               | both     | No stale snapshot                             |

---

## AT-006-D — Degraded and orphaned states

**Requirements**: REQ-014, REQ-IF-001, REQ-NF-004 · **Journey**: B · **New in this regeneration**

| ID         | Scenario                                                                                                                                                             | Platform | Pass criteria                                       |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | --------------------------------------------------- |
| ATS-006-D1 | **Given** an entry whose recipe has since been deleted, **when** the plan is opened, **then** the card reads "Recipe unavailable" with an icon and remains removable | both     | Entry visible and removable; not silently dropped   |
| ATS-006-D2 | **Given** that same plan, **then** the orphaned entry is excluded from totals and its day is marked a partial estimate                                               | both     | Totals exclude it; day flagged                      |
| ATS-006-D3 | **Given** the recipe service is unavailable, **when** the plan is opened, **then** the plan and all entries still render                                             | both     | **No error page**; plan usable                      |
| ATS-006-D4 | **Given** that outage, **then** nutrition reads "unavailable" with a retry — never `0`                                                                               | both     | No zero shown                                       |
| ATS-006-D5 | **Given** that outage, **when** the user tries to assign a new recipe, **then** they are told the action is temporarily unavailable and no entry is created          | both     | Clear message; **no** entry persisted (fail closed) |
| ATS-006-D6 | **Given** the service recovers, **when** the plan is reopened, **then** nutrition returns with no user action beyond a reload                                        | both     | Self-healing                                        |

---

## AT-006-E — Reuse a week (templates)

**Requirements**: REQ-012, REQ-013, REQ-015 · **Story**: US-006-007

| ID         | Scenario                                                                                                                                             | Platform | Pass criteria                             |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ----------------------------------------- |
| ATS-006-E1 | **Given** a populated plan, **when** the user saves it as a template, **then** it appears in the template list with day and meal counts              | both     | Counts correct                            |
| ATS-006-E2 | **Given** a template, **when** applied to next Monday, **then** a new plan is created with the same recipes at the same relative positions           | both     | Positions preserved                       |
| ATS-006-E3 | **Given** that new plan, **when** it is edited, **then** the template is unchanged                                                                   | both     | Independence                              |
| ATS-006-E4 | **Given** a template with a recipe since removed, **when** applied, **then** the plan is created **and** the user is told 1 meal was skipped and why | both     | Skip report visible with count and reason |
| ATS-006-E5 | **Given** a 14-day template applied to a 7-day range, **when** applied, **then** the user is told how many meals fell outside                        | both     | Out-of-range count reported               |
| ATS-006-E6 | **Given** an apply that fails partway, **then** no half-built plan is left behind                                                                    | both     | Either a complete plan or none            |
| ATS-006-E7 | **Given** a user with no templates, **then** they see an empty state pointing at "Save as template"                                                  | both     | No sample templates                       |

---

## AT-006-F — Home widget and navigation

**Requirements**: REQ-017, REQ-IF-007 · **Story**: US-006-005

| ID         | Scenario                                                                                                                               | Platform | Pass criteria                              |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------- | -------- | ------------------------------------------ |
| ATS-006-F1 | **Given** a plan covering today, **when** the user opens Home, **then** "This Week's Meals" shows today's entries with names and slots | both     | Satisfies 001 US-000 scenario 6            |
| ATS-006-F2 | **Given** no plan covering today, **then** the widget shows its own empty state with a call to action                                  | both     | Not a skeleton; not another feature's data |
| ATS-006-F3 | **Given** Home on web and mobile side by side, **then** the widget is present on both in the same state                                | both     | 001 US-000 scenario 11                     |
| ATS-006-F4 | **Given** the feature has shipped, **then** **no** meal-plan skeleton placeholder renders anywhere                                     | both     | SC-006-005 — zero residue                  |
| ATS-006-F5 | **Given** the widget's request fails, **then** the widget shows a recoverable error and the rest of Home still renders                 | both     | Home not broken by one widget              |
| ATS-006-F6 | **Given** Home, **when** the user taps the meal-plan nav item, **then** the planner opens                                              | both     | Navigation wired                           |

---

## AT-006-G — Complete the planning workflow

**Requirements**: REQ-011, REQ-IF-005, REQ-IF-006 · **Story**: US-006-004

| ID         | Scenario                                                                                                                                         | Platform | Pass criteria                                       |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | -------- | --------------------------------------------------- |
| ATS-006-G1 | **Given** a new user, **when** they create a 7-day plan, fill it and reach the grocery projection, **then** the elapsed time is under 10 minutes | both     | **SC-006-001**, measured in a timed session         |
| ATS-006-G2 | **Given** a partially filled plan, **when** the handoff is opened, **then** unplanned meals are listed with a route back to the planner          | both     | Gaps named, not just counted                        |
| ATS-006-G3 | **Given** a plan with an orphaned entry, **then** the handoff warns it will be left out                                                          | both     | Warning present                                     |
| ATS-006-G4 | **Given** feature 007 is not deployed, **then** the "Create shopping list" action is visibly unavailable with a stated reason                    | both     | Reason exposed to assistive tech, not styling alone |

---

## AT-006-H — Accessibility and localization

**Requirements**: REQ-019, REQ-NF-003, REQ-NF-004, REQ-NF-007

| ID         | Scenario                                                                                                                             | Platform | Pass criteria                           |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------ | -------- | --------------------------------------- |
| ATS-006-H1 | **Given** a screen-reader user, **when** they traverse the planner, **then** every slot and entry announces its day, slot and recipe | both     | Names present and meaningful            |
| ATS-006-H2 | **Given** a keyboard-only user, **then** every operation available by pointer is available by keyboard                               | web      | Full parity of operations               |
| ATS-006-H3 | **Given** a user with colour-vision deficiency, **then** orphaned and partial states remain distinguishable                          | both     | Verified with colour rendering disabled |
| ATS-006-H4 | **Given** a non-`en` locale, **then** every planner string renders in that locale with no untranslated literal                       | both     | No hard-coded English                   |
| ATS-006-H5 | **Given** an axe scan of each planner surface, **then** no violations are reported                                                   | both     | Zero violations                         |

---

## AT-006-I — Account erasure

**Requirements**: REQ-020

| ID         | Scenario                                                                                                                                                                               | Platform | Pass criteria                                                                           |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | --------------------------------------------------------------------------------------- |
| ATS-006-I1 | **Given** a user with plans and templates, **when** they erase their account, **then** none of that data survives                                                                      | web      | Zero residual rows across all four tables (GDPR)                                        |
| ATS-006-I2 | **Given** a user on mobile with plans and templates, **when** they erase their account from the mobile settings surface, **then** the same erasure runs and none of that data survives | mobile   | Zero residual rows; the mobile entry point reaches the same mechanism, not a second one |
| ATS-006-I3 | **Given** an erasure that fails partway, **when** it is re-driven, **then** it completes and reports success                                                                           | web      | Idempotent; no partial residue                                                          |

---

## AT-006-J — Premium AI — **Phase 2, deferred**

**Requirements**: REQ-006, REQ-007, REQ-008, REQ-CN-001 · **Story**: US-006-006

**No acceptance scenarios are written.** Blocked on feature 005 (no AI provider exists) and feature 010 (no enforceable
premium entitlement — `subscriptionTier` is not a token claim). Scenarios will be written against those features' real
contracts. The May plan wrote premium acceptance criteria against a guessed entitlement mechanism, and the guess was
wrong; not repeating that is the point.

**Phase-1 acceptance obligation**: no premium surface, control or upsell for FR-025/026/027 appears anywhere in the
planner (verified by ATS-006-F4's sibling check in the component matrix).

---

## Requirement → Acceptance Coverage

| Requirement                                    | Acceptance scenarios                               |
| ---------------------------------------------- | -------------------------------------------------- |
| REQ-001, REQ-002                               | ATS-006-A1..A4                                     |
| REQ-003, REQ-021, REQ-022                      | ATS-006-B1..B10                                    |
| REQ-CN-008, REQ-CN-010, REQ-CN-011, REQ-CN-012 | ATS-006-B4, B9, B10                                |
| REQ-004, REQ-005                               | ATS-006-C1..C6                                     |
| REQ-006, REQ-007, REQ-008                      | **deferred (AT-006-J)**                            |
| REQ-009, REQ-010                               | ATS-006-C5, ATS-006-A2                             |
| REQ-011                                        | ATS-006-G1                                         |
| REQ-012, REQ-013                               | ATS-006-E1..E7                                     |
| REQ-014                                        | ATS-006-D1, D2, ATS-006-G3                         |
| REQ-015                                        | ATS-006-B8                                         |
| REQ-016                                        | ATS-006-B1..B3, ATS-006-H2, all **both** scenarios |
| REQ-017                                        | ATS-006-F1..F6                                     |
| REQ-018                                        | ATS-006-A5, A6                                     |
| REQ-019                                        | ATS-006-H4                                         |
| REQ-020                                        | ATS-006-I1                                         |
| REQ-NF-003, NF-004                             | ATS-006-H1..H5, ATS-006-C3, ATS-006-D1             |
| REQ-NF-006                                     | ATS-006-C5                                         |
| REQ-NF-007                                     | ATS-006-F3 and every **both** scenario             |
| REQ-IF-001                                     | ATS-006-D3..D6                                     |
| REQ-IF-005, IF-006                             | ATS-006-G2..G4                                     |
| REQ-IF-007                                     | ATS-006-F3                                         |
| REQ-CN-002                                     | ATS-006-A7                                         |
| REQ-CN-005                                     | ATS-006-A4                                         |
| REQ-CN-009                                     | ATS-006-A4, ATS-006-B4                             |

### Requirements carried by inspection rather than a BDD scenario

**Corrected 2026-08-02.** The previous revision claimed "37 / 37 … 100%" while nine Phase-1 requirements had no row in
the table at all. They are not gaps — each is a standing property verified by CI or code review rather than by a
user-observable scenario, which is what the Verification column in `requirements.md` already says. Recording them
explicitly is the difference between a covered requirement and an overlooked one.

| Requirement                                        | How it is verified instead                                                     |
| -------------------------------------------------- | ------------------------------------------------------------------------------ |
| REQ-NF-001, NF-002, NF-005, NF-008, NF-009, NF-010 | CI: `typecheck`, lint, the JSDoc/pattern-header rule, commit order, T067 audit |
| REQ-CN-003, REQ-CN-004                             | Schema inspection at T023 — asserted by the absence of a FK and of a table     |
| REQ-CN-006, REQ-CN-007                             | T067 audit: no reachable premium surface, no food-service call                 |
| REQ-IF-003                                         | ATS-006-A7 exercises owner scoping; the auth wiring itself is T024's tests     |
| REQ-IF-008                                         | Verified in the **recipe service's** own suite (T001–T003, ITS-015-C1..C4)     |

**Coverage**: 46 / 46 Phase-1 requirements are accounted for — 34 by at least one acceptance scenario, 12 by the
inspection/CI route recorded above. 5 Phase-2 requirements are explicitly deferred with the blocker named, and
REQ-IF-002 is withdrawn (`[DEPRECATED]`) and carries no obligation.

## Summary

| Metric                                   | Count                                 |
| ---------------------------------------- | ------------------------------------- |
| Acceptance test cases                    | 9 active (`A`–`I`) + 1 deferred (`J`) |
| Acceptance scenarios                     | 52                                    |
| Scenarios required on **both** platforms | 48                                    |
| Web-only scenarios                       | 4 (keyboard, ownership URL, erasure)  |
| Mobile-only scenarios                    | 1 (tap-to-assign interaction count)   |
| Degraded-state scenarios                 | 6 — **new**                           |
| Accessibility scenarios                  | 5                                     |

## Exit Criteria

The feature is acceptance-complete when:

1. All 52 scenarios pass, on both platforms where marked.
2. SC-006-001 through SC-006-005 are demonstrated — three of them from CI evidence rather than a session.
3. Every `Undesirable` hazard has its mitigating test passing (see [`traceability-matrix.md`](./traceability-matrix.md)
   Matrix H).
4. The premium-surface-absence check passes: no FR-025/026/027 control ships.
