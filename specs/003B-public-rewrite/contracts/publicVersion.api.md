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

The server computes `offer`. The client renders it and never derives it.

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

## Start a public version

`POST /api/v1/import/{importId}/items/{ordinal}/public-version` with `{ choice: 'public' | 'both', shownOffer: ShownOffer }`.
`POST /api/v1/recipes/{recipeId}/public-version` for the later route (a private copy) with
`{ shownOffer: { kind: 'choice', credit } }` and no `choice` field. Its job has `private_recipe_id` set and
no import item (the item pair NULL), builds its facts from the private copy and sets `private_digest`. A paid copy goes through the
same paid-site rules.

- `202 { jobId, state }`. A second call while a live job exists returns the same job.
- `409 { code: 'attemptsUsed' }` on the import path when the item's `public_attempts` is already 3 (the cook reopened it and chose "For everyone" or "Both" again). It is checked first, before any save, so nothing is saved or charged. The client shows `failed.titleFinal` and `failed.bodyFinal`, and the private exit (the wording of `review.notNow`) runs the paste's ordinary Save recipe, because there is no live job to call keepPrivate on.
- `409 { code: 'publicExists', recipeId: string | null }`: another version of this source page is already public (FR-034). The key is released by FR-034a.
- `409 { code: 'offerChanged', offer }`: the offer the server computes now differs from the `shownOffer` the client sent
  (see "The shown offer"). `offer` is the current offer. Client copy: `offerChanged.line`. Publish answers the same way.
- Start refuses an item with no statement with the import save's existing needs refusal. `409 itemNotReady` is Publish's and keepPrivate's answer for an item that is not matched yet (below).
- Start cancels the item's live job in the same transaction (the job it replaces), and attempts carry over to the new job. On the Both path Start skips its private save when the item's `saved_at` is set.
- Start spends no unit for the writer job (C-24). On the Both path its first step is the private save, which charges the
  paste's unit (FR-016a), so Start can answer `429 IMPORT_QUOTA_EXCEEDED` there and then starts no job. On the public-only path
  Start never answers it.

## Reopen: the import item view

The import item view gains `publicVersionJob: { jobId, state } | null`, the item's latest job by `created_at`, or `null` when it has none (the job rows are deleted 7 days after they finish). The client routes a reopened import with it and with the item's `saved_at` (FR-044a). The recipe id is only the target to open once `saved_at` is set. It carries no job text.

## Read the job

`GET /api/v1/public-version-jobs/{jobId}` →
`{ state, attempts, output?: { title, steps: { text }[] }, refusal?: 'factMissing' | 'factAdded' | 'tooSimilar' | 'unreadable' }`.
The output is present only in `ready`. It holds no source text, and the job's `source_steps` is never returned.
`attempts` is the import item's count across its jobs on the import path, and the job's own count on the later route. The client reads `attempts` to decide which actions to show: at `attempts === 3` it hides `wizard.retry` and
`flag.rewrite` and shows the Final variants (FR-031).

## Publish

