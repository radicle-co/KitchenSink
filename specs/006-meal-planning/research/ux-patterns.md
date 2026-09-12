# UX Patterns: Meal Planning

**Branch**: `006-meal-planning` | **Date**: 2026-05-09 | **Reconciled**: 2026-08-02
**Status**: Complete | **Source**: [spec.md](../spec.md), [plan.md](../plan.md), [research.md](../research.md)

> **Reconciliation note (2026-08-02).** Two corrections: the **lock/finalize** state is gone (spec C-006-007 — YAGNI,
> 007 does not exist), and every pattern below is now stated for **both platforms**. The May version described a
> web-only drag interaction, which `CODING_STANDARDS §14.1` would reject.

---

## 1. Planner Views

### 1.1 Weekly Calendar Grid (Primary — web)

Primary planning surface on web is a 7-column week grid with meal slots per day:

- Columns: the seven days of the plan week, **starting on the active locale's first day of week** (FR-037) — not
  hard-coded to Monday
- Rows/sections per column: the plan's configured slots only (a plan without snacks shows no snack row)
- Slot states: `empty`, `assigned`, `orphaned`, `saving`, `error`

**Why**: aligns with the FR-022/FR-023 core loop and gives the fastest comprehension for drag scheduling.

### 1.2 Day List (Primary — mobile)

Mobile's primary surface is a vertical day list, each day a section containing its configured slots. The week grid is
not adapted to a phone; it is replaced.

- Swipe or paginate between weeks; a sticky day header keeps the date visible
- The same five slot states, with the same labels and accessible names as web
- Tap an empty slot → recipe picker sheet; long-press an assigned entry → move / change servings / remove

**Why**: a 7-column grid is unreadable at phone width, and card-dragging inside a scrolling grid competes with the
scroll gesture. Tap-to-assign also reaches SC-006-002 (≤ 3 interactions) more reliably than drag.

---

### 1.3 Monthly Overview (Secondary — both platforms)

Monthly view provides density and planning-horizon visibility:

- Day cells show a count badge and one anchor (typically the dinner title)
- Opening a day reveals the same slot model as the primary view
- On mobile the month view is a compact calendar that drills into the day list

**Why**: supports "what's coming" planning and matches the `planner-month` wireframe.

---

## 2. Assignment Interaction

### 2.1 Web — pointer drag **and** keyboard

`@dnd-kit/core` + `@dnd-kit/sortable`:

1. Drag a recipe card from the sidebar/search results
2. Drop into a (day, slot) cell
3. Persist via `POST /api/v1/meal-plans/{id}/entries` with an `Idempotency-Key` (FR-032)
4. Render optimistically; reconcile failure with an inline retry that does not lose the user's placement

The **keyboard path is not an afterthought and not an alternative implementation** — it is `@dnd-kit`'s keyboard sensor
over the same drag machinery: focus a recipe, `Space` to lift, arrow keys to traverse cells, `Space` to drop, `Escape`
to cancel, with live-region announcements at each step. This is the reason the library was chosen (NFR-003).

### 2.2 Mobile — tap to assign

1. Tap an empty slot → a recipe picker sheet opens, scoped to the user's readable recipes with search
2. Choose a recipe → sheet closes, entry renders optimistically
3. Same idempotent write, same inline retry on failure

Both platforms drive the **same** shared command surface (`useMealPlanBoard`); only the trigger differs. Tests assert
the resulting board state, not the gesture.

### 2.3 Accessibility guardrails (NFR-003 / NFR-004)

- Every slot and entry has an accessible name queryable by `getByRole` / `getByLabel`
- Every drag operation has a keyboard equivalent
- No state is conveyed by colour alone — `orphaned` and `partial nutrition` each carry a text label and an icon
- Optimistic and error states are announced, not merely styled

---

### 2.4 Degraded and orphaned states

- **Orphaned entry** (the recipe is no longer readable — FR-033): keep the card shell, replace the title with a
  "Recipe unavailable" label plus icon, keep the entry removable, and exclude it from totals while marking that day's
  nutrition partial.
- **Recipe service unavailable**: the plan and its entries still render from 006's own data; nutrition shows as
  "unavailable" with a retry, never as `0`. This is the user-visible half of the gateway's availability discipline.
- **Partial nutrition**: totals render with an explicit "estimate — some items not counted" label, never a bare number.

**Why**: the plan is 006's data and must remain usable even when a dependency is degraded; a confidently wrong total is
worse than an acknowledged partial one.

---

## 3. Plan Creation Pattern

### 3.1 Progressive Setup (Wizard-lite)

Recommended setup sequence for `plan-create`:

1. Date range + plan name
2. Meal slot defaults
3. Optional preferences/goals
4. Create empty plan

This supports both quick manual setup and premium AI seeding.

---

### 3.2 Family Sizing Control

At assignment or slot level, support serving multipliers and household-size presets.

**Traceability note**: family sizing is implied by `servings` in `plan.md` and domain brief, but not a dedicated FR in `spec.md`.

---

## 4. Templates and Recurrence

### 4.1 Plan Templates

Template UX for `plan-templates` should include:

