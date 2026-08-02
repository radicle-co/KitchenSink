# Acceptance Test Plan: Cooking Mode

**Feature Branch**: `008-cooking-mode`
**Created**: 2026-05-09
**Status**: Draft
**Source**: `specs/008-cooking-mode/v-model/requirements.md`, `specs/008-cooking-mode/v-model/system-test.md`

## Overview

This document defines the Acceptance Test Plan for the Cooking Mode feature. It maps every functional, non-functional, interface, and constraint requirement from `requirements.md` to BDD-style acceptance test scenarios (AT-NNN-X), each with pass criteria. Cooking Mode is a read-only presentation layer that renders Recipe data from feature 001 and requires authentication from feature 002.

**ID Schema:**

- **Acceptance Test Case**: `AT-NNN-X` — NNN = feature number (008), X = sequential letter
- **Acceptance Test Scenario**: `ATS-NNN-X#` — nested under parent AT, numeric suffix

---

## Acceptance Test Cases (Tier 1–3 Structure)

### Tier 1: Feature Epic

### Tier 2: User Story / Requirement

### Tier 3: BDD Scenario (Given / When / Then)

---

### AT-008-A — Step-by-Step Display

**Requirement**: REQ-001, REQ-008

| ATS ID     | Scenario                                  | Given                                  | When                                                         | Then                                                                       |
| ---------- | ----------------------------------------- | -------------------------------------- | ------------------------------------------------------------ | -------------------------------------------------------------------------- |
| ATS-008-A1 | Enter Cooking Mode → first step displayed | User has a loaded recipe with ≥3 steps | User calls `POST /api/v1/cooking-mode/start` with `recipeId` | System returns step 1 content in large text; step indicator shows "1 of N" |
| ATS-008-A2 | Step text is readable from 3 feet         | Step content returned                  | Rendered on 4.7"+ mobile screen at arm's length              | Text size ≥ 18sp; contrast ratio ≥ 4.5:1                                   |
| ATS-008-A3 | Single step displayed at a time           | Cooking Mode active                    | User is on step 3                                            | Only step 3 text visible; steps 1, 2, 4+ not visible                       |

---

### AT-008-B — Forward Navigation

**Requirement**: REQ-002

| ATS ID     | Scenario                           | Given               | When             | Then                                                         |
| ---------- | ---------------------------------- | ------------------- | ---------------- | ------------------------------------------------------------ |
| ATS-008-B1 | Advance to next step               | User on step 2 of 5 | User taps "Next" | System displays step 3; step indicator updates to "3 of 5"   |
| ATS-008-B2 | Advance from last step             | User on step 5 of 5 | User taps "Next" | No change; step 5 remains displayed; "Finish" button appears |
| ATS-008-B3 | Gesture navigation (swipe forward) | User on step 2      | User swipes left | System displays step 3                                       |

---

### AT-008-C — Backward Navigation

**Requirement**: REQ-003

| ATS ID     | Scenario                        | Given               | When              | Then                                                                       |
| ---------- | ------------------------------- | ------------------- | ----------------- | -------------------------------------------------------------------------- |
| ATS-008-C1 | Go back one step                | User on step 4 of 7 | User taps "Back"  | System displays step 3; step indicator "3 of 7"; current position not lost |
| ATS-008-C2 | Back from step 1 → no change    | User on step 1      | User taps "Back"  | Step 1 remains displayed; no error                                         |
| ATS-008-C3 | Gesture navigation (swipe back) | User on step 5      | User swipes right | System displays step 4                                                     |

---

### AT-008-D — Countdown Timers

**Requirement**: REQ-004, REQ-005, REQ-006

| ATS ID     | Scenario                                | Given                                | When                   | Then                                                                   |
| ---------- | --------------------------------------- | ------------------------------------ | ---------------------- | ---------------------------------------------------------------------- |
| ATS-008-D1 | Timer displayed for timed step          | Step has `duration: '00:25:00'`      | User navigates to step | System shows countdown "25:00" visible; timer indicator active         |
| ATS-008-D2 | Countdown decrements in real time       | Timer at "24:30"                     | 60 seconds elapses     | Timer displays "23:30"                                                 |
| ATS-008-D3 | Audible alert on timer completion       | Timer at "00:10"                     | Timer reaches "00:00"  | System plays audible alert sound; visual flash notification also shown |
| ATS-008-D4 | Timer not displayed for non-timed step  | Step has no duration field           | User navigates to step | No timer UI shown for this step                                        |
| ATS-008-D5 | Multiple concurrent timers (impossible) | Two timed steps shown simultaneously | —                      | Not applicable — single step at a time                                 |

---

### AT-008-E — Screen Wake Lock

**Requirement**: REQ-007, REQ-CN-002