`POST /api/v1/public-version-jobs/{jobId}/publish` with `{ title, steps: { text }[], shownOffer: ShownOffer }` (the cook's edited version).

- `201 { recipeId }`, or `200 { recipeId }` for a job already published (idempotent on the source page key). On the public-only path the same transaction runs `claimSave` with the public recipe's id, under the import header lock, using the `decision_rev` read under that lock: it records the recipe id and `saved_at` on the item and clears the item's draft (`payload`). On the Both path Publish does not write the item.
- The unit charge of FR-016a runs inside the Publish transaction, after the server fact check and the wording check have passed (so a `422 flags`, a `422 tooSimilar` or a `503 checkUnavailable` rolls back before anything is charged), and after the lock order of the data model, on the same `allowance_spent_at` guard as keepPrivate. On the public-only path Publish charges the unit. On the Both path the private save already set the guard, so Publish charges nothing, and the later route (no import item) charges nothing. A refusal by `admit` rolls the transaction back and answers `429 IMPORT_QUOTA_EXCEEDED`, and the job stays `ready`. A replay never charges twice.
- `409 { code: 'itemNotReady' }` on the public-only path when the item is not matched yet: retryable, nothing written, nothing charged.
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
fewer than 3 attempts are used. Attempts carry over (per import item, FR-031) and no allowance unit is spent.

- `409 { code: 'attemptsUsed' }` at 3 attempts. The client refetches the job (`GET`) and re-renders from its state and
  attempts.
- `409 { code: 'publicExists', recipeId }` when re-entering `pending` collides with another cook's live job on the page.
- After `privateCopyChanged` it rebuilds the facts snapshot, the source steps and the private digest from the changed private copy.
- A job in `pending`, `writing`, `published`, `cancelled` or `budgetSpent` answers `409 { code: 'notRetryable' }`. The job's state alone decides it.

## Cancel

`POST /api/v1/public-version-jobs/{jobId}/cancel` → `200 { state }`. Idempotent. The transitions are in the data-model
"State transitions" list, which is the one statement of them: every state except `published` ends `cancelled`,
`budgetSpent` included, and a `published` job stays `published`, so `state` is the job's state after the call. In the same
UPDATE it clears `facts_snapshot`, `source_steps` and `output`. It saves nothing and spends no allowance unit (FR-016a).
It is an explicit discard on the public-only path (`review.discard`, Stop, and the offer after `403 PRIVATE_SLOTS_FULL`): after it ends the
job it calls `ImportService.delete` in its own transaction, so the import's header goes, its items and lines cascade away
with the item's draft, and the job's item pair goes to NULL. The import is no longer listed (FR-044a), and a later keepPrivate on the
job answers `409 notKeepable` and charges nothing. On the Both path the cancel is the exit (Stop,
`review.notNowBoth` and `failed.done`): the job ends and the private copy stays. Back calls no route (FR-044). The expiry at 24 hours and the sweep end the job the same way
but clear only the job's own text, never the item's draft, and delete nothing (FR-033). The public-only path's private exits do not use this
route: they use keepPrivate below.

## Keep a private copy

`POST /api/v1/public-version-jobs/{jobId}/keepPrivate` → `201 { recipeId }`, and a replay answers `200` with the same
`recipeId`. It serves `review.notNow`, `button.private` and the private exits of the failed and blocked-final
screens on the public-only path (the job has an import item and no private copy). It never infers a state from the item's recipe id. The checks run in this order:

1. A job that is not public-only, or that has no item (a discard deleted the import), answers `409 { code: 'notKeepable' }`.
2. A `published` job answers `409 { code: 'notKeepable' }`.
3. An item with `saved_at` set answers `200 { recipeId }` with the item's recipe id, or `409 { code: 'notKeepable' }` when that recipe id is NULL.
4. A `cancelled` job answers `409 { code: 'notKeepable' }`.

An item that is not matched yet answers `409 { code: 'itemNotReady' }`, retryable, with nothing written.

- One transaction, in the lock order of the data model: the import header, the item (`SELECT ... FOR UPDATE`), the allowance, the DD33 lock, the job. Then the unit charge below, `claimSave` of the item's draft as a private recipe with FR-021's wording (which records the recipe id and `saved_at` on the item and clears the draft), and the job moved to `cancelled` from `pending`, `writing`, `ready`, `checkRefused`, `failed` or `budgetSpent`, with `source_steps`, `facts_snapshot` and `output` set to NULL. A `budgetSpent` job answers `201`, ends `cancelled` and spends one unit.
- The unit charge (FR-016a): `SELECT ... FOR UPDATE` on the item by `(import_id, ordinal)`. Zero rows throws `ImportItemNotFound`, never "already paid". Then, when `allowance_spent_at IS NULL`, the transaction sets it and calls `ImportAllowanceDal.admit(tx, userId, { ...scopeOf(item.channel), units: 1 })`. If admit refuses, everything rolls
  back and the route answers `429 IMPORT_QUOTA_EXCEEDED`. When `allowance_spent_at` is already set, nothing is charged. A replay never charges twice.
- With no free slot it answers `403 { code: 'PRIVATE_SLOTS_FULL', used, limit }` and changes nothing, so the unit is not charged either. The client swaps in place to the no-slot set (Publish and `review.discard`, FR-044) and moves focus to the alert.
- A Publish racing it ends one way: the loser answers its own conflict and writes nothing. The paste routes retry once on `40P01` (a deadlock with the bulk save).

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
