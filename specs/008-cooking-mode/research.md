# Phase 0 Research: Cooking Mode

**Branch**: `008-cooking-mode` | **Date**: 2026-05-08
**Spec**: [spec.md](./spec.md) | **Status**: Complete

## Research Questions

| #    | Question                                                                       | Status      |
| ---- | ------------------------------------------------------------------------------ | ----------- |
| RQ-1 | Competitor cooking mode patterns — what is the current UX standard?            | ✅ Answered |
| RQ-2 | Screen wake lock on React Native / Expo — best library and API                 | ✅ Answered |
| RQ-3 | Step navigation UX — gestures, tap targets, keyboard/voice                     | ✅ Answered |
| RQ-4 | Timer implementation — inline detection, multi-timer, persistence across steps | ✅ Answered |
| RQ-5 | Voice control options for React Native                                         | ✅ Answered |
| RQ-6 | Accessibility and large-text patterns for kitchen use                          | ✅ Answered |
| RQ-7 | Offline / connectivity edge case                                               | ✅ Answered |
| RQ-8 | Integration surface with 001 Recipe entity                                     | ✅ Answered |

---

## RQ-1: Competitor Cooking Mode Patterns

### Market Survey (2026)

| App / Site              | Step-by-step | Wake lock |  Inline timers   |   Voice nav   | Per-step ingredients | Notes                                      |
| ----------------------- | :----------: | :-------: | :--------------: | :-----------: | :------------------: | ------------------------------------------ |
| Drizzlelemons           |      ✅      |    ✅     |  ✅ auto-detect  |  🔜 planned   |          ✅          | Swipe L/R + tap buttons; 56 px tap targets |
| Vule (One4Studio)       |      ✅      |    ✅     |        ✅        |   ✅ simple   |          —           | "Next / Previous / Timer" voice commands   |
| CookEase                |      ✅      |    ✅     |        —         |     ✅ AI     |          —           | Context-aware AI commise                   |
| Flavorish               |      ✅      |    ✅     |        —         |       —       |          —           | Step check-off; multi-recipe switching     |
| Cookie                  |      ✅      |    ✅     |    ✅ audible    |  ✅ natural   |          —           | Accessibility-first; VoiceOver from day 1  |
| The Kitchn (Cook Mode+) |      ✅      |    ✅     |        —         |       —       |          —           | Ingredient checklist; step collapse        |
| Kale AI                 |      ✅      |     —     | ✅ step-attached |       —       |          —           | Timer label stays with step context        |
| PantryPal (OSS)         |      ✅      |    ✅     |  ✅ regex parse  | ✅ Web Speech |          —           | ARIA live regions; keyboard ←/→            |

### Consensus UX Pattern (2026 standard)

1. **Full-screen takeover** — strip all chrome (nav bar, footer, ads)
2. **One step at a time** — large text, single column, no scrolling
3. **Swipe or tap to advance** — horizontal swipe primary; large Prev/Next buttons fallback
4. **Inline timers** — auto-detected from step text; countdown stays visible across steps; audio alert on completion
5. **Screen always on** — wake lock activates on entry, releases on exit
6. **Progress indicator** — "Step N of M" or progress bar
7. **Voice as progressive enhancement** — simple commands ("Next", "Previous", "Timer"); silent fallback when unsupported

### Differentiators Worth Considering

- **Per-step ingredient display** (Drizzlelemons) — reduces scrolling back to ingredient list
- **Next-step preview while timer runs** (New Atlantis Studios) — enables parallel prep
- **Step check-off** (Flavorish, The Kitchn) — tactile completion feedback
- **Completion screen** — rate recipe, add notes (Drizzlelemons roadmap)

---

## RQ-2: Screen Wake Lock — React Native / Expo

### Recommended Library: `expo-keep-awake`

