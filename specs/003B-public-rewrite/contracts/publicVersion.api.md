# Contract: public versions (recipe-service)

The zod is authored in-service (DD15, ADR-0014) beside the controller, and copied to `@kitchensink/schema-recipe` by
`contract:generate`. This file states the shape for planning only. All routes need a Bearer token. Another cook's job
or recipe answers 404, never 403.

## Classification in the import item read

`GET /api/v1/import/{importId}` items gain:

```text
source: { classification: 'open' | 'thirdParty' | 'paid', domain: string | null }
offer:  PublicVersionOffer
```

`classification` is `paid` only for a clearly read paid signal. A page on the paid list with no clear signal, and an
unknown signal, read `thirdParty` with `offer.credit: 'paid'` (FR-012b).

`PublicVersionOffer` is one zod schema, `publicVersionOfferSchema`, authored in recipe-service
`import/publicVersion/publicVersion.schema.ts`. The import item view and the offer route below both use it:

```text
PublicVersionOffer =
          { kind: 'choice', credit: 'free' | 'paid' }
        | { kind: 'privateOnly', reason: 'paidRecent' | 'paidSignature' | 'publisherOptOut' | 'aiOptOut' | 'budget'
                                | 'noSteps' | 'noSourceAddress' | 'languageUnsupported' | 'languageUncertain'
                                | 'switchOff',
                                holdEndsOn?: string }
          // holdEndsOn is an ISO date, present only for paidRecent when the date is known.
          // A schema refine rejects holdEndsOn on any other reason.
          // Only a clearly read signal gives paidRecent, paidSignature, publisherOptOut or aiOptOut. An unknown signal
          // is never a reason: the offer is a choice (FR-012b).
          // languageUnsupported: the detector or the platform's locale data cannot handle the language (FR-012c).
          // languageUncertain: the language could not be decided with confidence (FR-012c).
          // 'under16' is not a reason: age is checked at Publish. Spec 016 adds it back.
        | { kind: 'publicExists', status: 'published' | 'writing' | 'inReview', recipeId: string | null }
          // one public version per source page (FR-034). recipeId is null until a recipe exists.
          // 'writing' and 'inReview' are states of an existing public version, never privateOnly reasons.
        | { kind: 'publicOnly', credit: 'free' | 'paid' }   // no slot left, public possible
        | { kind: 'deadEnd', reason: 'paid' | 'noWrite' }
```

The server computes `offer`. The client renders it and never derives it. With no free private slot the server answers `deadEnd`, never `privateOnly`, for every case that would end in "Save my copy" (reason `paid` for a paid source held back, `noWrite` for the other `privateOnly` reasons), because the save would be refused. A `publicExists` offer with no free slot offers `review.discard` (`review.discardFile` on a file item) as its exit.

## The shown offer

Start and Publish carry `shownOffer`, the offer the client rendered, cut down to the only two kinds a cook can start or
publish from:

```text
ShownOffer = { kind: 'choice' | 'publicOnly', credit: 'free' | 'paid' }
```

Any other body is a `400`. The server runs one pure function, `publishGate(offer, shownOffer)`. It allows the call
when the offer the server computes now is `choice` or `publicOnly` and its `credit` equals the shown `credit`, and
otherwise answers `409 { code: 'offerChanged', offer }`. It never compares slots (`choice` and `publicOnly` differ by
a slot fact only). The budget is checked at Start only. Publish ignores it, and a retry over the ceiling ends the job
`budgetSpent` in the worker. When the server computes the offer at Start and at Publish, it excludes the caller's own
live job and its reservation, so the same cook's job never reads as `publicExists`. If the page is now held by
another cook's version, the answer is `409 { code: 'publicExists', recipeId }` (`recipeId` as for starting a job),
which takes precedence over `offerChanged`. The client never decides on its own that the offer changed. The later
route sends the `shownOffer` it built from `GET /api/v1/recipes/{recipeId}/public-version/offer`.

## Read the offer for a private copy

