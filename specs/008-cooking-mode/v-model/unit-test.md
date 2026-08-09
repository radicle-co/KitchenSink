# Unit Test Plan: Cooking Mode

**Feature Branch**: `008-cooking-mode`
**Created**: 2026-05-09
**Status**: Draft
**Source**: `specs/008-cooking-mode/v-model/module-design.md`

## Overview

This document defines the Unit Test Plan for Cooking Mode. Every module design (`MOD-NNN`)
in `module-design.md` has one or more Test Cases (`UTP-NNN-X`), and every Test Case has one or
more executable Unit Scenarios (`UTS-NNN-X#`) in white-box Arrange/Act/Assert format.

Unit tests verify **internal module logic** — control flow, data transformations, state
transitions, and variable boundaries. They do NOT test module boundaries (integration), user
journeys (acceptance), or system-level behavior (system tests).

MOD-015 (TypeScriptStrictConfig), MOD-016 (ESLintNoAnyRule), and MOD-017 (AccessibilityLintRules)
are compile-time/lint-time configuration artifacts with no runtime logic; they are verified by
build/CI enforcement and are excluded from executable unit test cases below. MOD-018
(AccessibilityRuntimeChecks) contains testable runtime logic and is included.

## ID Schema

- **Unit Test Case**: `UTP-{NNN}-{X}` — where NNN matches the parent MOD, X is a letter suffix (A, B, C...)
- **Unit Test Scenario**: `UTS-{NNN}-{X}{#}` — nested under the parent UTP, with numeric suffix (1, 2, 3...)
- Example: `UTS-001-A1` → Scenario 1 of Test Case A verifying MOD-001
- ID lineage: from `UTS-001-A1`, a regex extracts `UTP-001-A` and `MOD-001`. To find the `ARCH-NNN` ancestor, consult the "Parent Architecture Modules" field in `module-design.md`.

## ISO 29119-4 White-Box Techniques

Each test case MUST identify its technique by name and anchor to a specific module design view:

| Technique                       | Source View                   | What It Tests                                           |
| ------------------------------- | ----------------------------- | ------------------------------------------------------- |
| **Statement & Branch Coverage** | Algorithmic/Logic View        | Every line and every True/False branch outcome          |
| **Boundary Value Analysis**     | Internal Data Structures      | Scalar variable boundaries: min-1, min, mid, max, max+1 |
| **Equivalence Partitioning**    | Internal Data Structures      | Discrete non-scalar types: Booleans, Enums              |
| **Strict Isolation**            | Architecture Interface View   | Every external dependency mocked/stubbed                |
| **Error Guessing**              | Error Handling & Return Codes | Negative paths, invalid inputs, dependency exceptions   |
| **State Transition Testing**    | State Machine View            | Every transition including invalid ones                 |

## Unit Tests

---

### MOD-001 — CookingModeScreen

**Parent Architecture Modules**: ARCH-001
**Target Source File**: `packages/apps/commise/features/cooking/src/screens/CookingModeScreen.tsx`

---

#### UTP-001-A — Mount: Auth failure redirects to Login

**Technique**: Statement & Branch Coverage (Algorithmic/Logic View — `AuthError` branch)
**Mocks**: `AuthGuard.checkSession` → throws `AuthError`; `navigate` spy

| Scenario   | Arrange                                                                | Act                                         | Assert                                                                                     |
| ---------- | ---------------------------------------------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------ |
| UTS-001-A1 | `AuthGuard.checkSession` is stubbed to throw `AuthError("no session")` | Mount `<CookingModeScreen recipeId="r1" />` | `navigate("Login")` is called once; component returns without setting `state.ready = true` |

---

#### UTP-001-B — Mount: Recipe not found falls back to cache hit

**Technique**: Statement & Branch Coverage (Algorithmic/Logic View — `RecipeNotFoundError` + cache hit branch)
**Mocks**: `AuthGuard.checkSession` → OK; `RecipeDataAdapter.adapt` → throws `RecipeNotFoundError`; `OfflineRecipeCache.getCachedRecipe` → returns `[step1]`

| Scenario   | Arrange                                                                | Act             | Assert                                                                                                |
| ---------- | ---------------------------------------------------------------------- | --------------- | ----------------------------------------------------------------------------------------------------- |
| UTS-001-B1 | Auth OK; adapter throws `RecipeNotFoundError`; cache returns `[step1]` | Mount component | `state.steps = [step1]`; `state.ready = true`; `OfflineRecipeCache.cacheRecipe` called with `[step1]` |

---

#### UTP-001-C — Mount: Cache miss sets error state

**Technique**: Statement & Branch Coverage (Algorithmic/Logic View — cache miss branch)
**Mocks**: Auth OK; adapter throws `RecipeNotFoundError`; cache throws `CacheMissError`

| Scenario   | Arrange                                                                                  | Act             | Assert                                                                                                    |
| ---------- | ---------------------------------------------------------------------------------------- | --------------- | --------------------------------------------------------------------------------------------------------- |
| UTS-001-C1 | Auth OK; adapter throws `RecipeNotFoundError`; `getCachedRecipe` throws `CacheMissError` | Mount component | `state.error = "Recipe unavailable offline"`; `state.ready` remains `false`; `<ErrorFallbackUI>` rendered |

---

#### UTP-001-D — Mount: Happy path initialises all services

**Technique**: Statement & Branch Coverage (Algorithmic/Logic View — success path)
**Mocks**: Auth OK; adapter returns `[step1, step2]`; all services stubbed

| Scenario   | Arrange                                           | Act             | Assert                                                                                                                                          |
| ---------- | ------------------------------------------------- | --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| UTS-001-D1 | All dependencies succeed; adapter returns 2 steps | Mount component | `ScreenWakeLockManager.acquire` called; `StepNavigationController.initialise(0, 2)` called; `state.ready = true`; `<StepDisplayPanel>` rendered |

---

#### UTP-001-E — Unmount: Services are torn down

**Technique**: Statement & Branch Coverage (Algorithmic/Logic View — `ON_UNMOUNT` branch)
**Mocks**: All mount dependencies succeed; `TimerEngine.reset` spy; `ScreenWakeLockManager.release` spy

| Scenario   | Arrange                        | Act               | Assert                                                                           |
| ---------- | ------------------------------ | ----------------- | -------------------------------------------------------------------------------- |
| UTS-001-E1 | Component mounted successfully | Unmount component | `TimerEngine.reset()` called once; `ScreenWakeLockManager.release()` called once |

---

#### UTP-001-F — State: stepIndex updates on goNext / goPrev

**Technique**: Statement & Branch Coverage (Algorithmic/Logic View — `goNext` / `goPrev` functions)
**Mocks**: All mount dependencies succeed; `StepNavigationController` real instance

| Scenario   | Arrange                                 | Act             | Assert                |
| ---------- | --------------------------------------- | --------------- | --------------------- |
| UTS-001-F1 | Component ready with 3 steps at index 0 | Call `goNext()` | `state.stepIndex = 1` |
| UTS-001-F2 | Component ready at index 1              | Call `goPrev()` | `state.stepIndex = 0` |

---

#### UTP-001-G — State Transition: Loading → Ready

**Technique**: State Transition Testing (State Machine View)
**Mocks**: All dependencies succeed

| Scenario   | Arrange                   | Act             | Assert                                                                                                                                                 |
| ---------- | ------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| UTS-001-G1 | Component not yet mounted | Mount component | State transitions: `Loading → AuthChecking → FetchingRecipe → Caching → Ready`; `<LoadingSpinner>` shown during async, then `<StepDisplayPanel>` shown |

---

#### UTP-001-H — State Transition: FetchingRecipe → CacheFallback → Error

**Technique**: State Transition Testing (State Machine View)
**Mocks**: Auth OK; adapter throws `NetworkError`; cache throws `CacheMissError`

| Scenario   | Arrange                                                      | Act             | Assert                                              |
| ---------- | ------------------------------------------------------------ | --------------- | --------------------------------------------------- |
| UTS-001-H1 | Adapter throws `NetworkError`; cache throws `CacheMissError` | Mount component | State reaches `Error`; `<ErrorFallbackUI>` rendered |

---

#### UTP-001-I — BVA: stepIndex boundary values

**Technique**: Boundary Value Analysis (Internal Data Structures — `stepIndex ∈ [0, steps.length - 1]`)
**Mocks**: Component ready with 3 steps

| Scenario   | Arrange                              | Act                 | Assert                                                |
| ---------- | ------------------------------------ | ------------------- | ----------------------------------------------------- |
| UTS-001-I1 | `stepIndex = 0` (min)                | Render              | `<StepDisplayPanel>` receives `stepIndex=0`; no error |
| UTS-001-I2 | `stepIndex = 2` (max, 3-step recipe) | Set `stepIndex = 2` | `<StepDisplayPanel>` receives `stepIndex=2`; no error |

---

### MOD-002 — StepDisplayPanel

**Parent Architecture Modules**: ARCH-002
**Target Source File**: `packages/apps/commise/features/cooking/src/components/StepDisplayPanel.tsx`

---

#### UTP-002-A — Null step prop renders placeholder

**Technique**: Statement & Branch Coverage (Algorithmic/Logic View — null guard branch)

| Scenario   | Arrange            | Act                                                                    | Assert                                                      |
| ---------- | ------------------ | ---------------------------------------------------------------------- | ----------------------------------------------------------- |
| UTS-002-A1 | `step = null`      | Render `<StepDisplayPanel step={null} stepIndex={0} totalSteps={1} />` | `<PlaceholderText text="Loading step…">` rendered; no crash |
| UTS-002-A2 | `step = undefined` | Render with `step={undefined}`                                         | Same placeholder rendered                                   |

---

#### UTP-002-B — Valid step renders instruction and progress label

**Technique**: Statement & Branch Coverage (Algorithmic/Logic View — happy path)

| Scenario   | Arrange                                                                                                  | Act    | Assert                                                                          |
| ---------- | -------------------------------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------- |
| UTS-002-B1 | `step = { instruction: "Boil water", note: null, durationSeconds: null }`, `stepIndex=0`, `totalSteps=3` | Render | "Boil water" text visible; `progressLabel = "Step 1 of 3"`; note section absent |
| UTS-002-B2 | `step = { instruction: "Stir", note: "Gently", durationSeconds: 60 }`                                    | Render | "Stir" and "Gently" both visible                                                |

---

#### UTP-002-C — progressLabel string construction

**Technique**: Statement & Branch Coverage (Algorithmic/Logic View — `progressLabel` computation)

| Scenario   | Arrange                       | Act    | Assert                                      |
| ---------- | ----------------------------- | ------ | ------------------------------------------- |
| UTS-002-C1 | `stepIndex=2`, `totalSteps=5` | Render | `progressLabel = "Step 3 of 5"` (1-indexed) |

---

#### UTP-002-D — BVA: stepIndex and totalSteps boundaries

**Technique**: Boundary Value Analysis (Internal Data Structures — `progressLabel` max 32 chars)

| Scenario   | Arrange                                 | Act    | Assert                                                    |
| ---------- | --------------------------------------- | ------ | --------------------------------------------------------- |
| UTS-002-D1 | `stepIndex=0`, `totalSteps=1` (min)     | Render | `progressLabel = "Step 1 of 1"` (11 chars, within 32)     |
| UTS-002-D2 | `stepIndex=199`, `totalSteps=200` (max) | Render | `progressLabel = "Step 200 of 200"` (15 chars, within 32) |

---

### MOD-003 — StepTransitionAnimator

**Parent Architecture Modules**: ARCH-003
**Target Source File**: `packages/apps/commise/features/cooking/src/components/StepTransitionAnimator.tsx`

---

#### UTP-003-A — No animation on initial mount

**Technique**: Statement & Branch Coverage (Algorithmic/Logic View — `stepIndex == prevStepIndex` branch)
**Mocks**: `Animated.sequence` spy

| Scenario   | Arrange                  | Act    | Assert                                                        |
| ---------- | ------------------------ | ------ | ------------------------------------------------------------- |
| UTS-003-A1 | Mount with `stepIndex=0` | Render | `Animated.sequence` NOT called; `animatedValue` remains `1.0` |

---

#### UTP-003-B — Animation triggered on stepIndex change

**Technique**: Statement & Branch Coverage (Algorithmic/Logic View — `stepIndex != prevStepIndex` branch)
**Mocks**: `Animated.sequence` spy; `Animated.timing` spy

