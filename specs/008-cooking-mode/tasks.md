# Feature 008 — Cooking Mode — Tasks

**Feature**: `008-cooking-mode`  
**Status**: Draft  
**Source**: [spec.md](spec.md) | [plan.md](plan.md) | [product-spec](product-spec/product-spec.md)

---

## US Reference

| ID     | Story                                                                | Priority     | FRs            |
| ------ | -------------------------------------------------------------------- | ------------ | -------------- |
| US-001 | Enter Cooking Mode and see one step at a time in large readable text | P2 Must Have | FR-032         |
| US-002 | Navigate forward/backward through steps without losing position      | P2 Must Have | FR-033         |
| US-003 | Start timers directly from timed steps                               | P2 Must Have | FR-034         |
| US-004 | Receive clear alert when a timer completes                           | P2 Must Have | FR-034         |
| US-005 | Keep device screen awake while Cooking Mode is active                | P2 Must Have | FR-035         |
| US-006 | Use voice commands for next/back/timer                               | Should Have  | FR-033, FR-034 |
| US-007 | Recover an in-progress session after short interruption              | Should Have  | FR-033, FR-035 |
| US-008 | Check off ingredients in a side panel while cooking                  | Could Have   | FR-032         |
| US-009 | Apply cook-time scaling guidance in mode                             | Could Have   | FR-034         |

---

## Dependency Graph

```
T-001 ─┬─→ T-002 ─┬─→ T-006 ─┬─→ T-011 ─┬─→ T-020
       │          │          ├─→ T-012 ─┘
       │          ├─→ T-008  │
       │          ├─→ T-013  │
       │          └─→ T-014  │
       │
       ├─→ T-018 ─┬─→ T-011, T-012, T-020
       │          └─→ T-019
       │
       └─→ T-003 ─┬─→ T-009 ─┬─→ T-016
                  ├─→ T-010  │
                  ├─→ T-017  │
                  └─→ T-019  │

T-004, T-005 (independent wake-lock platforms)
T-007 depends on T-001
```

**Task count: 20** — T-001…T-017 session/timer/UI, T-018…T-020 the contract-consumption half
(GR-015 §15-b, GR-017 §17-b), which had **no task** before this revision.

---

## US-001 — Enter Cooking Mode and see one step at a time in large readable text

- [ ] **T-001** [P1] [US-001] Define CookingMode's OWN domain types, and **derive** every recipe shape from `@kitchensink/schema-recipe` — `packages/shared/cooking/src/types.ts`
    - **Depends on**: none
    - **Implements**: plan.md §2 data model, FR-032, GR-015 §15-b.2/§15-b.3, GR-017 §17-b.1
    - **⛔ `RecipeInstruction` MUST NOT be declared here.** A step/instruction shape is a **recipe-service wire shape**, and `packages/shared/cooking` is a consumer. Declaring it re-authors a contract 008 does not own, which is exactly the drift GR-015 exists to prevent — and it fails silently, because a hand-written parallel type typechecks green while disagreeing with the service by one field.
    - **Acceptance**: `CookingSession`, `CookingTimer` and the session/timer state enums are 008's **own** client-side types and stay here. Every recipe-derived shape — the step list, a step's `instruction`, `timerSeconds`, ingredients for the T-015 checklist — is **imported from `@kitchensink/schema-recipe`** or **DERIVED** from it with `Pick`/`Omit`/`Partial`/mapped types. Reference implementation: `packages/apps/commise/features/recipes/src/filters/model.ts`. Types compile under `strict: true`; all exported interfaces carry JSDoc (NFR-001, NFR-002).
    - **⚠️ `packages/shared/cooking` does not exist in the tree yet** (008 is unimplemented). This task creates it; it must be created already depending on the schema-package **leaf**, never on `@kitchensink/recipe-service` — the boundary `packages/infra/global/__tests__/app-service-dependency.test.ts` enforces.
    - **Tests**: unit (each derived type asserted **assignable from** its wire parent, so a recipe contract change breaks the derivation instead of drifting past it) **AND** integration (a `git ls-files`-based assertion that no file in `packages/shared/cooking` declares a recipe request/response body type, modelled on `packages/infra/global/__tests__/app-service-dependency.test.ts`).

- [ ] **T-002** [P1] [US-001] Implement cooking session state machine and step navigation engine — `packages/shared/cooking/src/session.ts`
    - **Depends on**: T-001
    - **Implements**: FR-032, FR-033
    - **Acceptance**: `advance()` / `goBack()` update `currentStepIndex`; boundary clamps at first/last step; `completedSteps` tracked; 100% unit-test coverage.

