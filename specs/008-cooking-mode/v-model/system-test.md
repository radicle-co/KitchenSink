# System Test Plan: Cooking Mode

**Feature Branch**: `008-cooking-mode`
**Created**: 2026-05-09
**Status**: Draft
**Source**: `specs/008-cooking-mode/v-model/system-design.md`

## Overview

This document defines the System Test Plan for Cooking Mode. Every system component
in `system-design.md` has one or more Test Cases (STP), and every Test Case has one or
more executable System Scenarios (STS) in technical BDD format (Given/When/Then).

System tests verify **architectural behavior**, not user journeys. Language must be
technical and component-oriented.

## ID Schema

- **System Test Case**: `STP-{NNN}-{X}` — where NNN matches the parent SYS, X is a letter suffix (A, B, C...)
- **System Test Scenario**: `STS-{NNN}-{X}{#}` — nested under the parent STP, with numeric suffix (1, 2, 3...)
- Example: `STS-001-A1` → Scenario 1 of Test Case A verifying SYS-001

## ISO 29119 Test Techniques

Each test case MUST identify its technique by name:

- **Interface Contract Testing** — Verifies API contracts from the Interface View
- **Boundary Value Analysis** — Tests data limits from the Data Design View
- **Equivalence Partitioning** — Tests representative data classes
- **Fault Injection** — Tests failure propagation from the Dependency View

## System Tests

### Component Verification: SYS-001 (Step Display)

**Parent Requirements**: REQ-001, REQ-008, REQ-009, REQ-NF-003, REQ-NF-004, REQ-NF-005

#### Test Case: STP-001-A (Step Display renders correct step content from props)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies that the Step Display component correctly consumes its React props contract `{ step: Step, stepIndex: number, totalSteps: number, timerState: TimerState }` and renders the expected step text and position indicator.

- **System Scenario: STS-001-A1**
    - **Given** the Step Display component receives props `{ step: { text: "Preheat oven to 375°F" }, stepIndex: 0, totalSteps: 5, timerState: { status: 'idle' } }`
    - **When** the component renders
    - **Then** the rendered output contains the step text "Preheat oven to 375°F" and the position indicator "1 / 5"

- **System Scenario: STS-001-A2**
    - **Given** the Step Display component receives props with `stepIndex: 4` and `totalSteps: 5`
    - **When** the component renders
    - **Then** the position indicator displays "5 / 5" and no "next step" affordance is rendered

#### Test Case: STP-001-B (Step Display triggers error boundary on render failure)

**Technique**: Fault Injection
**Target View**: Dependency View
**Description**: Verifies that when SYS-006 (Recipe Data Adapter) returns a malformed step object, the Step Display component activates its error boundary rather than propagating an unhandled exception.

- **System Scenario: STS-001-B1**
    - **Given** the Step Display component receives props where `step` is `undefined`
    - **When** the component attempts to render
    - **Then** the error boundary catches the render failure and displays a fallback error state; no unhandled exception propagates to the parent

- **System Scenario: STS-001-B2**
    - **Given** SYS-006 dependency is injected with a stub that returns `null` for the step field
    - **When** Step Display renders with the null step
    - **Then** the error boundary activates and the component does not crash the Cooking Mode session

#### Test Case: STP-001-C (Step Display reflects active timer state from SYS-003)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies that the Step Display correctly reads `timerState` from SYS-003 and renders the timer UI when status is `'running'` or `'done'`.

- **System Scenario: STS-001-C1**
    - **Given** the Step Display receives `timerState: { remaining: 120, status: 'running' }`
    - **When** the component renders
    - **Then** a timer display element is present showing the remaining time value

- **System Scenario: STS-001-C2**
    - **Given** the Step Display receives `timerState: { remaining: 0, status: 'done' }`
    - **When** the component renders
    - **Then** the timer display indicates completion state (not a running countdown)

---

### Component Verification: SYS-002 (Step Navigation)

**Parent Requirements**: REQ-002, REQ-003, REQ-010

#### Test Case: STP-002-A (Step Navigation enforces boundary conditions at first and last step)

**Technique**: Boundary Value Analysis
**Target View**: Data Design View
**Description**: Verifies that the Step Navigation module clamps `stepIndex` to `[0, totalSteps-1]` and issues no-op callbacks at boundaries, per the Interface View contract.

