# Product Specification: Commise - Meal Planning

**Branch**: `006-meal-planning`
**Date**: 2026-05-09 | **Reconciled**: 2026-08-02
**Status**: Draft — Phase 1 ready for planning; Phase 2 deferred
**Source**: [spec.md](../spec.md) (source of truth for FR/NFR/SC ids and the Clarifications that resolve open questions)

> **Reconciliation note (2026-08-02).** Three changes: the two "inferred" stories are now **decided** (templates
> promoted to FR-028, family sizing to FR-030) rather than left as warnings for three months; the premium AI stories are
> **explicitly deferred** to Phase 2 with their blockers named; and every story now states its **mobile** counterpart,
> because a story that only ships on web violates a hard rule (`CODING_STANDARDS §14.1`) and cannot be "Must Have".

---

## Vision

Meal Planning turns Commise from a recipe repository into a repeatable planning system for real households. Users
should be able to build plans quickly, adapt them easily, and carry them through to shopping with clear nutritional
context.

**Tagline**: "Plan fast, eat well, waste less."

**Core principles**:

- Planning should feel tactile and editable — a week you can see and rearrange, on whichever device is in your hand.
- Nutrition should be visible without leaving the planner, and **honest**: a partial estimate is labelled as one rather
  than rounded into a confident number.
- Repeating a good week should be cheap. Re-planning from scratch every Sunday is the reason people abandon meal
  planners.
- Grocery handoff is a completion step, but the grocery _rules_ belong to 007. 006 hands over data, not opinions.
- Premium AI should assist, not replace user control — and is not part of the first release.

---

## Personas

### Primary — P3 Riley (Family Meal Planner)

**Archetype**: Family Meal Planner
**Core motivation**: Quick, kid-friendly, weekly rotation, household scale

**Goals**:

- See the full week at a glance without switching screens — a grid on the laptop, a scannable day list on the phone.
- Reuse proven weekly structures so planning takes minutes, not an hour.
- Adjust servings per meal to match who is actually eating.
- Move from a finished plan into the shopping workflow without re-entering anything.

**Pain points**:

- Re-entering near-identical plans week after week.
- Losing the thread between planning and shopping.
- Serving math that ignores household headcount.

**Serves**: FR-022, FR-023, FR-028, FR-030, FR-034, FR-036, SC-006-001, SC-006-002
**Stories**: US-006-001, US-006-002, US-006-004

_Reconciliation: Riley's "recurring plan support" goal is **not** met in Phase 1. Templates (FR-028) cover the "same
rotation every week" pain; automatic recurrence is deferred (spec C-006-008). Stating this plainly is better than
implying a goal is served when it is not._

---

### Secondary — P4 Sam (Nutrition & Diet Planner)

**Archetype**: Nutrition & Diet Planner
**Core motivation**: Macros, diet protocols, goal tracking

**Goals**:

- See per-day and whole-plan macro totals (calories, protein, carbs, fat) update as meals are assigned.
- Swap a single meal and immediately see how the totals shift.
- Keep tracking inside the planner rather than a parallel spreadsheet.

**Pain points**:

- Nutrition visible on individual recipe pages but disconnected from plan-level decisions.
- No cumulative view without exporting and doing the maths elsewhere.

**Serves**: FR-024, NFR-004, NFR-006
**Stories**: US-006-003

_Reconciliation: two of Sam's original goals move out of 006. **Validating a plan against a diet protocol** and
**surfacing gaps as warnings** ("low protein on Thursday") both require nutrition **targets**, which feature 009 owns
and which do not exist. 006 renders totals; 009 renders compliance against them, reading 006's projection (FR-036).
Building a second, divergent definition of "on target" inside 006 would be the wrong layer. Also note **fibre is not
available** — the shipped recipe nutrition model carries calories/protein/carbs/fat only (spec C-006-004)._

---

### Tertiary — P6 Avery (Waste Optimizer)

**Archetype**: Waste Optimizer
**Core motivation**: Use-the-fridge, ingredient chaining, cost reduction

**Goals**:

- Route leftover ingredients from one meal into another later in the week.
- Get suggestions that reduce the number of unique ingredients across the plan.
- Accept or reject proposals without losing manual control.

**Serves**: FR-025, FR-026, FR-027
**Stories**: US-006-006 — **Phase 2, deferred**

_Reconciliation: Avery is **not served by Phase 1**, and this persona should not be used to justify Phase 1 scope. Every
one of Avery's goals depends on FR-025/026/027, which are blocked on feature 005 (no AI provider surface exists) and
feature 010 (no enforceable premium entitlement exists — see spec C-006-009). Leftover chaining is additionally deferred
on its own merits: it needs a consumption model no requirement drives (C-006-008)._

---

## Epics

| #   | Epic                         | Priority | Phase | Notes                                                        |
| --- | ---------------------------- | -------- | ----- | ------------------------------------------------------------ |
| E1  | Plan creation and scheduling | P2       | 1     | Plans, entries, both platforms                               |
| E2  | Nutrition visibility         | P2       | 1     | Read-time totals with honest partiality                      |
| E3  | Plan reuse (templates)       | P3       | 1     | Promoted from "inferred" — the main anti-churn lever         |
| E4  | Home presence and navigation | P2       | 1     | Retires the roadmap placeholder 001 shipped for this feature |
| E5  | Downstream handoff           | P2       | 1     | Read projection only; 007/009 own their own logic            |
| E6  | Premium AI assistance        | P4       | **2** | **Deferred** — blocked on 005 and 010                        |

---

## Stories (MoSCoW)

### Must Have — Phase 1