| Scenario   | Arrange                              | Act                          | Assert                                                                                            |
| ---------- | ------------------------------------ | ---------------------------- | ------------------------------------------------------------------------------------------------- |
| UTS-003-B1 | Component mounted with `stepIndex=0` | Update prop to `stepIndex=1` | `Animated.sequence` called once; sequence contains two `Animated.timing` calls (toValue 0 then 1) |

---

#### UTP-003-C — Animation failure falls back to instant opacity reset

**Technique**: Statement & Branch Coverage (Algorithmic/Logic View — animation failure branch)
**Mocks**: `Animated.sequence(...).start` calls `onComplete` with `{ finished: false }`; `animatedValue.setValue` spy

| Scenario   | Arrange                                              | Act                 | Assert                                                               |
| ---------- | ---------------------------------------------------- | ------------------- | -------------------------------------------------------------------- |
| UTS-003-C1 | Animation start callback fires with `finished=false` | Trigger step change | `animatedValue.setValue(1)` called; component still renders children |

---

#### UTP-003-D — State Transition: Visible → FadingOut → FadingIn → Visible

**Technique**: State Transition Testing (State Machine View)

| Scenario   | Arrange                      | Act                | Assert                                                                    |
| ---------- | ---------------------------- | ------------------ | ------------------------------------------------------------------------- |
| UTS-003-D1 | Component in `Visible` state | Change `stepIndex` | `animatedValue` goes to `0` (FadingOut), then to `1` (FadingIn → Visible) |

---

#### UTP-003-E — BVA: animatedValue boundaries

**Technique**: Boundary Value Analysis (Internal Data Structures — `animatedValue ∈ [0.0, 1.0]`)

| Scenario   | Arrange                | Act          | Assert                              |
| ---------- | ---------------------- | ------------ | ----------------------------------- |
| UTS-003-E1 | Animate to `toValue=0` | Run fade-out | `animatedValue` reaches `0.0` (min) |
| UTS-003-E2 | Animate to `toValue=1` | Run fade-in  | `animatedValue` reaches `1.0` (max) |

---

### MOD-004 — CookingSessionReducer

**Parent Architecture Modules**: ARCH-004
**Target Source File**: `packages/shared/cooking/src/session.ts`
**Test Source File**: `packages/shared/cooking/src/__tests__/session.test.ts`

> **Corrected 2026-08-09.** `UTP-004-A`…`UTP-004-H` previously exercised a stateful `StepNavigationController` class —
> `controller.initialise(0, 3)`, `getState().stepIndex`, "no callback fired" — that does not exist and is not the approved design;
> see the correction note under MOD-004 in `module-design.md`. Every one of those scenarios was unrunnable against the shipped pure
> reducer. The cases below are transcribed from the shipped suite. Case **letters are carried over where the intent is genuinely
> the same** (A invalid `totalSteps`, B the opening state, C last-step clamp, D first-step clamp, E normal navigation, G state
> transitions, H `totalSteps` BVA); **I…M are added** for behaviour the class-shaped plan had no equivalent of — validated jumps,
> the no-duplicate property, purity, JSON round trip, pause/resume. **`UTP-004-F` (unsubscribe) is retired**: a pure function emits
> nothing, so it has no analogue. Its letter is deliberately left unused rather than reassigned, so an external reference to
> `UTP-004-F` resolves to a retirement and not to a different test. Totals: **12 test cases, 51 scenario ids, 58 executing tests**
> (two cases are parameterised — see the notes under UTP-004-A and UTP-004-I), all passing.

---

#### UTP-004-A — createSession rejects an unusable step count

**Technique**: Equivalence Partitioning + Boundary Value Analysis (Internal Data Structures — `totalSteps`, integer `>= 1`)
**Mocks**: none (pure module)

| Scenario   | Arrange                                                       | Act                                                               | Assert                                                                                                                 |
| ---------- | ------------------------------------------------------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| UTS-004-A1 | `totalSteps = 0`, then `-1` (min−1 and below)                 | `createSession({ recipeId: 'recipe-01', totalSteps, startedAt })` | Throws; `isInvalidTotalStepsError(thrown)` is `true`                                                                   |
| UTS-004-A2 | `totalSteps = 1.5`, `NaN`, `Infinity` (non-integer partition) | Same call                                                         | Throws; `isInvalidTotalStepsError(thrown)` is `true` — one `Number.isInteger` guard covers all three                   |
| UTS-004-A3 | `totalSteps = 0`                                              | Same call                                                         | Thrown value matches `{ name: 'InvalidTotalStepsError', totalSteps: 0 }`; `isInvalidStepIndexError(thrown)` is `false` |

> A1 and A2 share one parameterised `it.each` over the five values, so this case runs **6 tests** across 3 scenario ids. Each
> asserts the specific guard rather than a bare `.toThrow()`, which would also pass against an unimplemented stub.

---

#### UTP-004-B — createSession opens the session at the first step (REQ-008)

**Technique**: Statement & Branch Coverage (Algorithmic/Logic View — `createSession` success path)
**Mocks**: none (pure module)

| Scenario   | Arrange          | Act                | Assert                                                                                                                                                               |
| ---------- | ---------------- | ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| UTS-004-B1 | `totalSteps = 5` | `createSession(…)` | Result `toStrictEqual` `{ recipeId, startedAt, currentStepIndex: 0, completedSteps: [], checkedIngredientIds: [], scaleFactor: 1, activeTimers: [] }` — whole object |
| UTS-004-B2 | `totalSteps = 5` | `createSession(…)` | `'pausedAt' in session` is `false` — the key is **omitted**, not `undefined`, so a persisted session is deep-equal to its restored copy                              |

---

#### UTP-004-C — advance clamps at the last step

**Technique**: Boundary Value Analysis (Internal Data Structures — `currentStepIndex ∈ [0, totalSteps - 1]`)
**Mocks**: none (pure module)

| Scenario   | Arrange                                                        | Act                    | Assert                                                                                                            |
| ---------- | -------------------------------------------------------------- | ---------------------- | ----------------------------------------------------------------------------------------------------------------- |
| UTS-004-C1 | 3-step session advanced twice (at index 2)                     | `advance(atLast, 3)`   | `currentStepIndex` stays `2`; `completedSteps` is `[0, 1, 2]` — the final step is still recorded                  |
| UTS-004-C2 | 3-step session already holding `[0, 1, 2]`                     | `advance(finished, 3)` | Result `toStrictEqual` the input — the terminal advance is idempotent, not a growing duplicate list               |
| UTS-004-C3 | `totalSteps = 1` (single-step recipe)                          | `advance(session, 1)`  | `currentStepIndex = 0`; `completedSteps = [0]` — completes without ever moving                                    |
| UTS-004-C4 | Restored session with `currentStepIndex = 7`; recipe now has 3 | `advance(stale, 3)`    | `currentStepIndex = 2`; `completedSteps = [2]` — a stale index is repaired into range, not walked further off end |

---

#### UTP-004-D — goBack clamps at the first step (REQ-003)

**Technique**: Boundary Value Analysis (Internal Data Structures — lower bound of `currentStepIndex`)
**Mocks**: none (pure module)

| Scenario   | Arrange                                                 | Act                | Assert                                                                                                        |
| ---------- | ------------------------------------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------- |
| UTS-004-D1 | Session at index 1                                      | `goBack(atSecond)` | `currentStepIndex = 0`                                                                                        |
| UTS-004-D2 | Fresh session at index 0                                | `goBack(session)`  | Result `toStrictEqual` the input — a value no-op at the lower boundary                                        |
| UTS-004-D3 | 3-step session at index 2 with `completedSteps = [0,1]` | `goBack(atLast)`   | `currentStepIndex = 1`; `completedSteps` still `[0, 1]` — FR-033: reviewing reveals progress, never undoes it |
| UTS-004-D4 | Corrupt restored session with `currentStepIndex = -4`   | `goBack(corrupt)`  | `currentStepIndex = 0` — repaired rather than propagated                                                      |

---

#### UTP-004-E — advance moves forward and records the departed step (REQ-002)

**Technique**: Statement & Branch Coverage (Algorithmic/Logic View — `advance` success path)
**Mocks**: none (pure module)

| Scenario   | Arrange                                                            | Act                               | Assert                                                                                                      |
| ---------- | ------------------------------------------------------------------ | --------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| UTS-004-E1 | Fresh 3-step session                                               | `advance(session, 3)`             | `currentStepIndex = 1`; `completedSteps = [0]`                                                              |
| UTS-004-E2 | Fresh 3-step session                                               | `advance(advance(session, 3), 3)` | `currentStepIndex = 2`; `completedSteps = [0, 1]` — progress accumulates across the recipe                  |
| UTS-004-E3 | Session with `checkedIngredientIds = ['ing-1']`, `scaleFactor = 2` | `advance(session, 3)`             | `recipeId`, `startedAt`, `checkedIngredientIds`, `scaleFactor`, `activeTimers` all unchanged                |
| UTS-004-E4 | Fresh 3-step session                                               | `advance(session, 0)`             | `isInvalidTotalStepsError(thrown)` is `true` — every boundary-taking transition re-validates the step count |

---

#### UTP-004-G — sessionStatus derives the statechart position

**Technique**: State Transition Testing (State Machine View) + Equivalence Partitioning (`SessionStatus` enum)
**Mocks**: none (pure module)

| Scenario    | Arrange                                                            | Act                                     | Assert                                                                                          |
| ----------- | ------------------------------------------------------------------ | --------------------------------------- | ----------------------------------------------------------------------------------------------- |
| UTS-004-G1  | Fresh 3-step session                                               | `sessionStatus(session, 3)`             | `'idle'`                                                                                        |
| UTS-004-G2  | Session advanced once                                              | `sessionStatus(advanced, 3)`            | `'cooking'`                                                                                     |
| UTS-004-G3  | Advanced then `goBack` — index 0 again, `completedSteps = [0]`     | `sessionStatus(back, 3)`                | `'cooking'`, **not** `'idle'` — position alone must not decide the status                       |
| UTS-004-G4  | Advanced then paused                                               | `sessionStatus(paused, 3)`              | `'paused'`                                                                                      |
| UTS-004-G5  | The same session resumed                                           | `sessionStatus(resume(paused), 3)`      | `'cooking'`                                                                                     |
| UTS-004-G6  | A **fresh** session paused                                         | `sessionStatus(paused, 3)` then resumed | `'paused'`, then `'idle'` after `resume` — the overlay does not destroy the underlying state    |
| UTS-004-G7  | Advanced through all three steps                                   | `sessionStatus(finished, 3)`            | `'complete'`                                                                                    |
| UTS-004-G8  | At the last step, `completedSteps = [0, 1]`                        | `sessionStatus(atLast, 3)`              | `'cooking'` — reaching the last step is not yet completing it                                   |
| UTS-004-G9  | Finished session, then `goBack`                                    | `sessionStatus(goBack(finished), 3)`    | `'complete'` — reviewing after finishing does not un-finish                                     |
| UTS-004-G10 | Finished session, then paused                                      | `sessionStatus(paused, 3)`              | `'paused'` — pause outranks completion, because only pause is explicit state                    |
| UTS-004-G11 | `currentStepIndex = 2`, `completedSteps = [0, 2]` (step 1 skipped) | `sessionStatus(partial, 3)`             | `'cooking'` — a partial set is not complete                                                     |
| UTS-004-G12 | `completedSteps = [0, 1, 2]` but the recipe grew to 5 steps        | `sessionStatus(stale, 5)`               | `'cooking'` — completion is index **membership**, not a count, so ghost progress cannot fake it |
| UTS-004-G13 | Any session                                                        | `sessionStatus(session, -1)`            | `isInvalidTotalStepsError(thrown)` is `true`                                                    |

---

#### UTP-004-H — BVA: totalSteps boundary values

**Technique**: Boundary Value Analysis (Internal Data Structures — `totalSteps >= 1`)
**Mocks**: none (pure module)

| Scenario   | Arrange                      | Act                                                | Assert                           |
| ---------- | ---------------------------- | -------------------------------------------------- | -------------------------------- |
| UTS-004-H1 | `totalSteps = 1` (min valid) | `createSession(…)`                                 | No throw; `currentStepIndex = 0` |
| UTS-004-H2 | `totalSteps = 200`           | `createSession(…)` → `sessionStatus(session, 200)` | No throw; status is `'idle'`     |