- [ ] **T-007** [P2] [US-001] Build `StepDisplay` component (large instruction text, optional image, step counter) — `packages/apps/commise/ui/src/cooking/StepDisplay.tsx`
    - **Depends on**: T-001
    - **Implements**: plan.md §4, FR-032, SC-007
    - **Acceptance**: Instruction text ≥32sp; image lazy-loaded; step position visible; `getByRole` queryable accessible name (NFR-003); color paired with icon/text for states (NFR-004).

- [ ] **T-006** [P2] [US-001] Build `CookingModeScreen` orchestrator composing StepDisplay, Navigation, and Timers — `packages/apps/commise/ui/src/cooking/CookingModeScreen.tsx`
    - **Depends on**: T-002, T-007, T-008, T-009
    - **Implements**: plan.md §4 component architecture, FR-032
    - **Acceptance**: Screen mounts at first step; sub-components render correctly; exit releases wake lock and clears session.

- [ ] **T-011** [P3] [US-001] Add Cooking Mode web route/entry point wired to recipe selection — `packages/apps/commise/web/src/app/[locale]/cooking/[recipeId]/page.tsx`
    - **Depends on**: T-006, T-004, T-018
    - **Implements**: plan.md §1 Web target
    - **Acceptance**: Route `/{locale}/cooking/{recipeId}` loads CookingModeScreen; recipe instructions fetched through `@kitchensink/recipe-service-client` and **parsed on receipt** (T-018), never with a bare `fetch` against a hand-written type; auth gate enforced.
    - **⚠️ Path corrected**: this task previously named `packages/apps/commise/web/src/routes/cooking.tsx`. `@commise/web` is a **Next.js App Router** app — there is **no `src/routes/`** directory, and every route is locale-scoped under `src/app/[locale]/`.

- [ ] **T-012** [P3] [US-001] Add Cooking Mode mobile screen entry wired to recipe selection — `packages/apps/commise/mobile/src/screens/CookingModeScreen.tsx`
    - **Depends on**: T-006, T-005
    - **Implements**: plan.md §1 Mobile target
    - **Acceptance**: Screen pushed from recipe detail; passes recipeId; auth gate enforced; Expo-compatible.

---

## US-002 — Navigate forward/backward through steps without losing position

- [ ] **T-008** [P2] [US-002] Build `StepNavigation` component (tap zones, swipe handler, progress dots) — `packages/apps/commise/ui/src/cooking/StepNavigation.tsx`
    - **Depends on**: T-002
    - **Implements**: FR-033, plan.md §4 Navigation UX
    - **Acceptance**: Tap zones ≥40% width each (48×48dp touch target); swipe gesture supported; progress dots reflect current step; first/last step boundaries disabled safely; `getByRole` labels for prev/next (NFR-003).

---

## US-003 — Start timers directly from timed steps

- [ ] **T-003** [P1] [US-003] Implement countdown timer engine with concurrent timer support — `packages/shared/cooking/src/timer-engine.ts`
    - **Depends on**: T-001
    - **Implements**: FR-034, plan.md §4 Timer Component
    - **Acceptance**: Multiple timers run concurrently; pause/resume per timer; remainingMs decrements accurately; no `any` types (NFR-001); unit tests cover concurrent + pause scenarios.

- [ ] **T-009** [P2] [US-003] Build `TimerBadge` and `ActiveTimers` panel components — `packages/apps/commise/ui/src/cooking/TimerBadge.tsx`
    - **Depends on**: T-003
    - **Implements**: FR-034
    - **Acceptance**: Timed steps show start action; countdown visible while active; concurrent timers listed; accessible labels (NFR-003); non-color state cues (NFR-004).

---

## US-004 — Receive clear alert when a timer completes

- [ ] **T-010** [P2] [US-004] Build `TimerAlert` component (audible chime, pulsing visual banner, ARIA live region) — `packages/apps/commise/ui/src/cooking/TimerAlert.tsx`
    - **Depends on**: T-003
    - **Implements**: FR-034, plan.md §4 TimerAlert
    - **Acceptance**: Timer completion triggers sound + visual pulse; ARIA live region announces to screen readers; accessible dismiss action (NFR-003, NFR-004).

---

## US-005 — Keep device screen awake while Cooking Mode is active

