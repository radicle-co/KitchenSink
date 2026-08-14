# Technical Plan: Feature 008 — Cooking Mode

**Feature**: `008-cooking-mode`
**Status**: Draft

---

## 1. Architecture Overview

### System Context

```
User selects recipe → Enters Cooking Mode
    ↓
Display step-by-step instructions (large text, one at a time)
    ↓
Navigate: tap zones (left/right), swipe, or voice
    ↓
Timers: inline per step, multiple concurrent
    ↓
Screen wake lock active entire session
    ↓
Session state: resume after interruption (24h window)
```

### Platform Targets

- **Web**: React (desktop + tablet)
- **Mobile**: React Native + Expo (iOS + Android)
- **Shared session/domain logic** in `packages/shared/cooking/src/`, published as `@kitchensink/cooking-core` (GR-009: platform
  scope → `@kitchensink/{name}`, matching the shipped `@kitchensink/recipe-core`). Pure, platform-free.
- **Cross-platform feature UI** in `packages/apps/commise/features/cooking/src/`, published as `@commise/features-cooking`,
  depending on `@commise/features-core`, `@commise/ui`, `@commise/i18n`, `@kitchensink/recipe-core`, `@kitchensink/cooking-core`.
  Platform variants use the enforced `.native.tsx` suffix (never `-rn` / `.mobile.*`) — see CLAUDE.md §14.

> **Package placement (corrected 2026-08-05).** An earlier revision of this plan placed every Cooking Mode component under
> `packages/apps/commise/ui/src/cooking/`. `@commise/ui` is the **design system** — it ships primitives only (`button`, `input`,
> `surface`, `tokens`, `motion`, `pressScale`, `confirmDialog`). Cross-platform _feature_ UI ships from
> `packages/apps/commise/features/{account,core,recipes}`. Cooking Mode is feature UI and follows that convention; putting it in
> `@commise/ui` would make the design system depend on recipe domain types and invert the dependency direction.

---

## 2. Data Model

### Cooking Session State

Cooking Mode defines **no recipe-shaped type**. Steps come from `@kitchensink/recipe-core`'s shipped `RecipeStep`
(`{ id, recipeId, stepNumber, instruction, timerSeconds? }`) — `timerSeconds` already models the per-step inline duration FR-034
needs. Redefining it locally is prohibited by **GR-007 AC-007-d**.

```typescript
import type { RecipeStep } from '@kitchensink/recipe-core';

/**
 * Session-scoped cooking state. Serialized to device storage (AsyncStorage / IndexedDB)
 * for offline + resume, so every field MUST be JSON-round-trippable.
 */
interface CookingSession {
    recipeId: string;
    startedAt: string; // ISO 8601 — never a Date, never epoch millis (CLAUDE.md)
    currentStepIndex: number;
    completedSteps: number[]; // array, NOT Set — see "Serializability" below
    checkedIngredientIds: string[]; // FR-032a, session-scoped; never written to the recipe
    scaleFactor: number; // FR-034a, default 1; display-only, never written to the recipe
    activeTimers: CookingTimer[];
    pausedAt?: string; // ISO 8601, if the user exits mid-session
}

interface CookingTimer {
    id: string;
    label: string; // "Marinate chicken"
    stepNumber: number; // Which RecipeStep this timer belongs to
    durationMs: number; // derived from RecipeStep.timerSeconds * 1000
    startedAt: string; // ISO 8601
    isPaused: boolean;
    pausedRemainingMs?: number;
}
```

### Serializability (corrected 2026-08-05)

An earlier revision typed `completedSteps` as `Set<number>` while also persisting the session as JSON.
`JSON.stringify(new Set([1,2]))` yields `{}` — every completed step would be **silently lost** on resume, and the bug would only
appear after a real interruption. `completedSteps` is therefore a `number[]`, and any set-like behavior is applied in the
session reducer, not in the persisted shape. A round-trip test (`persist → JSON → restore → deep-equal`) is a required unit test.

### Units and dates (corrected 2026-08-05)

The prior local type used `durationMinutes`; the shipped field is `timerSeconds`. Mixing the two silently produces timers 60×
wrong. Only `RecipeStep.timerSeconds` is authoritative; conversion to milliseconds happens once, at timer construction.
Timestamps are ISO 8601 strings per the repo-wide date convention, not `Date.now()` numbers.

