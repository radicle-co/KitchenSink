# Tech Stack Rationale: Cooking Mode

**Branch**: `008-cooking-mode` | **Date**: 2026-05-09
**Status**: Complete | **Sources**: [research.md](../research.md), [plan.md](../plan.md), [spec.md](../spec.md)

---

## Overview

The cooking-mode stack is primarily an interaction/runtime feature over existing recipe/auth infrastructure. Decisions below come directly from RQ-2..RQ-8 and technical plan sections.

---

## Frontend Platforms

### Web (React)

**Choice**: React-based cooking mode screen with browser Wake Lock integration and keyboard/touch affordances.

**Rationale**:

- Plan targets desktop/tablet web.
- Web Wake Lock API enables hands-free continuous display where supported.
- Keyboard navigation support complements tablet keyboards and accessibility tooling.

### Mobile (React Native + Expo)

**Choice**: React Native screen in Expo with `expo-keep-awake` and native accessibility primitives.

**Rationale**:

- `research.md` RQ-2 identifies `expo-keep-awake` as the correct wake-lock path for managed Expo.
- Mobile is primary kitchen context; large-target touch and dynamic type handling are mandatory.

---

## Core Interaction Services

### Timer Service (Shared)

**Choice**: Shared deterministic timer logic (`create/start/pause/resume/cancel/tick`) plus UI adapters.

**Rationale**:

- Consistent behavior across web and mobile.
- Enables multi-timer concurrency without platform divergence.
- Supports session persistence and recovery scenarios.

### Session Persistence

**Choice**: Platform-adapter persistence (IndexedDB on web, AsyncStorage on mobile) behind shared interface.

**Rationale**:

- Required by plan for resume-within-24h behavior.
- Preserves cooking continuity under interruption and limited connectivity.

---

## Wake Lock Stack

### Web

**Choice**: `navigator.wakeLock.request('screen')` with visibility re-acquire logic.

**Trade-offs**:

- Not universally supported; requires graceful fallback/no-op path.
- Must avoid stale lock handles across tab visibility transitions.

### Mobile

**Choice**: `expo-keep-awake` via `useKeepAwake('cooking-mode')` or imperative API.

**Trade-offs**:

- Requires dependency installation/pod handling in some workflows.
- Scope tagging is needed to avoid wake-lock leakage beyond cooking mode.

---

## Voice Control Stack (Phase 2)

**Choice**: Keep voice control as optional extension path.

- Web: Web Speech API prototype path.
- Mobile: native bridge / library selection per platform constraints.

**Rationale**:

- Research validates value for hands-busy cooking.
- Canonical FRs do not yet explicitly mandate voice; preserving as phased scope protects delivery certainty.

---

## Data/API Integration

**Choice**: Reuse the existing recipe **detail** endpoint (`GET /api/v1/recipes/{id}`) from feature 001.

> **Corrected 2026-08-05.** This section previously named `GET /api/v1/recipes/{id}/instructions` as an "existing" endpoint.
> No such route exists — `packages/services/recipe-service/src/recipes/recipes.controller.ts` defines `GET :id` and
> `POST :id/clone` only. The conclusion below is unchanged and in fact strengthened: the recipe detail payload already embeds
> `steps: RecipeStepView[]` including `timerSeconds`, so Cooking Mode needs **no** new endpoint and no extra request.

**Rationale**:

- Cooking mode is presentation + interaction layer, not a net-new backend domain.
- Reduces delivery risk by leveraging existing authenticated recipe data flows.

---

## Accessibility/Quality Constraints as Stack Requirements

The “stack” includes operational constraints from NFR/REQ-NF set:

- TypeScript strict mode (no `any` except explicit test doubles).
- Accessible labels queryable in tests.
- Non-color-only state encoding.
- Large readable text and large touch targets.

These are implementation gates, not optional polish.

---

## Deferred/Warning Scope

- Ingredient checkoff panel: candidate UX extension, not canonical FR.
- Cook-time scaling in-mode: requested domain scope, not canonical FR.

Both remain documented as revalidation items before promotion into mandatory implementation scope.
