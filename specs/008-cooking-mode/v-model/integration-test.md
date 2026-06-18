# Integration Test Plan: Cooking Mode

**Feature Branch**: `008-cooking-mode`
**Created**: 2026-05-09
**Status**: Draft
**Source**: `specs/008-cooking-mode/v-model/architecture-design.md`

## Overview

This document defines the Integration Test Plan for Cooking Mode. Every architecture module
in `architecture-design.md` has one or more Test Cases (ITP), and every Test Case has one or
more executable Integration Scenarios (ITS) in module-boundary BDD format (Given/When/Then).

Integration tests verify **seams and handshakes between modules**, not internal logic or user
journeys. Language must be module-boundary-oriented.

## ID Schema

- **Integration Test Case**: `ITP-{NNN}-{X}` — where NNN matches the parent ARCH, X is a letter suffix (A, B, C...)
- **Integration Test Scenario**: `ITS-{NNN}-{X}{#}` — nested under the parent ITP, with numeric suffix (1, 2, 3...)
- Example: `ITS-001-A1` → Scenario 1 of Test Case A verifying ARCH-001

## ISO 29119-4 Integration Test Techniques

Consumer-Driven Contract Testing (CDCT) is included for externally consumed module contracts; provider modules publish contracts and consumer modules validate expectations before integration deployment.

Each test case MUST identify its technique by name and anchor to a specific architecture view:

| Technique                                | Source View                   | What It Tests                                                 |
| ---------------------------------------- | ----------------------------- | ------------------------------------------------------------- |
| **Interface Contract Testing**           | Interface View                | Module API contracts, data format compliance, error responses |
| **Data Flow Testing**                    | Data Flow View                | End-to-end data transformation chain validation               |
| **Interface Fault Injection**            | Interface View + Process View | Malformed payloads, timeouts, graceful failure                |
| **Concurrency & Race Condition Testing** | Process View                  | Simultaneous access, lock handling, queue ordering            |

## Integration Tests

---

### ARCH-001 — CookingModeScreen

#### ITP-001-A: CookingModeScreen → AuthGuard session handshake (Interface Contract Testing)

- **Technique**: Interface Contract Testing
- **Architecture View**: Interface View (External-Facing Module Interfaces)
- **Modules Under Test**: ARCH-001 ↔ ARCH-012
- **Preconditions**: Clerk session context is injectable; `CookingModeScreen` receives `recipeId: string` prop.

##### ITS-001-A1 — Authenticated session propagates userId to screen lifecycle

```
Given ARCH-012 AuthGuard.checkSession() returns { userId: "user-123" }
When ARCH-001 CookingModeScreen receives { recipeId: "recipe-abc" } and calls AuthGuard
Then ARCH-001 proceeds to call ARCH-011 RecipeDataAdapter.adapt("recipe-abc")
And ARCH-001 does NOT redirect to the login screen
```

##### ITS-001-A2 — Unauthenticated session triggers redirect at the ARCH-001/ARCH-012 boundary

```
Given ARCH-012 AuthGuard.checkSession() throws AuthError
When ARCH-001 CookingModeScreen receives { recipeId: "recipe-abc" } and calls AuthGuard
Then ARCH-001 does NOT call ARCH-011 RecipeDataAdapter
And ARCH-001 emits a navigation event to the login screen
```

#### ITP-001-B: CookingModeScreen → ScreenWakeLockManager acquire/release contract (Interface Contract Testing)

- **Technique**: Interface Contract Testing
- **Architecture View**: Interface View (External-Facing Module Interfaces)
- **Modules Under Test**: ARCH-001 ↔ ARCH-009
- **Preconditions**: ARCH-009 is injectable; platform wake lock API is stubbed.

##### ITS-001-B1 — Wake lock acquired on Cooking Mode entry

```
Given ARCH-009 ScreenWakeLockManager.acquire() is available
When ARCH-001 CookingModeScreen mounts successfully after auth and recipe load
Then ARCH-001 calls ARCH-009 acquire() exactly once
And ARCH-009 returns void without error
```

##### ITS-001-B2 — Wake lock released on Cooking Mode exit