- **System Scenario: STS-002-A1**
    - **Given** Step Navigation is initialized with `currentIndex: 0` and `totalSteps: 5`
    - **When** the `onPrev` callback is invoked
    - **Then** `stepIndex` remains `0`; no state mutation occurs; no error is thrown

- **System Scenario: STS-002-A2**
    - **Given** Step Navigation is initialized with `currentIndex: 4` and `totalSteps: 5`
    - **When** the `onNext` callback is invoked
    - **Then** `stepIndex` remains `4`; no state mutation occurs; no error is thrown

- **System Scenario: STS-002-A3**
    - **Given** Step Navigation is initialized with `currentIndex: 2` and `totalSteps: 5`
    - **When** `onNext` is invoked
    - **Then** `stepIndex` transitions to `3`

#### Test Case: STP-002-B (Step Navigation exposes correct gesture/tap input handlers)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies that the Step Navigation module exposes `onNext` and `onPrev` as callable handlers and that invoking them produces the correct `stepIndex` output.

- **System Scenario: STS-002-B1**
    - **Given** Step Navigation is mounted with `currentIndex: 1`, `totalSteps: 3`, and handler stubs for `onNext` and `onPrev`
    - **When** `onNext` is called once
    - **Then** the updated `stepIndex` emitted is `2`

- **System Scenario: STS-002-B2**
    - **Given** Step Navigation is mounted with `currentIndex: 1`, `totalSteps: 3`
    - **When** `onPrev` is called once
    - **Then** the updated `stepIndex` emitted is `0`

#### Test Case: STP-002-C (Step Navigation fails gracefully when SYS-006 is unavailable)

**Technique**: Fault Injection
**Target View**: Dependency View
**Description**: Verifies that when SYS-006 (Recipe Data Adapter) fails to provide step boundary data, Step Navigation does not go out of range.

- **System Scenario: STS-002-C1**
    - **Given** SYS-006 is stubbed to return an empty steps array (`[]`)
    - **When** Step Navigation initializes with `totalSteps: 0`
    - **Then** both `onNext` and `onPrev` are no-ops; `stepIndex` remains `0`; no array-out-of-bounds error occurs

---

### Component Verification: SYS-003 (Timer Engine)

**Parent Requirements**: REQ-004, REQ-005, REQ-006

#### Test Case: STP-003-A (Timer Engine state machine transitions: idle → running → done)

**Technique**: Equivalence Partitioning
**Target View**: Behavioral View
**Description**: Verifies the Timer Engine state machine transitions through `idle → running → done` and emits an audible alert on completion, per the state machine specification.

- **System Scenario: STS-003-A1**
    - **Given** the Timer Engine is in state `{ status: 'idle' }`
    - **When** `start(durationSeconds: 5)` is dispatched
    - **Then** the state transitions to `{ remaining: 5, status: 'running' }`

- **System Scenario: STS-003-A2**
    - **Given** the Timer Engine is in state `{ remaining: 1, status: 'running' }`
    - **When** a tick event fires (1 second elapses)
    - **Then** the state transitions to `{ remaining: 0, status: 'done' }` and the audible alert emission is triggered

- **System Scenario: STS-003-A3**
    - **Given** the Timer Engine is in state `{ status: 'running' }`
    - **When** `pause` action is dispatched
    - **Then** the state transitions to `{ status: 'paused' }` and the countdown halts

#### Test Case: STP-003-B (Timer Engine boundary: zero and negative duration inputs)

**Technique**: Boundary Value Analysis
**Target View**: Data Design View
**Description**: Verifies that the Timer Engine resets on invalid (zero or negative) duration inputs rather than entering an undefined state.

- **System Scenario: STS-003-B1**
    - **Given** the Timer Engine receives `start(durationSeconds: 0)`
    - **When** the action is processed
    - **Then** the state resets to `{ status: 'idle' }`; no countdown is started

- **System Scenario: STS-003-B2**
    - **Given** the Timer Engine receives `start(durationSeconds: -30)`
    - **When** the action is processed
    - **Then** the state resets to `{ status: 'idle' }`; no countdown is started; no error propagates