- Save current plan as template
- Apply template from a chosen start date
- Preview before apply

**Traceability note**: templates appear as open question in `plan.md`; include as conditional UX pending explicit scope confirmation.

---

### 4.2 Recurring Meals

Recurring rules (e.g., “every Monday lunch”) reduce repetitive planning.

Pattern suggestion:

- Slot action: “Repeat...”
- Frequency options: weekly/biweekly/custom
- Conflict handling for occupied slots

**Traceability note**: no explicit FR currently; treat as candidate enhancement unless promoted during revalidation.

---

## 5. Nutrition and Goal Feedback

### 5.1 Daily / Whole-Plan Nutrition Panels

Nutrition summary panel shows:

- Per-day totals for calories, protein, carbohydrate and fat — **and nothing for a day with no entries** (blank, not
  zeroes, which would read as a genuine zero-calorie day)
- A whole-plan total
- A **partial-estimate label** on any day or total where a contributing entry could not be fully accounted, paired with
  an icon (NFR-004)
- **No fibre** — the shipped `RecipeNutrition` does not carry it (spec C-006-004)

Maps to FR-024. Note the dependency correction: these values come from the **recipe service**, not the food service.

### 5.2 Goal-Aware Warnings — deferred to 009

Goal progress bars and "high carb vs goal" / "low protein day" hints require nutrition **targets**, which 009 owns and
which do not exist yet. 006 renders totals; it does not render compliance. When 009 ships, it reads 006's projection
(FR-036) and owns the guidance. Keeping this out of 006 avoids a second, divergent definition of "on target".

---

## 6. Templates

### 6.1 Save as Template

From a populated plan: "Save as template" → name it → confirm. The template records entries by **relative day offset**
and slot, so it can be re-applied to any future start date.

### 6.2 Apply Template — review the skip report

1. Choose a template and a start date
2. The system creates the new plan and reports what it could **not** carry over: entries beyond the target range, and
   entries whose recipe is no longer readable
3. The counts are shown explicitly rather than silently dropped — a template that quietly loses three dinners is worse
   than one that says so

**Why**: silent partial success is the failure mode that makes users distrust templates.

### 6.3 Deferred: leftovers and recurrence

"Use leftovers" quick actions, serving carry-forward, and recurring weekly schedules are **out of scope** (spec
C-006-008). Leftovers need a consumption model and recurrence needs a scheduling engine; neither is driven by a current
requirement. The patterns are recorded here so they are designed, not re-discovered, when a requirement arrives.

---

## 7. Waste Optimization Review — Phase 2, deferred

For the FR-027 premium flow the pattern is review-first:

1. User requests optimization
2. System proposes swaps/reordering
3. User approves per suggestion or in bulk — **never a silent plan rewrite**

Deferred with Phase 2 (spec C-006-009). The review-first shape is the durable part and should survive whatever 005's
provider contract turns out to be.

---

## 8. Grocery Handoff

### 8.1 A projection, not a manifest ceremony

006 exposes a read projection of the plan's entries (FR-036). It does **not** aggregate ingredients, dedupe units, or
generate a list — those rules belong to 007, which owns them.

The May version of this section proposed a pre-handoff review showing an estimated line-item count, a dedupe note and a
lock/finalize option. All three are removed: the first two require the ingredient aggregation 006 no longer performs,
and the lock is dropped entirely (spec C-006-007). What remains is a plain entry point into 007's own flow, which
carries the date range.

Maps to SC-006-001 (end-to-end workflow target).

---

## Pattern Cross-Reference

| Pattern                                  | Primary FR/SC          | Status                              |
| ---------------------------------------- | ---------------------- | ----------------------------------- |
| Week grid (web) / day list (mobile)      | FR-022, FR-034, FR-037 | Phase 1                             |
| Monthly overview                         | FR-022, FR-034         | Phase 1                             |
| Drag assignment + keyboard sensor (web)  | FR-023, NFR-003        | Phase 1                             |
| Tap-to-assign (mobile)                   | FR-023, FR-034         | Phase 1                             |
| Orphaned-entry presentation              | FR-033, NFR-004        | Phase 1                             |
| Partial-estimate nutrition panel         | FR-024, NFR-004        | Phase 1                             |
| Templates + skip report                  | FR-028                 | Phase 1                             |
| Home widget ("This Week's Meals")        | FR-035                 | Phase 1                             |
| Grocery projection entry point           | FR-036, SC-006-001     | Phase 1 (006 side only)             |
| Goal-aware guidance                      | —                      | Deferred to 009                     |
| Leftovers, recurrence                    | —                      | Deferred (C-006-008)                |
| AI suggestion / auto-plan / waste review | FR-025/026/027         | Deferred to Phase 2 (C-006-009)     |
| Shopping handoff (projection only)       | FR-036, SC-006-001     | `spec.md`, `plan.md` §API Contracts |

## WARNING: Explicit Scope Gaps

- Recurring meals and templates have strong UX value but are not explicit FRs in `spec.md`.
- Family sizing and leftovers UX are modeled through existing fields and FR-027 intent; dedicated FRs may be needed for deterministic traceability.
