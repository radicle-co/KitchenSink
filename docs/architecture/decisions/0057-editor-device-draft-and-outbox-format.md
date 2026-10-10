# 0057 — The editor keeps a device draft, promotes it at checkpoints, and the outbox has one writer and a fixed format

- **Status**: Accepted
- **Date**: 2026-10-08
- **Drivers**: Owner rulings D1, D7 and D9 (`docs/design/uiOverhaul/ownerDecisions.md`). D1 makes create and edit one
  scrolling editor with autosave, where a published recipe saves to the device until the cook presses "Save
  changes". D7, as the owner amended it on 2026-10-09, keeps the web editor's draft and its unsent saves (the outbox
  journal, ids and form values only) in `sessionStorage`, and signing out clears both. D9 stops a never-published draft
  from making versions.
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
- **Web:** `sessionStorage`, through `createWebStorageStore(() => window.sessionStorage, { isCopy })`. The draft
  survives a reload in the same tab, and closing the tab ends it (D7). The web outbox journal is kept there too, for the
  same lifetime (§3). This exception covers the editor's draft and the editor's unsent saves, and nothing else (D7, as amended).
- **One store object per app** (`webDeviceStore`, `nativeDeviceStore`). `draftStoreFor` and `outboxMutatorFor` each
  memoize one serial writer per store OBJECT, so the editor, the outbox observer, `SyncProvider` and the session end
  share their writers only while they share one object.

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
Publish. Every way out of the editor is its exit (build spec §3.5): ×; on native the system Back and the edge swipe,
heard through React Navigation's `beforeRemove`; and on both platforms the editor unmounting, which is the only signal
the web has for browser Back or a shell link. A second exit does nothing: it meets the first one's write on the wire,
finds nothing changed, or finds the lane closed by a hand-off. The unmount's checkpoint runs at the cleanup itself,
never deferred, because a session end clears the cook's stores from the provider's effect in the same commit, after
that cleanup; deferred, the checkpoint would write the signed-out cook's draft and journal back. (React's StrictMode
runs it once at mount in development; an untouched editor writes nothing there.) The app going to the background is
heard as an event, each change from focused to not, so an editor opened in the background raises nothing. Ten seconds of idle typing (`SERVER_CHECKPOINT_IDLE_MS`) is a checkpoint too. Typing and blur never reach the server. A write that fails the
draft floor is never asked for, because the server refuses it with a `400` at every trigger.

The policy reads the lifecycle from the first publish, the same fact the server versions by (ADR-0058 rule 1). The
recipe read and every write's answer carry it as `firstPublishedAt`, absent until the first publish. A recipe set back
to draft through the API therefore stays `published` to the editor: its changes wait for Save changes, and it offers
no paste. A read without the field falls back to `status = published`, which the service's own CHECK makes imply a
first publish. The same lifecycle gates Paste a list (`pasteOffered`, D10: until the first publish) and decides whether
a pasted line keeps its source (`pastedLineKeepsSource`: only until the create is submitted). A paste still joining
holds the create, except on the editor's exit.

The rebind command (ADR-0045) is a direct write, not an outbox intent: each rebind needs the version the previous
answer returned, which an intent cannot carry without the outbox rewriting payloads. It runs only while the editor has
no server write outstanding, holds the editor's lane while it runs, and adopts the version it returns. On a
never-published draft it runs at once, because it makes no version (ADR-0058). On a published recipe it is held until
Save changes, because every write of that recipe makes a version (D1):

- The pick's food is admitted, which writes the catalog and makes no recipe version, and the line shows it at once.
- The rebind waits in the memento's `pendingRebinds`, one per line, the later re-pick winning. Discard drops the ones
  still waiting, with the rest of the device draft. It cannot undo one that already landed: if Save changes sent
  rebind k and then rebind k + 1 failed, k has made its version and taught its correction, and Discard leaves it on the
  server while dropping k + 1 onward and the update.
- Save changes drains the held rebinds through the same command queue, each at the version the previous answer
  returned, and only then sends its one update. A held rebind whose line the cook removed is dropped. A rebind that
  fails stops the save and goes back to waiting, with the ones behind it; Retry runs the save again.
