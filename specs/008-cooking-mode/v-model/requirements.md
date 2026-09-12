# V-Model Requirements Specification: Cooking Mode

**Feature Branch**: `008-cooking-mode`
**Created**: 2026-05-09
**Status**: Draft
**Source**: `specs/008-cooking-mode/spec.md`

## Overview

Cooking Mode is a step-by-step, hands-free-friendly interface for the Commise recipe app, optimized for active kitchen use. It displays recipe instructions one step at a time in large, readable text, supports forward/backward navigation, integrates countdown timers for timed steps, and keeps the device screen active throughout the session. It consumes Recipe data from feature 001-commise-recipe-app and requires authentication from 002-user-auth.

## Requirements

### Functional Requirements

| ID      | Description                                                                                                                                                                            | Priority | Rationale                                                                                                                                                        | Verification Method |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| REQ-001 | The system SHALL provide a Cooking Mode that displays recipe instructions one step at a time in large, readable formatting.                                                            | P1       | Core feature purpose — hands-free kitchen use requires clear, single-step display. (FR-032)                                                                      | Test                |
| REQ-002 | The system SHALL allow users to navigate forward through recipe steps in Cooking Mode.                                                                                                 | P1       | Users must be able to progress through a recipe sequentially. (FR-033)                                                                                           | Test                |
| REQ-003 | The system SHALL allow users to navigate backward through recipe steps in Cooking Mode without losing their current position.                                                          | P1       | Users must be able to review previous steps without restarting. (FR-033)                                                                                         | Test                |
| REQ-004 | The system SHALL provide integrated countdown timers for recipe steps that include a time duration (e.g., "bake for 25 minutes").                                                      | P1       | Timed steps require in-context timers to avoid context switching. (FR-034)                                                                                       | Test                |
| REQ-005 | The system SHALL display a visible countdown when a step timer is active.                                                                                                              | P1       | Users need real-time feedback on remaining time. (FR-034, Acceptance Scenario 3)                                                                                 | Demonstration       |
| REQ-006 | The system SHALL emit an audible alert when a step countdown timer completes.                                                                                                          | P1       | Kitchen environments are noisy; audio notification is required for usability. (Acceptance Scenario 3)                                                            | Test                |
| REQ-007 | The system SHALL keep the device screen active (prevent sleep/lock) while Cooking Mode is engaged.                                                                                     | P1       | Hands-free use means users cannot tap to wake the screen. (FR-035)                                                                                               | Test                |
| REQ-008 | The system SHALL display the first instruction step when a user enters Cooking Mode.                                                                                                   | P1       | Entry point must be deterministic and start at step 1. (Acceptance Scenario 1)                                                                                   | Test                |
| REQ-009 | The system SHALL transition smoothly between steps when the user advances in Cooking Mode.                                                                                             | P2       | Smooth transitions reduce cognitive load during cooking. (Acceptance Scenario 2)                                                                                 | Demonstration       |
| REQ-010 | The system SHALL support step navigation via simple gestures / taps in Cooking Mode.                                                                                                   | P2       | Hands may be occupied or wet; large-target, gesture-based input is required. (User Story 1)                                                                      | Test                |
| REQ-011 | The system SHALL remain functional in Cooking Mode when the device loses internet connectivity after the recipe has been loaded.                                                       | P2       | Kitchen environments may have intermittent connectivity; loaded recipe data must be available offline. (Edge Case)                                               | Test                |
| REQ-012 | The system SHALL provide, within Cooking Mode, an ingredient list that opens and dismisses without leaving the active step, in which each ingredient can be individually checked off.  | P2       | Cooks track prep completion while working; leaving the step to do so breaks the hands-free flow. (FR-032a, US-008, Acceptance Scenario 6)                        | Test                |
| REQ-013 | The system SHALL persist checked-ingredient state for the lifetime of the cooking session, across step navigation and session resume, without modifying the stored recipe.             | P2       | Checkoff is worthless if it resets on navigation; and per REQ-CN-001 Cooking Mode is a read-only consumer of Recipe data. (FR-032a)                              | Test                |
| REQ-014 | The system SHALL allow the user to scale the recipe's serving yield from within Cooking Mode and SHALL recalculate displayed ingredient quantities for the scaled yield.               | P2       | Cooks routinely halve or double a recipe at the stove and need correct quantities without leaving the mode. (FR-034a, US-009, Acceptance Scenario 7)             | Test                |
| REQ-015 | The system SHALL NOT alter any step's timer duration when a scale factor is applied, and SHALL surface an advisory that cook times are not scaled whenever the scale factor is not 1×. | P1       | Cook time does not scale linearly with yield; silently scaling timers would emit incorrect and potentially unsafe cooking instructions. (FR-034a, spec.md D-002) | Test                |

