# Implementation Plan: Offline Mode

**Branch**: `docs/offline-start-adr` (single-branch directive. Spec Kit ran with `SPECIFY_FEATURE=019-offline-mode`.) |
**Date**: 2026-10-25 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `specs/019-offline-mode/spec.md`

## Summary

Turn offline mode on in full, on web and mobile. The app opens with no network through a local-first gate: a new
`held` auth state admits the last signed-in cook to their stored data while Clerk loads on its normal path. A persisted
read cache keeps the cook's library summaries, their own recipes and recently opened recipes on the device. The sync
provider gains a drain at the moment the session becomes verified, which closes the likely cause of ADR-0069's stuck
reconnect. On web, a service-worker shell opens the app offline (owner decision, 2026-10-25). The web outbox and drafts
move to durable browser storage, with one writer across tabs. The missing conflict, refusal and network-only
surfaces are built on both platforms. ADR-0069's three conditions are the exit gate.

## Technical Context

**Language/Version**: TypeScript (strict), Node 24.x toolchain.
**Primary Dependencies**:

- `@clerk/expo` 4.14.1 and `@clerk/nextjs` 7.8.
- `@tanstack/react-query` 5, with its per-query persister (`experimental_createQueryPersister`).
- On mobile: `@react-native-async-storage/async-storage` 2.2.0, `@react-native-community/netinfo` 12 and expo-image.
- On web, two new declared dependencies: Serwist (`@serwist/next`) for the service worker, and `idb-keyval` for
  IndexedDB.
- The existing `@kitchensink/sync` outbox.

**Storage**: on the device only. Mobile: AsyncStorage for the read cache, the pointer, the outbox and the drafts. Web:
IndexedDB for the same four. The outbox and draft keep their v1 format (ADR-0057). Cook marks stay in `sessionStorage`
(D18).
**Testing**: vitest unit and integration (React Testing Library for components), Playwright for web, Maestro for
mobile. No service changes, so no service e2e or k6 work.
**Target Platform**: iOS and Android (Expo 57, React Native 0.86), and web (Next.js 16) in current evergreen browsers.
**Project Type**: mobile and web clients over existing services.
**Performance Goals**: a stored recipe shows within 5 seconds of an offline start (SC-005). Waiting changes reach the
server within 30 seconds of reconnecting in 95% of cases (SC-004).
**Constraints**: no token from a cached session. The service worker caches no signed-in HTML. One tab at a time drains
the web outbox. The outbox format is a one-way door (ADR-0057). The read cache fits a byte budget set from each
platform's real storage limit.
**Scale/Scope**: one cook's library per device or browser profile. About fifteen client modules and nine surfaces
(contracts/offlineSurfaces.md).

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

| #    | Principle                         | Status | Notes                                                                                       |
| ---- | --------------------------------- | ------ | ------------------------------------------------------------------------------------------- |
| I    | Correctness and Type Safety       | Pass   | `held` joins the `AuthState` union, so every switch over it fails to compile until handled. |
| II   | Readability and JSDoc             | Pass   | New modules carry JSDoc and `@pattern` tags (pattern register below).                       |
| III  | Code Organization and Imports     | Pass   | The adapter sits in `@commise/query`, the state in `@commise/features-account`.             |
| IV   | Testing Discipline                | Pass   | Unit, integration, Playwright and Maestro tiers are listed per build step.                  |
| V    | Monorepo and Workspace Governance | Pass   | No new workspace. New dependencies: the TanStack persister, Serwist and `idb-keyval`.       |
| VI   | Formatting and Tooling            | Pass   | Shared configs, unchanged.                                                                  |
| VII  | Accessibility and UX Consistency  | Pass   | Each surface goes through `staff-ux-engineer` SPECIFY, with accessible names and tokens.    |
| VIII | Cross-Platform Parity             | Pass   | The offline start, the read cache and every surface ship on web and mobile together.        |

Re-checked after Phase 1: unchanged. The design adds no workspace, keeps the outbox format and ships every capability
on both platforms.

## Pattern Register

- **State machine**: `AuthState` gains `held`. Each platform's gate keeps its render map as a Visitor, as an exhaustive
  switch.
- **Protection Proxy**: `subjectBoundToken`, preserved. It refuses a token for any cook but the signed-in one (FR-019).
- **Adapter**: the read-cache storage adapter, one per platform, with zod parsing at the boundary: the adapter parses
  each entry into its type, and a failure is a miss.
- **Read model**: `projection.ts` already gives "local unsynced, then stored, then fetched". Nothing is added for it.
- **Observer**: `sessionScope` and the pointer reconcile on each change of auth state.
- **Command and Memento**: the outbox and the device draft, preserved. Save-as-new is one outbox mutation.
- **Command Processor**: the drainer, preserved, with one new trigger.
- **Mutex**: the web outbox's single writer across tabs, satisfied by the browser's Web Locks API.

## Build Order

Each step is test-first (CLAUDE.md, TEST-FIRST IS LAW) and ships on its own.

1. **Reconnect instrumentation and the verified trigger** (research R2, contracts/syncTriggers.md). Log what the token
   call returns after reconnecting. Add the drain on the move into `authenticated`, the bounded retry for a parked
   `401`, and the Sentry event. Unit tests cover the triggers and the send gate. Integration runs `SyncProvider` with a fake clock and a token that
   fails, then succeeds. Maestro and Playwright reconnect with a change waiting. This fixes running apps
   too.
