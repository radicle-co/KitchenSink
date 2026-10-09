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
      A write's answer is recorded by `adopt(ref, { serverId, version })`: a create's moves the draft to the server
      id, and every answer raises `baseVersion`. Neither `adopt` nor `save` ever lowers it, so the editor and the
      outbox observer (below) can both write and the last one cannot regress the token.
    - `baseVersion` is the server version the draft was edited from, or `null` before the create.
    - `values` is the form's values without `photos`. A pending photo pick has no bytes in the form, so it cannot
      survive a reload. A line's amount the cook has not stated is `NaN` in the form; JSON writes it as `null`, and
      the format reads `null` back as `NaN`, so an amount-less line is a normal draft, not an unreadable one.
    - `pendingRebinds` holds the food re-picks on a published recipe that wait for Save changes, as
      `{ lineKey, target }`.
- **Ids and form values only (D7).** The parse is strict. A field the format does not have makes the whole value
  unreadable. A compile-time test pins the values schema to the form's own type, so a new form field fails `tsc`
  until the format names it.
- **Quarantine.** Bytes that do not parse go to `editor.draft.quarantine.{subject}`, a JSON list of raw strings. The
  main key then starts empty. Only the session-end clear removes the quarantine.
- **Bound.** At most 20 drafts per user (`MAX_KEPT_DRAFTS`). The least recently saved goes first, so an abandoned
  draft cannot grow the key until a write fails for quota and loses the draft being typed.
- **One writer.** Every read-modify-write of the key runs in a serial queue (`createSerialQueue`), and every caller
  shares one store per port and cook (`draftStoreFor`), so the queue really is one.

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
Publish. Every way out of the editor is its exit: ×, and on native the system Back and the edge swipe too (build spec
§3.5). The native screen hears those through React Navigation's `beforeRemove`. Ten seconds of idle typing (`SERVER_CHECKPOINT_IDLE_MS`) is a checkpoint too. Typing and blur never reach the server. A write that fails the
draft floor is never asked for, because the server refuses it with a `400` at every trigger.

The policy reads the lifecycle from `status`. The server reads `first_published_at` (ADR-0058). The two agree on
every recipe a client can produce, because no client sets a published recipe back to draft. A client that adds that
control needs the fact on the wire first.

The rebind command (ADR-0045) is a direct write, not an outbox intent: each rebind needs the version the previous
answer returned, which an intent cannot carry without the outbox rewriting payloads. Like paste (blueprint A5) it is
non-deferrable. It runs only while the editor has no server write outstanding, holds the editor's lane while it runs,
and adopts the version it returns. On a published recipe it still writes at once; the memento's `pendingRebinds`,
which would hold re-picks until Save changes, is in the format and stays empty until that is built.

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
- **A record on the wire is never replaced, and neither is a parked one.** A parked record is work the cook was told
  about and has not decided on — a create parked with an unknown outcome may exist on the server, and replacing its
  body would send a second create. It leaves the log only through `withdraw(seq)`, which refuses any record that is not
  parked. A delete of an entity whose create is on the wire waits behind that create and depends on its ref.
- **The editor submits exclusively.** `submitExclusive` (`appendExclusive`) queues a create or an update only while no
  record of the same entity is on the wire or parked, and answers which record stood in the way. A pending one of the
  same kind is replaced, losslessly, because the editor sends whole drafts. The check is made inside the serialized
  mutation, so it cannot race the drain's claim.
- **Answers travel back in memory.** A sender's `SendResult` may carry an `answer` (the recipe a write returned, a
  409's two sides). The drain hands each synced or parked record's settlement, with its answer and its `seq`, to an
  `onSettled` listener after the journal wrote it; the provider publishes it to `SyncQueue.subscribe`. Nothing of an
  answer is stored: the durable facts already have homes (the resolutions here, the version in the device draft).
