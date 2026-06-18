# System Design: Cooking Mode

**Feature Branch**: `008-cooking-mode`
**Created**: 2026-05-09
**Status**: Draft
**Source**: `specs/008-cooking-mode/v-model/requirements.md`

## Overview

Cooking Mode is decomposed into five system components: a Step Display subsystem responsible for rendering recipe instructions one step at a time, a Step Navigation module managing forward/backward traversal, a Timer Engine service handling countdown logic and audio alerts, a Screen Wake Lock utility preventing device sleep, and an Offline Cache module ensuring recipe data availability without connectivity. Cross-cutting concerns (type safety, accessibility, documentation) are addressed by a Quality & Accessibility component. The system is a read-only consumer of Recipe data from feature 001 and requires an authenticated session from feature 002.

## ID Schema

- **System Component**: `SYS-NNN` — sequential identifier for each component
- **Parent Requirements**: Comma-separated `REQ-NNN` list per component (many-to-many)
- Example: `SYS-003` with Parent Requirements `REQ-001, REQ-005` — component satisfies both requirements

## Decomposition View (IEEE 1016 §5.1)

| SYS ID  | Name                    | Description                                                                                                                                                                                  | Parent Requirements                                           | Type      |
| ------- | ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- | --------- |
| SYS-001 | Step Display            | Renders the current recipe instruction step in large, readable formatting. Manages step index state, displays step number/total, and triggers smooth visual transitions between steps.       | REQ-001, REQ-008, REQ-009, REQ-NF-003, REQ-NF-004, REQ-NF-005 | Subsystem |
| SYS-002 | Step Navigation         | Controls forward and backward traversal through recipe steps. Maintains current step index, enforces boundary conditions (first/last step), and exposes gesture/tap input handlers.          | REQ-002, REQ-003, REQ-010                                     | Module    |
| SYS-003 | Timer Engine            | Parses timed step durations from recipe data, manages countdown state (start/pause/reset), emits audible alerts on completion, and exposes timer status to the display layer.                | REQ-004, REQ-005, REQ-006                                     | Service   |
| SYS-004 | Screen Wake Lock        | Acquires the platform wake lock when Cooking Mode is entered and releases it on exit. Handles platform API differences (Web Wake Lock API / React Native `activateKeepAwake`).               | REQ-007, REQ-CN-002                                           | Utility   |
| SYS-005 | Offline Recipe Cache    | Caches the full recipe (steps, timers, instructions) into local storage when Cooking Mode is entered so that subsequent steps remain accessible without network connectivity.                | REQ-011                                                       | Module    |
| SYS-006 | Recipe Data Adapter     | Adapts the Recipe entity from feature 001-commise-recipe-app into the Cooking Mode internal step model. Read-only; never mutates Recipe data.                                                | REQ-IF-001, REQ-CN-001                                        | Adapter   |
| SYS-007 | Auth Guard              | Verifies a valid authenticated session (via feature 002-user-auth) before allowing entry into Cooking Mode. Redirects unauthenticated users to the login flow.                               | REQ-IF-002                                                    | Service   |
| SYS-008 | Quality & Accessibility | Cross-cutting: enforces TypeScript strict mode, JSDoc documentation requirements, accessible component naming, and color-independent state communication across all Cooking Mode components. | REQ-NF-001, REQ-NF-002, REQ-NF-004, REQ-NF-005                | Utility   |

## Dependency View (IEEE 1016 §5.2)

| Source  | Target  | Relationship | Failure Impact                                                                              |
| ------- | ------- | ------------ | ------------------------------------------------------------------------------------------- |
| SYS-001 | SYS-002 | Reads        | Step Display cannot determine which step to render; shows stale or incorrect step.          |
| SYS-001 | SYS-003 | Reads        | Step Display cannot show timer state; timer UI is absent or frozen.                         |
| SYS-001 | SYS-006 | Reads        | Step Display has no recipe data; Cooking Mode cannot render any content.                    |
| SYS-002 | SYS-006 | Reads        | Navigation cannot determine step boundaries; forward/backward may go out of range.          |
| SYS-003 | SYS-006 | Reads        | Timer Engine cannot parse step durations; no timers are started.                            |
| SYS-005 | SYS-006 | Writes       | Offline cache cannot persist recipe data; offline mode is unavailable.                      |
| SYS-006 | SYS-007 | Calls        | Recipe Adapter cannot confirm auth; Cooking Mode entry is blocked or insecure.              |
| SYS-004 | SYS-001 | Subscribes   | Wake lock is not acquired/released in sync with Cooking Mode lifecycle; battery drain risk. |

### Dependency Diagram

```text
[SYS-007 Auth Guard]
        │ (auth check)
        ▼
[SYS-006 Recipe Data Adapter] ◄── (read-only Recipe entity from 001)
        │
        ├──► [SYS-001 Step Display] ◄── [SYS-002 Step Navigation]
        │           │
        │           └──► [SYS-003 Timer Engine]
        │
        └──► [SYS-005 Offline Recipe Cache]

[SYS-004 Screen Wake Lock] ──subscribes──► [SYS-001 Step Display lifecycle]

[SYS-008 Quality & Accessibility] ── cross-cutting ──► all components
```

## Interface View (IEEE 1016 §5.3)

### External Interfaces