---

## 3. API Contracts

### 3.0 Contract ownership and drift (GR-015)

**Normative sources**: [`docs/CODING_STANDARDS.md` §15](../../docs/CODING_STANDARDS.md) ·
[`GR-015`](../governance-rules.md#gr-015-api-contract-ownership) ·
[ADR-0014](../../docs/architecture/decisions/0014-service-owned-api-contracts.md).

**008 is mostly a client feature, which makes the CLIENT half of GR-015 the whole of its obligation.** Cooking
mode owns almost no new server surface: its one read endpoint belongs to 001's recipe service, and its session
state is local. That is precisely the shape in which the client half gets skipped, so it is stated first.

**Every client MUST** — separately mandatory:

- Import the recipe instruction/step wire **types and zod** from **`@kitchensink/schema-recipe`** (via
  `@kitchensink/recipe-service-client`) and **declare no recipe wire type of its own** — not in
  `packages/shared/cooking`, not in `@commise/web`, not in `@commise/mobile` (GR-015 §15-b.4 binds shared and
  app packages identically to `packages/clients/*`).
- **`packages/shared/cooking` is the highest-risk site in this feature.** A shared "cooking step" interface
  hand-written there would be a second representation of 001's step contract, imported by both platforms, and
  it would drift silently — exactly the failure GR-015 exists to prevent. The cooking-mode step model is a
  **DERIVATION** of the recipe step wire type via `Pick` / `Omit` / `Partial` (cooking mode needs
  `text`, `durationMinutes`, ordering — not the whole recipe), **not a parallel declaration**. Reference:
  `packages/apps/commise/features/recipes/src/filters/model.ts`.
- A per-step display model, a timer view model, and the wake-lock state are **genuinely client-side** and
  belong to 008. Only shapes that cross the wire are governed by the schema package.

**If 008 adds any server surface** — a persisted cooking session (§8 Session Resume), or the real-time step
sync below — **the service half applies in full**: zod authored in the owning service at
`src/**/*.schema.ts` beside its controller, requests validated with that same zod via `nestjs-zod`'s
`createZodDto`, a generated and committed `packages/schemas/<service>` (zod + `z.infer` types +
`contract-hash.ts` + barrel + a **derived**, outbound-only `openapi.yaml`), and `*.schema.ts` files importing
**only `zod` and other `*.schema.ts` files**.

🟠 **OPEN — is `CookingSessionEvent` a wire contract, and if so whose?** The WebSocket block below declares
`CookingSessionEvent` inline in this plan. If multi-device sync ships, that event **crosses the wire between
devices via a server** and is therefore a wire contract that must be authored as zod in the owning service and
exported from its schema package — not declared in a plan document and re-typed on each platform. Two things
are undetermined and neither is derivable from §15 or an existing ADR: **(a) which service owns the
cooking-session/WebSocket surface** (§9 lists real-time sync as an open question at all), and **(b) whether
GR-015's HTTP-shaped rule extends to a WebSocket event envelope**, since §15 is written for HTTP services.
**Questions for the owner.** Until they are answered, `CookingSessionEvent` stays illustrative and MUST NOT be
copied into a shared package as an authored type.

**Drift gates** — inherited from GR-015 §15-c; 008 adds none of its own. The `CONTRACT_HASH` **boot assertion**
is the layer that matters most to this feature, because cooking mode ships inside a **released mobile binary**
that cannot be updated in step with a recipe-service deploy.

**⚠️ Third-party APIs (GR-015 §15-d).** 008 consumes no external API. If one is added (a voice or
speech-recognition provider for §5's voice navigation, say), it is the **opposite** case: we do not serve it,
so its client **validates the raw upstream shape at the boundary with zod**, **may declare its own types**, and
**gets no OpenAPI document**. `packages/clients/usda` is the reference implementation and its `schemas.ts` must
never be "converged".

### 3.0a Input validation (GR-016)

**Normative sources**: [`docs/CODING_STANDARDS.md` §15.4](../../docs/CODING_STANDARDS.md) ·
[`GR-016`](../governance-rules.md#gr-016-input-validation-at-every-boundary) ·
[ADR-0015](../../docs/architecture/decisions/0015-input-validation-at-every-boundary.md). §3.0 decides **who
authors** the zod; GR-016 decides **where it runs**. Bindings for this feature only.

**008 owns almost no server surface today, so most of GR-016 lands on it as a consumer** — and the one place
it does touch a bounded column is its own headline feature.

- **Consumer-side parse (GR-016 §16-c.3).** Cooking mode reads
  `GET /api/v1/recipes/{id}/instructions` through `@kitchensink/recipe-service-client`, and the response is
  **validated on receipt** with `@kitchensink/schema-recipe`'s zod — not merely typed. A released mobile binary
  talking to a newer recipe service is the exact case where a shape assumption fails silently, and the
  `CONTRACT_HASH` gate cannot see a client that never parsed.
- **⛔ THE FLOOR — `timerSeconds` is one of the five measured fields.** It writes an `integer` (`int4`) column
  capped at **2,147,483,647** and was measured with **no upper bound**. 008 is the feature that consumes and
  (if session state is ever persisted) submits it. Wherever a timer value crosses the wire, it is bounded at
  least as tightly as the column — and in practice far tighter, since a cooking timer has a sane maximum that
  no storage constraint will ever tell us. **Asserted, never derived**: no zod generated from Drizzle, no
  storage type imported into a `*.schema.ts`.
- **If 008 adds a server surface** — persisted cooking sessions (§8 Session Resume) or step sync — the full
  service half applies: one mechanism (`createZodDto` + **`nestjs-zod`'s** `ZodValidationPipe`), one `400`
  path, path/query/body all parsed, and the storage floor honoured on every persisted field.
- 🟠 **OPEN (unchanged) — `CookingSessionEvent`.** GR-016 does **not** resolve the two open questions above.
  §16-b names **queue, event and webhook** ingress explicitly and is silent on a **WebSocket event envelope**,
  so "does the boundary-parse rule extend to a WS envelope, and which service owns that surface" remains
  **OPEN for the owner**. What GR-016 does settle is the direction of travel: if that envelope ships, whatever
  receives it parses it before dispatching on it — an unvalidated event routed by `type` is a defect on either
  answer. `CookingSessionEvent` stays illustrative and MUST NOT be copied into a shared package.
- **Local session state is not a wire boundary.** Timer state, wake-lock state and step position held on-device
  are genuinely client-side (§3.0). GR-016 binds them only if they start crossing a boundary — at which point
  they are wire shapes and the whole rule applies at once.
- **⛔ Response validation is DEFERRED (GR-016 §16-g)** on the service side. 008's receipt-side parse above is
  the consumer half and is required; the two are different obligations.

### Endpoints

**Cooking Mode adds no endpoint and requires no service change.**

| Method | Path                   | Auth     | Description                                                                  |
| ------ | ---------------------- | -------- | ---------------------------------------------------------------------------- |
| GET    | `/api/v1/recipes/{id}` | Required | Existing recipe detail; its payload already embeds `steps: RecipeStepView[]` |

> **Corrected 2026-08-05.** A prior revision specified `GET /api/v1/recipes/{id}/instructions`. That route **does not exist** in
> the shipped recipe-service (`packages/services/recipe-service/src/recipes/recipes.controller.ts` defines `GET :id` and
> `POST :id/clone`), and it is unnecessary: the recipe detail response already carries the full ordered step list including
> `timerSeconds`. Cooking Mode consumes the recipe the detail screen has **already fetched** via
> `@kitchensink/recipe-service-client`, so entering the mode costs no additional request and works offline once loaded
> (spec.md Assumptions, and the Edge Case on connectivity loss).

### Cross-device sync — explicitly out of scope

A prior revision sketched a `CookingSessionEvent` WebSocket for "multi-device cooking". Cross-device sync is **out of scope**
for 008 (confirmed at the 2026-08-05 revalidation gate). No WebSocket, no `sessionId` server resource, and no server-side
session persistence is built. Session state is device-local only. This is recorded so the capability is not silently
re-introduced as speculative scaffolding (YAGNI).

---

## 4. Frontend Components

### Component Architecture

All of the following live in `packages/apps/commise/features/cooking/src/` (`@commise/features-cooking`), **not** in `@commise/ui`.

```
<CookingModeScreen>              ← ORCHESTRATION: owns useCookingSession, wake lock, timers
  ├── <StepDisplay>              ← pure: props → JSX
  │   ├── <StepImage> (optional)
  │   ├── <StepText> (large, 24-48px)
  │   └── <TimerBadge> (if RecipeStep.timerSeconds is set)
  ├── <StepNavigation>           ← pure
  │   ├── <TapZone prev> (40% width, large tap target)
  │   ├── <StepDots> (● ○ ○ ○ ○)
  │   └── <TapZone next> (40% width)
  ├── <ActiveTimers>             ← pure
  │   └── <TimerCard> (countdown, pause, sound)
  ├── <IngredientChecklist>      ← pure (FR-032a): checked state in, onToggle out
  ├── <ScaleSelector>            ← pure (FR-034a): scaleFactor in, onScaleChange out
  │   └── renders the "cook times are not scaled" advisory when scaleFactor !== 1
  └── <VoiceControlButton>       ← Should Have, deferred (US-006 stays Should Have)
```

**Pattern register.** `CookingModeScreen` is the single orchestrational component (headless `useCookingSession` hook +
statechart-shaped session reducer); every child is a pure presentational component taking `props → JSX` with no fetching and no
mutation, per CLAUDE.md's design-pattern rules. The session reducer is an explicit state machine over
`idle | cooking | paused | complete`; the timer set is a Command-shaped list of start/pause/cancel actions. Primitives
(`Button`, `Surface`, tokens) are imported **from** `@commise/ui` — the dependency points feature → design system, never back.

### Navigation UX

```
┌─────────────────────────────────────┐
│                                     │
│          [Step Image]               │
│                                     │
│          Step 3 of 8                 │
│    "Add the chicken and stir        │
│     for 3 minutes until             │
│     the internal temp               │
│     reaches 165°F"                  │
│                                     │
│     [🕐 3:00 timer]                │
│                                     │
│ ◀ TAP ZONE        TAP ZONE ▶        │
│   Previous         Next             │
│                                     │
│         ● ○ ○ ● ○ ○ ○ ●             │
└─────────────────────────────────────┘
```

### Timer Component

```typescript
interface TimerState {
    id: string;
    label: string;
    remainingMs: number; // Live countdown
    isPaused: boolean;
    isComplete: boolean; // Triggers alert
}

interface TimerAlert {
    audio: 'chime' | 'vibrate' | 'both';
    visual: 'pulsing-banner'; // Shows at top of screen
}
```

---

## 5. Key Technical Implementations

### Screen Wake Lock (Web)

```typescript
// packages/shared/cooking/src/wakeLock.ts
/**
 * Acquires a screen wake lock scoped to one cooking session and returns its
 * disposer. The listener is bound INSIDE the call and removed by the disposer,
 * so nothing is registered at import time.
 *
 * @sideEffect Touches `navigator.wakeLock` and adds a `visibilitychange` listener.
 */
export async function acquireWakeLock(): Promise<() => Promise<void>> {
    if (typeof document === 'undefined' || !('wakeLock' in navigator)) {
        return async () => {}; // SSR / unsupported browser: no-op, FR-035 degrades silently
    }
    let sentinel: WakeLockSentinel | null = await navigator.wakeLock.request('screen');

    // The OS drops the lock whenever the tab is backgrounded; re-acquire on return.
    const onVisibility = async (): Promise<void> => {
        if (document.visibilityState === 'visible' && sentinel === null) {
            sentinel = await navigator.wakeLock.request('screen');
        }
    };
    document.addEventListener('visibilitychange', onVisibility);

    return async () => {
        document.removeEventListener('visibilitychange', onVisibility);
        await sentinel?.release();
        sentinel = null;
    };
}
```

> **Corrected 2026-08-05 (three defects).**
>
> 1. The prior snippet called `document.addEventListener` **at module scope**. `@commise/web` server-renders, so merely importing
>    the module during SSR throws `ReferenceError: document is not defined` — it would crash the route, not just skip the lock.
> 2. That listener was never removed and re-acquired the lock on _every_ tab return **for the lifetime of the page**, including
>    long after the user left Cooking Mode — a leak that defeats FR-035's "while Cooking Mode is engaged" bound.
> 3. `'wakeLock' in navigator` was evaluated without a `typeof navigator` guard.
>
> Ownership is now a disposer returned to the caller, so the lock's lifetime is exactly the session's.

### Screen Wake Lock (React Native / Expo)

```typescript
// packages/shared/cooking/src/wakeLock.native.ts  ← `.native.ts`, NOT `-rn.ts`
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';

const COOKING_TAG = 'cooking-mode';

/**
 * Native counterpart of {@link acquireWakeLock}; same disposer contract, so the
 * calling hook is identical on both platforms.
 *
 * @sideEffect Holds an OS-level keep-awake lock until the disposer runs.
 */
export async function acquireWakeLock(): Promise<() => Promise<void>> {
    await activateKeepAwakeAsync(COOKING_TAG);
    return async () => {
        deactivateKeepAwake(COOKING_TAG);
    };
}
```

> **Corrected 2026-08-05 (two defects).**
>
> 1. **The file name violated the enforced cross-platform rule.** `wake-lock-rn.ts` is neither the required `.native.ts` suffix
>    nor anything the bundler resolves — Metro would never pick it up, so mobile would silently fall through to the web
>    implementation and FR-035 would not work on device at all. 44 shipped files use `.native.tsx`; this follows them.
> 2. **`KeepAwake.activate()` / `.deactivate()` do not exist.** The installed `expo-keep-awake@57.0.1` exports
>    `activateKeepAwakeAsync`, `deactivateKeepAwake`, `useKeepAwake`, `isAvailableAsync`, and the deprecated sync
>    `activateKeepAwake` — the planned code would not compile. The tagged form is used so Cooking Mode's lock cannot be
>    released by an unrelated caller.

### Voice Control (Web — Phase 2)

```typescript
// Phase 2: Web Speech API
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

const COMMANDS = {
    next: () => advanceToStep(currentIndex + 1),
    back: () => advanceToStep(currentIndex - 1),
    previous: () => advanceToStep(currentIndex - 1),
    timer: () => startCurrentStepTimer(),
    pause: () => pauseAllTimers(),
};

export function startVoiceControl(onCommand: (cmd: string) => void): void {
    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = false;

    recognition.onresult = (event) => {
        const transcript = event.results[event.results.length - 1][0].transcript.toLowerCase().trim();
        if (COMMANDS[transcript]) {
            onCommand(transcript);
        }
    };

    recognition.start();
}
```

---

## 6. Accessibility Requirements

| Requirement       | Value                                           |
| ----------------- | ----------------------------------------------- |
| Minimum font size | 24sp (body), 32sp (instructions)                |
| Contrast ratio    | WCAG AAA (7:1)                                  |
| Touch targets     | Minimum 48×48dp (exceed WCAG 44px minimum)      |
| Screen reader     | ARIA live regions for timer alerts              |
| Voice control     | "next", "back", "timer" commands for hands-free |

---

## 7. Offline Behavior

```typescript
// Recipe cached on entry to Cooking Mode
interface OfflineStrategy {
    cacheOnEntry: {
        trigger: 'user enters cooking mode';
        data: 'recipe + all instructions + ingredient images';
        storage: 'AsyncStorage / IndexedDB';
    };

    ifOfflineOnEntry: {
        checkCache: boolean; // Look for recipe first
        ifCached: 'proceed';
        ifNotCached: 'show offline message';
    };
}
```

---

## 8. Session Resume

```typescript
// Resume within 24 hours
interface SessionResume {
  checkExistingSession: (recipeId: string) => CookingSession | null;

  if session && session.pausedAt > (now - 24h):
    prompt: "Resume where you left off? (Step {currentStepIndex + 1})"
    if confirmed: restoreSession(session)
    if declined: startFresh()
  else:
    startFresh()
}
```

---

## 9. Open Questions

1. **Voice command language**: English only for MVP?
2. **Timer sounds**: Custom audio asset or system default?
3. **Step images**: Required or optional per step? (affects recipe entry UX in 001)
4. **Session resume timeout**: 24 hours default — power users need longer?

---

## 10. Implementation Order

1. **Step display + navigation** — tap zones, swipe, step dots
2. **Screen wake lock** — web (`navigator.wakeLock`) + Expo (`expo-keep-awake`)
3. **Timer service** — local countdown, multiple concurrent, pause/resume
4. **Timer alerts** — audio + visual + vibration
5. **Session persistence** — save to AsyncStorage, resume prompt
6. **Offline behavior** — cache recipe on entry, handle no-cache
7. **Voice control (Phase 2)** — Web Speech API for web, native for RN
8. **Multi-device sync (Phase 2)** — WebSocket for real-time step sync