```
Given ARCH-009 ScreenWakeLockManager holds an active wake lock
When ARCH-001 CookingModeScreen unmounts (user exits Cooking Mode)
Then ARCH-001 calls ARCH-009 release() exactly once
And ARCH-009 returns void without error
```

#### ITP-001-C: CookingModeScreen orchestration data flow (Data Flow Testing)

- **Technique**: Data Flow Testing
- **Architecture View**: Data Flow View
- **Modules Under Test**: ARCH-001 → ARCH-012 → ARCH-011 → ARCH-010 → ARCH-004
- **Preconditions**: All downstream modules are injectable stubs.

##### ITS-001-C1 — Full entry data flow: recipeId flows through auth → adapter → cache → navigation controller

```
Given ARCH-012 returns { userId: "u1" }, ARCH-011 returns CookingStep[3], ARCH-010 caches successfully
When ARCH-001 receives { recipeId: "r1" } and executes the entry sequence
Then ARCH-001 passes "r1" to ARCH-011.adapt()
And ARCH-001 passes the returned CookingStep[3] to ARCH-010.cacheRecipe()
And ARCH-001 passes totalSteps=3 to ARCH-004.initialise()
```

---

### ARCH-002 — StepDisplayPanel

#### ITP-002-A: StepDisplayPanel prop contract from StepTransitionAnimator (Interface Contract Testing)

- **Technique**: Interface Contract Testing
- **Architecture View**: Interface View (Internal Module Interfaces)
- **Modules Under Test**: ARCH-003 ↔ ARCH-002
- **Preconditions**: ARCH-002 is rendered within ARCH-003's animation wrapper.

##### ITS-002-A1 — Valid step props render accessible output

```
Given ARCH-003 StepTransitionAnimator passes { step: CookingStep, stepIndex: 1, totalSteps: 5 }
When ARCH-002 StepDisplayPanel receives the props
Then ARCH-002 renders with accessible role and aria-label containing step content
And ARCH-002 does NOT throw or show a placeholder
```

##### ITS-002-A2 — Missing step data triggers placeholder at the ARCH-003/ARCH-002 boundary

```
Given ARCH-003 StepTransitionAnimator passes { step: undefined, stepIndex: 0, totalSteps: 0 }
When ARCH-002 StepDisplayPanel receives the props
Then ARCH-002 renders a placeholder UI
And ARCH-002 does NOT propagate an unhandled error to ARCH-013 ErrorBoundary
```

---

### ARCH-003 — StepTransitionAnimator

#### ITP-003-A: StepTransitionAnimator → StepDisplayPanel animation handshake (Interface Contract Testing)

- **Technique**: Interface Contract Testing
- **Architecture View**: Interface View (Internal Module Interfaces)
- **Modules Under Test**: ARCH-003 ↔ ARCH-002
- **Preconditions**: Animation library is available; stepIndex changes are injectable.

##### ITS-003-A1 — stepIndex change triggers animation and passes updated props to StepDisplayPanel

```
Given ARCH-003 StepTransitionAnimator is mounted with stepIndex=0
When ARCH-004 StepNavigationController emits stepIndex=1 to ARCH-003
Then ARCH-003 initiates an animation transition (slide or fade)
And ARCH-003 passes { step: newStep, stepIndex: 1 } to ARCH-002 StepDisplayPanel after transition
And the transition completes within 300 ms
```

#### ITP-003-B: StepTransitionAnimator animation failure fallback (Interface Fault Injection)

- **Technique**: Interface Fault Injection
- **Architecture View**: Interface View + Process View
- **Modules Under Test**: ARCH-003 ↔ ARCH-002
- **Preconditions**: Animation library can be forced to fail.

##### ITS-003-B1 — Animation failure falls back to instant render without propagating error

```
Given ARCH-003 StepTransitionAnimator's animation engine throws an error on transition
When ARCH-004 emits a stepIndex change to ARCH-003
Then ARCH-003 falls back to instant (non-animated) render
And ARCH-003 still passes correct props to ARCH-002 StepDisplayPanel
And no error propagates to ARCH-013 ErrorBoundaryAndLogger
```