2. **The read cache, both platforms** (research R3 and R4, contracts/readCache.md). Read each platform's storage limit
   first: AsyncStorage 2.2.0's source on mobile, and the browser's quota on web. Then set the budget. Unit tests cover
   the adapters, the allowlist, a parse failure, the prefix wipe and the budget order. Integration restores into a
   fresh query client. Maestro and Playwright read an opened recipe offline in a running app.
3. **The held state, the pointer and the gates** (research R1 and R6, contracts/authGate.md). Read the longest session
   from the Clerk production instance settings. Tiers: unit (`deriveAuthState` for each input, the admission limit),
   component (each gate state on each platform), Maestro (`offline/offlineSurvivesRestart.yaml` passes, and leaves the
   hand-run list).
4. **The web shell and the durable web outbox** (research R5). Add the Serwist service worker, which caches a public
   shell and never signed-in HTML. Offline, the recipe routes render on the client from the read cache, because a
   server-rendered page cannot load with no network. Move the web outbox and draft from `sessionStorage` to IndexedDB in
   the same v1 format, and give one tab the drain through Web Locks. Add a strict Content Security Policy. Unit tests cover the lock and the storage move.
   Integration drains one outbox from two tabs and checks that each change is sent once. Playwright starts offline in
   a profile that loaded the app before, edits, closes and reopens offline, then reconnects.
5. **The missing surfaces and intents** (research R7, contracts/offlineSurfaces.md). `staff-ux-engineer` SPECIFY first,
   then build on web and mobile together. Adds `removeMember` and save-as-new. Tiers: component per state, Playwright
   for web, Maestro for mobile.
6. **Governance and the gate**. Write `docs/offline-strategy.md` (GR-005 AC-005-d) and one ADR that amends ADR-0069,
   supersedes ADR-0057's tab lifetime for the web outbox and draft (D7), and changes the web session-end rule of
   ADR-0054 to FR-025's. Run SC-001 to SC-003 (quickstart.md section 4).

## Project Structure

### Documentation (this feature)

```text
specs/019-offline-mode/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── authGate.md
│   ├── offlineSurfaces.md
│   ├── readCache.md
│   └── syncTriggers.md
└── checklists/requirements.md
```

### Source Code (repository root)

```text
packages/apps/commise/features/account/src/
├── authState.ts                 # held state, admission input
└── session/                     # sign-out warning for unsynced work (FR-024)
packages/apps/commise/query/src/
├── syncProvider.tsx             # open stores vs can send, verified trigger
├── readCache.ts                 # NEW storage adapter and persister settings
└── queryClient.ts               # persister wiring
packages/apps/commise/mobile/src/
├── components/AuthGate.tsx      # held render
├── hooks/useAuth.ts             # pointer read, held derivation
└── storage/lastSignedInCook.ts  # NEW pointer adapter
packages/apps/commise/web/src/
├── app/sw.ts                    # NEW Serwist service worker
├── components/auth/             # held render on web
├── storage/                     # NEW IndexedDB adapters: read cache, pointer, outbox, draft
└── middleware.ts                # unchanged; the shell never serves signed-in HTML from cache
packages/apps/commise/features/recipes/src/
├── session/deviceSession.ts     # wipe read cache and photos; web session-end rule
└── (item marks, refusal, needs-network surfaces, web and native)
packages/shared/sync/src/
├── record.ts                    # removeMember
├── outboxMutator.ts             # save-as-new
└── drainLane.ts                 # cross-tab writer through Web Locks on web
docs/offline-strategy.md         # NEW (GR-005)
docs/architecture/decisions/     # NEW ADR amending ADR-0069, ADR-0057 (D7) and ADR-0054
```

**Structure Decision**: no new workspace. The state stays in the shared account package and the persistence in the query
package. The outbox stays in the sync leaf package, and platform code that differs sits behind `.native.tsx`.

## Complexity Tracking

No constitution violations. The Principle VIII waiver is gone: the owner chose a full web offline start on
2026-10-25.

## Risks

- **The verified trigger can be only part of the cause.** Step 1's instrumentation settles it. If the cause sits inside
  Clerk, SC-001 records it, and the gate still uses Clerk's normal load path.
- **Experimental persister.** TanStack can change `experimental_createQueryPersister`. The adapter keeps a swap to our
  own store local.
- **Storage limit not yet read.** The 6 MB Android figure comes from a write-up. Step 2 reads the real value first.
- **Revoked session offline.** It opens on this device until it reconnects or the admission limit passes (research R6).
- **Script injection on web.** IndexedDB is readable by any script on the origin. A strict Content Security Policy and
  the sign-out wipe limit it (research R5).
- **Server-rendered routes.** A page that the server renders cannot load offline. Step 4 gives the recipe routes a
  client path over the read cache, and every other route shows the "needs the network" screen offline.
- **Serwist and Turbopack.** Serwist's getting-started guide targets webpack, with a separate Turbopack example. Step 4
  starts by building that example against this app's bundler.
- **Two tabs.** Without the Web Locks writer, two tabs send a change twice. Step 4's integration test drains one outbox
  from two tabs and counts the sends.

## Open Question

**OQ-1 (major): how the app opens offline** (spec OQ-1, research R1). Options: Clerk's experimental cache on mobile
with the held state on web only, the held state on both, or an answer from Clerk first. The owner does not want to
build sign-in behavior ourselves. On 2026-10-25 Clerk had published no plan to make its cache stable or to support
offline on web. The choice changes build step 3 and how SC-003 reads. Build steps 1, 2 and 4 to 6 do not depend on it.
Step 4's web gate needs the held state under every option.