- **An unknown update may be sent again; an unknown create needs the cook.** An update names its version, so a second
  copy of one that did land meets a 409 and the conflict view rather than a second write. A create has no such token,
  so the editor tells the cook to look in My recipes first.
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
- **The session-end clear reaches both stores.** `signOutAndVerify` (ADR-0009, ADR-0054) takes the app's
  `endDeviceSession` and runs it only once the session is proven ended: it clears the cook's draft store and removes
  their outbox key and its quarantine. A failed sign-out keeps both.
- **The editor owns the CAS token across consecutive updates.** Each `update` carries an `expectedVersion`, and an
  update sent while an earlier one is on the wire would name the version the earlier one started from and meet a 409
  against the cook's own write. So the editor keeps ONE server write per recipe in flight (`editor/writeLane.ts`): a
  checkpoint that meets a write on the wire is deferred, and runs against the version the answer returned. Updates
  start only once the create has answered; before that a checkpoint re-submits the create, which the outbox
  coalesces. The lane is held outside React state, because an answer can land before React renders the write it
  answers. The outbox does not rewrite payloads.
- **The lane also records that the editor closed.** Publish, Save changes, Discard and the conflict's hand-offs close
  it, and a closed lane runs no checkpoint and writes no device draft. This is lane state for the same reason: a
  navigator announces a leave synchronously, inside the hand-off, so the exit checkpoint it triggers arrives before
  React renders the close. If the close were React state, that checkpoint would write a discarded draft back to the
  device.
- **Visibility follows the write's answer.** Visibility has its own endpoint and policy (C-004), so after Publish or
  Save changes the app sends it only when the cook's choice differs from the visibility in that write's ANSWER
  (`editor/visibilityFollowUp.ts`). A new recipe has no earlier read to compare against, and its create can go out
  public at the draft floor before the cook chooses private.
- **The sender must pass `Retry-After` to the drain.** `SendResult` carries `retryAfterSeconds`, and
  `@kitchensink/retry-after` parses the header. `RecipeServiceClientError` carries no response headers, so
  `recipeSender` cannot pass it yet. Until the client exposes it, the backoff alone governs.
- **An answer that arrives after the editor closed still reaches the device draft.** Each app mounts one observer of
  the settlement bus (`useDraftAnswers`) that adopts every synced recipe write into the cook's draft store. A
  FAILURE that arrives then is reported through `useSyncQueue().failures`, and the editor, reopened, finds its recipe's
  parked write there and offers the cook the choice.
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
- `packages/shared/sync/src/__tests__/outboxLog.test.ts` (`appendExclusive`, `withdraw`, a parked record never
  coalesced) and `drainer.test.ts` (settlement events after the journal, with the sender's answer).
- `packages/apps/commise/query/src/__tests__/syncProvider.test.tsx` (the exclusive submit, replies, withdrawal and
  resolutions), `recipeSender.test.ts` (a write's answer, a 409's two sides) and `recipeWriteCacheObserver.test.tsx`.
- `packages/apps/commise/features/recipes/src/hooks/__tests__/useRecipeEditor.test.tsx`: the lane — one write in
  flight, the deferred checkpoint at the answered version, an answer before the editor knew its record, the 409 and
  its resolutions through `withdraw`, and a checkpoint in the same tick as Discard writing nothing — and
  `editor/__tests__/writeLane.test.ts`, `useDraftAnswers.test.tsx`.
- `mobile/tests/screens/RecipeEditorScreen.native.test.tsx`: a leave that is not × still creates a titled new recipe.
  It and `web/tests/components/recipes/RecipeEditorContainer.test.tsx` send the visibility the answer lacks.
- `packages/apps/commise/features/recipes/tests/__integration__/lineCommit.integration.test.tsx`: the rebind command
  and Save changes in order, over a real outbox and the real client.
- `features-account`'s `signOutAndVerify.test.ts` and both apps' sign-out adapters: the session-end clear runs after
  the proof, never before it, and `web/src/components/recipes/__tests__/deviceSession.test.ts` clears one cook's
  stores and not another's.
