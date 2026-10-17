---
title: "fix: settle stuck saves after Discard, and keep a phone's unsent saves when its session expires"
type: fix
date: 2026-10-13
---

# Stuck saves after Discard, and phone session expiry

## Owner ruling (2026-10-13)

The owner delegated both items ("just do them all"). The decisions below are the coordinator's, from the
staff-architect blueprint of the same day.

## Governing decisions

- ADR-0057 §2: no client id is sent on create. An idempotency key on create is refused. Do not re-propose it.
- ADR-0057 §3: a re-send that cannot write twice is the only re-send of a parked record. Supersession refuses to drop
  a parked record silently, and the caller then asks the cook.
- ADR-0054 §4: queued writes stay with their cook, namespaced by the cook, and drain after that cook signs in again.
- `adrHygiene.test.ts`: ADR text is edited in place (no Update sections, dated stamps or strike-throughs).

## Facts

- Create carries no client id (`createRecipeRequestSchema`, `recipeWriteIntent`).
- Update carries `expectedVersion`. The CAS check in `recipes.service.ts` answers a re-send with `409`.
- Delete is a soft delete. A second delete gets `404`. No route undeletes a recipe.

## Where a record gets stuck today

1. The bounded wait runs out and the create parks later (`discardBehindCreate` in `useRecipeEditor.ts`). The parked
   create stays, and the delete waiting on its ref is marked `blocked` by `drainer.ts`. `withdraw`'s `strands` in
   `outboxLog.ts` only matches a `pending` delete, so the blocked one survives even a manual withdraw.
2. The create parks just before `discardBehindCreate` runs. `submit` uses `supersede`, which throws on a parked record
   (`outboxLog.ts`, `syncProvider.tsx`). The `.catch(() => undefined)` swallows it, so the parked create is orphaned
   with no delete. The same race exists in `discard()` for an update that parks between the plan and the submit, and
   there the rejection is unhandled.
3. A never-published recipe is deleted while its update was on the wire. The update parks, the delete syncs, and the
   parked update stays forever.
4. A delete times out (unknown outcome) and parks forever. A delete that gets `404` also parks forever as terminal.
5. A published recipe has a parked earlier Save changes, and the cook presses Discard. `discardPlanOf` returns
   `withdraw: undefined` (`editorIntents.ts`), so the parked update outlives the Discard.

Effect: `recoveringOf` (`syncNoticeState.ts`) keeps "Syncing 1" up forever.

## Decisions

1. The outbox settles moot records itself, in the same serialized mutation, from facts in the log. A delete waiting
   on a parked create is the cook's consent. A synced delete makes every parked write of that entity pointless.
2. A delete can be re-sent after an unknown outcome, because it cannot write twice. A `404` on a delete means done.
3. Discard becomes one atomic consented change, `SyncQueue.discard`, instead of withdraw-then-submit.
4. A published Discard withdraws a parked write.
5. The stored format does not change: no new field, state or kind, and `LOCAL_SCHEMA_VERSION` stays 1.
6. Phone sessions: keep on expiry, clear only on sign-out, close or erase. A token request that fails parks as `401`
   (resumes), never as `unknown`. The per-subject keys `editor.draft.v1.{subject}` and `sync.outbox.v1.{subject}`
   already keep one cook's records from another cook on the same phone.

## Discard for each record state

| State     | Never published, only a create                                              | Never published, server holds it                                          | Published                                                    |
| --------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `pending` | Both go (supersede, as today)                                               | The delete replaces the update (as today)                                 | Kept: an earlier Save changes on its way                     |
| `sending` | Bounded wait, then a delete behind it. New: if it parks later, both go      | A delete behind it. New: when the delete syncs, a parked update goes      | Left alone (residual risk)                                   |
| `parked`  | Withdraw. The confirm says "can be saved" for an unknown outcome (as today) | Withdraw, then delete, in one mutation. New: an unknown delete is re-sent | New: withdraw it. The confirm says changes can already stand |
| `blocked` | Leaves with its producer (fix: `strands` includes `blocked`)                | n/a                                                                       | n/a                                                          |

Behavior is the same on web and mobile. Only the store adapter differs.

## Components

