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
- Shared core logic in `packages/shared/cooking/src/`

---

## 2. Data Model

### Cooking Session State

```typescript
// Persisted to device storage (AsyncStorage / IndexedDB) for offline + resume
interface CookingSession {
    recipeId: string;
    startedAt: number; // Date.now()
    currentStepIndex: number;
    completedSteps: Set<number>;
    activeTimers: CookingTimer[];
    pausedAt?: number; // If user exits mid-session
}

interface CookingTimer {
    id: string;
    label: string; // "Marinate chicken"
    stepNumber: number; // Which step this timer belongs to
    durationMs: number;
    startedAt: number;
    isPaused: boolean;
    pausedRemainingMs?: number;
}

// Recipe instructions (from 001)
interface RecipeInstruction {
    stepNumber: number;
    text: string;
    imageUrl?: string;
    durationMinutes?: number; // If step has a built-in timer
    audioNarrationUrl?: string; // TTS or pre-recorded
}
```

---

## 3. API Contracts

### Endpoints (from 001)

| Method | Path                                | Auth     | Description                              |
| ------ | ----------------------------------- | -------- | ---------------------------------------- |
| GET    | `/api/v1/recipes/{id}/instructions` | Required | Get recipe instructions for cooking mode |

### WebSocket (optional, real-time)

```typescript
// Real-time step sync (multi-device cooking)
interface CookingSessionEvent {
    type: 'step_advance' | 'timer_start' | 'timer_complete';
    sessionId: string;
    stepIndex?: number;
    timerId?: string;
}
```

---

## 4. Frontend Components

### Component Architecture

```
<CookingModeScreen>
  ├── <StepDisplay>
  │   ├── <StepImage> (optional)
  │   ├── <StepText> (large, 24-48px)
  │   └── <TimerBadge> (if step has duration)
  ├── <StepNavigation>
  │   ├── <TapZone prev> (40% width, large tap target)
  │   ├── <StepDots> (● ○ ○ ○ ○)
  │   └── <TapZone next> (40% width)
  ├── <ActiveTimers>
  │   ├── <TimerCard> (countdown, pause, sound)
  │   └── ...
  └── <VoiceControlButton> (optional, v2)
```

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
// packages/shared/cooking/src/wake-lock.ts
let wakeLock: WakeLockSentinel | null = null;

export async function requestWakeLock(): Promise<void> {
    if ('wakeLock' in navigator) {
        wakeLock = await navigator.wakeLock.request('screen');
    }
}

export async function releaseWakeLock(): Promise<void> {
    if (wakeLock) {
        await wakeLock.release();
        wakeLock = null;
    }
}

// Re-acquire on visibility change (tab switch, background)
document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState === 'visible') {
        await requestWakeLock();
    }
});
```

### Screen Wake Lock (React Native / Expo)

```typescript
// packages/shared/cooking/src/wake-lock-rn.ts
import * as KeepAwake from 'expo-keep-awake';

export function activateWakeLock(): void {
    KeepAwake.activate();
}

export function deactivateWakeLock(): void {
    KeepAwake.deactivate();
}
```

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
