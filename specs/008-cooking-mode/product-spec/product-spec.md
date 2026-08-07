# Product Specification: Cooking Mode

**Branch**: `008-cooking-mode`
**Date**: 2026-05-09
**Status**: Draft
**Source**: [spec.md](../spec.md)

---

## Vision

Cooking Mode turns recipe content into an execution interface that works when a cook's hands are occupied, wet, or gloved. The experience prioritizes large readability, minimal interaction cost, reliable timers, and uninterrupted screen visibility so users can stay in flow from first step to completion.

**Tagline**: "Cook step-by-step without breaking momentum."

**Core principles**:

- One active step, clearly readable.
- Multiple navigation paths (tap/swipe) with predictable behavior.
- Timers are first-class in-flow tools, not external utilities.
- Screen behavior must support hands-free kitchen reality.

---

## Personas

### P1 Casey — Beginner Cook (Primary)

**Profile**: Building kitchen confidence, often cooking from a recipe for the first time. Casey multitasks with heat, utensils, and limited clean-hand moments. Casey also has accessibility needs: relies on large text, voice control, screen reader support, and hands-free interaction for safety and confidence in the kitchen.

**Goals**:

- Read and execute instructions clearly from a distance, with large legible text.
- Move forward/back through steps without friction.
- Trust timer alerts while focusing on cooking tasks.
- Navigate cooking mode with accessible names, predictable controls, and non-color cues.
- Operate the interface hands-free via voice commands or assistive tech.

**Pain points**:

- Screen sleeps mid-step.
- Tiny controls and dense text slow execution and create safety risk.
- Context switching to external timers breaks flow.
- Ambiguous icon-only states and VoiceOver-unfriendly controls undermine confidence.

**Fits**: Must Have stories FR-032..FR-035; NFR/REQ-NF accessibility constraints and quality gates.

---

### P2 Taylor — Aspiring Chef (Secondary)

**Profile**: Pursuing technique mastery and tackling advanced dishes. Taylor wants cooking mode to support complex, multi-step recipes with precision timing and inline technique reference.

**Goals**:

- Run timer chains across multiple concurrent steps without losing track.
- Access technique videos or tips inline without leaving cooking flow.
- Navigate long, complex recipes confidently.

**Pain points**:

- No way to manage overlapping timers for multi-component dishes.
- Technique context (e.g., "what does a proper sear look like?") requires leaving the app.

**Fits**: Should Have and Could Have stories; FR-033, FR-034 timer concurrency.

---

### P9 Drew — Professional Chef (Tertiary)

**Profile**: Kitchen-pro precision. Drew runs mise en place workflows and needs cooking mode to support pacing and timing across a full service prep sequence.

**Goals**:

- See mise en place display with clear ingredient/prep status at a glance.
- Manage pacing and timing across multiple recipe components simultaneously.
- Move through steps rapidly without accidental taps.

**Pain points**:

- Consumer-grade UX slows professional prep cadence.
- No support for batch-scale or multi-component timing in a single session.

**Fits**: Could Have and Won't Have stories; advanced timer and session management.

---

## Epics

### Epic A: Guided Step Execution

Deliver a one-step-at-a-time interface with robust forward/back navigation and progress context.

**User stories**: US-001, US-002.
**FR coverage**: FR-032, FR-033.

---

### Epic B: In-Context Timing and Attention

Support per-step timers, concurrent timer management, and completion alerts without leaving cooking flow.

**User stories**: US-003, US-004.
**FR coverage**: FR-034.

---

### Epic C: Kitchen Continuity

Keep the screen awake in cooking mode and preserve flow through interruptions/connectivity changes.

**User stories**: US-005.
**FR coverage**: FR-035.

---

## Stories (MoSCoW)

### Must Have

| ID     | Story                                                                                                                                                | FR mapping                  | Acceptance Criteria                                                                                                                        |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| US-001 | As a cook, I can enter Cooking Mode and see one instruction step at a time in large readable text so that I can cook from the screen without strain. | [FR-032](../spec.md#fr-032) | 1. Entering mode always opens at first step. 2. Instruction text is large and legible in kitchen context. 3. Step position is visible.     |
| US-002 | As a cook, I can navigate forward and backward through steps using simple interactions so that I can progress or review without losing position.     | [FR-033](../spec.md#fr-033) | 1. Next/previous navigation works reliably. 2. First/last step boundaries are safe. 3. Current position remains accurate after navigation. |
| US-003 | As a cook, I can start timers directly from timed steps so that waiting steps are tracked in context.                                                | [FR-034](../spec.md#fr-034) | 1. Timed steps expose timer action. 2. Countdown is visible while active. 3. Multiple timers can run concurrently.                         |
| US-004 | As a cook, I receive a clear alert when a timer completes so that I do not miss critical cook transitions.                                           | [FR-034](../spec.md#fr-034) | 1. Timer completion triggers audible and visual signal. 2. Alert state is accessible to assistive tech.                                    |
| US-005 | As a cook, Cooking Mode keeps my device screen awake while active so that I can continue hands-free without re-waking the device.                    | [FR-035](../spec.md#fr-035) | 1. Screen does not auto-sleep during active cooking mode. 2. Wake behavior is released on exit.                                            |

**Traceability**: 5 Must Have stories / 5 mapped to canonical FRs = 100% coverage.

---

### Should Have

| ID     | Story                                                                                                           | FR mapping                                               | Acceptance Criteria                                                                                                                                |
| ------ | --------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| US-006 | As a cook, I can use voice commands for next/back/timer so that I can operate mode with fully occupied hands.   | [FR-033](../spec.md#fr-033), [FR-034](../spec.md#fr-034) | 1. Voice mode can be toggled on/off. 2. Supported commands execute reliably in controlled kitchen noise. 3. Failures provide clear retry feedback. |
| US-007 | As a cook, I can recover an in-progress session after short interruption so that I can resume where I left off. | [FR-033](../spec.md#fr-033), [FR-035](../spec.md#fr-035) | 1. Resume prompt appears for recent sessions. 2. Step index and active timers restore correctly.                                                   |

---

### In v1 scope — promoted from Could Have (2026-08-05)

| ID     | Story                                                                                                            | FR mapping                    | Acceptance Criteria                                                                                                                                                                                                             |
| ------ | ---------------------------------------------------------------------------------------------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| US-008 | As a cook, I can check off ingredients in a panel while cooking so that I can track prep completion.             | [FR-032a](../spec.md#fr-032a) | 1. Ingredient list opens and dismisses without leaving the active step. 2. Checked state is clear, accessible, and survives step navigation and session resume. 3. The stored recipe is never modified.                         |
| US-009 | As a cook, I can apply cook-time scaling guidance in mode so that ingredient quantities match adjusted servings. | [FR-034a](../spec.md#fr-034a) | 1. User can choose a scaling factor. 2. Ingredient quantities recalculate for the scaled yield. 3. Timer durations are **unchanged**, and an advisory states cook times are not scaled. 4. The stored recipe is never modified. |

**Resolved** (superseding the prior "no explicit canonical FR" warning): both stories were promoted into v1 scope at the
2026-08-05 revalidation gate and now have backing requirements `FR-032a` and `FR-034a` in `spec.md` (D-001). US-009's wording
changed from "timing and ingredient flow" to **quantities only** per D-002 — cook time does not scale linearly with yield.

### Could Have

_(none remaining — the previous entries were promoted above.)_

---

## Out of Scope

- Real-time multi-device step sync (plan phase-2 concept only).
- AI conversational coaching beyond bounded command grammar.
- Any direct modifications to recipe-authoring schemas from feature 001.
