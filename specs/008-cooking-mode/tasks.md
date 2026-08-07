# Feature 008 — Cooking Mode — Tasks

**Feature**: `008-cooking-mode`  
**Status**: Draft  
**Source**: [spec.md](spec.md) | [plan.md](plan.md) | [product-spec](product-spec/product-spec.md)

---

## US Reference

| ID     | Story                                                                | Priority        | FRs            |
| ------ | -------------------------------------------------------------------- | --------------- | -------------- |
| US-001 | Enter Cooking Mode and see one step at a time in large readable text | P2 Must Have    | FR-032         |
| US-002 | Navigate forward/backward through steps without losing position      | P2 Must Have    | FR-033         |
| US-003 | Start timers directly from timed steps                               | P2 Must Have    | FR-034         |
| US-004 | Receive clear alert when a timer completes                           | P2 Must Have    | FR-034         |
| US-005 | Keep device screen awake while Cooking Mode is active                | P2 Must Have    | FR-035         |
| US-006 | Use voice commands for next/back/timer                               | Should Have     | FR-033, FR-034 |
| US-007 | Recover an in-progress session after short interruption              | Should Have     | FR-033, FR-035 |
| US-008 | Check off ingredients in a side panel while cooking                  | **P3 v1 scope** | **FR-032a**    |
| US-009 | Apply cook-time scaling guidance in mode                             | **P3 v1 scope** | **FR-034a**    |

> **Scope change (2026-08-05 revalidation gate).** US-008 and US-009 were promoted from _Could Have_ into v1 scope and now have
> backing requirements `FR-032a` / `FR-034a` (spec.md D-001). US-006 (voice control) remains _Should Have_ and US-007 remains as
> specified; cross-device sync remains **out of scope**.

---

## Dependency Graph

```
T-000 (scaffold both packages) ─→ everything
  │
  ├─→ T-001 ─┬─→ T-002 ─┬─→ T-006 ─┬─→ T-011 ─→ T-019 (Playwright)
  │          │          │          └─→ T-012 ─→ T-020 (Maestro)
  │          │          ├─→ T-008
  │          │          ├─→ T-013 ─→ T-021 (integration)
  │          │          ├─→ T-014
  │          │          ├─→ T-015   (FR-032a)
  │          │          └─→ T-016   (FR-034a)
  │          │
  │          └─→ T-003 ─┬─→ T-009
  │                     └─→ T-010
  │
  ├─→ T-004, T-005 (independent wake-lock platforms, shared disposer contract)
  ├─→ T-007 (depends on T-001)
  ├─→ T-017 (unit — Test-first, precedes T-002/T-003/T-004/T-005)
  └─→ T-018 (component — Test-first, precedes T-006…T-010, T-015, T-016)
```

`T-017`/`T-018` are drawn from `T-000` because, being `Test-first: true`, they are written **before** the implementation tasks
they cover; the arrows above show coverage order, not "wait until implemented".

---

## US-001 — Enter Cooking Mode and see one step at a time in large readable text

- [ ] **T-000** [P1] [US-001] Scaffold the two new packages — `packages/shared/cooking/` (`@kitchensink/cooking-core`) and `packages/apps/commise/features/cooking/` (`@commise/features-cooking`)
    - **Depends on**: none
    - **Implements**: plan.md §1 Platform Targets, GR-009
    - **Acceptance**: Both `package.json`s follow GR-009 scoping; `features-cooking` depends on `@commise/features-core`, `@commise/ui`, `@commise/i18n`, `@kitchensink/recipe-core`, `@kitchensink/cooking-core`; `cooking-core` depends on **no** UI package and no platform SDK; tsconfig/vitest configs extend the shared `@kitchensink/*` tool configs; `npm run build` and `npm run typecheck` pass from a clean state.

- [ ] **T-001** [P1] [US-001] Define session-scoped domain types (`CookingSession`, `CookingTimer`) — `packages/shared/cooking/src/types.ts`
    - **Depends on**: T-000
    - **Implements**: plan.md §2 data model, FR-032
    - **Acceptance**: Types compile under `strict: true`; all exported interfaces carry JSDoc (NFR-001, NFR-002). **Defines no recipe-shaped type** — `RecipeStep` is imported from `@kitchensink/recipe-core` (GR-007 AC-007-d; spec.md D-003). `completedSteps` / `checkedIngredientIds` are arrays, not `Set`s, and every timestamp is an ISO 8601 string, so the whole shape survives a JSON round-trip (plan.md §2 Serializability). A test asserts `restore(JSON.parse(JSON.stringify(session)))` deep-equals the original.