### Non-Functional Requirements

| ID         | Description                                                                                                                        | Priority | Rationale                                                                                     | Verification Method |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------- | -------- | --------------------------------------------------------------------------------------------- | ------------------- |
| REQ-NF-001 | All TypeScript code for Cooking Mode MUST compile with `strict: true`; `any` is prohibited outside explicitly marked test doubles. | P1       | Constitution Principle I — type safety is non-negotiable. (NFR-001)                           | Inspection          |
| REQ-NF-002 | All exported functions, interfaces in Cooking Mode MUST carry JSDoc documentation.                                                 | P1       | Constitution Principle II — documented APIs are required for maintainability. (NFR-002)       | Inspection          |
| REQ-NF-003 | Cooking Mode step text MUST be readable from 3 feet away on standard mobile devices.                                               | P1       | Kitchen use requires legibility at arm's length. (SC-007)                                     | Demonstration       |
| REQ-NF-004 | All Cooking Mode UI components MUST expose an accessible name queryable via `getByRole` / `getByLabel` in Playwright tests.        | P1       | Constitution Principles IV & VII — accessibility is required. (NFR-003)                       | Test                |
| REQ-NF-005 | Color MUST NOT be the sole conveyor of state in Cooking Mode UI; icon / text label pairing is required.                            | P1       | Constitution Principle VII — color-blind users must receive equivalent information. (NFR-004) | Inspection          |

### Interface Requirements

| ID         | Description                                                                                                                 | Priority | Rationale                                                                               | Verification Method |
| ---------- | --------------------------------------------------------------------------------------------------------------------------- | -------- | --------------------------------------------------------------------------------------- | ------------------- |
| REQ-IF-001 | The system SHALL consume Recipe entity data (steps, timers, instructions) as defined in feature 001-commise-recipe-app.     | P1       | Cooking Mode has no independent recipe data model; it renders from 001's Recipe entity. | Inspection          |
| REQ-IF-002 | The system SHALL require a valid authenticated session (per feature 002-user-auth) before allowing entry into Cooking Mode. | P1       | All features require authentication per 002-user-auth dependency.                       | Test                |

| REQ-IF-003 | The system SHALL provide equivalent web and mobile user-facing workflows for Cooking Mode, including the same core capabilities, entitlement behavior, error states, accessibility semantics, and recovery paths unless an explicit V-Model parity exception is recorded. | P1 | KitchenSink Constitution Principle VIII requires web/mobile lockstep for every user-facing capability. | Test |

### Constraint Requirements

| ID         | Description                                                                                | Priority | Rationale                                                                          | Verification Method |
| ---------- | ------------------------------------------------------------------------------------------ | -------- | ---------------------------------------------------------------------------------- | ------------------- |
| REQ-CN-001 | Cooking Mode MUST NOT modify Recipe data; it is a read-only consumer of the Recipe entity. | P1       | Cooking Mode is a presentation layer; data integrity of recipes must be preserved. | Inspection          |
| REQ-CN-002 | Screen wake lock MUST be released when the user exits Cooking Mode.                        | P1       | Retaining wake lock after exit would drain device battery unnecessarily.           | Test                |

## Assumptions

- Users have internet connectivity when initially loading a recipe; Cooking Mode may function with limited connectivity once the recipe is loaded.
- Voice command support is referenced in the user story but not specified as a formal requirement in the spec; it is excluded from this requirements document per the strict translator constraint.
- "Standard mobile devices" for readability testing (SC-007) refers to devices with screens ≥ 4.7 inches at typical display brightness.

## Dependencies

- **001-commise-recipe-app**: Provides the Recipe entity (steps, instructions, time durations) that Cooking Mode renders. Cooking Mode cannot function without a valid Recipe from this feature.
- **002-user-auth**: Provides authentication. All Cooking Mode entry points require a valid authenticated session.

## Glossary

| Term          | Definition                                                                                                  |
| ------------- | ----------------------------------------------------------------------------------------------------------- |
| Cooking Mode  | A full-screen, step-by-step interface for following a recipe while actively cooking.                        |
| Step          | A single instruction unit within a recipe, displayed one at a time in Cooking Mode.                         |
| Step Timer    | A countdown timer embedded within a recipe step that tracks a required wait duration (e.g., "bake 25 min"). |
| Wake Lock     | A device API that prevents the screen from sleeping while Cooking Mode is active.                           |
| Recipe Entity | The data model for a recipe as defined in feature 001-commise-recipe-app.                                   |

---

**Total Requirements**: 18
**By Priority**: P1: 15 | P2: 3 | P3: 0
**By Verification Method**: Test: 10 | Inspection: 5 | Analysis: 0 | Demonstration: 3