---

### ARCH-004 — StepNavigationController

#### ITP-004-A: StepNavigationController → StepTransitionAnimator step change event (Interface Contract Testing)

- **Technique**: Interface Contract Testing
- **Architecture View**: Interface View (Internal Module Interfaces)
- **Modules Under Test**: ARCH-004 ↔ ARCH-003, ARCH-004 ↔ ARCH-006
- **Preconditions**: ARCH-004 is initialised with stepIndex=0, totalSteps=5.

##### ITS-004-A1 — goNext() emits onStepChange to ARCH-003 and ARCH-006

```
Given ARCH-004 StepNavigationController is initialised with { stepIndex: 0, totalSteps: 5 }
When ARCH-004.goNext() is called
Then ARCH-004 emits onStepChange({ stepIndex: 1 }) to ARCH-003 StepTransitionAnimator
And ARCH-004 emits onStepChange({ stepIndex: 1 }) to ARCH-006 TimerEngine
```

##### ITS-004-A2 — goPrev() at boundary is a no-op — no event emitted

```
Given ARCH-004 StepNavigationController is at stepIndex=0
When ARCH-004.goPrev() is called
Then ARCH-004 does NOT emit onStepChange
And stepIndex remains 0
```

##### ITS-004-A3 — goNext() at last step is a no-op — no event emitted

```
Given ARCH-004 StepNavigationController is at stepIndex=4, totalSteps=5
When ARCH-004.goNext() is called
Then ARCH-004 does NOT emit onStepChange
And stepIndex remains 4
```

---

### ARCH-005 — GestureInputAdapter

#### ITP-005-A: GestureInputAdapter → StepNavigationController gesture translation (Interface Contract Testing)

- **Technique**: Interface Contract Testing
- **Architecture View**: Interface View (Internal Module Interfaces)
- **Modules Under Test**: ARCH-005 ↔ ARCH-004
- **Preconditions**: Platform gesture events are injectable; ARCH-004 is a spy.

##### ITS-005-A1 — Swipe-left gesture calls goNext() on StepNavigationController

```
Given ARCH-005 GestureInputAdapter is mounted and connected to ARCH-004
When a swipe-left gesture event is injected into ARCH-005
Then ARCH-005 calls ARCH-004.goNext() exactly once
And ARCH-005 does NOT call ARCH-004.goPrev()
```

##### ITS-005-A2 — Swipe-right gesture calls goPrev() on StepNavigationController

```
Given ARCH-005 GestureInputAdapter is mounted and connected to ARCH-004
When a swipe-right gesture event is injected into ARCH-005
Then ARCH-005 calls ARCH-004.goPrev() exactly once
And ARCH-005 does NOT call ARCH-004.goNext()
```

#### ITP-005-B: GestureInputAdapter unrecognised gesture is silently ignored (Interface Fault Injection)

- **Technique**: Interface Fault Injection
- **Architecture View**: Interface View + Process View
- **Modules Under Test**: ARCH-005 ↔ ARCH-004
- **Preconditions**: An unrecognised gesture type is injectable.

##### ITS-005-B1 — Unrecognised gesture does not call any method on StepNavigationController

```
Given ARCH-005 GestureInputAdapter is mounted and connected to ARCH-004
When an unrecognised gesture event (e.g., pinch) is injected into ARCH-005
Then ARCH-005 does NOT call ARCH-004.goNext() or ARCH-004.goPrev()
And no error is thrown or propagated
```

---

### ARCH-006 — TimerEngine

#### ITP-006-A: TimerEngine → TimerDisplayWidget state emission (Interface Contract Testing)

- **Technique**: Interface Contract Testing
- **Architecture View**: Interface View (Internal Module Interfaces)
- **Modules Under Test**: ARCH-006 ↔ ARCH-007
- **Preconditions**: ARCH-006 is started with durationSeconds=5; ARCH-007 is a subscriber spy.

##### ITS-006-A1 — TimerEngine emits { remaining, status: 'running' } on each tick to TimerDisplayWidget