- [ ] **T-002** [P1] [US-001] Implement cooking session state machine and step navigation engine — `packages/shared/cooking/src/session.ts`
    - **Depends on**: T-001
    - **Implements**: FR-032, FR-033
    - **Acceptance**: `advance()` / `goBack()` update `currentStepIndex`; boundary clamps at first/last step; `completedSteps` tracked; 100% unit-test coverage.

- [ ] **T-007** [P2] [US-001] Build `StepDisplay` component (large instruction text, optional image, step counter) — `packages/apps/commise/features/cooking/src/StepDisplay.tsx`
    - **Depends on**: T-001
    - **Implements**: plan.md §4, FR-032, SC-007
    - **Acceptance**: Instruction text ≥32sp; image lazy-loaded; step position visible; `getByRole` queryable accessible name (NFR-003); color paired with icon/text for states (NFR-004).

- [ ] **T-006** [P2] [US-001] Build `CookingModeScreen` orchestrator composing StepDisplay, Navigation, and Timers — `packages/apps/commise/features/cooking/src/CookingModeScreen.tsx`
    - **Depends on**: T-002, T-007, T-008, T-009
    - **Implements**: plan.md §4 component architecture, FR-032
    - **Acceptance**: Screen mounts at first step; sub-components render correctly; exit releases wake lock and clears session.

- [ ] **T-011** [P3] [US-001] Add Cooking Mode web route/entry point wired to recipe selection — `packages/apps/commise/web/src/routes/cooking.tsx`
    - **Depends on**: T-006, T-004
    - **Implements**: plan.md §1 Web target
    - **Acceptance**: Route `/cooking/:recipeId` loads CookingModeScreen; steps come from the **existing** `GET /api/v1/recipes/{id}` detail payload (`steps: RecipeStepView[]`) via `@kitchensink/recipe-service-client` — **no new endpoint** is added and none is called (plan.md §3); auth gate enforced.

- [ ] **T-012** [P3] [US-001] Add Cooking Mode mobile screen entry wired to recipe selection — `packages/apps/commise/mobile/src/screens/CookingModeScreen.tsx`
    - **Depends on**: T-006, T-005
    - **Implements**: plan.md §1 Mobile target
    - **Acceptance**: Screen pushed from recipe detail; passes recipeId; auth gate enforced; Expo-compatible.

---

## US-002 — Navigate forward/backward through steps without losing position

- [ ] **T-008** [P2] [US-002] Build `StepNavigation` component (tap zones, swipe handler, progress dots) — `packages/apps/commise/features/cooking/src/StepNavigation.tsx`
    - **Depends on**: T-002
    - **Implements**: FR-033, plan.md §4 Navigation UX
    - **Acceptance**: Tap zones ≥40% width each (48×48dp touch target); swipe gesture supported; progress dots reflect current step; first/last step boundaries disabled safely; `getByRole` labels for prev/next (NFR-003).

---

## US-003 — Start timers directly from timed steps

- [ ] **T-003** [P1] [US-003] Implement countdown timer engine with concurrent timer support — `packages/shared/cooking/src/timer-engine.ts`
    - **Depends on**: T-001
    - **Implements**: FR-034, plan.md §4 Timer Component
    - **Acceptance**: Multiple timers run concurrently; pause/resume per timer; remainingMs decrements accurately; no `any` types (NFR-001); unit tests cover concurrent + pause scenarios.

- [ ] **T-009** [P2] [US-003] Build `TimerBadge` and `ActiveTimers` panel components — `packages/apps/commise/features/cooking/src/TimerBadge.tsx`
    - **Depends on**: T-003
    - **Implements**: FR-034
    - **Acceptance**: Timed steps show start action; countdown visible while active; concurrent timers listed; accessible labels (NFR-003); non-color state cues (NFR-004).

---

## US-004 — Receive clear alert when a timer completes

- [ ] **T-010** [P2] [US-004] Build `TimerAlert` component (audible chime, pulsing visual banner, ARIA live region) — `packages/apps/commise/features/cooking/src/TimerAlert.tsx`
    - **Depends on**: T-003
    - **Implements**: FR-034, plan.md §4 TimerAlert
    - **Acceptance**: Timer completion triggers sound + visual pulse; ARIA live region announces to screen readers; accessible dismiss action (NFR-003, NFR-004).

