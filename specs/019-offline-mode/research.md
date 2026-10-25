# Research: Offline Mode (019)

**Date**: 2026-10-25. **Inputs**: the spec, ADR-0057, ADR-0068 and ADR-0069, GR-005, `docs/design/offlineNotice.md`, a
staff-architect PLANNING review, and an external research pass. Each section gives the decision, the reason and the
options that lost.

## R1. How the app opens offline

- **Decision**: a local-first gate. The shared auth state gains a `held` state. The device can hold a record of a cook's last successful sign-in. If it does, and Clerk has not loaded, the
  gate admits that cook to their local data. Clerk loads on its
  normal path in the background. The app never mints a token from a cached session.
- **Reason**: the held state keeps "this device remembers a cook" apart from "the server accepts this cook", so the
  types say which one is true. It depends only on Clerk's normal load path. Clerk's offline cache (`__experimental_resourceCache`) is experimental. It has no fix newer than `@clerk/expo` 4.14.1, and its reconnect is undocumented (Clerk docs, offline-support guide, read 2026-10-25). ADR-0069 measured it sticking in about 2 runs of 3.
- **Alternatives**: Clerk's resource cache (ADR-0069's path). Rejected for now, because SC-003 must then be met again on every Clerk upgrade, and its stuck reconnect has no known cause. If Clerk makes the cache stable, and SC-001 places the defect inside Clerk with a fix in a named version, it becomes the choice.
- **The record**: mobile records no signed-in cook today. The web key `deviceSession.heldCook.v1` exists only on web
  (`RecipeProviders.tsx`) and clears the cook's work on a change of cook, which mobile must not do (owner decision 6, 2026-10-13: a phone keeps a cook's unsent saves after their session expires). So mobile gets its own pointer,
  `auth.lastSignedInCook.v1` (data-model.md).
- **Web**: the same `held` state and the same pointer, kept in IndexedDB (owner decision of 2026-10-25, R5). Clerk's
  web library cannot load offline, so the gate admits the held cook without waiting for it, exactly as on mobile.

## R2. The stuck reconnect (SC-001)

- **Decision**: instrument the reconnect first, as build step 1, and log what `getToken` returns after the network
  returns. That is ADR-0069's own next step.
- **Lead found in our code, not yet proven**: the outbox drains on mount once per cook (`syncProvider.tsx`) and again
  when the connection state changes. If the device comes online before Clerk can mint a token, the record parks with a
  `401`. The drainer can resend a parked record (`drainer.ts`, `resendsWhenParked`), but nothing starts another drain: the cook does not change, and the device does not go offline and online again. That matches "Syncing 1
  change…" with no end.
- **Consequence for the design**: the sync provider drains on mount, on reconnect, and also at the moment the session becomes verified (contracts/syncTriggers.md). This fixes running apps too, so it ships on its own.
- **SC-001 still applies under R1.** ADR-0069's residual risk is that the stuck reconnect also hits any long-offline
  cold start with the network on. The instrumented run settles that.

## R3. The read cache

- **Decision**: TanStack Query's per-query persister (`experimental_createQueryPersister`), behind a storage adapter we
  own. One key per query under `query.v1.{subject}.`. On mobile, the adapter lists keys with AsyncStorage `getAllKeys`. On web it uses IndexedDB through `idb-keyval`, a
  new declared dependency that the TanStack docs use for this (today it is only transitive). Either way, a wipe
  removes a cook's prefix with no manifest. The adapter parses each stored entry with the schema package's zod on the way in. An entry that fails to parse is dropped and fetched again. A `buster` comes from its own `READ_CACHE_VERSION`.
- **Reason**: per-query keys avoid rewriting one large blob on every change. The read cache can be thrown away, so it
  is not a one-way door and does not use the outbox's `LOCAL_SCHEMA_VERSION`. The read invariant (local unsynced, then
  stored server copy, then fetch) already holds, because `projection.ts` lays the outbox over whatever the query cache
  holds. Nothing is added for it.
- **Alternatives**: `PersistQueryClientProvider` with one persisted blob and a `shouldDehydrateQuery` allowlist
  (TanStack docs, persistQueryClient, read 2026-10-25). Rejected: one blob rewritten on every cache change, and no
  per-cook wipe without a manifest. A store we write ourselves: kept as the fallback for a change of shape in the experimental persister, and the adapter keeps that change local.
- **Settings**: `gcTime` at least the persister's `maxAge` (TanStack requires it). `maxAge` matches the offline admission
  limit (R6), because data older than that can never be shown.