1. **US-006-001 — Create Plan.** As an authenticated user, I can create a meal plan over a date range with the meal
   slots I actually use, on web and mobile.
   **FRs**: FR-022, FR-029, FR-034, FR-037 · **Epic**: E1
2. **US-006-002 — Assign Meals.** As a planner, I can assign recipes to (day, slot) cells, set servings, add a note,
   move an entry and remove one — by drag **or keyboard** on web, by tap on mobile.
   **FRs**: FR-023, FR-030, FR-031, FR-032, FR-033, FR-034 · **Epic**: E1
3. **US-006-003 — View Nutrition Summary.** As a planner, I can see per-day and whole-plan macro totals, with partial
   estimates clearly labelled and empty days showing nothing rather than zeroes.
   **FRs**: FR-024, FR-033, NFR-004, NFR-006 · **Epic**: E2
4. **US-006-005 — Home Widget and Navigation.** As a returning user, I see "This Week's Meals" on Home and can reach the
   planner from Home navigation, on both platforms.
   **FRs**: FR-035 · **Epic**: E4 · _Also satisfies 001 US-000 scenario 6 and retires the skeleton placeholder._
5. **US-006-004 — Complete the Planning Workflow.** As a planner, I can go from an empty plan to a grocery projection
   for a 7-day plan in under 10 minutes.
   **FRs/SC**: FR-036, SC-006-001 · **Epic**: E5

### Should Have — Phase 1

6. **US-006-007 — Plan Templates.** As a frequent planner, I can save a week I like as a template and apply it to a
   future date range, with a clear report of anything that could not be carried over.
   **FRs**: FR-028 · **Epic**: E3
   _Was "US-006-008 (Inferred)". Promoted to a committed requirement by spec C-006-008._

### Won't Have — this feature

- **Recurring schedules** (automatic weekly repetition). Needs a scheduling engine; no requirement drives it
  (C-006-008). Templates cover the same user pain at a fraction of the cost.
- **Leftover tracking / carry-forward.** Needs a consumption model (C-006-008).
- **Lock / finalize.** Dropped — its only purpose was freezing a plan for grocery ordering, and 007 does not exist
  (C-006-007).
- **Nutrition goals, targets and compliance warnings.** Owned by 009.
- **Grocery list generation, ingredient aggregation, unit merging, pantry rules.** Owned by 007. 006 exposes entries;
  007 aggregates them.
- **Plan sharing or collaborative editing.** Plans are private to their owner (FR-029). No requirement asks otherwise.
- **Fully autonomous plan execution without user review.**
- **Unauthenticated planning.**

### Phase 2 — deferred, not scheduled

7. **US-006-006 — AI Suggestions, Auto-Generation and Waste Optimization (Premium).**
   **FRs**: FR-025, FR-026, FR-027 · **Epic**: E6
   **Blocked by**: feature 005 (no AI provider surface) **and** feature 010 (no enforceable entitlement —
   `subscriptionTier` is in the identity `accounts` table, not a token claim; a guard reading `tier` from the token
   would deny every user). See spec C-006-009.
   Acceptance criteria are deliberately **not** written yet: they will be written against 005's and 010's real
   contracts. The previous draft wrote them against guessed contracts and guessed wrong.

_Story-number note: `US-006-008` (templates) and `US-006-009` (family sizing) from the May draft are retired as
identifiers. Templates are now `US-006-007`; family sizing is not a separate story — it is entry `servings` inside
`US-006-002` (FR-030), because a "family size preset" that only sets a number on an entry does not need its own flow._

---

## Cross-Platform Commitment

`CODING_STANDARDS §14.1` is a hard rule: every user-facing story ships to web **and** mobile in the same release, and a
task list missing the mobile counterpart must be rejected in review. **No parity waiver is taken for this feature.**

| Story      | Web                                           | Mobile                                            |
| ---------- | --------------------------------------------- | ------------------------------------------------- |
| US-006-001 | Creation dialog; week grid                    | Creation screen; day list                         |
| US-006-002 | `@dnd-kit` pointer drag **+ keyboard sensor** | Tap cell → picker sheet; long-press → move/remove |
| US-006-003 | Sticky nutrition summary                      | Collapsible per-day summary + plan total          |
| US-006-005 | `MealPlanHomeWidget.tsx`                      | `MealPlanHomeWidget.native.tsx`                   |
| US-006-004 | Grocery projection entry point                | Same                                              |
| US-006-007 | Save/apply template dialogs                   | Save/apply template sheets                        |

The drag-vs-tap difference is an **interaction fork, not a capability gap** — both platforms expose the same operations
over one shared command surface (`useMealPlanBoard`), and tests assert the resulting board state rather than the
gesture.

---

## Out of Scope

- Nutrition-plan authoring, targets and compliance (feature 009).
- Grocery list ownership, aggregation rules and retailer integration (feature 007).
- AI provider management and model orchestration (feature 005).
- Subscription entitlement modelling (feature 010).
- Recipe CRUD, search, visibility and access rules (feature 001) — 006 reads recipes and never re-derives their rules.

## Open Questions

None blocking. The three open questions carried by the May plan (template persistence, recipe scaling, lock semantics)
are resolved in spec Clarifications C-006-008, C-006-007 and FR-030 respectively.

The two long-standing WARNINGs from the 2026-05-12 verify report are **closed**:

- **W-001** (templates/recurrence not explicit FRs) → templates are FR-028; recurrence is explicitly out of scope.
- **W-002** (family sizing and leftovers inferred) → family sizing is FR-030; leftovers are explicitly out of scope.