- [ ] **T-004** [P2] [US-005] Implement web screen wake lock (`navigator.wakeLock`) with visibilitychange re-acquire — `packages/shared/cooking/src/wake-lock.ts`
    - **Depends on**: none
    - **Implements**: FR-035, plan.md §5 Screen Wake Lock (Web)
    - **Acceptance**: Requested on cooking mode entry; released on exit; re-acquired when tab returns to visible; graceful noop on unsupported browsers.

- [ ] **T-005** [P2] [US-005] Implement Expo screen wake lock (`expo-keep-awake`) — `packages/shared/cooking/src/wake-lock-native.ts`
    - **Depends on**: none
    - **Implements**: FR-035, plan.md §5 Screen Wake Lock (RN/Expo)
    - **Acceptance**: `KeepAwake.activate()` on entry; `deactivate()` on exit; tested on iOS + Android.

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

- [ ] **T-015** [P4] [US-008] Build `IngredientChecklist` slide-out panel component — `packages/apps/commise/ui/src/cooking/IngredientChecklist.tsx`
    - **Depends on**: none
    - **Implements**: FR-032
    - **Acceptance**: Panel toggles without obscuring active step; check state clear and accessible (NFR-003, NFR-004); ingredient data from 001 recipe entity.

---

## US-009 — Apply cook-time scaling guidance in mode

- [ ] **T-016** [P4] [US-009] Build `CookingScaleSelector` component with timer recalculation — `packages/apps/commise/ui/src/cooking/CookingScaleSelector.tsx`
    - **Depends on**: T-009
    - **Implements**: FR-034
    - **Acceptance**: Scaling factor selectable; timer suggestions update with explicit user confirmation; does not auto-mutate running timers.

---

## Cross-Cutting

- [ ] **T-017** [P2] [US-001, US-002, US-003, US-004] Add unit tests for cooking session, timer engine, and wake lock — `packages/shared/cooking/src/__tests__/`
    - **Depends on**: T-002, T-003, T-004, T-005
    - **Implements**: NFR-001, plan.md testability
    - **Acceptance**: Tests cover session state transitions, concurrent timer lifecycle, wake lock request/release, pause/resume, boundary conditions; run with `npm test`.

---

## Cross-Cutting — Contract consumption (GR-015 §15-b, GR-017 §17-b, §17-e.12)

> **008 owns no service**, so every service-side obligation is **deliberately out of scope here**: there is no
> zod to author, no `contract:generate` script, no schema package to create, no `CONTRACT_HASH` boot assertion,
> no turbo `inputs`, no `ZodValidationPipe`, no `z.strictObject()` request body, no storage-floor parity test and
> no non-HTTP ingress. All of those belong to **`@kitchensink/recipe-service`** and are tasked in 001.
> 008's obligation is the **client half** — and it had **no task at all**, which is GR-017 §17-e.12's failure
> mode: an obligation with no task is an obligation that does not ship.

- [ ] **T-018** [P1] [US-001] Fetch recipes through the typed client and **parse every response on receipt** with `@kitchensink/schema-recipe` — `packages/shared/cooking/src/recipe-source.ts`
    - **Depends on**: T-001
    - **Implements**: FR-032, GR-015 §15-b.1, GR-016 §16-c.3, GR-017 §17-b.2/§17-b.3, §17-f (the **required** half)
    - **Acceptance**: Cooking Mode reads recipes via **`@kitchensink/recipe-service-client`**, never with a bare `fetch` and never against a hand-written type. The response body is parsed with `@kitchensink/schema-recipe`'s runtime zod **at the moment it arrives**; a parse failure surfaces a typed error naming the field and Cooking Mode **refuses to enter** rather than rendering a half-understood recipe. The existing `packages/clients/recipe-service/src/contractSkew.ts` guard covers this consumer — **do not add a second skew guard**.
    - **⚠️ Why this is load-bearing for 008 specifically**: a cook is holding a hot pan. A missing `instruction` rendered as `undefined`, or a `timerSeconds` silently read as `NaN`, is a safety-adjacent failure, not a cosmetic one. Parsing on receipt is what turns it into a refusal instead.
    - **⛔ Do NOT add server-side response validation.** GR-016 §16-g defers a **producing service** parsing what it **emits** — an owner decision, not an unfinished task. This task is the **consumer** parsing what it **received** (GR-017 §17-f); only this half is required.
    - **Tests**: unit (a response with a missing `instruction`, a renamed `timerSeconds`, a wrong-typed `stepNumber` and an absent `steps` array each raise the typed parse error and block entry) **AND** integration (`tests/__integration__/*.integration.test.ts` against a booted recipe service, plus a hand-skewed fixture that must fail).