Sync domain, `packages/shared/sync/src/`:

- `outboxLog.ts`: new pure `withdrawMoot(log)`. For each parked create whose `produces` ref is unresolved and that has
  a `pending` or `blocked` delete of the same entity waiting on it, withdraw both. Call it from `settle` (the `parked`
  branch) and from `recoverInterrupted`. In `settle`'s `synced` branch, a settled delete withdraws every parked record
  that concerns its entity. `withdraw`'s `strands` also matches `blocked`. New pure `discardEntity(log, deleteIntent)`:
  withdraw the parked records the delete makes moot, then supersede. It never throws on a parked record and knows
  nothing about the UI. JSDoc: `@pattern Specification` on `withdrawMoot`. A Tombstone note on the waiting delete.
- `drainer.ts` (`sendable`): a parked delete with no status is sendable.
- `index.ts` (the package export): export `discardEntity`.

Query layer, `packages/apps/commise/query/src/`:

- `recipeSender.ts`: in the delete case, not-found becomes `{ outcome: 'ok', serverId: id }`, for delete only. The
  JSDoc states the dependency: no undelete route exists.
- `syncProvider.tsx`: `discard(intent)` on `SyncQueue` and `NOT_MOUNTED`, one mutation over `discardEntity`, then a
  flush.

Editor, `packages/apps/commise/features/recipes/`:

- `src/hooks/useRecipeEditor.ts`: the port gains `discard`. `discard()` and `discardBehindCreate` call
  `port.discard(remove.intent)` instead of the withdraw and submit chain.
- `src/editor/editorIntents.ts` (`discardPlanOf`): the published branch returns `withdraw: parked?.seq` and a new flag
  `savedChangesMayStand`, true when that parked write's class is `unknown`.
- `src/editor/editorChrome.ts`: the published confirm body switches on that flag. The copy and its localization key
  come from staff-ux-engineer (SPECIFY), for both platforms.
- `tests/__integration__/outboxPort.ts`: add `discard`.

Session expiry:

- `packages/apps/commise/features/account/src/session/subjectBoundToken.ts`: translate a rejection of the inner mint
  into a new `TokenMintFailedError` (with `cause`, `Object.setPrototypeOf` and an `isTokenMintFailedError` guard).
  `SessionSubjectChangedError` passes through unchanged. Still `@pattern Protection Proxy`.
- `recipeSender.ts` (`failureFor`): `isTokenMintFailedError` maps to `SESSION_ENDED` (401).
- `packages/apps/commise/mobile/src/storage/deviceSession.ts`: replace the open-question note with the rule.

Docs: ADR-0057, edited in place. The §3 re-send bullet adds delete, §3 adds the moot-settle rule, the §3 Discard bullet
drops "keeps its delete beside it until the session ends", and the mobile expiry sentence in Consequences becomes a
decision. The CLAUDE.md ADR-0057 bullet gains one clause: a delete is the one parked record that is re-sent, because
its second copy meets a 404.

## Build order (each step leaves the tree green)

1. Sync domain. Reds first: `outboxLog.test.ts`, `drainer.test.ts`.
2. Query layer: the `recipeSender` delete 404, `SyncQueue.discard`, the `offlineWritePath` integration test.
3. Editor: `port.discard`, the published withdraw, the UX copy. Web and native component tests land in the same slice.
4. Session expiry: `TokenMintFailedError` and its mapping, the mobile gate tests, the ADR wording.
5. Playwright and Maestro, then the ADR and CLAUDE.md text.

## Tests (each written failing first)

Unit:

- `packages/shared/sync/src/__tests__/outboxLog.test.ts`: a `withdrawMoot` table over status (none, 401, 400, 503)
  by delete state (`pending`, `blocked`). Counter-cases: no delete (the create stays), a resolved ref (no change),
  another entity (untouched), and the `recoverInterrupted` path. A synced delete withdraws the parked update,
  `setVisibility` and `addMember` of its entity only. A synced update withdraws nothing. `discardEntity`: a parked
  create leaves nothing queued. A parked update is withdrawn and a delete is queued. A sending record gets a delete
  behind it. It never throws. `withdraw` with a `blocked` delete.