---

#### UTP-004-I — goToStep validates the requested index

**Technique**: Boundary Value Analysis + Error Guessing (Error Handling View — `InvalidStepIndexError`)
**Mocks**: none (pure module)

| Scenario   | Arrange              | Act                                                           | Assert                                                                                    |
| ---------- | -------------------- | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| UTS-004-I1 | Fresh 3-step session | `goToStep(session, 2, 3)`                                     | `currentStepIndex = 2`                                                                    |
| UTS-004-I2 | Fresh 3-step session | `goToStep(session, 0, 3)` and `goToStep(session, 2, 3)`       | Both range boundaries accepted                                                            |
| UTS-004-I3 | Fresh 3-step session | `goToStep(session, 2, 3)`                                     | `completedSteps` stays `[]` — skipping over steps is not the same as cooking them         |
| UTS-004-I4 | Fresh 3-step session | `goToStep(session, index, 3)` for `3, -1, 1.5, NaN, Infinity` | `isInvalidStepIndexError(thrown)` is `true` for each — max+1, min−1 and the non-integers  |
| UTS-004-I5 | Fresh 3-step session | `goToStep(session, 9, 3)`                                     | Thrown value matches `{ name: 'InvalidStepIndexError', index: 9, totalSteps: 3 }`         |
| UTS-004-I6 | Fresh 3-step session | `goToStep(session, 0, 0)`                                     | `isInvalidTotalStepsError(thrown)` is `true` — the step count is checked before the index |

> UTS-004-I4 is a parameterised `it.each` over five indices, so this case runs **10 tests** across 6 scenario ids.

---

#### UTP-004-J — completedSteps never contains duplicates

**Technique**: Statement & Branch Coverage (Algorithmic/Logic View — `withStepRecorded` membership branch)
**Mocks**: none (pure module)

| Scenario   | Arrange              | Act                                            | Assert                                                                                 |
| ---------- | -------------------- | ---------------------------------------------- | -------------------------------------------------------------------------------------- |
| UTS-004-J1 | Fresh 3-step session | `advance` → `goBack` → `advance`               | `completedSteps` is `[0]` (recorded once); `currentStepIndex = 1`                      |
| UTS-004-J2 | Fresh 3-step session | Two advances, two `goBack`s, then two advances | `completedSteps` is `[0, 1]`; `new Set(completedSteps).size === completedSteps.length` |

---

#### UTP-004-K — every transition is pure

**Technique**: Invariant Assertion / Strict Isolation (frozen inputs — a stray `push` throws rather than passing quietly)
**Mocks**: none (pure module)

| Scenario   | Arrange                                                    | Act                                                                            | Assert                                                                                          |
| ---------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| UTS-004-K1 | A deep-frozen session, `structuredClone`d before the calls | `advance`, `goBack`, `goToStep`, `pause`, `resume`, `sessionStatus` all called | The session `toStrictEqual` its pre-call clone — no transition mutates its input                |
| UTS-004-K2 | A deep-frozen session                                      | Each transition invoked                                                        | Every result is `not.toBe` the input — a new object, never the same reference                   |
| UTS-004-K3 | A session already holding `completedSteps = [0]`           | `advance(session, 3)`                                                          | `next.completedSteps` is `not.toBe` `session.completedSteps`; the old session still reads `[0]` |

---

#### UTP-004-L — a session survives a JSON round trip