#### Test Case: STP-003-C (Timer Engine fault: SYS-006 unavailable — no step durations parsed)

**Technique**: Fault Injection
**Target View**: Dependency View
**Description**: Verifies that when SYS-006 fails to provide recipe step data, the Timer Engine does not start any timers and remains in idle state.

- **System Scenario: STS-003-C1**
    - **Given** SYS-006 is stubbed to throw `RecipeNotFoundError`
    - **When** the Timer Engine attempts to parse step durations
    - **Then** no timer is started; the Timer Engine remains in `{ status: 'idle' }`; the error is logged but not re-thrown

#### Test Case: STP-003-D (Timer Engine audio alert degrades gracefully on permission denial)

**Technique**: Fault Injection
**Target View**: Interface View
**Description**: Verifies that when the Audio API denies permission, the Timer Engine logs a warning and activates a visual fallback rather than throwing an unhandled error.

- **System Scenario: STS-003-D1**
    - **Given** the Audio API is stubbed to reject with a permission-denied error
    - **When** the Timer Engine attempts to emit an audible alert on completion
    - **Then** a warning is logged; the visual fallback state is set; no unhandled exception propagates

---

### Component Verification: SYS-004 (Screen Wake Lock)

**Parent Requirements**: REQ-007, REQ-CN-002

#### Test Case: STP-004-A (Screen Wake Lock acquires lock on Cooking Mode entry)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies that the Screen Wake Lock utility calls the platform Wake Lock API when it receives the Cooking Mode lifecycle `enter` event.

- **System Scenario: STS-004-A1**
    - **Given** the Screen Wake Lock utility is initialized and the platform Wake Lock API is available (stubbed)
    - **When** the Cooking Mode lifecycle `enter` event is emitted
    - **Then** the Wake Lock API `request('screen')` method is called exactly once; the lock is held

- **System Scenario: STS-004-A2**
    - **Given** the Screen Wake Lock utility holds an active lock
    - **When** the Cooking Mode lifecycle `exit` event is emitted
    - **Then** the Wake Lock `release()` method is called; no residual lock remains (CON-002)

#### Test Case: STP-004-B (Screen Wake Lock degrades gracefully when platform API is unavailable)

**Technique**: Fault Injection
**Target View**: Dependency View
**Description**: Verifies that when the platform Wake Lock API is unavailable (e.g., unsupported browser), the utility logs a warning and does not crash Cooking Mode.

- **System Scenario: STS-004-B1**
    - **Given** the platform Wake Lock API is stubbed as `undefined`
    - **When** the Cooking Mode lifecycle `enter` event fires
    - **Then** a warning is logged; Cooking Mode continues to function; no unhandled exception is thrown

#### Test Case: STP-004-C (Screen Wake Lock subscribes to SYS-001 lifecycle correctly)

**Technique**: Interface Contract Testing
**Target View**: Dependency View
**Description**: Verifies that SYS-004 subscribes to SYS-001 lifecycle events and that the subscription is torn down on exit.

- **System Scenario: STS-004-C1**
    - **Given** SYS-004 is mounted alongside SYS-001
    - **When** SYS-001 mounts (Cooking Mode entered)
    - **Then** SYS-004 registers a lifecycle subscription and acquires the wake lock

- **System Scenario: STS-004-C2**
    - **Given** SYS-004 holds an active subscription and wake lock
    - **When** SYS-001 unmounts (Cooking Mode exited)
    - **Then** SYS-004 unregisters the subscription and releases the wake lock

---

### Component Verification: SYS-005 (Offline Recipe Cache)

**Parent Requirements**: REQ-011

#### Test Case: STP-005-A (Offline Recipe Cache persists full Recipe entity to AsyncStorage on entry)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies that SYS-005 writes the complete Recipe entity (steps, timers, instructions) to AsyncStorage when Cooking Mode is entered.

- **System Scenario: STS-005-A1**
    - **Given** SYS-006 provides a valid `Recipe` entity with 5 steps and 2 timed steps
    - **When** Cooking Mode is entered and SYS-005 receives the Recipe entity
    - **Then** AsyncStorage `setItem` is called with the serialized Recipe entity; all 5 steps and 2 timed steps are present in the stored value