```
Given ARCH-006 TimerEngine is started with durationSeconds=5
When one tick interval elapses
Then ARCH-006 emits { remaining: 4, status: 'running' } to ARCH-007 TimerDisplayWidget
```

##### ITS-006-A2 — TimerEngine emits { remaining: 0, status: 'done' } on expiry

```
Given ARCH-006 TimerEngine is started with durationSeconds=1
When the countdown reaches zero
Then ARCH-006 emits { remaining: 0, status: 'done' } to ARCH-007 TimerDisplayWidget
And ARCH-006 emits timerComplete event to ARCH-008 AudioAlertService
```

#### ITP-006-B: TimerEngine → AudioAlertService timerComplete event (Interface Contract Testing)

- **Technique**: Interface Contract Testing
- **Architecture View**: Interface View (Internal Module Interfaces)
- **Modules Under Test**: ARCH-006 ↔ ARCH-008
- **Preconditions**: ARCH-008 is a spy; ARCH-006 is started with durationSeconds=1.

##### ITS-006-B1 — timerComplete event triggers AudioAlertService.play() exactly once

```
Given ARCH-006 TimerEngine is started with durationSeconds=1
When the countdown expires
Then ARCH-006 emits timerComplete to ARCH-008
And ARCH-008 AudioAlertService.play() is called exactly once
```

#### ITP-006-C: TimerEngine concurrent start/reset race condition (Concurrency & Race Condition Testing)

- **Technique**: Concurrency & Race Condition Testing
- **Architecture View**: Process View (Interaction 3: Timer Countdown)
- **Modules Under Test**: ARCH-006 internal state machine; ARCH-006 ↔ ARCH-007
- **Preconditions**: ARCH-006 is running; simultaneous reset and tick are injectable.

##### ITS-006-C1 — Simultaneous reset() and tick do not produce a negative remaining value

```
Given ARCH-006 TimerEngine is running with remaining=1
When reset() is called concurrently with the final tick
Then ARCH-006 emits { remaining: 0, status: 'idle' } or { remaining: 0, status: 'done' } — never negative
And ARCH-007 TimerDisplayWidget does NOT receive a remaining value below 0
```

---

### ARCH-007 — TimerDisplayWidget

#### ITP-007-A: TimerDisplayWidget subscription to TimerEngine state (Interface Contract Testing)

- **Technique**: Interface Contract Testing
- **Architecture View**: Interface View (Internal Module Interfaces)
- **Modules Under Test**: ARCH-007 ↔ ARCH-006
- **Preconditions**: ARCH-007 is mounted with a TimerEngine subscription; ARCH-006 is injectable.

##### ITS-007-A1 — TimerDisplayWidget renders MM:SS format from TimerEngine state

```
Given ARCH-006 TimerEngine emits { remaining: 90, status: 'running' }
When ARCH-007 TimerDisplayWidget receives the state update
Then ARCH-007 renders "01:30" in the countdown display
And ARCH-007 does NOT render "—" (the no-timer placeholder)
```

##### ITS-007-A2 — TimerDisplayWidget renders placeholder when no timer is active

```
Given ARCH-006 TimerEngine emits { remaining: 0, status: 'idle' }
When ARCH-007 TimerDisplayWidget receives the state update
Then ARCH-007 renders "—" as the countdown display
```

---

### ARCH-008 — AudioAlertService

#### ITP-008-A: AudioAlertService play() contract from TimerEngine (Interface Contract Testing)

- **Technique**: Interface Contract Testing
- **Architecture View**: Interface View (External-Facing Module Interfaces)
- **Modules Under Test**: ARCH-008 ↔ ARCH-006
- **Preconditions**: expo-av (or Web Audio API) is injectable; audio permission is grantable.

##### ITS-008-A1 — AudioAlertService plays sound when timerComplete is received and audio is permitted

```
Given ARCH-008 AudioAlertService has audio permission granted
When ARCH-006 TimerEngine emits timerComplete to ARCH-008
Then ARCH-008 calls the audio playback API exactly once
And ARCH-008 returns void without error
```

#### ITP-008-B: AudioAlertService graceful degradation on audio permission denial (Interface Fault Injection)