**Current version**: 55.0.6 (published 2026-04-02)
**Expo SDK compatibility**: SDK 53+ (Expo 53 is the project's target per AGENTS.md)
**Platforms**: iOS ✅ Android ✅ Web ✅

#### How it works under the hood

| Platform | Mechanism                                                            |
| -------- | -------------------------------------------------------------------- |
| iOS      | `UIApplication.shared.isIdleTimerDisabled = true`                    |
| Android  | Adds `FLAG_KEEP_SCREEN_ON` to the window                             |
| Web      | Screen Wake Lock API (`navigator.wakeLock`) with NoSleep.js fallback |

#### Recommended usage pattern — hook (declarative, auto-cleanup)

```typescript
import { useKeepAwake } from 'expo-keep-awake';

export function CookingModeScreen() {
    useKeepAwake('cooking-mode'); // released automatically on unmount
    // ...
}
```

#### Alternative — imperative (for conditional activation)

```typescript
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';

// On enter cooking mode
await activateKeepAwakeAsync('cooking-mode');

// On exit cooking mode
deactivateKeepAwake('cooking-mode');
```

**Decision**: Use `useKeepAwake('cooking-mode')` in the Cooking Mode screen component. The tag scopes the lock so other screens are unaffected. Cleanup is automatic on unmount — no manual deactivation needed for the happy path.

**Installation**:

```bash
npx expo install expo-keep-awake
```

No additional native config required for Android. iOS requires `npx pod-install` in bare workflow; managed Expo workflow handles it automatically.

---

## RQ-3: Step Navigation UX

### Gesture + Input Matrix

| Input method     | Primary use case           | Implementation                                                                   |
| ---------------- | -------------------------- | -------------------------------------------------------------------------------- |
| Horizontal swipe | Mobile — primary           | `PanResponder` or `react-native-gesture-handler` `Swipeable` / `GestureDetector` |
| Tap buttons      | Universal fallback         | Large Prev / Next buttons, min 56 px touch target                                |
| Keyboard arrows  | Web / tablet with keyboard | `onKeyDown` ← → handler                                                          |
| Voice            | Hands-free (Phase 2)       | See RQ-5                                                                         |

### Tap Target Sizing

Drizzlelemons uses **56 px minimum** (above the 48 px WCAG 2.5.5 recommendation). This is the right call for kitchen use — users may tap with knuckles, wrists, or elbows.

### Navigation State

```typescript
interface CookingModeState {
    currentStepIndex: number; // 0-based
    totalSteps: number;
    timers: StepTimer[]; // see RQ-4
}
```

- **Forward**: `currentStepIndex = Math.min(currentStepIndex + 1, totalSteps - 1)`
- **Backward**: `currentStepIndex = Math.max(currentStepIndex - 1, 0)`
- **Entry**: always starts at step 0
- **Exit**: explicit "Exit Cooking Mode" button or back gesture; confirm if timers are running

### Progress Indicator

"Step N of M" text label + thin progress bar at top. Both are needed: the bar gives spatial sense, the label gives exact position. Color alone is insufficient (NFR-004).

---

## RQ-4: Timer Implementation

### Detection Strategy

Parse step instruction text with a regex at render time (not stored in DB — instructions are free text from 001):

```typescript
// Matches: "25 minutes", "1 hour", "30 mins", "1 hr 30 min", "45 seconds"
const DURATION_REGEX =
    /(\d+)\s*(?:hr|hour|hours)?\s*(?:and\s*)?(\d+)?\s*(?:min|mins|minute|minutes|sec|second|seconds)/gi;

function parseTimerSeconds(instruction: string): number | null {
    // returns total seconds, or null if no duration found
}
```

Inline timer button appears in the step text wherever a duration is detected. Tapping it starts the countdown.

### Timer State Model

```typescript
interface StepTimer {
    stepIndex: number;
    label: string; // e.g. "Bake for 25 minutes"
    durationSeconds: number;
    remainingSeconds: number;
    status: 'idle' | 'running' | 'paused' | 'done';
    startedAt: number | null; // Date.now() snapshot for drift correction
}
```

### Key Behaviours (from competitor analysis)

| Behaviour                             | Rationale                                              |
| ------------------------------------- | ------------------------------------------------------ |
| Timer persists across step navigation | User advances to next step; timer keeps running        |
| Audio alert on completion             | User may not be watching screen                        |
| Timer visible on any step             | Persistent timer tray / badge shows all running timers |
| Start / Pause / Reset controls        | Overcooking risk if no pause                           |
| Multiple simultaneous timers          | Common: pasta + sauce, roast + sides                   |

### Audio Alert

Use `expo-av` (already in the Expo SDK) to play a short chime. Alternatively `expo-audio` (SDK 53+). Sound file bundled in app assets — no network dependency.

### Drift Correction

Store `startedAt: Date.now()` when timer starts. On each tick, compute `remaining = duration - (Date.now() - startedAt)` rather than decrementing a counter. This survives background/foreground transitions and JS thread pauses.

---

## RQ-5: Voice Control Options

### Assessment

Voice control is **not in the 008 spec FRs** (FR-032–035). It is a progressive enhancement noted in the user story ("simple gestures, taps, or voice commands"). Recommend treating it as **Phase 2 / future enhancement** to keep scope manageable.

### Options When Ready

| Option                            | Pros                            | Cons                                 |
| --------------------------------- | ------------------------------- | ------------------------------------ |
| `@react-native-voice/voice`       | Native iOS/Android; no API key  | Requires native module; more setup   |
| Expo Speech Recognition (SDK 53+) | Managed workflow compatible     | Still experimental as of SDK 53      |
| Web Speech API (web only)         | Zero dependencies on web        | Not available in React Native        |
| ElevenLabs Conversational AI      | Natural language; TTS read-back | Paid API; latency; requires internet |

**Recommendation for Phase 2**: `@react-native-voice/voice` for mobile + Web Speech API for web, with a silent no-op fallback when unsupported. Commands: "Next", "Previous", "Timer", "Repeat".

---

## RQ-6: Accessibility & Large-Text Patterns

### SC-007 Requirement

> Cooking Mode steps are readable from 3 feet away on standard mobile devices.

3 feet ≈ 90 cm. At typical phone brightness, **minimum 32 sp / 32 pt** body text is required for readability at that distance. Competitor analysis confirms this:

- Drizzlelemons: "large, readable text" — designed for distance reading
- Vule: "designed to be readable from a distance so you can keep cooking without leaning in"
- Cookie: large tap targets + dynamic type + high contrast

### Recommended Typography Scale for Cooking Mode

| Element             | Size     | Weight              |
| ------------------- | -------- | ------------------- |
| Step instruction    | 32–36 sp | Regular             |
| Step number / label | 18 sp    | SemiBold            |
| Timer countdown     | 28 sp    | Monospace / Tabular |
| Ingredient callout  | 20 sp    | Regular             |
| Nav buttons (text)  | 18 sp    | Medium              |

### Accessibility Requirements (from NFR-003, NFR-004)

- All interactive elements must have accessible names queryable via `getByRole` / `getByLabel`
- Color must not be the sole conveyor of state — use icon + label pairing (e.g., ✓ + "Done" not just green)
- Timer countdown: `accessibilityLiveRegion="polite"` so screen readers announce updates without interrupting
- Minimum touch target: 56 × 56 dp (exceeds WCAG 2.5.5 minimum of 44 × 44)

### Dynamic Type / Font Scaling

Respect the user's system font size setting (`allowFontScaling={true}` — the React Native default). Do not hard-lock font sizes. The layout must reflow gracefully at 200% system font scale.

---

## RQ-7: Offline / Connectivity Edge Case

### Spec Assumption

> Cooking Mode should function with limited connectivity once the recipe is loaded.

### Approach

The recipe data (instructions, ingredients) is fetched before entering Cooking Mode — it is already in memory / component state. Cooking Mode itself requires **no network calls** during active cooking:

- Step navigation: pure local state
- Timers: `Date.now()` arithmetic, no network
- Wake lock: device API, no network
- Audio alert: bundled asset, no network

**Edge case handling**:

- If the user enters Cooking Mode while online, the recipe is in memory — cooking continues uninterrupted if connectivity drops
- If the app is backgrounded and the recipe is evicted from memory, re-fetch on resume (standard React Navigation focus handler pattern)
- No real-time sync needed during cooking — progress is ephemeral (not persisted to server)

---

## RQ-8: Integration with 001 Recipe Entity

### Relevant 001 Fields

From `001-commise-recipe-app/spec.md`, the `Recipe` entity includes:

| Field          | Cooking Mode use                                      |
| -------------- | ----------------------------------------------------- |
| `instructions` | Ordered array of instruction steps — the core content |
| `ingredients`  | Available for per-step ingredient display (Phase 2)   |
| `prepTime`     | Display in mode entry screen                          |
| `cookTime`     | Display in mode entry screen                          |
| `totalTime`    | Display in mode entry screen                          |
| `servings`     | Display in mode entry screen                          |
| `title`        | Header / exit confirmation                            |

### Instruction Step Shape

The 001 spec stores instructions as ordered text. Cooking Mode consumes them as an array:

```typescript
// Shipped in @kitchensink/recipe-core — imported, never redefined (GR-007)
interface RecipeStep {
    id: string;
    recipeId: string;
    stepNumber: number;
    instruction: string;
    timerSeconds?: number; // structured, per-step duration
}
```

> **Corrected 2026-08-05.** This section previously sketched a local `RecipeInstruction` type whose comment said "timers parsed
> from this at render time". That premise is obsolete and was the root of two downstream defects: the shipped `RecipeStep`
> already carries a **structured** `timerSeconds`, so FR-034 needs no free-text duration parsing at all, and defining the type
> locally would violate GR-007 AC-007-d. See spec.md D-003.

Cooking Mode does **not** modify the Recipe entity. It is a read-only consumer.

### Navigation Entry Point

A "Start Cooking" / "Cook Mode" CTA on the Recipe Detail screen (owned by 001) launches the Cooking Mode screen (owned by 008). This is a screen push in the navigation stack — the Recipe object is passed as a route param.

---

## Decisions & Recommendations

| #   | Decision                                                           | Rationale                                                            |
| --- | ------------------------------------------------------------------ | -------------------------------------------------------------------- |
| D-1 | Use `expo-keep-awake` v55 with `useKeepAwake('cooking-mode')` hook | Managed Expo compatible, auto-cleanup, SDK 53 support confirmed      |
| D-2 | Parse timers from instruction text at render time via regex        | Instructions are free text from 001; no schema change needed         |
| D-3 | Store timer state with `startedAt` timestamp for drift correction  | Survives background/foreground; more accurate than counter decrement |
| D-4 | Minimum 32 sp instruction text; 56 dp touch targets                | Meets SC-007 (readable at 3 ft); exceeds WCAG 2.5.5                  |
| D-5 | Voice control deferred to Phase 2                                  | Not in FR-032–035; keeps 008 scope focused                           |
| D-6 | Cooking Mode is stateless w.r.t. server — no progress persistence  | Recipe already in memory; no network needed during cooking           |
| D-7 | Support multiple simultaneous timers                               | Common real-world need (pasta + sauce); competitor standard          |

---

## Open Questions

| #    | Question                                                                                                 | Impact                                                                |
| ---- | -------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| OQ-1 | Should step progress (current step index) be persisted locally so the user can resume after app restart? | UX quality; low complexity with AsyncStorage                          |
| OQ-2 | Should per-step ingredient display be in scope for 008 or deferred?                                      | Scope; requires linking ingredients to step numbers in 001 data model |
| OQ-3 | What audio asset should be used for the timer alert?                                                     | Asset sourcing; must be royalty-free and bundled                      |
| OQ-4 | Should Cooking Mode support landscape orientation?                                                       | Layout complexity; tablets especially                                 |

---

## Sources

- Drizzlelemons Cook Mode launch post — https://www.drizzlelemons.com/blog/cook-mode-step-by-step-recipe-view (2026-04-09)
- Vule hands-free cooking mode — https://www.one4studio.com/blog/hands-free-cooking-mode-voice-commands-vule (2026-02-07)
- CookEase hands-free guide — https://cookeaseapp.com/resources/hands-free-cooking-voice-control-guide (2026-01-28)
- Flavorish Cooking Mode — https://www.flavorish.ai/blog/cooking-mode-on-flavorish
- Cookie voice assistant — https://cookievoicerecipes.com/
- expo-keep-awake docs — https://docs.expo.dev/versions/latest/sdk/keep-awake/
- expo-keep-awake npm — https://www.npmjs.com/package/expo-keep-awake (v55.0.6, 2026-04-02)
- PantryPal Cook Mode OSS issue — https://github.com/hoangsonww/PantryPal-Streamlit-App/issues/5
- New Atlantis Studios Cook Mode — https://newatlantisstudios.com/blog/cook-mode-step-by-step-cooking (2026-02-09)