`GET /api/v1/recipes/{recipeId}/public-version/offer` → `200 { offer: LaterOffer }`, where
`LaterOffer = { kind: 'choice', credit } | { kind: 'privateOnly', reason, holdEndsOn? } | { kind: 'publicExists', status, recipeId }`
(the same shapes as above). The private copy already holds its slot, so this route never answers `publicOnly` or
`deadEnd`. Owner only, and it needs a token. It answers `404` for another cook's recipe, a missing recipe, or a recipe
with no source record. The recipe read
carries the owner-only field `hasSourceRecord: boolean` (see below), which tells the client whether to show "Share a
public version" at all. The client calls this route on tap, with no cache (`usePublicVersionOffer(recipeId, { enabled:
false })`, `staleTime` 0). If the offer changes after that, the `409 offerChanged` of Start covers it.

## Owner-only field on the recipe read

`GET /api/v1/recipes/{id}` gains `hasSourceRecord: boolean`: true when a `recipe_source_records` row exists whose
`evidence_id` equals the recipe's evidence row (several rows: the latest `recorded_at`; `evidence_id` is indexed).
Only an import writes a record, so an editor edit never changes it. It is present for the owner only and omitted for every other
viewer, like the other owner-only fields (ADR-0090, #301). It is computed the way #301 computes `publicNeedsCheck`.

The same read, `GET /api/v1/recipes/{id}` only (no list read carries it), carries the owner-only `publicVersionJob: { jobId, state } | null`: the latest job (by `created_at`) whose `private_recipe_id` is the recipe, or `null`. P6 uses it to show the `yourImports.publicWriting` or `yourImports.publicReady` line, which opens the writing or review screen (a Both path left while writing, or a later route in progress). After the job's 24-hour expiry it is no longer routed to, and the later route's "Share a public version" stays.

## Start a public version

`POST /api/v1/import/{importId}/items/{ordinal}/public-version` with `{ choice: 'public' | 'both', shownOffer: ShownOffer }`.
`POST /api/v1/recipes/{recipeId}/public-version` for the later route (a private copy) with
`{ shownOffer: { kind: 'choice', credit } }` and no `choice` field. Its job has `path = 'later'`, `private_recipe_id` set and
no import item (the item pair NULL), builds its facts from the private copy and sets `private_digest`. A paid copy goes through the
same paid-site rules. Start on the later route locks the recipe `FOR NO KEY UPDATE`, then returns the recipe's latest job (by `private_recipe_id`, a Both job included) with `202` and checks nothing else when that job is `pending`, `writing` or `ready`, so a second device of the same cook gets the same job (FR-034) and no row is inserted. When that job is resting (`checkRefused` or `failed` below 3 attempts), Start cancels it in the same transaction, clearing its text. It then answers `409 { code: 'attemptsUsed' }` when `recipes.public_attempts` is 3, checked after the live-job return.

- `202 { jobId, state }`. On the public-only path a second call with the same choice while a live job exists returns the live job. A Both Start saves the item, so a repeat Start on it (either choice) answers `itemSaved`, and the client reaches the live Both job through the recipe's `publicVersionJob`. A call with a changed choice cancels the item's live or resting job in the same transaction and starts a new one.
- `409 { code: 'itemSaved', recipeId }` on the import path when the item's `saved_at` is set, for either choice. The client opens the recipe (P6). It is checked first of all.
- `409 { code: 'attemptsUsed' }` on the import path when the item's `public_attempts` is already 3 (the cook reopened it and chose "For everyone" or "Both" again). It is checked after `itemSaved` and the same-choice live job, and before any save, so nothing is saved or charged (a Both Start at 3 saves nothing). The client shows `failed.titleFinal` and `failed.bodyFinal`, and the private exit (the wording of `review.notNow`) runs the paste's ordinary Save recipe, because there is no live job to call keepPrivate on. With no free slot the client shows `failed.bodyFinalFull` and `review.discard`, which calls `DELETE /api/v1/import/{importId}`. On a file item the private exit goes through the bulk save (keepPrivate answers `202`, the client calls advance), and with no free slot the client shows `failed.bodyFinalFullFile` and `review.discardFile`, which calls the discard-item route.
- `409 { code: 'publicExists', recipeId: string | null }`: another version of this source page is already public (FR-034). The key is released by FR-034a.
- `409 { code: 'offerChanged', offer }`: the offer the server computes now differs from the `shownOffer` the client sent
  (see "The shown offer"). `offer` is the current offer. Client copy: `offerChanged.line`. Publish answers the same way.
- `409 { code: 'itemNotReady' }` on the import path when the item is not matched yet, or when a file item's unit is not yet spent (an unpaid file item): retryable, nothing written. Publish and keepPrivate answer it too (below).
- Start refuses an item with no statement with the import save's existing needs refusal.
- Start answers `404` for a discarded file item, as for a missing item.
- Start checks, in order: `itemSaved`, a live job with the same choice (returned at once, nothing else checked), `attemptsUsed`, `itemNotReady`, the needs refusal, `publicExists`, `offerChanged`.
- A Start that starts a new job cancels the item's live or resting job in the same transaction (the job it replaces), so no resting job keeps step text, whether or not the choice changed, and the new job reads the attempt count from its holder (the item for `public`, the recipe for `both` and `later`). Start never skips the Both path's private save for a saved item: it answers `itemSaved` instead.
- Start spends no unit for the writer job (C-24). On the Both path of a paste item its first step is the private save, which charges the
  paste's unit (FR-016a), so Start can answer `429 IMPORT_QUOTA_EXCEEDED` there and then starts no job. On the public-only path
  Start never answers it, and a file item never answers it at all: its unit was spent when its lines were sent, so the save finds `allowance_spent_at` set and charges nothing. The Both Start's private save on a file item goes through the bulk save.

## Reopen: the import item view

The import item view gains `publicVersionJob: { jobId, state } | null`, the item's latest job by `created_at`, or `null` when it has none (the job rows are deleted 7 days after they finish). The client routes a reopened import with it and with the item's `saved_at` (FR-044a). The recipe id is only the target to open once `saved_at` is set. It carries no job text.

## Read the job

`GET /api/v1/public-version-jobs/{jobId}` →
`{ state, attempts, output?: { title, steps: { text }[] }, refusal?: 'factMissing' | 'factAdded' | 'tooSimilar' | 'unreadable' }`.
The output is present only in `ready`. It holds no source text, and the job's `source_steps` is never returned.
`attempts` is read from the job's holder, chosen by its `path`: the import item's count for `public`, the private recipe's count for `both` and `later`. A job with no holder (its copy was deleted) answers `attempts: 0`. The client reads `attempts` to decide which actions to show: at `attempts === 3` it hides `wizard.retry` and
`flag.rewrite` and shows the Final variants (FR-031).

## Publish

`POST /api/v1/public-version-jobs/{jobId}/publish` with `{ title, steps: { text }[], shownOffer: ShownOffer }` (the cook's edited version).

- `201 { recipeId }`, or `200 { recipeId }` for a job already published (idempotent on the source page key). On the public-only path the same transaction runs `claimSave` with the public recipe's id, under the import header lock, using the `decision_rev` read under that lock: it records the recipe id and `saved_at` on the item and clears the item's draft (`payload`). On the Both path Publish does not write the item.
- The unit charge of FR-016a runs inside the Publish transaction, after the server fact check and the wording check have passed (so a `422 flags`, a `422 tooSimilar` or a `503 checkUnavailable` rolls back before anything is charged), and after the lock order of the data model, on the same `allowance_spent_at` guard as keepPrivate. On the public-only path Publish charges the unit. On the Both path the private save already set the guard, so Publish charges nothing, and the later route (no import item) charges nothing. A refusal by `admit` rolls the transaction back and answers `429 IMPORT_QUOTA_EXCEEDED`, and the job stays `ready`. A replay never charges twice.
- `409 { code: 'itemNotReady' }` on the public-only path when the item is not matched yet, checked under the item lock before the recipe insert: retryable, nothing written, nothing charged. An `ImportItemChangedError` from `claimSave` rolls the transaction back and answers the same.
- `422 { code: 'flags', flags: { kind: 'step' | 'allergen' | 'factAdded', line?, ingredient? }[] }` from the server fact check.
  `factAdded` carries the added `line`.
- `422 { code: 'tooSimilar' }` from the wording check.
- `503 { code: 'checkUnavailable' }` when the stored fingerprint's key version cannot be read. It is retryable and
  raises the alarm. The job stays `ready` and no attempt is spent, so the client can send Publish again (FR-050a).
- `409 { code: 'privateCopyChanged' }` on the Both path (FR-045).
- `409 { code: 'offerChanged', offer }` as for starting a job.
- `409 { code: 'publicExists', recipeId }` when another cook's version now holds the page. It takes precedence over
  `offerChanged`.
- `403 { code: 'ageConfirmNeeded' }`: the principal has no `publishAgeMet`, the `Principal` field parsed from the signed `public_metadata.ageFloorMet` claim (`publishAgeAllowed`, FR-016). Only
  Publish is gated, and so is the Publish step of the later route. The client shows `ageConfirm.*` (wording
  `ageConfirm.v1`). On "I'm 16 or over" it calls the identity route below, then `getToken({ skipCache: true })` (on
  mobile with the `commise-native` template), then retries Publish once. A second `403` shows an error and never loops.

## Identity: age assurance

`POST /api/v1/me/age-assurance` with `{ floor: 16, wordingVersion: 'ageConfirm.v1', locale }`. It writes the
`age_assurances` row first, then sets the Clerk `public_metadata.ageFloorMet` claim to the integer `16`. It is idempotent.

- `204` on success. A repeat call writes no second row.
- `503` when the claim write fails. The row stays, and a retry writes only the claim.

## Retry

`POST /api/v1/public-version-jobs/{jobId}/retry` → `202 { state: 'pending' }`. It serves "Write it again" (job `ready`
after `422 flags`, `422 tooSimilar` or `409 privateCopyChanged`) and "Try again" (job `checkRefused` or `failed`), while
fewer than 3 attempts are used. The attempt count belongs to the holder (FR-031) and no allowance unit is spent.

- `409 { code: 'attemptsUsed' }` at 3 attempts. The client refetches the job (`GET`) and re-renders from its state and
  attempts.
- `409 { code: 'publicExists', recipeId }` when re-entering `pending` collides with another cook's live job on the page.
- After `privateCopyChanged` it rebuilds the facts snapshot, the source steps and the private digest from the changed private copy.
- A job in `pending`, `writing`, `published`, `cancelled` or `budgetSpent` answers `409 { code: 'notRetryable' }`, and so does a job with no holder (a `both` job whose copy was deleted). Otherwise the job's state alone decides it.

## Cancel

`POST /api/v1/public-version-jobs/{jobId}/cancel` → `200 { state }`. Idempotent. The transitions are in the data-model
"State transitions" list, which is the one statement of them: every state except `published` ends `cancelled`,
`budgetSpent` included, and a `published` job stays `published`, so `state` is the job's state after the call. In the same
UPDATE it clears `facts_snapshot`, `source_steps` and `output`. It saves nothing and spends no allowance unit (FR-016a).
It is an explicit discard on the public-only path (`review.discard`, Stop, and the offer after `403 PRIVATE_SLOTS_FULL`): after it ends the
job it calls `ImportService.delete` in its own transaction, so the import's header goes, its items and lines cascade away
with the item's draft, and the job's item pair goes to NULL. The import is no longer listed (FR-044a), and a later keepPrivate on the
job answers `409 notKeepable` and charges nothing. Cancel on an already-cancelled public-only job is idempotent: if the item pair is still set it runs `ImportService.delete` again and answers as the first call did, and if the pair is NULL it does nothing and answers `200`. A discard with no job at all (the cook has not started one) uses the existing import delete, `DELETE /api/v1/import/{importId}`. On the Both path, and on any item that is already saved, every exit (Stop, Back from the writing screen or from the review, `review.notNowBoth`, `failed.done` and the blocked and final exits) calls cancel and the client goes to the private copy (P6): the job ends and the private copy stays. Nothing returns to the choice page (P5). On the later route cancel stops only the public-version job and never touches the cook's saved private recipe. On the public-only path Back from the review calls no route (FR-044). On a file item cancel only ends the job and deletes nothing: the explicit discard of a file item is the discard-item route below. The expiry at 24 hours and the sweep end the job the same way
but clear only the job's own text, never the item's draft, and delete nothing (FR-033). The public-only path's private exits do not use this
route: they use keepPrivate below.

## Keep a private copy

`POST /api/v1/public-version-jobs/{jobId}/keepPrivate` → `201 { recipeId }`, and a replay answers `200` with the same
`recipeId`. It serves `review.notNow`, `button.private` and the private exits of the failed and blocked-final
screens on the public-only path (the job's `path` is `public`). It never infers a state from the item's recipe id. The checks run in this order:

1. A job whose `path` is not `public` (a `both` job whose copy was deleted included), or that has no item (a discard deleted the import), answers `409 { code: 'notKeepable' }`. The path is read from the job's `path` column, never from `private_recipe_id`.
2. A `published` job answers `409 { code: 'notKeepable' }`.
3. An item with `saved_at` set answers `200 { recipeId }` with the item's recipe id, or `409 { code: 'notKeepable' }` when that recipe id is NULL.
4. A `cancelled` job answers `409 { code: 'notKeepable' }`.
5. An item that is not matched yet (`stage` not `matched`, checked under the item lock before the recipe insert) answers `409 { code: 'itemNotReady' }`, retryable, with nothing written and nothing charged. It comes after the `cancelled` check, so a replay still wins. An `ImportItemChangedError` from `claimSave` rolls back and answers the same.

- One transaction, in the lock order of the data model: the import header, the item (`SELECT ... FOR UPDATE`), the allowance, the DD33 lock, the job. (A file item takes the branch below instead.) Then the unit charge below, `claimSave` of the item's draft as a private recipe with FR-021's wording (which records the recipe id and `saved_at` on the item and clears the draft), and the job moved to `cancelled` from `pending`, `writing`, `ready`, `checkRefused`, `failed` or `budgetSpent`, with `source_steps`, `facts_snapshot` and `output` set to NULL. A `budgetSpent` job answers `201`, ends `cancelled` and spends one unit.
- The unit charge (FR-016a): `SELECT ... FOR UPDATE` on the item by `(import_id, ordinal)`. Zero rows throws `ImportItemNotFound`, never "already paid". Then, when `allowance_spent_at IS NULL`, the transaction sets it and calls `ImportAllowanceDal.admit(tx, userId, { ...scopeOf(item.channel), units: 1 })`. If admit refuses, everything rolls
  back and the route answers `429 IMPORT_QUOTA_EXCEEDED`. When `allowance_spent_at` is already set, nothing is charged. A replay never charges twice.
- With no free slot it answers `403 { code: 'PRIVATE_SLOTS_FULL', used, limit }` and changes nothing, so the unit is not charged either. The client swaps in place to the no-slot set (Publish and `review.discard`, FR-044) and moves focus to the alert.
- A Publish racing it ends one way: the loser answers its own conflict and writes nothing. The bulk save takes the same lock order, so there is no deadlock to retry.
- A file (`bulk`) item runs checks 1 to 5 and then, in one transaction, cancels the job and writes `choice = 'private'`, and answers `202 { importId, ordinal }`. The client calls advance, and the bulk save saves the recipe with its holds, its binding mode and DD33. Nothing is charged: the item is already paid. Advance never saves an item whose `choice` is `public` or `both`.

## Discard one file item

`POST /api/v1/import/{importId}/items/{ordinal}/discard` → `200 { importId, ordinal }`, for a file (`bulk`) item only (a paste import is discarded with the whole import). One transaction under the import header lock: it cancels the item's job, sets `discarded_at` and moves the cursor like a skip. File items never delete a row (ordinals stay contiguous), so a re-sent chunk meets a locked item and `upsertItems` refuses it. It is idempotent, answers `409 { code: 'itemSaved', recipeId }` for a saved item, and `404` for another cook's import. A discard spends no unit. The other recipes of the batch are untouched.

## Make the rest public

`POST /api/v1/import/{importId}/rest-public` with `{ items: { ordinal, shownOffer: ShownOffer }[] }` (the ticked rows only). One transaction under the import header lock, with the items `FOR UPDATE` in ordinal order, and no job row is written. An "I wrote this" item gets `choice = 'public'` and the advance saves it as today. Each eligible third-party item gets `choice = 'public'` and `public_requested_at`. Eligible means unsaved, not discarded, no job at all, and an offer of `choice` or `publicOnly`. A promoter, in its own transaction, then creates the jobs (data model, "Rest-public"). `200 { items: { ordinal, outcome }[] }` where `outcome` is one of:

```text
requested
waiting                                  // not matched or not paid yet; the marker is kept
skipped { reason: 'publicExists' | 'budget' | 'attemptsUsed' | 'alreadyStarted' | 'saved' | 'discarded' }
```

A replay marks nothing that already has a job or a marker and never restarts a resting job, and answers for each item from its current state: a marked item with no job answers `requested` (or `waiting` when it is not matched or not paid), and an item with a job answers `skipped` with `alreadyStarted`. The route never answers `429`: a file item is already paid, and Publish's guard charges nothing for it.

The import list entry (`GET /api/v1/import`) gains `publicVersions: { requested, writing, ready, needsYou, notWritten, published, nextReadyExpiresAt }` from one grouped query whose predicates are the table in the data model's "Rest-public" section, and the import item view gains `readyUntil` (the ISO date a ready draft's job expires, or `null`).

## Recipe writes

`PATCH /api/v1/recipes/{id}` and version restore on a public version answer `422 { code: 'tooSimilar' }` on a
refusal by the wording guard (FR-050). When the stored fingerprint's key version cannot be read, they answer a retryable
`503 { code: 'checkUnavailable' }` and raise an alarm (FR-050a). The editor keeps the cook's edit in its device draft. A
save that makes the version private runs no wording check. No new route.

## Duplicate lookup

`GET /api/v1/import/copies?source=<link>` →

```text
200 { copies: { recipeId: string, title: string, savedAt: string, site: string, version: number,
                replaceable: boolean, everPublished: boolean }[],
      total: number }
```

It lists the caller's own copies of one source page, never another cook's, and charges nothing.

- `copies` holds at most 20 entries (`IMPORT_COPIES_MAX`), newest first. `savedAt` is an ISO date.
- `everPublished` is true when the recipe's `first_published_at` is set. It is never derived from the recipe's status.
- `total` counts every copy of the page that the cook holds, so `total >= copies.length`. A page with no copy answers
  `{ copies: [], total: 0 }`.