- **Technique**: Interface Fault Injection
- **Architecture View**: Interface View + Process View
- **Modules Under Test**: ARCH-008 ↔ ARCH-006, ARCH-008 ↔ ARCH-013
- **Preconditions**: Audio permission is denied; ARCH-013 logger is a spy.

##### ITS-008-B1 — AudioAlertService logs warning and does not throw when audio is denied

```
Given ARCH-008 AudioAlertService has audio permission denied
When ARCH-006 TimerEngine emits timerComplete to ARCH-008
Then ARCH-008 does NOT throw an unhandled error
And ARCH-008 calls ARCH-013 logger with a warning-level structured event
And ARCH-008 signals the visual fallback to ARCH-007 TimerDisplayWidget
```

---

### ARCH-009 — ScreenWakeLockManager

#### ITP-009-A: ScreenWakeLockManager acquire/release contract with ARCH-001 (Interface Contract Testing)

- **Technique**: Interface Contract Testing
- **Architecture View**: Interface View (External-Facing Module Interfaces)
- **Modules Under Test**: ARCH-009 ↔ ARCH-001
- **Preconditions**: Platform wake lock API is injectable; ARCH-001 calls acquire/release.

##### ITS-009-A1 — acquire() returns void on supported platform

```
Given ARCH-009 ScreenWakeLockManager is on a platform that supports wake lock
When ARCH-001 CookingModeScreen calls ARCH-009.acquire()
Then ARCH-009 acquires the platform wake lock
And ARCH-009 returns void to ARCH-001
```

#### ITP-009-B: ScreenWakeLockManager graceful degradation on unsupported platform (Interface Fault Injection)

- **Technique**: Interface Fault Injection
- **Architecture View**: Interface View + Process View
- **Modules Under Test**: ARCH-009 ↔ ARCH-001, ARCH-009 ↔ ARCH-013
- **Preconditions**: Platform wake lock API is unavailable; ARCH-013 logger is a spy.

##### ITS-009-B1 — acquire() logs warning and does not throw on unsupported platform

```
Given ARCH-009 ScreenWakeLockManager is on a platform that does NOT support wake lock
When ARCH-001 CookingModeScreen calls ARCH-009.acquire()
Then ARCH-009 does NOT throw an unhandled error
And ARCH-009 calls ARCH-013 logger with a warning-level structured event
And ARCH-001 continues Cooking Mode entry without interruption
```

---

### ARCH-010 — OfflineRecipeCache

#### ITP-010-A: OfflineRecipeCache → ARCH-001 cache hit/miss contract (Interface Contract Testing)

- **Technique**: Interface Contract Testing
- **Architecture View**: Interface View (Internal Module Interfaces)
- **Modules Under Test**: ARCH-010 ↔ ARCH-001
- **Preconditions**: AsyncStorage is injectable; cache state is controllable.

##### ITS-010-A1 — getCachedRecipe() returns CookingStep[] on cache hit

```
Given ARCH-010 OfflineRecipeCache has a cached entry for recipeId="r1"
When ARCH-001 CookingModeScreen calls ARCH-010.getCachedRecipe("r1")
Then ARCH-010 returns the cached CookingStep[] to ARCH-001
And ARCH-001 does NOT call ARCH-011 RecipeDataAdapter again
```

##### ITS-010-A2 — getCachedRecipe() throws CacheMissError on cache miss

```
Given ARCH-010 OfflineRecipeCache has NO cached entry for recipeId="r2"
When ARCH-001 CookingModeScreen calls ARCH-010.getCachedRecipe("r2")
Then ARCH-010 throws CacheMissError
And ARCH-001 renders the offline error UI
```

#### ITP-010-B: OfflineRecipeCache data flow — cacheRecipe() persists adapter output (Data Flow Testing)

- **Technique**: Data Flow Testing
- **Architecture View**: Data Flow View
- **Modules Under Test**: ARCH-011 → ARCH-001 → ARCH-010
- **Preconditions**: ARCH-011 returns CookingStep[]; AsyncStorage is injectable.