| ATS ID     | Scenario                              | Given                    | When                                 | Then                                                                 |
| ---------- | ------------------------------------- | ------------------------ | ------------------------------------ | -------------------------------------------------------------------- |
| ATS-008-E1 | Screen stays awake in Cooking Mode    | User enters Cooking Mode | User does not interact for 2 minutes | Screen remains on; device does not sleep                             |
| ATS-008-E2 | Wake lock released on exit            | Cooking Mode active      | User taps "Exit" or closes mode      | Screen wake lock released within 1 second; device can sleep normally |
| ATS-008-E3 | Wake lock released on navigation away | Cooking Mode active      | User navigates to another app/screen | Wake lock released automatically                                     |

---

### AT-008-F — Offline Functionality

**Requirement**: REQ-011

| ATS ID     | Scenario                               | Given                         | When                                          | Then                                                                 |
| ---------- | -------------------------------------- | ----------------------------- | --------------------------------------------- | -------------------------------------------------------------------- |
| ATS-008-F1 | Recipe loaded, then connectivity lost  | Recipe loaded in Cooking Mode | WiFi drops                                    | Cooking Mode continues to function; step navigation works            |
| ATS-008-F2 | Recipe not pre-loaded, no connectivity | Recipe not yet loaded         | User enters Cooking Mode without connectivity | System returns error "Recipe could not be loaded — check connection" |

---

### AT-008-G — Authentication Gate

**Requirement**: REQ-IF-002

| ATS ID     | Scenario                             | Given                     | When                                         | Then                                            |
| ---------- | ------------------------------------ | ------------------------- | -------------------------------------------- | ----------------------------------------------- |
| ATS-008-G1 | Valid session → Cooking Mode allowed | Valid Clerk session token | User calls `POST /api/v1/cooking-mode/start` | System proceeds to load recipe                  |
| ATS-008-G2 | No session → 401 returned            | No session token          | User calls `POST /api/v1/cooking-mode/start` | System returns 401; Cooking Mode not accessible |

---

### AT-008-H — Read-Only Constraint

**Requirement**: REQ-CN-001

| ATS ID     | Scenario                             | Given               | When                                      | Then                                                              |
| ---------- | ------------------------------------ | ------------------- | ----------------------------------------- | ----------------------------------------------------------------- |
| ATS-008-H1 | No write operations to Recipe        | Cooking Mode active | User navigates steps, uses timers         | Recipe data in 001 is unchanged after Cooking Mode session ends   |
| ATS-008-H2 | Timer start time stored locally only | User starts a timer | Timer state held in local component state | Timer completion triggers alert but does not write to any backend |

---

## Acceptance Criteria per REQ

| REQ ID     | Pre-condition                         | Success Condition                                                    | Technique                           |
| ---------- | ------------------------------------- | -------------------------------------------------------------------- | ----------------------------------- |
| REQ-001    | Recipe loaded                         | Single step displayed in large text; previous/next steps not visible | Statement Coverage                  |
| REQ-002    | User on step N where N < total        | "Next" advances to step N+1                                          | Branch Coverage                     |
| REQ-003    | User on step N where N > 1            | "Back" returns to step N-1; position not reset                       | Statement Coverage                  |
| REQ-004    | Step has duration field               | Countdown timer shown with correct initial time                      | Equivalence Partitioning            |
| REQ-005    | Timer active                          | Visible countdown updating every second                              | Statement Coverage (real-time test) |
| REQ-006    | Timer reaches 0                       | Audible alert played                                                 | Fault Injection (wait for timer)    |
| REQ-007    | Cooking Mode active                   | Device screen does not sleep                                         | Timing Test (2 min idle)            |
| REQ-008    | Valid recipe loaded                   | First step displayed on entry                                        | Statement Coverage                  |
| REQ-009    | Step transition                       | Animation completes; new step visible                                | Demonstration                       |
| REQ-010    | Cooking Mode active                   | Gesture input (swipe/tap) navigates steps                            | Statement Coverage                  |
| REQ-011    | Recipe loaded, then connectivity lost | Navigation continues to work                                         | Fault Injection                     |
| REQ-NF-001 | All TypeScript source                 | `tsc --strict` exits 0                                               | Inspection                          |
| REQ-NF-002 | All exported functions                | JSDoc present on all exports                                         | Inspection                          |
| REQ-NF-003 | Rendering on mobile                   | Text readable at 3 feet (18sp+ font, 4.5:1 contrast)                 | Demonstration                       |
| REQ-NF-004 | UI components                         | `getByRole`/`getByLabel` queries succeed                             | Playwright Integration Test         |
| REQ-NF-005 | Any colored state indicator           | Icon or text label accompanies color state                           | Accessibility Inspection            |
| REQ-IF-001 | Recipe from 001                       | Cooking Mode renders from existing Recipe entity schema              | Inspection                          |
| REQ-IF-002 | No session                            | 401 returned; entry blocked                                          | Fault Injection                     |
| REQ-CN-001 | After Cooking Mode session            | Recipe data in 001 unchanged                                         | Inspection (compare before/after)   |
| REQ-CN-002 | User exits Cooking Mode               | Wake lock released within 1 s                                        | Timing Test                         |