- [ ] **T-019** [P1] [US-003] Bound `timerSeconds` at 008's **product** ceiling before it reaches the timer engine — `packages/shared/cooking/src/timer-engine.ts`
    - **Depends on**: T-003, T-018
    - **Implements**: FR-034, GR-016 §16-d (the floor is a **floor, not a target**)
    - **⚠️ Read this precisely — the storage floor is ALREADY satisfied upstream.** `timerSeconds` is `positiveInt4()` (`packages/shared/recipe-core/src/recipeRequestBounds.ts:257`), asserted to accept the `int4` ceiling and reject ceiling+1 by `packages/shared/recipe-core/src/__tests__/recipeRequestBounds.test.ts`. So this is **not** the "no upper bound" defect — that one is fixed. Do **not** file it as such, and do **not** loosen or duplicate the service-side bound.
    - **Acceptance**: The gap is that `int4`'s ceiling is **2,147,483,647 seconds ≈ 68 years**, which is a valid _column_ value and an absurd _cooking timer_. 008 therefore applies its **own, tighter product bound** on consumption — a documented maximum (a cooking timer measured in hours, not decades) — and a value above it is surfaced as an explicit "timer too long to run" state rather than started, clamped silently, or overflowed into a `setTimeout` delay the platform cannot represent. GR-016 §16-d's rule that "the column allows it is not an argument for accepting it" is the governing clause; 008 owns this number because it is a product decision with no storage floor to derive from.
    - **⛔ The bound belongs to 008's consumption, not to `recipes.schema.ts`.** Tightening the wire schema would reject recipes the service legitimately stores and is a contract change 008 does not own — raise it against 001 if the product wants it portfolio-wide.
    - **Tests**: unit (a timer at the product ceiling starts; ceiling+1 yields the "too long" state and never calls the platform timer; the `int4` ceiling value does **not** overflow or wrap; `0`/absent means "no timer" and starts nothing — `undefined`, not `0`, is how "no timer" is expressed) **AND** integration (a recipe carrying an over-long `timerSeconds` loads into Cooking Mode with the step readable and only the timer affordance disabled).

- [ ] **T-020** [P2] [US-001] Keep web and mobile entry points in lockstep on the derived types — `packages/apps/commise/web`, `packages/apps/commise/mobile`
    - **Depends on**: T-011, T-012, T-018
    - **Implements**: GR-015 §15-b.4, GR-017 §17-b.1, CODING_STANDARDS §14.1 (lockstep parity), §14.3
    - **Acceptance**: Neither app nor `@commise/ui` declares a recipe wire shape; both entry points consume the T-001 derived types and the T-018 parsed result, so the step/timer contract is described **once** for both platforms. Platform-specific files use the `.native.ts(x)` suffix (never `.mobile.*`). T-011 and T-012 ship in the **same release**. All user-facing copy — including the T-019 "timer too long" and T-018 "recipe could not be read" states — goes through the localization path, never a hard-coded literal.
    - **⚠️ Two stale paths corrected in this file**: T-011 named `packages/apps/commise/web/src/routes/cooking.tsx`, but `@commise/web` is a **Next.js App Router** app with **no `src/routes/`** directory — the route is `packages/apps/commise/web/src/app/[locale]/cooking/[recipeId]/page.tsx`. T-012's `packages/apps/commise/mobile/src/screens/CookingModeScreen.tsx` is correct (that directory exists).
    - **Tests**: **vitest component tests for EVERY path/state on BOTH platforms** — entering, first/last step, populated, parse-failure refusal (T-018), timer idle/running/paused/completed/too-long (T-019), wake-lock unsupported, resume-prompt, start-fresh, voice-unsupported, ingredient panel open/closed — not a representative sample **AND** **Playwright** (`packages/apps/commise/web/tests/e2e/cookingMode.spec.ts`, `getByRole`/`getByLabel` only, no `data-testid`, no `waitForTimeout`) per happy-path story **AND** a **Maestro** flow (`packages/apps/commise/mobile/.maestro/cooking/*.yaml`) per story, matching the Playwright specs one-for-one.

---

## Constraints Checklist

- [x] All tasks are `- [ ]`
- [x] All paths under `packages/`
- [x] No phantom T-NNN referenced without definition
- [x] Every task traces to a US and to spec.md FRs
- [x] Dependency graph contains only tasks written above
- [x] Acceptance criteria reference spec.md acceptance scenarios and NFRs