- `drainer.test.ts`: an unknown parked delete is re-sent. Unknown create and update are still not re-sent (keep pin).
- `packages/apps/commise/query/src/__tests__/recipeSender.test.ts`: delete 404 is ok. Create and update 404 stay
  failures. `TokenMintFailedError` is 401. A plain error with no status is still unknown.
- `syncProvider.test.tsx`: `discard` is one mutation. When a create parks between the editor's decision and `discard`,
  nothing rejects and the log ends empty.
- The features-account `subjectBoundToken` test: the cause is wrapped. `SessionSubjectChangedError` is unchanged.
- `query/src/__tests__/retryPolicy.test.ts`: a read that fails with the wrapped error is still retried.

Integration:

- `query/tests/__integration__/offlineWritePath.integration.test.tsx`: a create times out with a delete queued behind
  it, and the log ends empty with no second POST and no DELETE. An update gets 409 and the delete 204, and the log
  ends empty. A delete times out, is re-sent and gets 404, and the log ends empty.
- `features/recipes/tests/__integration__/editorDiscard.integration.test.tsx`: the wait runs out, then the create parks
  unknown, and the outbox ends empty. The same with the editor unmounted mid-wait. A published recipe with a parked
  update, then Discard, and the outbox ends empty.

Component:

- `editor/__tests__/editorIntents.test.ts`: a `discardPlanOf` table, published by `pending`/`sending`/`parked`.
- `useRecipeEditor.test.tsx`: a published Discard withdraws. The `discardBehindCreate` race.
- `web/tests/components/recipes/RecipeEditorContainer.test.tsx` and
  `mobile/tests/screens/RecipeEditorScreen.native.test.tsx`: a published recipe with a parked write; Discard shows the
  "can already be saved" body, leaves for the recipe, and the failure is gone.
- `mobile/tests/providers/RecipeServiceGate.native.test.tsx`: cook A goes to `null` with no sign-out, and A's
  `editor.draft.v1.A` and `sync.outbox.v1.A` survive. Cook B signs in and sees pending 0 and no drafts while A's keys
  remain; A signs in again, the records reappear, and a 401-parked record drains.

Playwright, `web/tests/e2e/recipeEditor.spec.ts`: hold `POST /api/v1/recipes` past the 10 s bound, then abort it;
Discard. No sync notice, no second POST, no DELETE. Answer `PATCH` with 500 on Save changes. Reopen, Discard, reopen;
no failure alert. These mocks hold only where no live recipe-service is reachable (the SSR prefetch problem).

Maestro: a new `mobile/.maestro/offline/discardWhileOffline.yaml`. Airplane mode on, create a titled recipe, Discard,
airplane mode off. No notice remains, and the recipe is not in My recipes. Maestro cannot hold a request on the wire,
so the `sending` and `parked` rows are proved by the native component and integration tiers.

## Residual risks

- A withdrawn unknown-outcome create can have made a private draft on the server. It shows in My recipes, where the
  cook can delete it. A client id would close this, but the owner's ruling refuses one.
- A published update that parks after the editor is gone stays until the recipe is reopened.
- The delete re-send depends on there being no undelete route. The sender's JSDoc says so.
- `remedyFor(401)` gives `edit`, which is wrong. ADR-0054 records it as a UX follow-up.
- Cook A's drafts stay on a shared phone after cook B signs in, until A signs in and out again. ADR-0054 §4 accepts it.

Unverified inputs, each to get a red test: `@clerk/expo` sets `userId` to `null` on expiry. Web's
`RecipeAuthNotReadyError` is thrown inside the mint that `subjectBoundToken` wraps. The published Discard of a parked
update is reachable in the UI.

## Pattern register

Tombstone (the queued delete records the cook's consent). Specification (`withdrawMoot`) inside the Transactional
Outbox in log form, applied atomically by the Serialized Mutator. Command (`SyncQueue.discard`) over the pure
`discardEntity`. Idempotent Receiver, with the `recipeSender` Adapter mapping a delete's 404 to the goal state.
Exception translation inside the existing Protection Proxy (`subjectBoundToken`). Preserved: no blind retry, `withdraw`
as the only way a parked record leaves the log, the single writer, and the per-subject keys.