---

## US-005 — Keep device screen awake while Cooking Mode is active

- [ ] **T-004** [P2] [US-005] Implement web screen wake lock (`navigator.wakeLock`) returning a disposer — `packages/shared/cooking/src/wakeLock.ts`
    - **Depends on**: T-000
    - **Implements**: FR-035, plan.md §5 Screen Wake Lock (Web)
    - **Acceptance**: `acquireWakeLock()` requests on entry and returns a disposer that removes the `visibilitychange` listener **and** releases the sentinel. **No listener is registered at module scope** — importing the module under SSR (no `document`) must not throw, and a test asserts import succeeds with `document`/`navigator` undefined. Re-acquires only while the session is live; graceful no-op on unsupported browsers; marked `@sideEffect`.

- [ ] **T-005** [P2] [US-005] Implement Expo screen wake lock (`expo-keep-awake`) — `packages/shared/cooking/src/wakeLock.native.ts`
    - **Depends on**: T-000
    - **Implements**: FR-035, plan.md §5 Screen Wake Lock (RN/Expo)
    - **Acceptance**: Uses `activateKeepAwakeAsync(tag)` / `deactivateKeepAwake(tag)` — the API `expo-keep-awake@57` actually exports; `KeepAwake.activate()` does **not** exist and must not be used. File uses the `.native.ts` suffix so Metro resolves it (never `-rn`/`-native`); exports the **same** disposer signature as T-004 so the calling hook is platform-agnostic. Verified on iOS + Android.

---

## US-007 — Recover an in-progress session after short interruption

- [ ] **T-013** [P3] [US-007] Implement session persistence and 24h resume logic (IndexedDB / AsyncStorage) — `packages/shared/cooking/src/session-persistence.ts`
    - **Depends on**: T-002
    - **Implements**: plan.md §8 Session Resume, FR-033, FR-035
    - **Acceptance**: Session saved on pause/exit; resume prompt shown if <24h; restores step index and active timers; start-fresh option clears cache.

---

## US-006 — Use voice commands for next/back/timer

- [ ] **T-014** [P3] [US-006] Implement Web Speech API voice command controller (`next`, `back`, `timer`, `pause`) — `packages/shared/cooking/src/voice-control.ts`
    - **Depends on**: T-002
    - **Implements**: plan.md §5 Voice Control, FR-033, FR-034
    - **Acceptance**: Toggle on/off; commands mapped to session actions; error/retry feedback surfaced; English MVP.

---

## US-008 — Check off ingredients in a side panel while cooking

- [ ] **T-015** [P3] [US-008] Build `IngredientChecklist` panel component — `packages/apps/commise/features/cooking/src/IngredientChecklist.tsx`
    - **Depends on**: T-002, T-000
    - **Implements**: **FR-032a**
    - **Acceptance**: Pure `props → JSX` (checked ids in, `onToggle` out — no fetching, no mutation). Panel opens and dismisses without leaving the current step; checked state survives step navigation and session resume (FR-032a) and **never** writes to the stored recipe — a test asserts no recipe mutation call is issued. Ingredients read from `@kitchensink/recipe-core`; check state accessible via `getByRole('checkbox')` with non-color cues (NFR-003, NFR-004).

---

## US-009 — Apply cook-time scaling guidance in mode

- [ ] **T-016** [P3] [US-009] Build `ScaleSelector` component — scales **quantities only**, never times — `packages/apps/commise/features/cooking/src/ScaleSelector.tsx`
    - **Depends on**: T-002, T-000
    - **Implements**: **FR-034a**
    - **Acceptance**: Pure `props → JSX` (`scaleFactor` in, `onScaleChange` out). Selecting a factor recalculates displayed ingredient quantities and **leaves every timer duration untouched** — a test sets 2× and asserts each `CookingTimer.durationMs` is unchanged. When `scaleFactor !== 1` an advisory states cook times are not scaled and may need adjustment (FR-034a). Never mutates the stored recipe.
    - **Note**: the prior "timer recalculation" wording is superseded by spec.md **D-002** — cook time does not scale linearly with yield, so auto-scaling timers would emit wrong and potentially unsafe instructions.

---

## Cross-Cutting