---

## Feature Test Summary Matrix

| REQ        | AT Count | Scenarios | Test Method              | Pass Criteria                                     |
| ---------- | -------- | --------- | ------------------------ | ------------------------------------------------- |
| REQ-001    | 1        | 3         | Statement Coverage       | Single step, large text, correct step indicator   |
| REQ-002    | 1        | 3         | Branch + Statement       | Step advances; last step shows Finish             |
| REQ-003    | 1        | 3         | Branch + Statement       | Step retreats; step 1 is floor                    |
| REQ-004    | 1        | 2         | Equivalence Partitioning | Timer shown for timed steps; absent for non-timed |
| REQ-005    | 1        | 2         | Real-time Test           | Countdown decrements; visible at all times        |
| REQ-006    | 1        | 1         | Fault Injection (wait)   | Audible alert plays at timer completion           |
| REQ-007    | 1        | 1         | Timing Test              | Screen on after 2 min idle                        |
| REQ-008    | 1        | 1         | Statement Coverage       | First step displayed on entry                     |
| REQ-009    | 1        | 1         | Demonstration            | Smooth transition animation                       |
| REQ-010    | 1        | 1         | Statement Coverage       | Gesture/tap navigation works                      |
| REQ-011    | 1        | 2         | Fault Injection          | Navigation works offline; error if not pre-loaded |
| REQ-NF-001 | 1        | 1         | Inspection               | `tsc --strict` clean                              |
| REQ-NF-002 | 1        | 1         | Inspection               | JSDoc on all exports                              |
| REQ-NF-003 | 1        | 1         | Demonstration            | Text readable at 3 feet                           |
| REQ-NF-004 | 1        | 1         | Playwright               | `getByRole`/`getByLabel` succeeds                 |
| REQ-NF-005 | 1        | 1         | Accessibility Inspection | Icon or text with every color state               |
| REQ-IF-001 | 1        | 1         | Inspection               | Recipe schema from 001                            |
| REQ-IF-002 | 1        | 2         | Fault Injection          | 401 without session                               |
| REQ-CN-001 | 1        | 2         | Inspection               | Recipe data unchanged after session               |
| REQ-CN-002 | 1        | 2         | Timing Test              | Wake lock released <1 s after exit                |

---

## Exit Criteria

For feature 008 to be considered shippable, ALL gates below must be green:

**Gate 1 — Functional Completeness**

- [ ] REQ-001 through REQ-011 all have passing acceptance test scenarios
- [ ] Step display, forward/backward navigation, and timer functionality work end-to-end

**Gate 2 — Accessibility**

- [ ] `tsc --strict` exits 0
- [ ] JSDoc on all exported functions and interfaces
- [ ] All UI components have `getByRole`/`getByLabel` accessible names
- [ ] No color-only state indicators (icon or text pairing required)
- [ ] Step text readable from 3 feet on 4.7"+ screens

**Gate 3 — Audio & Timers**

- [ ] Audible alert plays when timer reaches 00:00
- [ ] Visible countdown updates every second
- [ ] Timer absent for non-timed steps

**Gate 4 — Screen Wake Lock**

- [ ] Screen stays awake during active Cooking Mode
- [ ] Wake lock released within 1 second of exit

**Gate 5 — Offline**

- [ ] Once recipe is loaded, step navigation works without connectivity
- [ ] Clear error shown if recipe not pre-loaded and no connectivity

**Gate 6 — Data Integrity**

- [ ] Recipe data in 001 is unchanged after Cooking Mode session
- [ ] No write operations to Recipe entity from Cooking Mode

---

### AT-PARITY — Cross-platform parity for Cooking Mode

**Requirement**: REQ-IF-003

| ATS ID       | Scenario                     | Given                                                                | When                                                                          | Then                                                                                                                                                                               |
| ------------ | ---------------------------- | -------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ATS-PARITY-1 | Web/mobile capability parity | A user-facing Cooking Mode workflow is implemented on web and mobile | Product QA compares the web and mobile flows against the same requirement set | Both platforms expose the same core capabilities, entitlement behavior, error states, accessibility semantics, and recovery paths, or a documented V-Model parity exception exists |
| ATS-PARITY-2 | Parity regression gate       | A change modifies a Cooking Mode user-facing workflow                | The feature test plan is reviewed                                             | The change includes paired web and mobile acceptance coverage or a documented exception approved by product governance                                                             |