- **System Scenario: STS-005-A2**
    - **Given** a Recipe entity was previously cached by SYS-005
    - **When** network connectivity is lost and a subsequent step is requested
    - **Then** SYS-005 returns the cached Recipe entity from AsyncStorage; no network request is made

#### Test Case: STP-005-B (Offline Recipe Cache fault: AsyncStorage write failure does not block Cooking Mode)

**Technique**: Fault Injection
**Target View**: Dependency View
**Description**: Verifies that when AsyncStorage write fails, SYS-005 logs the error and Cooking Mode continues without the offline guarantee.

- **System Scenario: STS-005-B1**
    - **Given** AsyncStorage is stubbed to reject `setItem` with a storage quota error
    - **When** SYS-005 attempts to cache the Recipe entity
    - **Then** the error is logged; Cooking Mode session continues; no exception propagates to SYS-001

#### Test Case: STP-005-C (Offline Recipe Cache fault: SYS-006 write failure)

**Technique**: Fault Injection
**Target View**: Dependency View
**Description**: Verifies that when SYS-006 (the source of Recipe data) fails, SYS-005 does not attempt to cache a null/undefined entity.

- **System Scenario: STS-005-C1**
    - **Given** SYS-006 is stubbed to throw `RecipeNotFoundError`
    - **When** SYS-005 attempts to receive and cache the Recipe entity
    - **Then** no write to AsyncStorage occurs; the error is propagated to the Cooking Mode error state

---

### Component Verification: SYS-006 (Recipe Data Adapter)

**Parent Requirements**: REQ-IF-001, REQ-CN-001

#### Test Case: STP-006-A (Recipe Data Adapter maps Recipe entity to internal step model correctly)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies that SYS-006 correctly transforms the `Recipe` entity from feature 001 into the Cooking Mode internal step model, including steps, timers, and instructions.

- **System Scenario: STS-006-A1**
    - **Given** the 001 API returns a `Recipe` entity with `steps: [{ text: "Mix flour", durationSeconds: null }, { text: "Bake", durationSeconds: 1500 }]`
    - **When** SYS-006 adapts the entity
    - **Then** the internal step model contains 2 steps; step 2 has `durationSeconds: 1500`; step 1 has no timer

- **System Scenario: STS-006-A2**
    - **Given** the 001 API returns a `Recipe` entity with `recipeId: "abc123"`
    - **When** SYS-006 adapts the entity
    - **Then** the adapted model is read-only; no mutation of the original `Recipe` entity occurs (CON-001)

#### Test Case: STP-006-B (Recipe Data Adapter throws RecipeNotFoundError on missing recipe)

**Technique**: Equivalence Partitioning
**Target View**: Interface View
**Description**: Verifies that SYS-006 throws `RecipeNotFoundError` when the 001 API returns a 404 or empty response.

- **System Scenario: STS-006-B1**
    - **Given** the 001 REST API is stubbed to return HTTP 404 for `recipeId: "nonexistent"`
    - **When** SYS-006 calls the API with that `recipeId`
    - **Then** `RecipeNotFoundError` is thrown; the error surfaces to the Cooking Mode UI error state

- **System Scenario: STS-006-B2**
    - **Given** the 001 REST API is stubbed to return an empty `steps: []` array
    - **When** SYS-006 adapts the entity
    - **Then** the internal step model contains 0 steps; no error is thrown; SYS-002 receives `totalSteps: 0`

#### Test Case: STP-006-C (Recipe Data Adapter calls SYS-007 Auth Guard before fetching)

**Technique**: Interface Contract Testing
**Target View**: Dependency View
**Description**: Verifies that SYS-006 invokes SYS-007 to confirm authentication before making any API call to feature 001.

- **System Scenario: STS-006-C1**
    - **Given** SYS-007 is stubbed to return `{ authenticated: false }`
    - **When** SYS-006 attempts to fetch a Recipe entity
    - **Then** no API call to the 001 REST endpoint is made; the auth failure is propagated

- **System Scenario: STS-006-C2**
    - **Given** SYS-007 is stubbed to return `{ authenticated: true, userId: "user-42" }`
    - **When** SYS-006 fetches a Recipe entity
    - **Then** the 001 REST API is called with the correct `recipeId`; the adapted step model is returned

---

### Component Verification: SYS-007 (Auth Guard)

