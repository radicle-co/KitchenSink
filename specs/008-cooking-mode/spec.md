# Feature Specification: Cooking Mode

**Feature Branch**: `008-cooking-mode`
**Created**: 2026-04-14
**Status**: Draft
**Input**: Split from `001-commise-recipe-app` — step-by-step hands-free cooking interface with timers and screen wake lock.

## Dependencies

| Spec                                                        | Relationship                                                     |
| ----------------------------------------------------------- | ---------------------------------------------------------------- |
| [001-commise-recipe-app](../001-commise-recipe-app/spec.md) | **Required** — cooking mode renders Recipe instructions from 001 |
| [002-user-auth](../002-user-auth/spec.md)                   | **Required** — all features require authentication               |

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Cooking Mode (Priority: P2)

A user selects a recipe and enters "Cooking Mode," which presents a step-by-step, hands-free-friendly interface optimized for use while actively cooking. Instructions are displayed one step at a time in large, readable text. The user advances through steps with simple gestures, taps, or voice commands. Timers are integrated for steps that require waiting.

**Why this priority**: Cooking mode is a high-engagement feature that makes the app genuinely useful in the kitchen, differentiating it from static recipe viewers.

**Independent Test**: Can be tested by entering cooking mode for a recipe with 8+ steps and timers, advancing through all steps, and verifying timers work correctly.

**Acceptance Scenarios**:

1. **Given** a user selects a recipe, **When** they enter Cooking Mode, **Then** the first instruction step is displayed in large, readable text optimized for kitchen use.
2. **Given** a user is in Cooking Mode, **When** they advance to the next step, **Then** the display transitions smoothly to show the next instruction.
3. **Given** a step includes a time duration (e.g., "bake for 25 minutes"), **When** the user starts the timer, **Then** a countdown is displayed and an alert sounds when complete.
4. **Given** a user is in Cooking Mode, **When** they want to go back to review a previous step, **Then** they can navigate backward without losing their place.
5. **Given** a user is cooking, **When** the device screen would normally turn off, **Then** Cooking Mode keeps the screen active.
6. **Given** a user is on any step, **When** they open the ingredient list and check off an ingredient, **Then** that ingredient
   reads as checked, and it is still checked after navigating to another step and back (FR-032a).
7. **Given** a user sets the yield to 2×, **When** they view the ingredient list, **Then** ingredient quantities are doubled, the
   stored recipe is unchanged, every step's timer duration is unchanged, and an advisory states that cook times are not
   scaled (FR-034a).

---

### Edge Cases

- What happens during Cooking Mode if the device loses internet connectivity?

## Requirements _(mandatory)_

### Functional Requirements

**Cooking Mode**

- **FR-032**: System MUST provide a Cooking Mode that displays recipe instructions one step at a time in large, readable formatting.
- **FR-032a**: System MUST provide, within Cooking Mode, an ingredient list that can be opened and dismissed without leaving the
  current step, in which each ingredient can be individually checked off. Checked state MUST persist for the lifetime of the
  cooking session (including across step navigation and session recovery per FR-033) and MUST NOT mutate the stored recipe.
- **FR-033**: System MUST allow users to navigate forward and backward through recipe steps in Cooking Mode.
- **FR-034**: System MUST provide integrated countdown timers for recipe steps that include time durations.
- **FR-034a**: System MUST allow the user to scale the recipe's serving yield from within Cooking Mode and MUST recalculate
  displayed ingredient quantities for the scaled yield. Scaling MUST NOT alter any step's timer duration; where a scale factor
  other than 1× is active, Cooking Mode MUST surface an advisory that cook times are not scaled and may need adjustment.
  Scaling MUST NOT mutate the stored recipe.
- **FR-035**: System MUST keep the device screen active while Cooking Mode is engaged.

### Non-Functional Requirements _(constitution-derived)_

- **NFR-001**: All TypeScript MUST compile with `strict: true`; no `any` used outside explicitly marked test doubles. (Constitution Principle I)
- **NFR-002**: All exported functions and interfaces MUST carry JSDoc documentation. (Principle II)
- **NFR-003**: Any UI component MUST expose an accessible name queryable via `getByRole`/`getByLabel` in Playwright tests. (Principles IV & VII)
- **NFR-004**: Color MUST NOT be the sole conveyor of state; icon or text label pairing required. (Principle VII)

### Key Entities

Cooking Mode defines **no** recipe-shaped entity of its own. Per **GR-007** it consumes the shipped types from
`@kitchensink/recipe-core` — in particular `RecipeStep` (`stepNumber`, `instruction`, `timerSeconds`), which already carries the
per-step inline duration FR-034 requires, and `Ingredient`, which FR-032a checks off and FR-034a scales for display. Defining a
local `RecipeInstruction` (or any local copy of `Recipe`/`Step`/`Ingredient`) is prohibited by GR-007 AC-007-d.

Cooking Mode owns only **session-scoped, non-persisted** state: `CookingSession` (current step index, completed steps, checked
ingredients, active scale factor) and `CookingTimer`. None of it mutates the stored recipe.

## Decisions

- **D-001 (FR numbering, 2026-08-05)**: US-008 and US-009 were promoted into v1 scope and required backing FRs. 008 owns only
  `FR-032`..`FR-035` (`FR-036`/`FR-037` belong to 009 — see `../spec-sweep-2026-08-02.md`), so the new requirements take the
  letter-suffix form `FR-032a` / `FR-034a`, following the `004-FR-014a` precedent (004 D-017). No neighbor's range is disturbed.
- **D-002 (scaling does not scale time, 2026-08-05)**: `tasks.md` T-016 previously specified "timer recalculation" while US-009
  specified scaling _guidance_. Cook time does not scale linearly with yield — doubling a batch does not double bake time — so
  auto-scaling timers would produce wrong, potentially unsafe cooking instructions. FR-034a therefore scales **quantities only**
  and surfaces an advisory. The contradiction is resolved in favour of US-009.
- **D-003 (reuse `RecipeStep`, 2026-08-05)**: The prior plan defined a local `RecipeInstruction` type. `@kitchensink/recipe-core`
  already exports `RecipeStep` with the needed shape including `timerSeconds`; 008 imports it rather than duplicating it (GR-007).

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-007**: Cooking Mode steps are readable from 3 feet away on standard mobile devices.

## Assumptions

- Users have internet connectivity for core features; Cooking Mode should function with limited connectivity once the recipe is loaded.