##### ITS-010-B1 — CookingStep[] from ARCH-011 is persisted to AsyncStorage via ARCH-010

```
Given ARCH-011 RecipeDataAdapter returns CookingStep[3] for recipeId="r1"
When ARCH-001 calls ARCH-010.cacheRecipe(CookingStep[3])
Then ARCH-010 writes the full CookingStep[3] array to AsyncStorage under key "r1"
And a subsequent ARCH-010.getCachedRecipe("r1") returns the same CookingStep[3]
```

---

### ARCH-011 — RecipeDataAdapter

#### ITP-011-A: RecipeDataAdapter → ARCH-001 adapt() contract (Interface Contract Testing)

- **Technique**: Interface Contract Testing
- **Architecture View**: Interface View (External-Facing Module Interfaces)
- **Modules Under Test**: ARCH-011 ↔ ARCH-001
- **Preconditions**: 001 API is injectable; Zod schema is active.

##### ITS-011-A1 — adapt() returns validated CookingStep[] for a valid Recipe entity

```
Given ARCH-011 RecipeDataAdapter receives a valid Recipe entity from the 001 API
When ARCH-001 CookingModeScreen calls ARCH-011.adapt("recipe-abc")
Then ARCH-011 returns a CookingStep[] that passes Zod schema validation
And ARCH-011 does NOT mutate the source Recipe entity
```

#### ITP-011-B: RecipeDataAdapter fault injection — malformed API response (Interface Fault Injection)

- **Technique**: Interface Fault Injection
- **Architecture View**: Interface View + Process View
- **Modules Under Test**: ARCH-011 ↔ ARCH-001
- **Preconditions**: 001 API returns a malformed payload.

##### ITS-011-B1 — adapt() throws ValidationError when API response fails Zod schema

```
Given ARCH-011 RecipeDataAdapter receives a Recipe entity missing required fields
When ARCH-001 CookingModeScreen calls ARCH-011.adapt("recipe-bad")
Then ARCH-011 throws ValidationError
And ARCH-001 does NOT pass undefined data to ARCH-004 StepNavigationController
```

##### ITS-011-B2 — adapt() throws RecipeNotFoundError when API returns 404

```
Given ARCH-011 RecipeDataAdapter receives a 404 response from the 001 API
When ARCH-001 CookingModeScreen calls ARCH-011.adapt("recipe-missing")
Then ARCH-011 throws RecipeNotFoundError
And ARCH-001 renders an appropriate error UI
```

---

### ARCH-012 — AuthGuard

#### ITP-012-A: AuthGuard.checkSession() contract with ARCH-001 (Interface Contract Testing)

- **Technique**: Interface Contract Testing
- **Architecture View**: Interface View (External-Facing Module Interfaces)
- **Modules Under Test**: ARCH-012 ↔ ARCH-001
- **Preconditions**: Clerk session context is injectable.

##### ITS-012-A1 — checkSession() returns { userId } for a valid Clerk session

```
Given ARCH-012 AuthGuard has access to a valid Clerk session context
When ARCH-001 CookingModeScreen calls ARCH-012.checkSession()
Then ARCH-012 returns { userId: "user-123" } to ARCH-001
And ARCH-001 proceeds with recipe loading
```

##### ITS-012-A2 — checkSession() throws AuthError for an expired or missing session

```
Given ARCH-012 AuthGuard has access to an expired Clerk session context
When ARCH-001 CookingModeScreen calls ARCH-012.checkSession()
Then ARCH-012 throws AuthError
And ARCH-001 does NOT proceed with recipe loading
```

#### ITP-012-B: AuthGuard fault injection — Clerk session read failure (Interface Fault Injection)

- **Technique**: Interface Fault Injection
- **Architecture View**: Interface View + Process View
- **Modules Under Test**: ARCH-012 ↔ ARCH-001
- **Preconditions**: Clerk session read is injectable; a session-read failure is simulatable.

##### ITS-012-B1 — checkSession() throws AuthError on Clerk session read failure

```
Given ARCH-012 AuthGuard's Clerk session read throws (e.g. corrupt/unreadable token)
When ARCH-001 CookingModeScreen calls ARCH-012.checkSession()
Then ARCH-012 throws AuthError (not an unhandled promise rejection)
And ARCH-001 redirects to the login screen
```