**Parent Requirements**: REQ-IF-002

#### Test Case: STP-007-A (Auth Guard returns authenticated=true for valid JWT session)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies that SYS-007 correctly validates a valid Clerk session token and returns `{ authenticated: true, userId: string }`.

- **System Scenario: STS-007-A1**
    - **Given** the Clerk session is stubbed to return a valid, non-expired session token for `userId: "user-42"`
    - **When** SYS-007 validates the session
    - **Then** the response is `{ authenticated: true, userId: "user-42" }`

- **System Scenario: STS-007-A2**
    - **Given** the Clerk session is stubbed to return an expired session token
    - **When** SYS-007 validates the session
    - **Then** the response is `{ authenticated: false }`; a redirect to the login flow is triggered

#### Test Case: STP-007-B (Auth Guard blocks Cooking Mode entry for unauthenticated sessions)

**Technique**: Equivalence Partitioning
**Target View**: Behavioral View
**Description**: Verifies that SYS-007 blocks Cooking Mode entry and redirects to login when no valid session exists (CON-006).

- **System Scenario: STS-007-B1**
    - **Given** no Clerk session token is present in the session store
    - **When** SYS-007 is invoked at Cooking Mode entry
    - **Then** `{ authenticated: false }` is returned; the Cooking Mode session does not proceed; the login redirect is triggered

- **System Scenario: STS-007-B2**
    - **Given** the Clerk session read throws an error during token validation
    - **When** SYS-007 attempts to validate the session
    - **Then** `{ authenticated: false }` is returned; the error is logged; the login redirect is triggered

#### Test Case: STP-007-C (Auth Guard fault: Clerk token fails verification)

**Technique**: Fault Injection
**Target View**: Dependency View
**Description**: Verifies that when a Clerk session token cannot be verified (e.g., malformed token, or `azp` not in `CLERK_AUTHORIZED_PARTIES`), SYS-007 fails closed — denying access rather than allowing unauthenticated entry. Verification is networkless (`verifyToken` via the public `CLERK_JWT_KEY`), so there is no network dependency to partition.

- **System Scenario: STS-007-C1**
    - **Given** the Clerk session token is stubbed to be malformed or to fail `azp`/signature verification
    - **When** SYS-007 attempts session validation
    - **Then** access is denied (`authenticated: false`); Cooking Mode entry is blocked; no recipe data is fetched

---

### Component Verification: SYS-008 (Quality & Accessibility)

**Parent Requirements**: REQ-NF-001, REQ-NF-002, REQ-NF-004, REQ-NF-005

#### Test Case: STP-008-A (TypeScript strict mode enforced across all Cooking Mode modules)

**Technique**: Equivalence Partitioning
**Target View**: Constraints View
**Description**: Verifies that all Cooking Mode TypeScript source files compile successfully under `strict: true` with no `any` types outside explicitly marked test doubles (CON-003).

- **System Scenario: STS-008-A1**
    - **Given** the TypeScript compiler is configured with `strict: true` and `noImplicitAny: true`
    - **When** all Cooking Mode source files are compiled
    - **Then** the compilation exits with code 0; no type errors are reported; no untyped `any` usage appears in non-test files

- **System Scenario: STS-008-A2**
    - **Given** a Cooking Mode source file is modified to introduce an implicit `any` type
    - **When** the TypeScript compiler runs
    - **Then** a type error is reported; the build fails

#### Test Case: STP-008-B (Color is not the sole conveyor of state — icon/text pairing required)

**Technique**: Equivalence Partitioning
**Target View**: Constraints View
**Description**: Verifies that all state indicators in Cooking Mode components include a non-color indicator (icon or text label) in addition to any color change (CON-005, REQ-NF-005).

- **System Scenario: STS-008-B1**
    - **Given** the Step Navigation component renders the "last step" boundary state
    - **When** the rendered output is inspected
    - **Then** the disabled state is communicated via both a visual color change AND a text label or icon (e.g., `aria-disabled`, a lock icon, or "Last step" label); color alone is not the sole indicator

- **System Scenario: STS-008-B2**
    - **Given** the Timer Engine emits `{ status: 'done' }`
    - **When** the Step Display renders the timer completion state
    - **Then** the completion is indicated by both a color change AND a text/icon indicator (e.g., "Done" label or checkmark icon)

