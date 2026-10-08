# 0057 — The editor keeps a device draft, promotes it at checkpoints, and the outbox has one writer and a fixed format

- **Status**: Accepted
- **Date**: 2026-10-08
- **Drivers**: Owner rulings D1, D7 and D9 (`docs/design/uiOverhaul/ownerDecisions.md`). D1 makes create and edit one
  scrolling editor with autosave, where a published recipe saves to the device until the cook presses "Save
  changes". D7 keeps the web editor's draft in `sessionStorage`. D9 stops a never-published draft from making
  versions.
- **Decides**: blueprint A3 and A4 (`docs/architecture/uiOverhaulBlueprint.md`), adjusted for D7 (which answers the
  blueprint's Q1) and D9 (which answers Q2).
- **Relates to**: [ADR-0058](0058-never-published-drafts-record-no-version.md), the server rule that makes the
  checkpoint cadence affordable. [ADR-0045](0045-ingredient-lookup-and-unresolved-foods.md), the rebind command.
  [ADR-0054](0054-session-seam.md), the rule that a cook's device state ends with their session.

## Context

The editor of the UI overhaul saves as the cook types. Three things hold the cook's work, and each has a different
owner:

- The **device draft**. The editor writes it often and reads it on reopen.
- The **outbox** (`@kitchensink/sync`, `@commise/query/sync`). It queues server writes. It sends them while the
  network is there.
- The **server**. There, every save of a published recipe makes a version.

The outbox shipped with no `submit` call site and no ADR, and its persisted format had never been written to a
device. Its own code recorded two defects owed before the first call site:

- **The clobber.** The drain wrote back the snapshot it loaded. A record that a concurrent `submit` appended in
  between was lost from storage, and the UI still counted it.
- **No backoff.** A transient refusal (`429`, `502`, `503`, `504`) was re-sent three times with no wait.

Review of those two found four more defects on the same path:

- A record that died mid-send was re-sent on relaunch. Its outcome is unknown, so that re-send is the blind retry the
  drainer's rule forbids.
- Every drain re-sent every parked record, an unknown outcome included.
- The ids that a drain resolved were not kept. An update queued after its create had synced was sent with its
  `local:` placeholder.
- "Quarantined" bytes stayed on the outbox key, and the next write destroyed them.

## Decision

### 1. The device draft is a Memento behind the key/value port

`features/recipes/src/editor/draftStore.ts` keeps one recipe's draft as a memento. It sits behind the `OutboxStore`
port, with one adapter per platform, and the app chooses the adapter:

- **Mobile:** AsyncStorage, through the existing `createNativeOutboxStore`.
- **Web:** `sessionStorage`, through `createWebStorageStore(() => window.sessionStorage)`. The draft survives a
  reload in the same tab, and closing the tab ends it (D7). This exception covers the editor draft and nothing else.
  The web outbox stays in memory.

The persisted format is a one-way door, and version 1 is this:

- **Key:** `editor.draft.v1.{subject}`, one key per user, where `subject` is the IdP subject. The app-user ULID does
  not exist before the first online request. One key holds every draft, for three reasons. A rekey and an eviction
  are then one atomic write. The session-end clear is one `removeItem`. And the port cannot list keys, so a key per
  recipe cannot be cleared at all.
- **Value:** `{ formatVersion: 1, drafts: { [recipeRef]: memento } }`.
- **Memento:** `{ recipeRef, baseVersion, values, pendingRebinds, savedAt }`.
    - `recipeRef` is the recipe's local ref (`local:recipe:…`) before the server create, and its server id after.
      After the create resolves, `rekey` moves the draft to the server id.
    - `baseVersion` is the server version the draft was edited from, or `null` before the create.
    - `values` is the form's values without `photos`. A pending photo pick has no bytes in the form, so it cannot
      survive a reload.
    - `pendingRebinds` holds the food re-picks on a published recipe that wait for Save changes, as
      `{ lineKey, target }`.
- **Ids and form values only (D7).** The parse is strict. A field the format does not have makes the whole value
  unreadable. A compile-time test pins the values schema to the form's own type, so a new form field fails `tsc`
  until the format names it.
- **Quarantine.** Bytes that do not parse go to `editor.draft.quarantine.{subject}`, a JSON list of raw strings. The
  main key then starts empty. Only the session-end clear removes the quarantine.
- **Bound.** At most 20 drafts per user (`MAX_KEPT_DRAFTS`). The least recently saved goes first, so an abandoned
  draft cannot grow the key until a write fails for quota and loses the draft being typed.
- **One writer.** Every read-modify-write of the key runs in a serial queue (`createSerialQueue`).

The editor writes the draft on every trigger: one second after typing stops, on blur, on a section change, on hide,
on exit, and on Save changes or Publish.

### 2. A checkpoint promotes the draft to a server write, by lifecycle

`features/recipes/src/editor/checkpointPolicy.ts` is one pure decision with a Strategy for each lifecycle:

- **Unsaved** (no server record): the first checkpoint at which the draft floor passes sends a `create` (A4). Until
  then the recipe exists only on the device. No client id is sent.
- **Never published:** each checkpoint sends an `update`, and it writes no version (ADR-0058). Publish sends the
  update with `status: 'published'`.
- **Published:** only Save changes writes. A draft equal to the server's copy sends nothing. Every other change
  waits on the device (D1).

The checkpoints are these: a section change, the editor's exit, the app going to the background, Save changes and
Publish. Ten seconds of idle typing (`SERVER_CHECKPOINT_IDLE_MS`) is a checkpoint too. Typing and blur never reach the server. A write that fails the
draft floor is never asked for, because the server refuses it with a `400` at every trigger.

The policy reads the lifecycle from `status`. The server reads `first_published_at` (ADR-0058). The two agree on
every recipe a client can produce, because no client sets a published recipe back to draft. A client that adds that
control needs the fact on the wire first.

Save changes on a published recipe first sends the memento's `pendingRebinds` through the rebind command. Each makes
a version and teaches a correction (ADR-0045). The editor adopts the version each returns, and then sends the one
`update`.

### 3. The outbox has one writer, and its format is fixed

`@kitchensink/sync` owns the format. Version 1 (`LOCAL_SCHEMA_VERSION`) is this:

- **Key:** `sync.outbox.v1.{subject}`.
- **Value:** `{ schemaVersion: 1, nextSeq, resolutions, pausedUntil?, records }`.
    - `nextSeq` is the next record's sequence number. It only goes up, so no number is ever reused.
    - `resolutions` maps each local ref a drain resolved to its server id. It is kept, so an intent queued after its
      producer synced still gets the id.
    - `pausedUntil` is the time before which no record is sent. A long wait the server stated sets it.
    - Each record is the intent plus `seq` and `state`. A parked record also has `lastStatus`. The states are
      `pending`, `sending`, `blocked` and `parked`.
- **Quarantine:** `sync.outbox.quarantine.{subject}`, the same list format as the draft's.
- **Compatibility** keys on the hand-bumped `LOCAL_SCHEMA_VERSION`, never on `CONTRACT_HASH`. That hash moves on a
  comment-only edit.

Nothing wrote an outbox before this format was fixed, so version 1 was not bumped for it.

The rules on top of the format:

- **One writer.** `outboxMutatorFor(store, subject)` returns the one mutator for an outbox. Each change is a pure
  function of the log as the store holds it at that moment, applied one at a time. React state only mirrors what the
  mutator wrote. The mutator never holds its queue across a network request, so a `submit` never waits on the network.
- **Every send is claimed, then journalled.** The drain walks a snapshot over network time. Before a send, it claims
  the record against the log as stored now (`claimForSending`), and the claim marks it `sending`. A record the cook
  replaced or deleted since the snapshot cannot be claimed, so the drain neither sends nor settles it. After the
  answer, the drain settles the record by `seq`.
- **A payload never carries a placeholder.** A record with a dependency this drain did not resolve waits, pending, for
  a later drain.
- **A delete supersedes.** `submit` routes a delete through `supersede`, so it removes the queued writes it makes moot.
  Supersession refuses to drop a parked record silently, and the caller then asks the cook.
- **An interrupted send is an unknown outcome.** The first read of a process parks every record a dead process left
  `sending`, with no status. No drain sends a record that is already `sending`.
- **A re-send that cannot write twice is the only re-send of a parked record.** Two cases qualify: a transient
  refusal, and `401`, where the sender refused because its cook was signed out. An unknown outcome, a conflict and a
  terminal refusal wait for the cook.
- **A record on the wire is never replaced.** A new edit of the same entity is appended beside it. A delete of an
  entity whose create is on the wire waits behind that create and depends on its ref.
- **Backoff.** A transient refusal is re-sent at most three times in all. Each wait is a uniform draw under a ceiling
  that starts at 500 ms and doubles, up to 8 s ("full jitter"). The wait is never shorter than the server's
  `Retry-After`. A wait over 10 s (`MAX_INLINE_WAIT_MS`) ends the drain, leaves the record pending, and sets
  `pausedUntil`. No drain sends anything before that time, whatever triggers it. At the end of the wait, the
  provider drains again.

### 4. One save status, with the store named

`features/recipes/src/editor/saveStatus.ts` derives one status from the draft, the outbox and the server. A parked
write comes first, then "saved", then "syncing", then what the device draft says. The status names where the draft is
kept: `disk` on mobile, `tabSession` on web. "Saved on this device" is true on mobile and false on web, so the copy is
per platform. The UX engineer writes it.

## Consequences

- **The web draft is at rest in the browser profile while its tab is open.** D7 accepts this for ids and form values,
  and nothing else of the app is kept there.
- **On web, closing the tab loses changes to a published recipe that wait for Save changes.** D7 accepts this. The
  status names `tabSession`, so the copy can say it.
- **The session-end clear must reach both stores.** `signOutAndVerify` (ADR-0009, ADR-0054) must call the draft
  store's `clear` and remove the outbox key after the session is proven ended. The slice 7 wiring owes this.
- **The editor owns the CAS token across consecutive updates.** Each `update` carries an `expectedVersion`. Take an
  edit queued while an earlier update is on the wire. It carries the version the earlier one started from. So its send
  meets a 409 against the cook's own write. The editor must send the next update from the version the last answer
  returned. The outbox does not rewrite payloads.
- **The sender must pass `Retry-After` to the drain.** `SendResult` carries `retryAfterSeconds`, and
  `@kitchensink/retry-after` parses the header. `RecipeServiceClientError` carries no response headers, so
  `recipeSender` cannot pass it yet. Until the client exposes it, the backoff alone governs.
- **A failure that arrives after the editor closed has no screen to show it.** The outbox reports it through
  `useSyncQueue().failures`. Where a cook sees it is the slice 7 UI's question.
- **Outbox intents still owed:** `removeMember` and `clone` have no intent kind, and `recipeSender` sends only recipe
  create, update and delete.

## Alternatives rejected

- **One key per recipe draft.** The port cannot list keys, so the session-end clear cannot find them, and a rekey
  becomes two writes that can tear.
- **IndexedDB on web.** The owner's ruling of 2026-09-17 keeps durable app data out of the browser. D7 relaxes that
  for the editor draft in `sessionStorage` only.
- **Hold the mutator's queue across the whole drain.** Simpler, but every `submit` then waits for the network, which
  the offline model forbids.
- **`p-retry` for the backoff.** It retries a function that throws, and this sender never throws by contract. It also
  cannot end a serial drain early and hand the wait back. The jitter formula is three lines.
- **Re-send an interrupted record on relaunch.** It is at-least-once delivery behind the cook's back. Every server
  endpoint then needs idempotency, which the no-blind-retry rule removed.

## Verification

- `packages/shared/sync/src/__tests__/`: `outboxLog`, `drainer`, `outboxMutator`, `outboxStore`, `serialQueue` and
  `webStorageStore` tests, each with a mutation that the suite was run against.
- `packages/apps/commise/query/src/__tests__/syncProvider.test.tsx`: the clobber, the failure projection after a
  relaunch, and the scheduled re-drain after a long `Retry-After`.
- `packages/apps/commise/query/tests/__integration__/offlineWritePath.integration.test.tsx`: the provider, the
  mutator, the drainer, `recipeSender` and the real client together, with `fetch` mocked.
- `packages/apps/commise/features/recipes/src/editor/__tests__/`: `draftStore`, `checkpointPolicy` and `saveStatus`
  tables.
- `packages/apps/commise/features/recipes/tests/__integration__/editorDraftStore.integration.test.ts`: the draft
  store over jsdom's real `sessionStorage`, with values seeded by the real wire mapping.