- **Photos**: expo-image's disk cache holds them. `endDeviceSession` also clears it.

## R4. Which recipes are on the device (FR-004)

- **Decision**: summaries of the whole library, so Home renders. The full version of every recipe the cook wrote, so
  FR-008 can edit them offline. The full version of recently opened recipes, least recently used first out, within a
  byte budget. On reconnect, the app refreshes only bodies whose `currentVersion` changed.
- **Reason**: it covers what the cook can edit and what they just used, at a bounded size. Prefetching every saved
  recipe by other cooks waits until real library sizes are measured.
- **Budget**: set during build step 2 from the storage limit actually read from `@react-native-async-storage`
  2.2.0's source. A write-up reports a 6 MB default on Android, which is not verified.

## R5. Web scope (FR-003)

- **Decision (owner, 2026-10-25)**: web gets the full offline start, the same as mobile. The ruling of 2026-09-17 that
  kept app data out of the browser was overturned the same day (`docs/design/uiOverhaul/ownerDecisions.md`).
- **What it needs**:
    - a Serwist service-worker shell (the Next.js PWA guide's recommendation for Next 16) that caches a public shell and
      no authenticated HTML, because `clerkMiddleware` cannot run offline.
    - the `held` state on web (R1), because clerk-js cannot load offline and no Clerk source documents an offline web
      start (Clerk docs, read 2026-10-25).
    - the read cache in IndexedDB behind the same adapter (R3, contracts/readCache.md).
    - the web outbox and draft moved from the tab's `sessionStorage` to IndexedDB, in the same v1 format. This ends
      D7's tab lifetime, so the new ADR supersedes that part of ADR-0057.
    - one writer for the outbox across tabs. A durable outbox is shared by every tab, so two tabs can drain it at once
      and send a change twice. The browser's Web Locks API (`navigator.locks`) gives one tab the drain at a time.
      ADR-0057 closed the duplicate-tab case with one owner per tab, and this keeps that guarantee.
- **Security cost**: IndexedDB is readable by any script on the origin (`outboxStore.ts`), so a script injection exposes
  the cook's stored recipes. A strict Content Security Policy and the sign-out wipe are the mitigations.
- **Shell and sign-out**: the shell never caches a signed-in page, so a sign-out cannot leave one behind for the next
  person.
- **Alternatives**: the open-tab scope that ships today. Rejected by the owner on 2026-10-25.

## R6. Offline admission limit and data on the device (FR-025, FR-027)

- **Scope**: both platforms. On web this changes the session-end rule (ADR-0054): an ended session no longer clears the
  cook's unsent work at once. It follows FR-025 instead, as mobile does.

- **Decision**: the gate refuses the held state for a pointer whose `signedInAt` is older than the longest session the Clerk production instance allows. Build step 3 reads that value from the instance settings. When Clerk loads
  and reports no user, the app shows sign-in, drops the read cache and keeps the outbox (owner decision 6). The outbox goes at the next sign-in by another cook, or at the end of the limit.
- **Reason**: the device cannot tell an erased account from an expired or revoked session, because Clerk reports no
  user in all three cases. A time bound and a change of cook keep orphaned data from staying forever, with no new
  server signal.
- **Accepted residual risk**: a revoked session still opens offline, on this device, until it reconnects or the limit
  passes. Possession of the device already grants access to the outbox today.

## R7. Conflict and refusal surfaces (User Story 3)

- **Exists**: `RecipeConflictView` (web and native), `FailureAlert` (web and native), `SyncNoticeHost` with its count,
  the unreadable-work notice, `saveStatus`, and `itemStatus.scopeOf` and `remedyFor` (unit-tested, not rendered).
- **Missing, and in scope**:
    - the error and the mark on the item itself (the three uncovered rows in `docs/design/offlineWriteAcceptance.md`)
    - a "needs a choice" mark in lists, for a conflict that arrives after the editor closes
    - "save as new" for a refused change, as one outbox mutation like `applyDiscard`
    - the `removeMember` intent that ADR-0057 still owes
    - the sign-out warning for unsynced changes (offlineNotice.md R3)
    - the network-only notices (FR-007) and the "this recipe needs the network" screen.

## R8. Governance

- **GR-005 AC-005-d**: `docs/offline-strategy.md` does not exist. This feature writes it, from R1 to R6, before the
  first offline-dependent feature (006, 007) enters implementation.
- **ADR**: a new ADR records R1, R3 and R5 and amends ADR-0069, as ADR-0069 §3 requires of the change that turns the
  offline start on.