---

### ARCH-013 — ErrorBoundaryAndLogger [CROSS-CUTTING]

#### ITP-013-A: ErrorBoundaryAndLogger catches render errors from wrapped components (Interface Contract Testing)

- **Technique**: Interface Contract Testing
- **Architecture View**: Interface View (Internal Module Interfaces)
- **Modules Under Test**: ARCH-013 ↔ ARCH-001 (and all wrapped components)
- **Preconditions**: ARCH-013 wraps CookingModeScreen; a child component is injectable.

##### ITS-013-A1 — Render error from a child component is caught and logged by ARCH-013

```
Given ARCH-013 ErrorBoundaryAndLogger wraps ARCH-001 CookingModeScreen
When a child component (e.g., ARCH-002 StepDisplayPanel) throws a render error
Then ARCH-013 catches the error at the React error boundary
And ARCH-013 calls the structured logger with an error-level event containing the error details
And ARCH-013 renders the user-friendly fallback UI
And the error does NOT propagate to the React Native root
```

#### ITP-013-B: ErrorBoundaryAndLogger structured log event contract (Data Flow Testing)

- **Technique**: Data Flow Testing
- **Architecture View**: Data Flow View
- **Modules Under Test**: ARCH-013 ↔ logger sink
- **Preconditions**: Logger sink is a spy; a render error is injectable.

##### ITS-013-B1 — Structured log event contains required fields

```
Given ARCH-013 ErrorBoundaryAndLogger catches a render error
When the logger is called
Then the log event contains: { level: 'error', message: string, errorName: string, componentStack: string }
And the log event does NOT contain raw PII or sensitive user data
```

---

### ARCH-014 — AccessibilityAndQualityGuard [CROSS-CUTTING]

#### ITP-014-A: AccessibilityAndQualityGuard TypeScript strict mode enforcement at build boundary (Interface Contract Testing)

- **Technique**: Interface Contract Testing
- **Architecture View**: Interface View (build pipeline boundary)
- **Modules Under Test**: ARCH-014 ↔ build pipeline
- **Preconditions**: TypeScript compiler is configured with `strict: true`; a file with `any` is injectable.

##### ITS-014-A1 — TypeScript compiler rejects `any` usage in Cooking Mode source files

```
Given ARCH-014 AccessibilityAndQualityGuard enforces strict: true and no-explicit-any ESLint rule
When a Cooking Mode source file introduces an explicit `any` type annotation
Then the TypeScript compiler or ESLint emits a type error at the build boundary
And the build pipeline does NOT produce a successful artifact
```

#### ITP-014-B: AccessibilityAndQualityGuard accessibility lint rule enforcement (Interface Contract Testing)

- **Technique**: Interface Contract Testing
- **Architecture View**: Interface View (build pipeline boundary)
- **Modules Under Test**: ARCH-014 ↔ build pipeline
- **Preconditions**: eslint-plugin-jsx-a11y is configured; a component missing accessible props is injectable.

##### ITS-014-B1 — ESLint rejects a component missing required accessibility attributes

```
Given ARCH-014 AccessibilityAndQualityGuard enforces eslint-plugin-jsx-a11y rules
When a Cooking Mode component is missing a required accessible role or label
Then ESLint emits an accessibility violation at the build boundary
And the build pipeline does NOT produce a successful artifact
```

---

## Coverage Summary