> **Test tiers (added 2026-08-05).** The prior task list carried unit tests only. Per the repository's testing policy, UI code
> requires a vitest component test for **every** state (loading, empty, populated, error, disabled, each branch — not just the
> happy path), **plus** Playwright for web user stories **and** a Maestro flow for mobile. T-018…T-021 close that gap; they are
> written **before** the code they cover (TDD red → green), and T-017…T-021 are all `Test-first: true`.

- [ ] **T-017** [P1] [US-001, US-002, US-003, US-004] `Test-first: true` — unit tests for session, timer engine, wake lock, persistence — `packages/shared/cooking/src/__tests__/`
    - **Depends on**: T-000
    - **Implements**: NFR-001, plan.md testability
    - **Acceptance**: Covers session state transitions and first/last boundary clamps; concurrent timer lifecycle with pause/resume; wake-lock acquire/dispose incl. the SSR import-safety case; the JSON round-trip test from T-001; scale factor leaves timer durations untouched (FR-034a); checked-ingredient state survives restore (FR-032a). Written to **fail if the logic is broken** (mutation lens), not merely to execute it.

- [ ] **T-018** [P2] [US-001…US-005, US-008, US-009] `Test-first: true` — vitest component tests for every Cooking Mode UI state — `packages/apps/commise/features/cooking/src/__tests__/`
    - **Depends on**: T-000
    - **Implements**: testing policy (UI), NFR-003, NFR-004
    - **Acceptance**: Each of `StepDisplay`, `StepNavigation`, `TimerBadge`/`ActiveTimers`, `TimerAlert`, `IngredientChecklist`, `ScaleSelector`, `CookingModeScreen` has tests for loading, empty (recipe with zero steps), populated, error, and disabled/boundary states — including the first/last-step disabled affordances and the timer-complete alert. Queries use `getByRole`/`getByLabel`. Native variants covered by `*.native.test.tsx` siblings.

- [ ] **T-019** [P3] [US-001…US-005] `Test-first: true` — Playwright e2e for the web cooking journey — `packages/apps/commise/web/tests/e2e/cookingMode.spec.ts`
    - **Depends on**: T-011
    - **Implements**: testing policy (web happy path)
    - **Acceptance**: Enters Cooking Mode from recipe detail, advances through all steps, navigates back without losing position, starts a timer and observes completion, and exits. `getByRole`/`getByLabel` only — `data-testid` and `page.waitForTimeout()` are banned. Bare `.spec.ts` under `tests/e2e/` is reserved for Playwright.

- [ ] **T-020** [P3] [US-001…US-005] `Test-first: true` — Maestro flow for the mobile cooking journey — `packages/apps/commise/mobile/.maestro/cooking/cooking-mode-flow.yaml`
    - **Depends on**: T-012
    - **Implements**: testing policy (mobile happy path), cross-platform rule
    - **Acceptance**: Opens a recipe, enters Cooking Mode, advances and reverses steps, starts a timer, and confirms the screen stays awake for the session. Runs in CI under the `heavy-e2e` PR label.

- [ ] **T-021** [P3] [US-007] `Test-first: true` — integration test for session persistence and 24h resume — `packages/shared/cooking/tests/sessionResume.integration.test.ts`
    - **Depends on**: T-013
    - **Implements**: testing policy (non-UI: unit **and** integration), FR-033
    - **Acceptance**: Persists a live session, restores it across a simulated process restart, asserts step index, checked ingredients, scale factor, and active timers all survive; asserts a >24h-old session is discarded and offers start-fresh.

---

## Constraints Checklist

- [x] All tasks are `- [ ]`
- [x] All paths under `packages/`
- [x] No phantom T-NNN referenced without definition
- [x] Every task traces to a US and to spec.md FRs
- [x] Dependency graph contains only tasks written above
- [x] Acceptance criteria reference spec.md acceptance scenarios and NFRs
- [x] **Feature UI lives in `packages/apps/commise/features/cooking`, not in the `@commise/ui` design system** (re-checked 2026-08-05)
- [x] **No task defines a recipe-shaped type locally** — `RecipeStep` is imported from `@kitchensink/recipe-core` (GR-007)
- [x] **No task adds an API endpoint** — Cooking Mode reads the existing recipe detail payload
- [x] **Platform variants use `.native.ts(x)`** — no `-rn` / `-native` / `.mobile.*` filenames
- [x] **Every required test tier is present**: unit (T-017), component (T-018), Playwright web (T-019), Maestro mobile (T-020), integration (T-021)