- So a published recipe still gains one version per re-pick at Save changes, plus the update (blueprint A3's N + 1).

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
- **Where it is kept:** AsyncStorage on mobile, and the tab's `sessionStorage` on web. The journal must live at least
  as long as the draft its records came from. The no-blind-retry rule below parks an unknown outcome for the cook, and
  that only prevents a second write while the parked record exists. An in-memory web journal under a draft that
  survives a reload forgets a create that was on the wire, and the reopened editor sends it again: a second recipe.
  Kept beside the draft, the reload finds the record, the first read parks it, and the cook decides. Closing the tab
  ends both. The editor is the journal's only writer, so it holds ids and form values only (D7).
- **One owner per journal.** Duplicate Tab copies `sessionStorage`, the journal included, and both tabs would send the
  same pending create. So the web store answers `isCopy` (`createTabCopyProbe`): each live tab holds a Web Lock named
  by an instance id kept in its session storage. A tab that finds an id another live tab's lock holds is a copy; it
  mints its own id and lock, so a duplicate of a duplicate is caught too. Where Web Locks is missing, every first read
  is treated as a copy. No wire change.
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
  `sending`, with no status. No drain sends a record that is already `sending`. When the store says its journal may be
  a copy, the first read also parks every queued record whose second copy would make a second row (`create`,
  `createFreeform`, `upload`); updates stay queued, because a second copy of one meets a 409.
- **A re-send that cannot write twice is the only re-send of a parked record.** Two cases qualify: a transient
  refusal, and `401`, where the sender refused because its cook was signed out. An unknown outcome, a conflict and a
  terminal refusal wait for the cook.
- **A record on the wire is never replaced, and neither is a parked one.** A parked record is work the cook was told
  about and has not decided on — a create parked with an unknown outcome may exist on the server, and replacing its
  body would send a second create. It leaves the log only through `withdraw(seq)`, which refuses any record that is not
  parked. A delete of an entity whose create is on the wire waits behind that create and depends on its ref. Withdrawing
  that create also removes that delete: no id will ever exist for the entity, so the delete would wait forever. Only
  that delete: anything else waiting on the ref is the cook's work, and the editor's Retry resubmits a withdrawn create
  under the same ref. A delete whose ref no record still produces and no drain resolved is never queued at all
  (`supersede`): it names an entity the server never held.
- **Discard waits for a create on the wire.** The editor is `withdraw`'s only caller, so a create that parked after its
  editor had closed had no surface to be withdrawn from. A Discard of a recipe only a create can have made therefore
  submits its delete exclusively: the outbox removes a create still queued, reports a parked one for the editor to
  withdraw, and reports one on the wire while queueing nothing. The editor then waits for that create's answer, the
  confirm busy and the editor mounted: synced, it deletes the recipe by its id; parked, it withdraws it. The wait is
  bounded by the recipe client's request timeout (`DEFAULT_REQUEST_TIMEOUT_MS`), and an editor that unmounts during it
  finishes the same way. A single attempt that never answers parks at that same per-attempt timeout, which started
  before the press, so it is withdrawn before the bound; only transient retries or a `401` replay can stretch a send
  past it. Past the bound the delete is queued behind the create, as before, so a create that still syncs is deleted;
  one that parks after the bound keeps its delete beside it until the session ends. Keep, while the confirm is busy,
  takes the Discard back: nothing has been queued or dropped by then.
- **The session-end clear is one more change in the same queue.** `clear()` runs behind every change asked for before
  it, and a change that leaves no records is never written over an absent key, so a drain's answer that lands after the
  clear cannot bring the old cook's journal back.
- **The editor submits exclusively.** `submitExclusive` (`appendExclusive`) queues a create or an update only while no
  record of the same entity is on the wire or parked, and answers which record stood in the way. A pending one of the
  same kind is replaced, losslessly, because the editor sends whole drafts. The check is made inside the serialized
  mutation, so it cannot race the drain's claim.
- **One recipe, one lane, across editors of it.** A create whose ref already resolved is refused first, with the
  server id (`resolved`): its synced record has left the log, so nothing else would stand in its way, and an editor
  reopened by Back and Forward that never heard the answer would create the recipe twice. That editor reads the recipe
  and continues as stored. An editor told that a record of its recipe it does not hold is on the wire tracks that
  record's number, so the answer is its own; it adopts the values from the answer, because it never saw the body.
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
- **On web, closing the tab loses whatever the server does not hold yet**: a published recipe's changes that wait for
  Save changes, and a draft's last checkpoint that has not reached the server. D7 accepts this. The status names
  `tabSession`, so the copy can say it, and the browser's own unload prompt is armed in every such state
  (`closingTabLosesWork`).
- **Duplicating a tab copies its `sessionStorage`**, the outbox journal included. The copy's first read parks its
  pending creates (§3, one owner per journal), so a create cannot reach the server twice; the cook decides in the copy.
  What remains: the copy's pending updates stay queued in both tabs, and the second to land meets a 409 and the conflict
  view rather than a second write; without Web Locks (an insecure origin) a plain reload also parks a pending create,
  which costs the cook a decision but never a duplicate; and a reload the browser reports while the old document still
  holds its lock would read as a copy, failing the same safe way.
- **The session-end clear reaches both stores, and on web every way a session ends.** One `endDeviceSession(store,
subject)` (`@commise/features-recipes`, both apps bind it to their store) clears the cook's draft store and outbox,
  each through its own writer, and the tab's cook marks. It runs from `signOutAndVerify` (ADR-0009, ADR-0054) only once
  the session is proven ended, so a failed sign-out keeps both. On web it also runs whenever Clerk's cook changes from a
  cook to `null` or to another cook (`useDeviceSessionScope`): a sign-out in another tab, an expiry or revocation, the
  UserButton. Clerk's loading `undefined` is ignored. The cook those stores were kept for is recorded in the same store
  (an IdP subject, nothing else), so a reload is no gap: a first value of `null` or of another cook after it still
  ends the first cook's session. The editor is keyed by the cook, so a switch remounts it and the first cook's exit
  checkpoint runs against their own stores before the clear. Mobile clears on its own sign-out only; whether an expired
  session on a phone should discard unsent saves is an open owner question.
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
  for the editor's draft and its pending writes in `sessionStorage` only.
- **An idempotency key on create, with the web journal left in memory.** It would close the reload duplicate too, and
  the Duplicate Tab one as well. It is refused by the governing offline ruling — no client-supplied id, and zero server
  changes — not by its cost: giving the journal the draft's lifetime and one owner per tab closes both without either.
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
- `packages/apps/commise/features/recipes/src/editor/__tests__/`: `draftStore`, `checkpointPolicy` (the lifecycle of a
  recipe set back to draft, the paste gate and the paste hold) and `saveStatus` (`closingTabLosesWork`) tables.
- `recipe-service`'s `recipeRowToDomain.test.ts` and `draftVersioning.integration.test.ts`: `firstPublishedAt` on the
  wire, absent on a draft and kept after the recipe is set back to draft.
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
  at once on a draft, and on a published recipe held until Save changes, then sent before its update, over a real
  outbox and the real client. `useRecipeEditor.test.tsx` covers the held rebinds' drain, Discard and Retry.
- `web/src/components/recipes/__tests__/deviceSession.test.ts`: the web outbox journal is kept in the tab's session
  storage, and without Web Locks its first read parks a pending create.
- `packages/shared/sync/src/__tests__/tabCopyProbe.test.ts` (fresh tab, reload, duplicate, a duplicate of a duplicate,
  no Web Locks), `outboxLog.test.ts` (`recoverInterrupted` over a copy, a withdrawal taking its superseding delete) and
  `outboxMutator.test.ts` (the copy probe on the first read, the queued `clear`, no key brought back after it).
- `outboxLog.test.ts` (a create of a resolved ref refused; a delete decided against a create queued, on the wire,
  parked, synced or never made), `useRecipeEditor.test.tsx` (a second editor of a recipe whose create the first
  queued; Discard waiting for a create on the wire, each answer, the bound, Keep and an unmount) and, over the real
  outbox, `editorReopenedOnItsCreate.integration.test.tsx` and `editorDiscard.integration.test.tsx`.
- The cook switch: `web/tests/components/recipes/RecipeEditorContainer.test.tsx` and
  `mobile/tests/screens/RecipeEditorScreen.native.test.tsx` (the first cook's exit checkpoint in their own outbox).
- `features-recipes`'s `session/__tests__/deviceSession.test.tsx` (one clear, its triggers, the loading `undefined`, a
  reload followed by nobody or by another cook)
  and `sessionEndWithEditorOpen.test.tsx` (the editor's exit checkpoint and the clear in one commit: nothing left);
  `editor/__tests__/useRecipeEditorSession.test.tsx` (the unmount is a leave; a second exit does nothing) and
  `useEditorPage.test.tsx` (the background as an event).
- `web/tests/e2e/recipeEditor.spec.ts` "leaving the one-page editor and coming back": browser Back creates a titled
  recipe; a reload and Back after the first save open that recipe, never a second.
- `features-account`'s `signOutAndVerify.test.ts` and both apps' sign-out adapters: the session-end clear runs after
  the proof, never before it, and `web/src/components/recipes/__tests__/deviceSession.test.ts` clears one cook's
  stores and not another's.