| ARCH ID   | Module Name                  | ITP Count | ITS Count | Techniques Applied                               |
| --------- | ---------------------------- | --------- | --------- | ------------------------------------------------ |
| ARCH-001  | CookingModeScreen            | 3         | 5         | Interface Contract, Data Flow                    |
| ARCH-002  | StepDisplayPanel             | 1         | 2         | Interface Contract                               |
| ARCH-003  | StepTransitionAnimator       | 2         | 2         | Interface Contract, Interface Fault Injection    |
| ARCH-004  | StepNavigationController     | 1         | 3         | Interface Contract                               |
| ARCH-005  | GestureInputAdapter          | 2         | 3         | Interface Contract, Interface Fault Injection    |
| ARCH-006  | TimerEngine                  | 3         | 4         | Interface Contract, Concurrency & Race Condition |
| ARCH-007  | TimerDisplayWidget           | 1         | 2         | Interface Contract                               |
| ARCH-008  | AudioAlertService            | 2         | 2         | Interface Contract, Interface Fault Injection    |
| ARCH-009  | ScreenWakeLockManager        | 2         | 2         | Interface Contract, Interface Fault Injection    |
| ARCH-010  | OfflineRecipeCache           | 2         | 3         | Interface Contract, Data Flow                    |
| ARCH-011  | RecipeDataAdapter            | 2         | 3         | Interface Contract, Interface Fault Injection    |
| ARCH-012  | AuthGuard                    | 2         | 3         | Interface Contract, Interface Fault Injection    |
| ARCH-013  | ErrorBoundaryAndLogger       | 2         | 2         | Interface Contract, Data Flow                    |
| ARCH-014  | AccessibilityAndQualityGuard | 2         | 2         | Interface Contract                               |
| **TOTAL** |                              | **27**    | **38**    |                                                  |

**Coverage**: All 14 ARCH modules covered (12 functional + 2 cross-cutting). All 4 ISO 29119-4 mandatory techniques applied.

## Traceability to Architecture Design

| ITP ID    | ARCH ID  | Technique                    | Architecture View         |
| --------- | -------- | ---------------------------- | ------------------------- |
| ITP-001-A | ARCH-001 | Interface Contract Testing   | Interface View (External) |
| ITP-001-B | ARCH-001 | Interface Contract Testing   | Interface View (External) |
| ITP-001-C | ARCH-001 | Data Flow Testing            | Data Flow View            |
| ITP-002-A | ARCH-002 | Interface Contract Testing   | Interface View (Internal) |
| ITP-003-A | ARCH-003 | Interface Contract Testing   | Interface View (Internal) |
| ITP-003-B | ARCH-003 | Interface Fault Injection    | Interface View + Process  |
| ITP-004-A | ARCH-004 | Interface Contract Testing   | Interface View (Internal) |
| ITP-005-A | ARCH-005 | Interface Contract Testing   | Interface View (Internal) |
| ITP-005-B | ARCH-005 | Interface Fault Injection    | Interface View + Process  |
| ITP-006-A | ARCH-006 | Interface Contract Testing   | Interface View (Internal) |
| ITP-006-B | ARCH-006 | Interface Contract Testing   | Interface View (Internal) |
| ITP-006-C | ARCH-006 | Concurrency & Race Condition | Process View              |
| ITP-007-A | ARCH-007 | Interface Contract Testing   | Interface View (Internal) |
| ITP-008-A | ARCH-008 | Interface Contract Testing   | Interface View (External) |
| ITP-008-B | ARCH-008 | Interface Fault Injection    | Interface View + Process  |
| ITP-009-A | ARCH-009 | Interface Contract Testing   | Interface View (External) |
| ITP-009-B | ARCH-009 | Interface Fault Injection    | Interface View + Process  |
| ITP-010-A | ARCH-010 | Interface Contract Testing   | Interface View (Internal) |
| ITP-010-B | ARCH-010 | Data Flow Testing            | Data Flow View            |
| ITP-011-A | ARCH-011 | Interface Contract Testing   | Interface View (External) |
| ITP-011-B | ARCH-011 | Interface Fault Injection    | Interface View + Process  |
| ITP-012-A | ARCH-012 | Interface Contract Testing   | Interface View (External) |
| ITP-012-B | ARCH-012 | Interface Fault Injection    | Interface View + Process  |
| ITP-013-A | ARCH-013 | Interface Contract Testing   | Interface View (Internal) |
| ITP-013-B | ARCH-013 | Data Flow Testing            | Data Flow View            |
| ITP-014-A | ARCH-014 | Interface Contract Testing   | Interface View (Build)    |
| ITP-014-B | ARCH-014 | Interface Contract Testing   | Interface View (Build)    |