**Technique**: Invariant Assertion (serialization — the invariant FR-033's session resume depends on)
**Mocks**: none (pure module)

| Scenario   | Arrange                                          | Act                                  | Assert                                                                                  |
| ---------- | ------------------------------------------------ | ------------------------------------ | --------------------------------------------------------------------------------------- |
| UTS-004-L1 | Mid-navigation session with a checked ingredient | `JSON.parse(JSON.stringify(midway))` | Restored copy `toStrictEqual` the original                                              |
| UTS-004-L2 | A paused session                                 | `JSON.parse(JSON.stringify(paused))` | Restored copy `toStrictEqual` the original, `pausedAt` included; still reads `'paused'` |
| UTS-004-L3 | A restored mid-navigation session                | `advance(restored, 3)`               | `currentStepIndex = 2`; `completedSteps = [0, 1]` — navigation continues correctly      |

---

#### UTP-004-M — pause and resume

**Technique**: State Transition Testing (State Machine View — the `paused` overlay)
**Mocks**: none (pure module)

| Scenario   | Arrange                         | Act                                         | Assert                                                                          |
| ---------- | ------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------- |
| UTS-004-M1 | Session advanced once           | `pause(midway, '2026-08-09T10:30:00.000Z')` | `pausedAt` recorded; `currentStepIndex` and `completedSteps` untouched          |
| UTS-004-M2 | A paused session                | `resume(paused)`                            | `'pausedAt' in resumed` is `false` — the key is deleted, not set to `undefined` |
| UTS-004-M3 | Session advanced once           | `resume(pause(midway, …))`                  | Result `toStrictEqual` the pre-pause session (FR-033)                           |
| UTS-004-M4 | A session that was never paused | `resume(session)`                           | Result `toStrictEqual` the input — safe, not an error                           |
| UTS-004-M5 | A session paused at 10:30       | `pause(first, '2026-08-09T11:00:00.000Z')`  | `pausedAt` is the later timestamp — the most recent pause wins                  |

---

#### UTP-004-F — RETIRED (2026-08-09)

The class design's `onStepChange` unsubscribe path. A pure reducer emits nothing, so the case has no analogue; the letter is
retained as a tombstone and MUST NOT be reassigned.

---

### MOD-005 — GestureInputAdapter

**Parent Architecture Modules**: ARCH-005
**Target Source File**: `packages/apps/commise/features/cooking/src/adapters/GestureInputAdapter.tsx`

---

#### UTP-005-A — Swipe left (dx < -50) calls onNext

**Technique**: Statement & Branch Coverage (Algorithmic/Logic View — `dx < -SWIPE_THRESHOLD` branch)
**Mocks**: `onNext` spy; `onPrev` spy; `PanResponder` gesture state injected

| Scenario   | Arrange                                        | Act                             | Assert                                             |
| ---------- | ---------------------------------------------- | ------------------------------- | -------------------------------------------------- |
| UTS-005-A1 | `gestureState.dx = -51`                        | Trigger `onPanResponderRelease` | `onNext()` called once; `onPrev` NOT called        |
| UTS-005-A2 | `gestureState.dx = -50` (exactly at threshold) | Trigger release                 | `onNext()` NOT called (threshold is exclusive `<`) |

---

#### UTP-005-B — Swipe right (dx > 50) calls onPrev

**Technique**: Statement & Branch Coverage (Algorithmic/Logic View — `dx > SWIPE_THRESHOLD` branch)

| Scenario   | Arrange                                       | Act             | Assert                                      |
| ---------- | --------------------------------------------- | --------------- | ------------------------------------------- |
| UTS-005-B1 | `gestureState.dx = 51`                        | Trigger release | `onPrev()` called once; `onNext` NOT called |
| UTS-005-B2 | `gestureState.dx = 50` (exactly at threshold) | Trigger release | `onPrev()` NOT called                       |

---

#### UTP-005-C — Sub-threshold gesture is ignored

**Technique**: Statement & Branch Coverage (Algorithmic/Logic View — else/ignore branch)

| Scenario   | Arrange                | Act             | Assert                               |
| ---------- | ---------------------- | --------------- | ------------------------------------ |
| UTS-005-C1 | `gestureState.dx = 0`  | Trigger release | Neither `onNext` nor `onPrev` called |
| UTS-005-C2 | `gestureState.dx = 25` | Trigger release | Neither callback called              |

---

#### UTP-005-D — Horizontal swipe detection: dx dominates dy

**Technique**: Statement & Branch Coverage (Algorithmic/Logic View — `onMoveShouldSetPanResponder` branch)

| Scenario   | Arrange                                        | Act                                  | Assert                                |
| ---------- | ---------------------------------------------- | ------------------------------------ | ------------------------------------- |
| UTS-005-D1 | `gestureState.dx = 60`, `gestureState.dy = 10` | `onMoveShouldSetPanResponder` called | Returns `true` (horizontal dominates) |
| UTS-005-D2 | `gestureState.dx = 10`, `gestureState.dy = 60` | `onMoveShouldSetPanResponder` called | Returns `false` (vertical dominates)  |

---

#### UTP-005-E — BVA: SWIPE_THRESHOLD boundary

**Technique**: Boundary Value Analysis (Internal Data Structures — `SWIPE_THRESHOLD = 50`)

| Scenario   | Arrange                    | Act     | Assert          |
| ---------- | -------------------------- | ------- | --------------- |
| UTS-005-E1 | `dx = -49` (threshold - 1) | Release | No callback     |
| UTS-005-E2 | `dx = -51` (threshold + 1) | Release | `onNext` called |
| UTS-005-E3 | `dx = 49`                  | Release | No callback     |
| UTS-005-E4 | `dx = 51`                  | Release | `onPrev` called |

---

### MOD-006 — TimerEngine

**Parent Architecture Modules**: ARCH-006
**Target Source File**: `packages/shared/cooking/src/timerEngine.ts`
**Test Source File**: `packages/shared/cooking/src/__tests__/timerEngine.test.ts`

> **Corrected 2026-08-09.** `UTP-006-A`…`UTP-006-I` previously exercised a `setInterval`-driven **single-timer class** —
> `engine.start(0)`, `clearInterval` spies, a `remaining` seconds counter, `engine.reset()`, and an
> `'idle' | 'running' | 'paused' | 'done'` status enum — that does not exist and is not the approved design; see the correction note
> under MOD-006 in `module-design.md`. Every one of those scenarios was unrunnable against the shipped pure engine, and because the
> old plan modelled **no concurrency at all**, the entire multi-timer surface (`startTimer` / `cancelTimer` / `completedTimers`,
> and therefore HAZ-008) had no unit coverage whatsoever. The cases below are transcribed from the shipped suite. Three cases are
> **retired**, their letters left unused rather than reassigned: `UTP-006-G` (status-enum state transitions), `UTP-006-H`
> (`durationSeconds` BVA) and `UTP-006-I` (status-enum partitioning) — with the enum and the tick gone, their intent now lives
> inside UTP-006-A (duration boundaries), UTP-006-C (the completion boundary) and UTP-006-D (the pause/resume transitions).
> `UTP-006-F` is **repurposed**: it no longer covers `tick`, it now carries the D-002 safety invariant, which is what that letter
> denotes in the shipped suite. Totals: **6 test cases, 47 scenario ids, 53 executing tests** (two cases are parameterised — see the
> notes under UTP-006-A and UTP-006-B), all passing.

---

#### UTP-006-A — createTimerFromStep converts SECONDS to milliseconds

**Technique**: Statement & Branch Coverage + Boundary Value Analysis (Algorithmic/Logic View — `createTimerFromStep`; `timerSeconds > 0`)
**Mocks**: none (pure module — `nowIso` is an input, so no fake timers are required)

| Scenario   | Arrange                                                    | Act                                                       | Assert                                                                                                           |
| ---------- | ---------------------------------------------------------- | --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| UTS-006-A1 | The canonical REQ-004 step: `timerSeconds = 1500` (25 min) | `createTimerFromStep(bakeStep, START)`                    | `durationMs` is exactly `1_500_000`                                                                              |
| UTS-006-A2 | `timerSeconds` of `1`, `90`, `3600`                        | `createTimerFromStep(…)`                                  | `1_000`, `90_000`, `3_600_000` — the factor is exactly `1000`, **not** `60` and not `60_000` (minutes)           |
| UTS-006-A3 | The canonical step                                         | `createTimerFromStep(bakeStep, START)`                    | Whole object equals `{ id, label: step.instruction, stepNumber, durationMs, startedAt: START, isPaused: false }` |
| UTS-006-A4 | `nowIso = '2026-08-07T13:00:00.000+01:00'`                 | `createTimerFromStep(bakeStep, nowIso)`                   | `startedAt` normalised to canonical UTC `'2026-08-07T12:00:00.000Z'`                                             |
| UTS-006-A5 | A step with `timerSeconds` omitted                         | `createTimerFromStep(stepWithoutTimer, START)`            | `isStepHasNoTimerError(thrown)` is `true` — the common, expected case                                            |
| UTS-006-A6 | `timerSeconds` of `0`, `-1`, `0.5`, `NaN`, `Infinity`      | `createTimerFromStep({ …bakeStep, timerSeconds }, START)` | `isInvalidTimerDurationError(thrown)` is `true` for each — `0` is rejected, not started-and-instantly-done       |
| UTS-006-A7 | `nowIso = 'not-a-timestamp'`                               | `createTimerFromStep(bakeStep, nowIso)`                   | `isInvalidTimestampError(thrown)` is `true`                                                                      |
| UTS-006-A8 | A copy of the step                                         | `createTimerFromStep(step, START)`                        | The step is unchanged afterwards (REQ-CN-001 — Cooking Mode never mutates recipe data)                           |

> UTS-006-A6 is a parameterised `it.each` over five durations, so this case runs **12 tests** across 8 scenario ids.

---

#### UTP-006-B — remainingMs counts down and clamps

**Technique**: Boundary Value Analysis + Error Guessing (Internal Data Structures — remaining ∈ `[0, durationMs]`)
**Mocks**: none (pure module)

| Scenario    | Arrange                                                   | Act                                             | Assert                                                                                            |
| ----------- | --------------------------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| UTS-006-B1  | 25-minute timer started at `12:00:00.000Z`                | `remainingMs(timer, START)`                     | The full `1_500_000` ms remains                                                                   |
| UTS-006-B2  | Same timer                                                | `remainingMs(timer, '12:10:00.000Z')`           | `900_000` — exactly 15 minutes                                                                    |
| UTS-006-B3  | Same timer                                                | `remainingMs(timer, '12:24:59.999Z')`           | `1` ms (max−1 boundary of elapsed time)                                                           |
| UTS-006-B4  | Same timer                                                | `remainingMs(timer, '12:25:00.000Z')`           | `0` at exactly the duration                                                                       |
| UTS-006-B5  | Same timer, 15 minutes past the end                       | `remainingMs(timer, '12:40:00.000Z')`           | `0`, and `>= 0` — an overrun clamps and never goes negative                                       |
| UTS-006-B6  | `nowIso` **before** `startedAt` (NTP / manual correction) | `remainingMs(timer, '11:55:00.000Z')`           | Clamped to `durationMs` — never more time than the timer was set for                              |
| UTS-006-B7  | Paused timer with `pausedRemainingMs = 900_000`           | `remainingMs(paused, …)` at 12:10 and 12:40     | `900_000` both times — frozen while wall-clock time passes                                        |
| UTS-006-B8  | A running timer and a paused timer                        | `remainingMs(…, '')` / `remainingMs(…, 'nope')` | `isInvalidTimestampError(thrown)` on **both** branches — the contract does not differ by path     |
| UTS-006-B9  | Timer with `startedAt = '2026-13-45'`                     | `remainingMs(corrupt, START)`                   | `isInvalidTimestampError(thrown)` is `true`                                                       |
| UTS-006-B10 | Timer with `isPaused = true` and no `pausedRemainingMs`   | `remainingMs(corrupt, START)`                   | `isInvalidTimerStateError(thrown)` is `true` — a corrupt restore is refused, not silently resumed |
| UTS-006-B11 | `durationMs` of `NaN`, `Infinity`, `-1`                   | `remainingMs({ …timer, durationMs }, START)`    | `isInvalidTimerStateError(thrown)` is `true` for each                                             |

> UTS-006-B11 is a parameterised `it.each` over three durations, so this case runs **13 tests** across 11 scenario ids.

---

#### UTP-006-C — isComplete at the exact boundary

**Technique**: Boundary Value Analysis (the REQ-006 alert trigger — max−1, max, max+1)
**Mocks**: none (pure module)

| Scenario   | Arrange                                   | Act                                   | Assert                                                         |
| ---------- | ----------------------------------------- | ------------------------------------- | -------------------------------------------------------------- |
| UTS-006-C1 | 25-minute timer                           | `isComplete(timer, '12:24:59.999Z')`  | `false` — not complete one millisecond early                   |
| UTS-006-C2 | Same timer                                | `isComplete(timer, '12:25:00.000Z')`  | `true` from the exact instant the duration elapses             |
| UTS-006-C3 | Same timer                                | `isComplete(timer, '12:40:00.000Z')`  | `true` — still complete after an overrun                       |
| UTS-006-C4 | Timer paused with `pausedRemainingMs = 1` | `isComplete(paused, '12:40:00.000Z')` | `false` — a paused timer never completes, however long it sits |
| UTS-006-C5 | Timer paused with `pausedRemainingMs = 0` | `isComplete(paused, '12:25:00.000Z')` | `true` — paused at zero is complete                            |

---

#### UTP-006-D — pause/resume preserves remaining time exactly

**Technique**: State Transition Testing (State Machine View — `Running ⇄ Paused`) + Error Guessing
**Mocks**: none (pure module)

| Scenario    | Arrange                                        | Act                                                        | Assert                                                                                                       |
| ----------- | ---------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| UTS-006-D1  | 25-minute timer, 10 minutes elapsed            | `pauseTimer(timer, '12:10:00.000Z')`                       | `isPaused` `true`; `pausedRemainingMs` `900_000`; `durationMs` untouched                                     |
| UTS-006-D2  | A copy of the running timer                    | `pauseTimer(original, …)`                                  | The input timer is unchanged — pause does not mutate                                                         |
| UTS-006-D3  | Paused at 12:10                                | `resumeTimer(paused, '12:30:00.000Z')`                     | `remainingMs` at 12:30 is exactly `900_000`; `isPaused` `false`; `pausedRemainingMs` `undefined`             |
| UTS-006-D4  | Paused then resumed                            | Inspect the resumed timer                                  | `Object.hasOwn(resumed, 'pausedRemainingMs')` is `false` — the marker is dropped, not left stale             |
| UTS-006-D5  | Paused at 12:10 (15:00 left), resumed at 12:30 | `remainingMs` / `isComplete` at 12:35, 12:44:59.999, 12:45 | `600_000`; `false`; `true` — the deadline moves by exactly the paused interval, not a millisecond either way |
| UTS-006-D6  | Three 1-minute pause/resume cycles             | `isComplete` at 12:27:59.999 and 12:28:00.000              | `false` then `true` — repeated cycles accumulate no drift                                                    |
| UTS-006-D7  | An already-paused timer                        | `pauseTimer(paused, '12:40:00.000Z')`                      | Returns the **same reference** — a repeated tap cannot re-capture, therefore cannot alter, the frozen time   |
| UTS-006-D8  | A running timer                                | `resumeTimer(timer, '12:10:00.000Z')`                      | Returns the same reference — resuming a running timer is a no-op                                             |
| UTS-006-D9  | `isPaused = true` with no `pausedRemainingMs`  | `resumeTimer(corrupt, …)`                                  | `isInvalidTimerStateError(thrown)` is `true`                                                                 |
| UTS-006-D10 | A running and a paused timer                   | `pauseTimer(…, 'nope')` / `resumeTimer(…, 'nope')`         | `isInvalidTimestampError(thrown)` on both                                                                    |

---

#### UTP-006-E — concurrent timers

**Technique**: Statement & Branch Coverage (Algorithmic/Logic View — `startTimer` / `cancelTimer` / `completedTimers`) + Error Guessing
**Mocks**: none (pure module — the timer set is a caller-owned array)

| Scenario    | Arrange                                   | Act                                                    | Assert                                                                                                    |
| ----------- | ----------------------------------------- | ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| UTS-006-E1  | `[bakeTimer]`                             | `startTimer(timers, boilTimer)`                        | Returns `[bakeTimer, boilTimer]`; the caller's array still reads `[bakeTimer]`                            |
| UTS-006-E2  | `[bakeTimer]`                             | `startTimer(timers, { …bakeTimer, startedAt: later })` | `isDuplicateTimerIdError(thrown)` is `true`; the array is untouched — rejected, not silently deduped      |
| UTS-006-E3  | A 25-minute and a 5-minute timer running  | `remainingMs` on each at 12:08                         | `1_020_000` and `0` — the two countdowns are independent                                                  |
| UTS-006-E4  | Same pair, the bake timer paused at 12:05 | `remainingMs` on each at 12:08                         | `1_200_000` (frozen) and `0` — pausing one leaves the other running                                       |
| UTS-006-E5  | `[bakeTimer, boilTimer]`                  | `cancelTimer(timers, 'step-bake')`                     | Returns `[boilTimer]`; the caller's array is unchanged                                                    |
| UTS-006-E6  | `[bakeTimer]`                             | `cancelTimer(timers, 'step-missing')`                  | `isUnknownTimerError(thrown)` is `true` — a silent no-op would leave a "cancelled" timer running to alert |
| UTS-006-E7  | `[bakeTimer, boilTimer]`                  | `completedTimers(timers, 12:08)` then `12:40`          | `[boilTimer]`, then `[bakeTimer, boilTimer]` — finished only, in source order                             |
| UTS-006-E8  | The same pair, both still running         | `completedTimers(timers, 12:04)`                       | `[]`                                                                                                      |
| UTS-006-E9  | An empty timer list                       | `completedTimers([], START)`                           | `[]`                                                                                                      |
| UTS-006-E10 | A timer paused before its window elapsed  | `completedTimers([paused], 12:40)`                     | `[]` — a paused timer is never reported complete just because wall-clock time passed                      |

---

#### UTP-006-F — SAFETY: yield scaling never reaches a timer (D-002)

**Technique**: Invariant Assertion / Static Inspection (structural, so a later edit reintroducing the dependency fails the suite)
**Mocks**: none — the module source itself is the fixture

| Scenario   | Arrange                                 | Act                                    | Assert                                                                                              |
| ---------- | --------------------------------------- | -------------------------------------- | --------------------------------------------------------------------------------------------------- |
| UTS-006-F1 | The module's own source, read from disk | Filter its `import` lines              | At least one import exists, and **none** matches `/scal/i` — the invariant is structural            |
| UTS-006-F2 | The module's eight exported functions   | Read `Function.length` on each         | Every arity is `2` — a scale factor could only arrive as an extra argument, so none can be smuggled |
| UTS-006-F3 | The module's own source                 | Regex for `Date.now(` and `new Date()` | Neither appears — the engine never reads the ambient clock (the determinism invariant)              |

---

#### UTP-006-G, UTP-006-H, UTP-006-I — RETIRED (2026-08-09)

The class design's status-enum state machine, `durationSeconds` BVA and status-enum equivalence partitioning. The enum and the
`setInterval` tick no longer exist; the surviving intent is covered by UTP-006-A, UTP-006-C and UTP-006-D. These letters are
tombstones and MUST NOT be reassigned.

---

### MOD-007 — TimerDisplayWidget

**Parent Architecture Modules**: ARCH-007
**Target Source File**: `packages/apps/commise/features/cooking/src/components/TimerDisplayWidget.tsx`

---

#### UTP-007-A — Null timerState renders placeholder

**Technique**: Statement & Branch Coverage (Algorithmic/Logic View — null guard)

| Scenario   | Arrange                  | Act                                               | Assert                              |
| ---------- | ------------------------ | ------------------------------------------------- | ----------------------------------- |
| UTS-007-A1 | `timerState = null`      | Render `<TimerDisplayWidget timerState={null} />` | Renders `"—"` placeholder; no crash |
| UTS-007-A2 | `timerState = undefined` | Render                                            | Same `"—"` placeholder              |

---

#### UTP-007-B — formatTime: correct MM:SS formatting

**Technique**: Statement & Branch Coverage (Algorithmic/Logic View — `formatTime` function)

| Scenario   | Arrange            | Act                | Assert            |
| ---------- | ------------------ | ------------------ | ----------------- |
| UTS-007-B1 | `remaining = 90`   | `formatTime(90)`   | Returns `"01:30"` |
| UTS-007-B2 | `remaining = 0`    | `formatTime(0)`    | Returns `"00:00"` |
| UTS-007-B3 | `remaining = 3599` | `formatTime(3599)` | Returns `"59:59"` |

---

#### UTP-007-C — Negative remaining is clamped to "00:00"

**Technique**: Statement & Branch Coverage (Algorithmic/Logic View — defensive clamp)

| Scenario   | Arrange          | Act              | Assert                      |
| ---------- | ---------------- | ---------------- | --------------------------- |
| UTS-007-C1 | `remaining = -1` | `formatTime(-1)` | Returns `"00:00"` (clamped) |

---

#### UTP-007-D — Primary action: idle shows Start button

**Technique**: Equivalence Partitioning (Internal Data Structures — `status` enum)

| Scenario   | Arrange                         | Act    | Assert                                       |
| ---------- | ------------------------------- | ------ | -------------------------------------------- |
| UTS-007-D1 | `timerState.status = 'idle'`    | Render | Start button visible; Reset button absent    |
| UTS-007-D2 | `timerState.status = 'running'` | Render | Pause button visible; Reset button visible   |
| UTS-007-D3 | `timerState.status = 'paused'`  | Render | Resume button visible; Reset button visible  |
| UTS-007-D4 | `timerState.status = 'done'`    | Render | Restart button visible; Reset button visible |

---

#### UTP-007-E — BVA: displayTime string length

**Technique**: Boundary Value Analysis (Internal Data Structures — `displayTime` 5 chars MM:SS)

| Scenario   | Arrange                    | Act                | Assert                                    |
| ---------- | -------------------------- | ------------------ | ----------------------------------------- |
| UTS-007-E1 | `remaining = 0`            | `formatTime(0)`    | `displayTime = "00:00"` (exactly 5 chars) |
| UTS-007-E2 | `remaining = 5999` (99:59) | `formatTime(5999)` | `displayTime = "99:59"` (exactly 5 chars) |

---

### MOD-008 — AudioAlertService

**Parent Architecture Modules**: ARCH-008
**Target Source File**: `packages/apps/commise/features/cooking/src/services/AudioAlertService.ts`

---

#### UTP-008-A — initialise: permission granted loads sound

**Technique**: Statement & Branch Coverage (Algorithmic/Logic View — `permission.status == 'granted'` branch)
**Mocks**: `Audio.requestPermissionsAsync` → `{ status: 'granted' }`; `Audio.Sound.createAsync` → mock sound object

| Scenario   | Arrange            | Act                          | Assert                                          |
| ---------- | ------------------ | ---------------------------- | ----------------------------------------------- |
| UTS-008-A1 | Permission granted | `await service.initialise()` | `permissionGranted = true`; `sound` is non-null |

---

#### UTP-008-B — initialise: permission denied sets visual fallback

**Technique**: Statement & Branch Coverage (Algorithmic/Logic View — `permission.status != 'granted'` branch)
**Mocks**: `Audio.requestPermissionsAsync` → `{ status: 'denied' }`; `LOG_WARNING` spy

| Scenario   | Arrange           | Act                          | Assert                                                                    |
| ---------- | ----------------- | ---------------------------- | ------------------------------------------------------------------------- |
| UTS-008-B1 | Permission denied | `await service.initialise()` | `permissionGranted = false`; `sound` remains `null`; `LOG_WARNING` called |

---

#### UTP-008-C — play: with permission plays sound

**Technique**: Statement & Branch Coverage (Algorithmic/Logic View — `permissionGranted AND sound != null` branch)
**Mocks**: `sound.replayAsync` spy

| Scenario   | Arrange                             | Act                    | Assert                                                                    |
| ---------- | ----------------------------------- | ---------------------- | ------------------------------------------------------------------------- |
| UTS-008-C1 | Service initialised with permission | `await service.play()` | `sound.replayAsync()` called once; `EMIT_EVENT('visualAlert')` NOT called |

---

#### UTP-008-D — play: without permission emits visual alert

**Technique**: Statement & Branch Coverage (Algorithmic/Logic View — else branch)
**Mocks**: `EMIT_EVENT` spy

| Scenario   | Arrange                                | Act                    | Assert                                                       |
| ---------- | -------------------------------------- | ---------------------- | ------------------------------------------------------------ |
| UTS-008-D1 | Service initialised without permission | `await service.play()` | `EMIT_EVENT('visualAlert')` called; `replayAsync` NOT called |

---

#### UTP-008-E — dispose: unloads sound and nullifies reference

**Technique**: Statement & Branch Coverage (Algorithmic/Logic View — `dispose` function)

| Scenario   | Arrange                        | Act                       | Assert                                       |
| ---------- | ------------------------------ | ------------------------- | -------------------------------------------- |
| UTS-008-E1 | Service initialised with sound | `await service.dispose()` | `sound.unloadAsync()` called; `sound = null` |
| UTS-008-E2 | Service with `sound = null`    | `await service.dispose()` | No error; `unloadAsync` NOT called           |

---

#### UTP-008-F — State Transition: Uninitialised → Ready → Playing → Ready → Disposed

**Technique**: State Transition Testing (State Machine View)

| Scenario   | Arrange       | Act                                               | Assert                                                                                              |
| ---------- | ------------- | ------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| UTS-008-F1 | Fresh service | `initialise()` (granted) → `play()` → `dispose()` | States: `Uninitialised → PermissionPending → Ready → Playing → Ready → Disposed`                    |
| UTS-008-F2 | Fresh service | `initialise()` (denied) → `play()`                | States: `Uninitialised → PermissionPending → VisualFallback → VisualFallback` (visualAlert emitted) |

---

#### UTP-008-G — Equivalence Partitioning: permissionGranted boolean

**Technique**: Equivalence Partitioning (Internal Data Structures — `permissionGranted: boolean`)

| Scenario   | Arrange                                     | Act      | Assert                     |
| ---------- | ------------------------------------------- | -------- | -------------------------- |
| UTS-008-G1 | `permissionGranted = true`, `sound != null` | `play()` | Audio path taken           |
| UTS-008-G2 | `permissionGranted = false`                 | `play()` | Visual fallback path taken |

---

### MOD-009 — ScreenWakeLockManager

**Parent Architecture Modules**: ARCH-009
**Target Source File**: `packages/shared/cooking/src/services/ScreenWakeLockManager.ts`

---

#### UTP-009-A — acquire: idempotent when already acquired

**Technique**: Statement & Branch Coverage (Algorithmic/Logic View — `isAcquired` guard)
**Mocks**: `activateKeepAwakeAsync` spy; platform = `'ios'`

| Scenario   | Arrange             | Act                       | Assert                                    |
| ---------- | ------------------- | ------------------------- | ----------------------------------------- |
| UTS-009-A1 | `isAcquired = true` | `await manager.acquire()` | `activateKeepAwakeAsync` NOT called again |

---

#### UTP-009-B — acquire: iOS/Android uses expo-keep-awake

**Technique**: Equivalence Partitioning (Internal Data Structures — platform enum)
**Mocks**: `PLATFORM = 'ios'`; `activateKeepAwakeAsync` spy

| Scenario   | Arrange                | Act                       | Assert                                                 |
| ---------- | ---------------------- | ------------------------- | ------------------------------------------------------ |
| UTS-009-B1 | Platform = `'ios'`     | `await manager.acquire()` | `activateKeepAwakeAsync()` called; `isAcquired = true` |
| UTS-009-B2 | Platform = `'android'` | `await manager.acquire()` | Same                                                   |

---

#### UTP-009-C — acquire: web uses navigator.wakeLock

**Technique**: Statement & Branch Coverage (Algorithmic/Logic View — web branch)
**Mocks**: `PLATFORM = 'web'`; `navigator.wakeLock.request` → mock sentinel

| Scenario   | Arrange                                       | Act                       | Assert                                                             |
| ---------- | --------------------------------------------- | ------------------------- | ------------------------------------------------------------------ |
| UTS-009-C1 | Platform = `'web'`; `wakeLock` in navigator   | `await manager.acquire()` | `navigator.wakeLock.request('screen')` called; `isAcquired = true` |
| UTS-009-C2 | Platform = `'web'`; `wakeLock.request` throws | `await manager.acquire()` | `LOG_WARNING` called; `isAcquired = false`                         |

---

#### UTP-009-D — acquire: unsupported platform logs warning

**Technique**: Statement & Branch Coverage (Algorithmic/Logic View — else branch)
**Mocks**: `PLATFORM = 'windows'`; `LOG_WARNING` spy

| Scenario   | Arrange              | Act                       | Assert                                     |
| ---------- | -------------------- | ------------------------- | ------------------------------------------ |
| UTS-009-D1 | Unsupported platform | `await manager.acquire()` | `LOG_WARNING` called; `isAcquired = false` |

---

#### UTP-009-E — release: idempotent when not acquired

**Technique**: Statement & Branch Coverage (Algorithmic/Logic View — `!isAcquired` guard)

| Scenario   | Arrange              | Act                       | Assert                           |
| ---------- | -------------------- | ------------------------- | -------------------------------- |
| UTS-009-E1 | `isAcquired = false` | `await manager.release()` | No platform API called; no error |

---

#### UTP-009-F — release: iOS/Android deactivates keep-awake

**Technique**: Statement & Branch Coverage (Algorithmic/Logic View — release mobile branch)
**Mocks**: `deactivateKeepAwake` spy; platform = `'ios'`

| Scenario   | Arrange                                 | Act                       | Assert                                               |
| ---------- | --------------------------------------- | ------------------------- | ---------------------------------------------------- |
| UTS-009-F1 | `isAcquired = true`; platform = `'ios'` | `await manager.release()` | `deactivateKeepAwake()` called; `isAcquired = false` |

---

#### UTP-009-G — State Transition: Released → Held → Released

**Technique**: State Transition Testing (State Machine View)

| Scenario   | Arrange          | Act                       | Assert                                           |
| ---------- | ---------------- | ------------------------- | ------------------------------------------------ |
| UTS-009-G1 | Fresh manager    | `acquire()` → `release()` | States: `Released → Acquiring → Held → Released` |
| UTS-009-G2 | `Held` state     | `acquire()` again         | Remains `Held` (idempotent)                      |
| UTS-009-G3 | `Released` state | `release()`               | Remains `Released` (idempotent)                  |

---

### MOD-010 — OfflineRecipeCache

**Parent Architecture Modules**: ARCH-010
**Target Source File**: `packages/shared/cooking/src/services/OfflineRecipeCache.ts`

---

#### UTP-010-A — cacheRecipe: invalid input throws

**Technique**: Statement & Branch Coverage (Algorithmic/Logic View — null/empty guard)
**Mocks**: `AsyncStorage.setItem` spy

| Scenario   | Arrange           | Act                                      | Assert                                                      |
| ---------- | ----------------- | ---------------------------------------- | ----------------------------------------------------------- |
| UTS-010-A1 | `recipeId = null` | `await cache.cacheRecipe(null, [step1])` | Throws `Error("Invalid cache input")`; `setItem` NOT called |
| UTS-010-A2 | `steps = []`      | `await cache.cacheRecipe("r1", [])`      | Throws `Error("Invalid cache input")`                       |

---

#### UTP-010-B — cacheRecipe: stores versioned JSON payload

**Technique**: Statement & Branch Coverage (Algorithmic/Logic View — happy path)
**Mocks**: `AsyncStorage.setItem` spy; `Date.now` → `1234567890`

| Scenario   | Arrange                                | Act                                      | Assert                                                                                                                         |
| ---------- | -------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| UTS-010-B1 | Valid `recipeId="r1"`, `steps=[step1]` | `await cache.cacheRecipe("r1", [step1])` | `setItem` called with key `"cooking_mode_cache_r1"` and JSON containing `{ version: 1, cachedAt: 1234567890, steps: [step1] }` |

---

#### UTP-010-C — getCachedRecipe: cache miss throws CacheMissError

**Technique**: Statement & Branch Coverage (Algorithmic/Logic View — `raw IS NULL` branch)
**Mocks**: `AsyncStorage.getItem` → `null`

| Scenario   | Arrange         | Act                                 | Assert                                               |
| ---------- | --------------- | ----------------------------------- | ---------------------------------------------------- |
| UTS-010-C1 | No cached entry | `await cache.getCachedRecipe("r1")` | Throws `CacheMissError("No cache for recipeId: r1")` |

---

#### UTP-010-D — getCachedRecipe: version mismatch invalidates and throws

**Technique**: Statement & Branch Coverage (Algorithmic/Logic View — `version != CACHE_VERSION` branch)
**Mocks**: `AsyncStorage.getItem` → JSON with `version: 0`; `AsyncStorage.removeItem` spy

| Scenario   | Arrange                       | Act                                 | Assert                                                                                                             |
| ---------- | ----------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| UTS-010-D1 | Cached entry with `version=0` | `await cache.getCachedRecipe("r1")` | `removeItem` called with `"cooking_mode_cache_r1"`; throws `CacheMissError("Cache version mismatch; invalidated")` |

---

#### UTP-010-E — getCachedRecipe: valid cache returns steps

**Technique**: Statement & Branch Coverage (Algorithmic/Logic View — happy path)
**Mocks**: `AsyncStorage.getItem` → valid JSON with `version: 1`, `steps: [step1]`

| Scenario   | Arrange            | Act                                 | Assert            |
| ---------- | ------------------ | ----------------------------------- | ----------------- |
| UTS-010-E1 | Valid cached entry | `await cache.getCachedRecipe("r1")` | Returns `[step1]` |

---

#### UTP-010-F — invalidate: removes cache entry

**Technique**: Statement & Branch Coverage (Algorithmic/Logic View — `invalidate` function)
**Mocks**: `AsyncStorage.removeItem` spy

| Scenario   | Arrange   | Act                            | Assert                                             |
| ---------- | --------- | ------------------------------ | -------------------------------------------------- |
| UTS-010-F1 | Any state | `await cache.invalidate("r1")` | `removeItem` called with `"cooking_mode_cache_r1"` |

---

#### UTP-010-G — BVA: CACHE_VERSION constant

**Technique**: Boundary Value Analysis (Internal Data Structures — `CACHE_VERSION = 1`)

| Scenario   | Arrange                                       | Act               | Assert                                  |
| ---------- | --------------------------------------------- | ----------------- | --------------------------------------- |
| UTS-010-G1 | Cached entry with `version = 1` (exact match) | `getCachedRecipe` | Returns steps (no invalidation)         |
| UTS-010-G2 | Cached entry with `version = 2` (mismatch)    | `getCachedRecipe` | Invalidates and throws `CacheMissError` |

---

### MOD-011 — RecipeDataAdapter

**Parent Architecture Modules**: ARCH-011
**Target Source File**: `packages/shared/cooking/src/adapters/RecipeDataAdapter.ts`

---

#### UTP-011-A — adapt: null/empty recipeId throws ValidationError

**Technique**: Statement & Branch Coverage (Algorithmic/Logic View — null/empty guard)

| Scenario   | Arrange           | Act                         | Assert                                           |
| ---------- | ----------------- | --------------------------- | ------------------------------------------------ |
| UTS-011-A1 | `recipeId = null` | `await adapter.adapt(null)` | Throws `ValidationError("recipeId is required")` |
| UTS-011-A2 | `recipeId = ""`   | `await adapter.adapt("")`   | Throws `ValidationError("recipeId is required")` |

---

#### UTP-011-B — adapt: 404 response throws RecipeNotFoundError

**Technique**: Statement & Branch Coverage (Algorithmic/Logic View — `response.status == 404` branch)
**Mocks**: `fetch` → `{ status: 404, ok: false }`

| Scenario   | Arrange         | Act                         | Assert                                               |
| ---------- | --------------- | --------------------------- | ---------------------------------------------------- |
| UTS-011-B1 | API returns 404 | `await adapter.adapt("r1")` | Throws `RecipeNotFoundError("Recipe not found: r1")` |

---

#### UTP-011-C — adapt: non-404 HTTP error throws NetworkError

**Technique**: Statement & Branch Coverage (Algorithmic/Logic View — `!response.ok` branch)
**Mocks**: `fetch` → `{ status: 500, ok: false }`

| Scenario   | Arrange         | Act                         | Assert                                  |
| ---------- | --------------- | --------------------------- | --------------------------------------- |
| UTS-011-C1 | API returns 500 | `await adapter.adapt("r1")` | Throws `NetworkError("API error: 500")` |

---

#### UTP-011-D — adapt: Zod validation failure throws ValidationError

**Technique**: Statement & Branch Coverage (Algorithmic/Logic View — `!result.success` branch)
**Mocks**: `fetch` → valid 200 response with malformed steps (missing `instruction`)

| Scenario   | Arrange                                                  | Act                         | Assert                                                |
| ---------- | -------------------------------------------------------- | --------------------------- | ----------------------------------------------------- |
| UTS-011-D1 | API returns step with `instruction: ""` (fails `min(1)`) | `await adapter.adapt("r1")` | Throws `ValidationError` containing Zod error message |

---

#### UTP-011-E — adapt: happy path maps API fields to CookingStep

**Technique**: Statement & Branch Coverage (Algorithmic/Logic View — mapping logic)
**Mocks**: `fetch` → `{ steps: [{ id: "s1", description: "Boil", chefNote: "Gently", timerSeconds: 60 }] }`

| Scenario   | Arrange                                          | Act                         | Assert                                                                             |
| ---------- | ------------------------------------------------ | --------------------------- | ---------------------------------------------------------------------------------- |
| UTS-011-E1 | Valid API response                               | `await adapter.adapt("r1")` | Returns `[{ id: "s1", instruction: "Boil", note: "Gently", durationSeconds: 60 }]` |
| UTS-011-E2 | Step with `chefNote: null`, `timerSeconds: null` | `await adapter.adapt("r1")` | Returns step with `note: null`, `durationSeconds: null`                            |

---

#### UTP-011-F — BVA: steps array length boundaries

**Technique**: Boundary Value Analysis (Internal Data Structures — `CookingStepsSchema` 1–200 elements)

| Scenario   | Arrange                           | Act                         | Assert                             |
| ---------- | --------------------------------- | --------------------------- | ---------------------------------- |
| UTS-011-F1 | API returns 0 steps               | `await adapter.adapt("r1")` | Throws `ValidationError` (min 1)   |
| UTS-011-F2 | API returns 1 step (min valid)    | `await adapter.adapt("r1")` | Returns array of 1 step            |
| UTS-011-F3 | API returns 200 steps (max valid) | `await adapter.adapt("r1")` | Returns array of 200 steps         |
| UTS-011-F4 | API returns 201 steps (max+1)     | `await adapter.adapt("r1")` | Throws `ValidationError` (max 200) |

---

#### UTP-011-G — BVA: instruction string length

**Technique**: Boundary Value Analysis (Internal Data Structures — `instruction: min(1).max(2000)`)

| Scenario   | Arrange                            | Act      | Assert                   |
| ---------- | ---------------------------------- | -------- | ------------------------ |
| UTS-011-G1 | `instruction = ""` (min-1)         | Validate | Throws `ValidationError` |
| UTS-011-G2 | `instruction = "A"` (min)          | Validate | Passes                   |
| UTS-011-G3 | `instruction` = 2000 chars (max)   | Validate | Passes                   |
| UTS-011-G4 | `instruction` = 2001 chars (max+1) | Validate | Throws `ValidationError` |

---

### MOD-012 — AuthGuard

**Parent Architecture Modules**: ARCH-012
**Target Source File**: `packages/apps/commise/features/cooking/src/guards/AuthGuard.ts`

---

#### UTP-012-A — Web: null session throws AuthError

**Technique**: Statement & Branch Coverage (Algorithmic/Logic View — `session IS NULL` branch)
**Mocks**: `PLATFORM = 'web'`; `getSession()` → `null`

| Scenario   | Arrange                                   | Act                              | Assert                                  |
| ---------- | ----------------------------------------- | -------------------------------- | --------------------------------------- |
| UTS-012-A1 | Web platform; `getSession` returns `null` | `await AuthGuard.checkSession()` | Throws `AuthError("No active session")` |

---

#### UTP-012-B — Web: valid session returns userId

**Technique**: Statement & Branch Coverage (Algorithmic/Logic View — web happy path)
**Mocks**: `PLATFORM = 'web'`; `getClerkSession()` → `{ user: { id: "user_123" } }`

| Scenario   | Arrange           | Act                              | Assert                           |
| ---------- | ----------------- | -------------------------------- | -------------------------------- |
| UTS-012-B1 | Valid web session | `await AuthGuard.checkSession()` | Returns `{ userId: "user_123" }` |

---

#### UTP-012-C — Mobile: null credentials throws AuthError

**Technique**: Statement & Branch Coverage (Algorithmic/Logic View — mobile null credentials branch)
**Mocks**: `PLATFORM = 'ios'`; `getClerkSession()` → `null`

| Scenario   | Arrange                      | Act                              | Assert                                           |
| ---------- | ---------------------------- | -------------------------------- | ------------------------------------------------ |
| UTS-012-C1 | Mobile; credentials = `null` | `await AuthGuard.checkSession()` | Throws `AuthError("Session expired or missing")` |

---

#### UTP-012-D — Mobile: expired accessToken throws AuthError

**Technique**: Statement & Branch Coverage (Algorithmic/Logic View — `token IS EXPIRED` branch)
**Mocks**: `PLATFORM = 'ios'`; session with expired token

| Scenario   | Arrange                            | Act                              | Assert                                           |
| ---------- | ---------------------------------- | -------------------------------- | ------------------------------------------------ |
| UTS-012-D1 | Mobile; `session.token` is expired | `await AuthGuard.checkSession()` | Throws `AuthError("Session expired or missing")` |

---

#### UTP-012-E — Missing userId in session throws AuthError

**Technique**: Statement & Branch Coverage (Algorithmic/Logic View — `userId IS NULL OR EMPTY` branch)
**Mocks**: `getClerkSession()` → `{ user: { id: null } }`

| Scenario   | Arrange                  | Act                              | Assert                                                |
| ---------- | ------------------------ | -------------------------------- | ----------------------------------------------------- |
| UTS-012-E1 | Session with `id = null` | `await AuthGuard.checkSession()` | Throws `AuthError("Invalid session: missing userId")` |
| UTS-012-E2 | Session with `id = ""`   | `await AuthGuard.checkSession()` | Throws `AuthError("Invalid session: missing userId")` |

---

#### UTP-012-F — Equivalence Partitioning: platform

**Technique**: Equivalence Partitioning (Internal Data Structures — platform: `'web'` vs mobile)

| Scenario   | Arrange                | Act              | Assert                                      |
| ---------- | ---------------------- | ---------------- | ------------------------------------------- |
| UTS-012-F1 | `PLATFORM = 'web'`     | `checkSession()` | Uses the Clerk session from `@clerk/nextjs` |
| UTS-012-F2 | `PLATFORM = 'ios'`     | `checkSession()` | Uses the Clerk session from `@clerk/expo`   |
| UTS-012-F3 | `PLATFORM = 'android'` | `checkSession()` | Uses the Clerk session from `@clerk/expo`   |

---

### MOD-013 — ErrorBoundary

**Parent Architecture Modules**: ARCH-013
**Target Source File**: `packages/apps/commise/features/cooking/src/components/ErrorBoundary.tsx`

---

#### UTP-013-A — getDerivedStateFromError: sets hasError and errorMessage

**Technique**: Statement & Branch Coverage (Algorithmic/Logic View — `getDerivedStateFromError`)

| Scenario   | Arrange        | Act                                                         | Assert                                             |
| ---------- | -------------- | ----------------------------------------------------------- | -------------------------------------------------- |
| UTS-013-A1 | Fresh boundary | `ErrorBoundary.getDerivedStateFromError(new Error("boom"))` | Returns `{ hasError: true, errorMessage: "boom" }` |

---

#### UTP-013-B — componentDidCatch: logs structured error

**Technique**: Statement & Branch Coverage (Algorithmic/Logic View — `componentDidCatch`)
**Mocks**: `Logger.error` spy

| Scenario   | Arrange                    | Act                              | Assert                                                                                                                                      |
| ---------- | -------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| UTS-013-B1 | Child throws during render | `componentDidCatch(error, info)` | `Logger.error` called with `{ message: "CookingMode render error", error: error.message, stack: ..., componentStack: ..., timestamp: ... }` |

---

#### UTP-013-C — render: fallback UI shown when hasError is true

**Technique**: Statement & Branch Coverage (Algorithmic/Logic View — `hasError` branch)

| Scenario   | Arrange                  | Act        | Assert                                                                                                 |
| ---------- | ------------------------ | ---------- | ------------------------------------------------------------------------------------------------------ |
| UTS-013-C1 | `state.hasError = true`  | `render()` | Fallback `<View accessibilityRole="alert">` rendered with "Something went wrong" text and Retry button |
| UTS-013-C2 | `state.hasError = false` | `render()` | `this.props.children` rendered                                                                         |

---

#### UTP-013-D — Retry button resets error state

**Technique**: Statement & Branch Coverage (Algorithmic/Logic View — Retry `onPress`)

| Scenario   | Arrange           | Act                | Assert                                                                              |
| ---------- | ----------------- | ------------------ | ----------------------------------------------------------------------------------- |
| UTS-013-D1 | `hasError = true` | Press Retry button | `setState({ hasError: false, errorMessage: null })` called; children rendered again |

---

#### UTP-013-E — componentDidCatch: Logger.error throwing is swallowed

**Technique**: Statement & Branch Coverage (Algorithmic/Logic View — `LoggerError` swallow)
**Mocks**: `Logger.error` → throws `LoggerError`

| Scenario   | Arrange                                  | Act                       | Assert                                            |
| ---------- | ---------------------------------------- | ------------------------- | ------------------------------------------------- |
| UTS-013-E1 | Logger throws during `componentDidCatch` | Child render error occurs | No uncaught exception; fallback UI still rendered |

---

#### UTP-013-F — State Transition: Nominal → Error → Nominal

**Technique**: State Transition Testing (State Machine View)

| Scenario   | Arrange               | Act             | Assert                               |
| ---------- | --------------------- | --------------- | ------------------------------------ |
| UTS-013-F1 | Boundary in `Nominal` | Child throws    | State = `Error`; fallback rendered   |
| UTS-013-F2 | Boundary in `Error`   | User taps Retry | State = `Nominal`; children rendered |

---

### MOD-014 — StructuredLogger

**Parent Architecture Modules**: ARCH-013
**Target Source File**: `packages/shared/cooking/src/utils/Logger.ts`

---

#### UTP-014-A — info: logs when logLevel allows INFO

**Technique**: Statement & Branch Coverage (Algorithmic/Logic View — `logLevel ALLOWS 'INFO'` branch)
**Mocks**: `console.log` spy

| Scenario   | Arrange             | Act                                | Assert                                                                                                  |
| ---------- | ------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------- |
| UTS-014-A1 | `logLevel = 'INFO'` | `logger.info({ message: "test" })` | `console.log` called with JSON containing `{ level: 'INFO', service: 'cooking-mode', message: 'test' }` |
| UTS-014-A2 | `logLevel = 'WARN'` | `logger.info({ message: "test" })` | `console.log` NOT called (INFO below WARN threshold)                                                    |

---

#### UTP-014-B — warn: logs when logLevel allows WARN

**Technique**: Statement & Branch Coverage (Algorithmic/Logic View — `logLevel ALLOWS 'WARN'` branch)

| Scenario   | Arrange              | Act                             | Assert                                    |
| ---------- | -------------------- | ------------------------------- | ----------------------------------------- |
| UTS-014-B1 | `logLevel = 'WARN'`  | `logger.warn({ message: "w" })` | `console.log` called with `level: 'WARN'` |
| UTS-014-B2 | `logLevel = 'ERROR'` | `logger.warn({ message: "w" })` | `console.log` NOT called                  |

---

#### UTP-014-C — error: always logs regardless of logLevel

**Technique**: Statement & Branch Coverage (Algorithmic/Logic View — `error` always-log path)

| Scenario   | Arrange              | Act                              | Assert               |
| ---------- | -------------------- | -------------------------------- | -------------------- |
| UTS-014-C1 | `logLevel = 'ERROR'` | `logger.error({ message: "e" })` | `console.log` called |
| UTS-014-C2 | `logLevel = 'DEBUG'` | `logger.error({ message: "e" })` | `console.log` called |

---

#### UTP-014-D — Log entry includes timestamp and serviceName

**Technique**: Statement & Branch Coverage (Algorithmic/Logic View — `WRITE_STRUCTURED_LOG`)
**Mocks**: `Date.prototype.toISOString` → `"2026-05-09T00:00:00.000Z"`

| Scenario   | Arrange      | Act                             | Assert                                                                                     |
| ---------- | ------------ | ------------------------------- | ------------------------------------------------------------------------------------------ |
| UTS-014-D1 | Any log call | `logger.info({ message: "x" })` | Logged JSON contains `service: "cooking-mode"` and `timestamp: "2026-05-09T00:00:00.000Z"` |

---

#### UTP-014-E — console.log throwing is swallowed

**Technique**: Statement & Branch Coverage (Algorithmic/Logic View — swallow path)
**Mocks**: `console.log` → throws

| Scenario   | Arrange              | Act                              | Assert                           |
| ---------- | -------------------- | -------------------------------- | -------------------------------- |
| UTS-014-E1 | `console.log` throws | `logger.error({ message: "e" })` | No uncaught exception propagated |

---

#### UTP-014-F — Equivalence Partitioning: logLevel enum

**Technique**: Equivalence Partitioning (Internal Data Structures — `logLevel: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR'`)

| Scenario   | Arrange              | Act                           | Assert                      |
| ---------- | -------------------- | ----------------------------- | --------------------------- |
| UTS-014-F1 | `logLevel = 'DEBUG'` | `info()`, `warn()`, `error()` | All three log               |
| UTS-014-F2 | `logLevel = 'INFO'`  | `info()`, `warn()`, `error()` | All three log               |
| UTS-014-F3 | `logLevel = 'WARN'`  | `info()`, `warn()`, `error()` | Only `warn` and `error` log |
| UTS-014-F4 | `logLevel = 'ERROR'` | `info()`, `warn()`, `error()` | Only `error` logs           |

---

### MOD-015 — TypeScriptStrictConfig [CROSS-CUTTING]

**Parent Architecture Modules**: ARCH-014
**Target Source File**: `packages/apps/commise/features/cooking/src/tsconfig.json`
**Note**: Compile-time configuration artifact. Verified by `tsc --noEmit` in CI. No executable unit test cases.

---

### MOD-016 — ESLintNoAnyRule [CROSS-CUTTING]

**Parent Architecture Modules**: ARCH-014
**Target Source File**: `packages/apps/commise/features/cooking/src/.eslintrc.json`
**Note**: Lint-time configuration artifact. Verified by `eslint` in CI. No executable unit test cases.

---

### MOD-017 — AccessibilityLintRules [CROSS-CUTTING]

**Parent Architecture Modules**: ARCH-014
**Target Source File**: `packages/apps/commise/features/cooking/src/.eslintrc.json`
**Note**: Lint-time configuration artifact. Verified by `eslint` with `jsx-a11y` and `react-native-a11y` plugins in CI. No executable unit test cases.

---

### MOD-018 — AccessibilityRuntimeChecks [CROSS-CUTTING]

**Parent Architecture Modules**: ARCH-014
**Target Source File**: `packages/shared/cooking/src/utils/a11yChecks.ts`

---

#### UTP-018-A — assertAccessibilityLabel: warns in DEV when label missing

**Technique**: Statement & Branch Coverage (Algorithmic/Logic View — `__DEV__ AND label IS NULL OR EMPTY` branch)
**Mocks**: `__DEV__ = true`; `console.warn` spy

| Scenario   | Arrange                                                 | Act                                           | Assert                                                               |
| ---------- | ------------------------------------------------------- | --------------------------------------------- | -------------------------------------------------------------------- |
| UTS-018-A1 | `__DEV__ = true`; element has no `accessibilityLabel`   | `assertAccessibilityLabel(element, "Button")` | `console.warn("[a11y] Missing accessibilityLabel on Button")` called |
| UTS-018-A2 | `__DEV__ = true`; element has `accessibilityLabel = ""` | Call function                                 | `console.warn` called                                                |
| UTS-018-A3 | `__DEV__ = false`                                       | Call function with missing label              | `console.warn` NOT called                                            |
| UTS-018-A4 | `__DEV__ = true`; element has valid label               | Call function                                 | `console.warn` NOT called                                            |

---

#### UTP-018-B — assertMinFontSize: warns in DEV when font too small

**Technique**: Statement & Branch Coverage (Algorithmic/Logic View — `fontSize < minSize` branch)
**Mocks**: `__DEV__ = true`; `console.warn` spy

| Scenario   | Arrange                                       | Act                                     | Assert                                                                    |
| ---------- | --------------------------------------------- | --------------------------------------- | ------------------------------------------------------------------------- |
| UTS-018-B1 | `__DEV__ = true`; `fontSize=16`, `minSize=24` | `assertMinFontSize(16, 24, "StepText")` | `console.warn("[a11y] Font size 16 below minimum 24 in StepText")` called |
| UTS-018-B2 | `__DEV__ = true`; `fontSize=24`, `minSize=24` | Call function                           | `console.warn` NOT called (equal is OK)                                   |
| UTS-018-B3 | `__DEV__ = false`                             | `fontSize=10`, `minSize=24`             | `console.warn` NOT called                                                 |

---

#### UTP-018-C — assertColorNotSoleIndicator: warns when neither icon nor text

**Technique**: Statement & Branch Coverage (Algorithmic/Logic View — `NOT hasIcon AND NOT hasText` branch)
**Mocks**: `__DEV__ = true`; `console.warn` spy

| Scenario   | Arrange                                            | Act                                                      | Assert                                                                         |
| ---------- | -------------------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------ |
| UTS-018-C1 | `__DEV__ = true`; `hasIcon=false`, `hasText=false` | `assertColorNotSoleIndicator(false, false, "StatusDot")` | `console.warn("[a11y] Color may be sole state indicator in StatusDot")` called |
| UTS-018-C2 | `__DEV__ = true`; `hasIcon=true`, `hasText=false`  | Call function                                            | `console.warn` NOT called                                                      |
| UTS-018-C3 | `__DEV__ = true`; `hasIcon=false`, `hasText=true`  | Call function                                            | `console.warn` NOT called                                                      |
| UTS-018-C4 | `__DEV__ = false`                                  | `hasIcon=false`, `hasText=false`                         | `console.warn` NOT called                                                      |

---

#### UTP-018-D — Equivalence Partitioning: **DEV** boolean

**Technique**: Equivalence Partitioning (Internal Data Structures — `__DEV__: boolean`)

| Scenario   | Arrange           | Act                                | Assert                                 |
| ---------- | ----------------- | ---------------------------------- | -------------------------------------- |
| UTS-018-D1 | `__DEV__ = true`  | Any assert function with violation | Warning emitted                        |
| UTS-018-D2 | `__DEV__ = false` | Any assert function with violation | No warning emitted (production silent) |

---

### MOD-019 — IngredientCheckoffState

**Parent Architecture Modules**: ARCH-015
**Target Source File**: `packages/shared/cooking/src/controllers/IngredientCheckoffState.ts`

---

#### UTP-019-A — toggleIngredient: adds, removes, and isolates

**Technique**: Statement & Branch Coverage (Algorithmic/Logic View — `state CONTAINS id` branch)
**Mocks**: none (pure function)

| Scenario   | Arrange                             | Act                        | Assert                                                          |
| ---------- | ----------------------------------- | -------------------------- | --------------------------------------------------------------- |
| UTS-019-A1 | `state = []`, recipe has `i1,i2,i3` | `toggleIngredient([], i1)` | Returns `[i1]`                                                  |
| UTS-019-A2 | `state = [i1]`                      | `toggleIngredient(_, i1)`  | Returns `[]` (removal branch)                                   |
| UTS-019-A3 | `state = [i1, i2]`                  | `toggleIngredient(_, i3)`  | Returns `[i1, i2, i3]`; `i1`/`i2` positions unchanged           |
| UTS-019-A4 | `state = [i1]`                      | `toggleIngredient(_, i2)`  | Input array is **not** mutated — original still `[i1]` (purity) |

#### UTP-019-B — toggleIngredient: rejects unknown ingredient

**Technique**: Equivalence Partitioning (invalid partition)
**Mocks**: none

| Scenario   | Arrange                     | Act                             | Assert                                           |
| ---------- | --------------------------- | ------------------------------- | ------------------------------------------------ |
| UTS-019-B1 | recipe has `i1`; state `[]` | `toggleIngredient([], "ghost")` | Throws `UnknownIngredientError`; state unchanged |
| UTS-019-B2 | recipe has `i1`; state `[]` | `toggleIngredient([], "")`      | Throws `UnknownIngredientError`                  |

#### UTP-019-C — reconcile: drops ghost ids on restore

**Technique**: Boundary Value Analysis
**Mocks**: none

| Scenario   | Arrange                                    | Act                      | Assert                        |
| ---------- | ------------------------------------------ | ------------------------ | ----------------------------- |
| UTS-019-C1 | state `[i1, i2]`; recipe now only has `i1` | `reconcile(state, [i1])` | Returns `[i1]` — `i2` dropped |
| UTS-019-C2 | state `[]`; recipe has `i1`                | `reconcile([], [i1])`    | Returns `[]`                  |
| UTS-019-C3 | state `[i1]`; recipe unchanged             | `reconcile(state, [i1])` | Returns `[i1]` unchanged      |

#### UTP-019-D — state is JSON-round-trippable (REQ-013 / plan.md §2)

**Technique**: Statement Coverage (serialization invariant)
**Mocks**: none

| Scenario   | Arrange          | Act                                 | Assert                                                          |
| ---------- | ---------------- | ----------------------------------- | --------------------------------------------------------------- |
| UTS-019-D1 | state `[i1, i2]` | `JSON.parse(JSON.stringify(state))` | Deep-equals `[i1, i2]` — **fails if the field is ever a `Set`** |

---

### MOD-020 — YieldScalingState

**Parent Architecture Modules**: ARCH-015
**Target Source File**: `packages/shared/cooking/src/controllers/YieldScalingState.ts`

---

#### UTP-020-A — setScaleFactor: accepts allowed, rejects everything else

**Technique**: Equivalence Partitioning + BVA
**Mocks**: none

| Scenario   | Arrange | Act                   | Assert                               |
| ---------- | ------- | --------------------- | ------------------------------------ |
| UTS-020-A1 | —       | `setScaleFactor(0.5)` | Returns `0.5`                        |
| UTS-020-A2 | —       | `setScaleFactor(2)`   | Returns `2`                          |
| UTS-020-A3 | —       | `setScaleFactor(1.5)` | Throws `UnsupportedScaleFactorError` |
| UTS-020-A4 | —       | `setScaleFactor(0)`   | Throws `UnsupportedScaleFactorError` |
| UTS-020-A5 | —       | `setScaleFactor(-1)`  | Throws `UnsupportedScaleFactorError` |

#### UTP-020-B — scaleQuantity: multiplies correctly

**Technique**: Equivalence Partitioning
**Mocks**: none

| Scenario   | Arrange | Act                       | Assert                        |
| ---------- | ------- | ------------------------- | ----------------------------- |
| UTS-020-B1 | —       | `scaleQuantity(200, 2)`   | Returns `400`                 |
| UTS-020-B2 | —       | `scaleQuantity(200, 0.5)` | Returns `100`                 |
| UTS-020-B3 | —       | `scaleQuantity(200, 1)`   | Returns `200`                 |
| UTS-020-B4 | —       | `scaleQuantity(0, 2)`     | Returns `0`                   |
| UTS-020-B5 | —       | `scaleQuantity(NaN, 2)`   | Throws `InvalidQuantityError` |

#### UTP-020-C — advisory tracks the factor (REQ-015)

**Technique**: Statement & Branch Coverage
**Mocks**: none

| Scenario   | Arrange | Act                                | Assert          |
| ---------- | ------- | ---------------------------------- | --------------- |
| UTS-020-C1 | —       | `shouldShowNotScaledAdvisory(1)`   | Returns `false` |
| UTS-020-C2 | —       | `shouldShowNotScaledAdvisory(2)`   | Returns `true`  |
| UTS-020-C3 | —       | `shouldShowNotScaledAdvisory(0.5)` | Returns `true`  |

#### UTP-020-D — SAFETY: scaling never reaches timer state (REQ-015 / D-002)

**Technique**: Invariant Assertion / Strict Isolation
**Mocks**: `TimerEngine` spy

| Scenario   | Arrange                                                        | Act                                       | Assert                                                                                       |
| ---------- | -------------------------------------------------------------- | ----------------------------------------- | -------------------------------------------------------------------------------------------- |
| UTS-020-D1 | `TimerEngine` holding a step with `timerSeconds = 1500`, spied | `setScaleFactor(2)`, then `0.5`, then `1` | `timerSeconds` reads `1500` after every call; **zero** calls recorded on the TimerEngine spy |
| UTS-020-D2 | Module under test                                              | Static inspection of MOD-020's imports    | MOD-020 imports no timer module — the invariant is structural, not merely behavioural        |

---

## Coverage Summary

| MOD       | Module Name                | Test Cases    | Scenarios | Techniques Applied                                                                        |
| --------- | -------------------------- | ------------- | --------- | ----------------------------------------------------------------------------------------- |
| MOD-001   | CookingModeScreen          | 9 (A–I)       | 14        | S&B, State Transition, BVA, Strict Isolation                                              |
| MOD-002   | StepDisplayPanel           | 4 (A–D)       | 7         | S&B, BVA                                                                                  |
| MOD-003   | StepTransitionAnimator     | 5 (A–E)       | 7         | S&B, State Transition, BVA                                                                |
| MOD-004   | CookingSessionReducer      | 12 (A–E, G–M) | 51        | S&B, BVA, State Transition, Equivalence Partitioning, Error Guessing, Invariant Assertion |
| MOD-005   | GestureInputAdapter        | 5 (A–E)       | 10        | S&B, BVA                                                                                  |
| MOD-006   | TimerEngine                | 6 (A–F)       | 47        | S&B, BVA, State Transition, Error Guessing, Invariant Assertion                           |
| MOD-007   | TimerDisplayWidget         | 5 (A–E)       | 10        | S&B, Equivalence Partitioning, BVA                                                        |
| MOD-008   | AudioAlertService          | 7 (A–G)       | 11        | S&B, State Transition, Equivalence Partitioning                                           |
| MOD-009   | ScreenWakeLockManager      | 7 (A–G)       | 11        | S&B, Equivalence Partitioning, State Transition                                           |
| MOD-010   | OfflineRecipeCache         | 7 (A–G)       | 9         | S&B, BVA                                                                                  |
| MOD-011   | RecipeDataAdapter          | 7 (A–G)       | 14        | S&B, BVA                                                                                  |
| MOD-012   | AuthGuard                  | 6 (A–F)       | 9         | S&B, Equivalence Partitioning                                                             |
| MOD-013   | ErrorBoundary              | 6 (A–F)       | 8         | S&B, State Transition                                                                     |
| MOD-014   | StructuredLogger           | 6 (A–F)       | 13        | S&B, Equivalence Partitioning                                                             |
| MOD-015   | TypeScriptStrictConfig     | — (CI)        | —         | Compile-time enforcement                                                                  |
| MOD-016   | ESLintNoAnyRule            | — (CI)        | —         | Lint-time enforcement                                                                     |
| MOD-017   | AccessibilityLintRules     | — (CI)        | —         | Lint-time enforcement                                                                     |
| MOD-018   | AccessibilityRuntimeChecks | 4 (A–D)       | 13        | S&B, Equivalence Partitioning                                                             |
| MOD-019   | IngredientCheckoffState    | 4 (A–D)       | 10        | S&B, Equivalence Partitioning, BVA                                                        |
| MOD-020   | YieldScalingState          | 4 (A–D)       | 15        | Equivalence Partitioning, BVA, Invariant Assertion                                        |
| **Total** |                            | **104**       | **259**   |                                                                                           |

> **Corrected 2026-08-09.** MOD-004 and MOD-006 were regenerated from the shipped suites — see the correction notes in their
> sections above — moving MOD-004 from 8 cases / 14 scenarios to 12 / 51 and MOD-006 from 9 / 17 to 6 / 47. The **Scenarios**
> column counts scenario **ids**; MOD-004 and MOD-006 run 58 and 53 executing vitest cases respectively, because four of their
> cases are parameterised `it.each` blocks. The previous **Test Cases** total of `108` also did not match its own column, which
> summed to `103`; the total is now the true column sum.

## Traceability

| UTP Range  | MOD     | ARCH Parent |
| ---------- | ------- | ----------- |
| UTP-001-\* | MOD-001 | ARCH-001    |
| UTP-002-\* | MOD-002 | ARCH-002    |
| UTP-003-\* | MOD-003 | ARCH-003    |
| UTP-004-\* | MOD-004 | ARCH-004    |
| UTP-005-\* | MOD-005 | ARCH-005    |
| UTP-006-\* | MOD-006 | ARCH-006    |
| UTP-007-\* | MOD-007 | ARCH-007    |
| UTP-008-\* | MOD-008 | ARCH-008    |
| UTP-009-\* | MOD-009 | ARCH-009    |
| UTP-010-\* | MOD-010 | ARCH-010    |
| UTP-011-\* | MOD-011 | ARCH-011    |
| UTP-012-\* | MOD-012 | ARCH-012    |
| UTP-013-\* | MOD-013 | ARCH-013    |
| UTP-014-\* | MOD-014 | ARCH-013    |
| UTP-018-\* | MOD-018 | ARCH-014    |
| UTP-019-\* | MOD-019 | ARCH-015    |
| UTP-020-\* | MOD-020 | ARCH-015    |

## Mock Registry

Each UTP that touches an external dependency MUST list the dependency mock in its setup. Mock entries identify the dependency name, mock type (stub, fake, spy, or in-memory adapter), owning MOD-NNN, and reset behavior between scenarios.

## Coverage Completion Unit Tests

### Module: MOD-015 (Coverage Completion)

**Parent Architecture Modules**: See `module-design.md` for MOD-015.

#### Test Case: UTP-015-A (core logic and error handling coverage)

**Technique**: Statement & Branch Coverage + Boundary Value Analysis + Error Guessing
**Target View**: Algorithmic/Logic View + Error Handling & Return Codes
**Description**: Verifies MOD-015 nominal branch behavior, boundary inputs (min-1, min, nominal, max, max+1 where bounded variables exist), and invalid-input/error branches.

- **Unit Scenario: UTS-015-A1**
    - **Arrange** valid module inputs and mocked dependencies from the Mock Registry
    - **Act** by invoking the primary exported function or method for MOD-015
    - **Assert** expected return value, state transition, and dependency interaction outcomes

- **Unit Scenario: UTS-015-A2**
    - **Arrange** invalid input, dependency exception, or boundary value for MOD-015
    - **Act** by invoking the same module entrypoint
    - **Assert** documented error handling, return code, or exception mapping

### Module: MOD-016 (Coverage Completion)

**Parent Architecture Modules**: See `module-design.md` for MOD-016.

#### Test Case: UTP-016-A (core logic and error handling coverage)

**Technique**: Statement & Branch Coverage + Boundary Value Analysis + Error Guessing
**Target View**: Algorithmic/Logic View + Error Handling & Return Codes
**Description**: Verifies MOD-016 nominal branch behavior, boundary inputs (min-1, min, nominal, max, max+1 where bounded variables exist), and invalid-input/error branches.

- **Unit Scenario: UTS-016-A1**
    - **Arrange** valid module inputs and mocked dependencies from the Mock Registry
    - **Act** by invoking the primary exported function or method for MOD-016
    - **Assert** expected return value, state transition, and dependency interaction outcomes

- **Unit Scenario: UTS-016-A2**
    - **Arrange** invalid input, dependency exception, or boundary value for MOD-016
    - **Act** by invoking the same module entrypoint
    - **Assert** documented error handling, return code, or exception mapping

### Module: MOD-017 (Coverage Completion)

**Parent Architecture Modules**: See `module-design.md` for MOD-017.

#### Test Case: UTP-017-A (core logic and error handling coverage)

**Technique**: Statement & Branch Coverage + Boundary Value Analysis + Error Guessing
**Target View**: Algorithmic/Logic View + Error Handling & Return Codes
**Description**: Verifies MOD-017 nominal branch behavior, boundary inputs (min-1, min, nominal, max, max+1 where bounded variables exist), and invalid-input/error branches.

- **Unit Scenario: UTS-017-A1**
    - **Arrange** valid module inputs and mocked dependencies from the Mock Registry
    - **Act** by invoking the primary exported function or method for MOD-017
    - **Assert** expected return value, state transition, and dependency interaction outcomes

- **Unit Scenario: UTS-017-A2**
    - **Arrange** invalid input, dependency exception, or boundary value for MOD-017
    - **Act** by invoking the same module entrypoint
    - **Assert** documented error handling, return code, or exception mapping