#### Test Case: STP-008-C (Accessible component naming across all Cooking Mode components)

**Technique**: Interface Contract Testing
**Target View**: Constraints View
**Description**: Verifies that all interactive Cooking Mode components expose accessible names (aria-label or equivalent) for screen reader compatibility (REQ-NF-004).

- **System Scenario: STS-008-C1**
    - **Given** the Step Navigation component is rendered
    - **When** the accessibility tree is inspected
    - **Then** the "Next Step" and "Previous Step" controls each have a non-empty accessible name; no interactive element has an empty or missing label

- **System Scenario: STS-008-C2**
    - **Given** the Timer Engine control buttons (Start, Pause, Reset) are rendered within Step Display
    - **When** the accessibility tree is inspected
    - **Then** each button has a descriptive accessible name; the timer countdown value is exposed as an accessible live region

---

## Coverage Summary

| SYS ID    | Component Name          | Test Cases | Scenarios | Techniques Used                                                       |
| --------- | ----------------------- | ---------- | --------- | --------------------------------------------------------------------- |
| SYS-001   | Step Display            | 3 (A–C)    | 6         | Interface Contract Testing, Fault Injection                           |
| SYS-002   | Step Navigation         | 3 (A–C)    | 6         | Boundary Value Analysis, Interface Contract Testing, Fault Injection  |
| SYS-003   | Timer Engine            | 4 (A–D)    | 8         | Equivalence Partitioning, Boundary Value Analysis, Fault Injection    |
| SYS-004   | Screen Wake Lock        | 3 (A–C)    | 5         | Interface Contract Testing, Fault Injection                           |
| SYS-005   | Offline Recipe Cache    | 3 (A–C)    | 5         | Interface Contract Testing, Fault Injection                           |
| SYS-006   | Recipe Data Adapter     | 3 (A–C)    | 6         | Interface Contract Testing, Equivalence Partitioning                  |
| SYS-007   | Auth Guard              | 3 (A–C)    | 6         | Interface Contract Testing, Equivalence Partitioning, Fault Injection |
| SYS-008   | Quality & Accessibility | 3 (A–C)    | 6         | Equivalence Partitioning, Interface Contract Testing                  |
| **Total** |                         | **25**     | **48**    |                                                                       |

## Traceability

| STP ID    | SYS ID  | REQ IDs                   |
| --------- | ------- | ------------------------- |
| STP-001-A | SYS-001 | REQ-001, REQ-008, REQ-009 |
| STP-001-B | SYS-001 | REQ-NF-003, REQ-NF-004    |
| STP-001-C | SYS-001 | REQ-005, REQ-NF-003       |
| STP-002-A | SYS-002 | REQ-002, REQ-003, REQ-010 |
| STP-002-B | SYS-002 | REQ-002, REQ-003          |
| STP-002-C | SYS-002 | REQ-002, REQ-003          |
| STP-003-A | SYS-003 | REQ-004, REQ-005, REQ-006 |
| STP-003-B | SYS-003 | REQ-004                   |
| STP-003-C | SYS-003 | REQ-004                   |
| STP-003-D | SYS-003 | REQ-006                   |
| STP-004-A | SYS-004 | REQ-007, REQ-CN-002       |
| STP-004-B | SYS-004 | REQ-007                   |
| STP-004-C | SYS-004 | REQ-007, REQ-CN-002       |
| STP-005-A | SYS-005 | REQ-011                   |
| STP-005-B | SYS-005 | REQ-011                   |
| STP-005-C | SYS-005 | REQ-011                   |
| STP-006-A | SYS-006 | REQ-IF-001, REQ-CN-001    |
| STP-006-B | SYS-006 | REQ-IF-001                |
| STP-006-C | SYS-006 | REQ-IF-001, REQ-IF-002    |
| STP-007-A | SYS-007 | REQ-IF-002                |
| STP-007-B | SYS-007 | REQ-IF-002                |
| STP-007-C | SYS-007 | REQ-IF-002                |
| STP-008-A | SYS-008 | REQ-NF-001                |
| STP-008-B | SYS-008 | REQ-NF-005                |
| STP-008-C | SYS-008 | REQ-NF-002, REQ-NF-004    |