| Component | Interface Type | Protocol               | Input                                                                                         | Output                                                  | Error Handling                                               |
| --------- | -------------- | ---------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------ |
| SYS-007   | External       | Clerk session token    | Derived — supports cross-cutting implementation constraints for traced parent system behavior | `{ authenticated: boolean, userId: string }` (Derived)  | Redirect to login on invalid/expired token                   |
| SYS-006   | External       | REST / 001 API         | Derived — supports cross-cutting implementation constraints for traced parent system behavior | `Recipe` entity (steps[], timers[], metadata) (Derived) | Throw `RecipeNotFoundError`; surface error to UI             |
| SYS-004   | External       | Platform Wake Lock API | Derived — supports cross-cutting implementation constraints for traced parent system behavior | Wake lock acquired/released (Derived)                   | Log warning; degrade gracefully (screen may sleep)           |
| SYS-003   | External       | Audio API              | Derived — supports cross-cutting implementation constraints for traced parent system behavior | Audible alert sound (Derived)                           | Log warning if audio permission denied; show visual fallback |

### Internal Interfaces

| Component | Interface Type | Protocol          | Input                                                                                         | Output                        | Error Handling                                              |
| --------- | -------------- | ----------------- | --------------------------------------------------------------------------------------------- | ----------------------------- | ----------------------------------------------------------- | --------------------------------------- | ------------ | --------- | ------------------------- |
| SYS-001   | Internal       | React props/state | Derived — supports cross-cutting implementation constraints for traced parent system behavior | Rendered step UI (Derived)    | Show error boundary on render failure                       |
| SYS-002   | Internal       | Event callbacks   | Derived — supports cross-cutting implementation constraints for traced parent system behavior | Updated `stepIndex` (Derived) | Clamp to [0, totalSteps-1]; no-op at boundaries             |
| SYS-003   | Internal       | State machine     | Derived — supports cross-cutting implementation constraints for traced parent system behavior | 'pause' \ (Derived)           | 'reset' }`                                                  | `{ remaining: number, status: 'idle' \  | 'running' \  | 'done' }` | Reset on invalid duration |
| SYS-005   | Internal       | AsyncStorage      | Derived — supports cross-cutting implementation constraints for traced parent system behavior | `void` (persisted) (Derived)  | Log error; Cooking Mode continues without offline guarantee |

## Behavioral View (IEEE 1016 §5.4)

### State Machine: Cooking Mode Session

```text
[Idle]
  │ user selects recipe + enters Cooking Mode
  ▼
[Auth Check] ──fail──► [Login Redirect]
  │ pass
  ▼
[Loading Recipe] ──error──► [Error State]
  │ success
  ▼
[Active: Step N]
  │ onNext (N < total)     │ onPrev (N > 0)
  ▼                        ▼
[Active: Step N+1]    [Active: Step N-1]
  │
  │ step has timer → [Timer Running] ──complete──► [Timer Done + Alert]
  │
  │ N == total
  ▼
[Completion Screen]
  │ exit
  ▼
[Idle] (wake lock released)
```

### State Machine: Timer Engine

```text
[Idle]
  │ start(durationSeconds)
  ▼
[Running] ──tick──► remaining--
  │ pause            │ remaining == 0
  ▼                  ▼
[Paused]         [Done] ──► emit audible alert
  │ resume
  ▼
[Running]
  │ reset
  ▼
[Idle]
```

## Constraints View (IEEE 1016 §5.5)

| Constraint ID | Description                                                                                                       | Source     |
| ------------- | ----------------------------------------------------------------------------------------------------------------- | ---------- |
| CON-001       | Cooking Mode MUST NOT modify Recipe data; all access is read-only.                                                | REQ-CN-001 |
| CON-002       | Screen wake lock MUST be released on Cooking Mode exit; no residual lock after session ends.                      | REQ-CN-002 |
| CON-003       | All TypeScript code MUST compile with `strict: true`; `any` is prohibited outside explicitly marked test doubles. | REQ-NF-001 |
| CON-004       | Step text MUST be legible from 3 feet on standard mobile devices (minimum font size guidance applies).            | REQ-NF-003 |
| CON-005       | Color MUST NOT be the sole conveyor of state; icon or text label pairing is required for all state indicators.    | REQ-NF-005 |
| CON-006       | Cooking Mode entry requires a valid authenticated session; unauthenticated access is blocked.                     | REQ-IF-002 |

## SYS↔REQ Traceability Matrix

| REQ ID     | SYS Components   |
| ---------- | ---------------- |
| REQ-001    | SYS-001          |
| REQ-002    | SYS-002          |
| REQ-003    | SYS-002          |
| REQ-004    | SYS-003          |
| REQ-005    | SYS-003          |
| REQ-006    | SYS-003          |
| REQ-007    | SYS-004          |
| REQ-008    | SYS-001          |
| REQ-009    | SYS-001          |
| REQ-010    | SYS-002          |
| REQ-011    | SYS-005          |
| REQ-NF-001 | SYS-008          |
| REQ-NF-002 | SYS-008          |
| REQ-NF-003 | SYS-001          |
| REQ-NF-004 | SYS-001, SYS-008 |
| REQ-NF-005 | SYS-001, SYS-008 |
| REQ-IF-001 | SYS-006          |
| REQ-IF-002 | SYS-007          |
| REQ-CN-001 | SYS-006          |
| REQ-CN-002 | SYS-004          |
