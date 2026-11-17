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

`POST /api/v1/import/{importId}/items/{itemId}/public-version` with `{ choice: 'public' | 'both', shownOffer: ShownOffer }`.
`POST /api/v1/recipes/{recipeId}/public-version` for the later route (a private copy) with
`{ shownOffer: { kind: 'choice', credit } }` and no `choice` field. Its job has `private_recipe_id` set and
`import_item_id` NULL, builds its facts from the private copy and sets `private_digest`. A paid copy goes through the
same paid-site rules.

- `202 { jobId, state }`. A second call while a live job exists returns the same job.
- `409 { code: 'publicExists', recipeId: string | null }`: another version of this source page is already public (FR-034). The key is released by FR-034a.
- `409 { code: 'offerChanged', offer }`: the offer the server computes now differs from the `shownOffer` the client sent
  (see "The shown offer"). `offer` is the current offer. Client copy: `offerChanged.line`. Publish answers the same way.
- No allowance unit is spent by Start (C-24), so it never answers `429 importAllowance`.

## Read the job

`GET /api/v1/public-version-jobs/{jobId}` →
`{ state, attempts, output?: { title, steps: { text }[] }, refusal?: 'factMissing' | 'factAdded' | 'tooSimilar' | 'unreadable' }`.
The output is present only in `ready`. It holds no source text, and the job's `source_steps` is never returned.
The client reads `attempts` to decide which actions to show: at `attempts === 3` it hides `wizard.retry` and
`flag.rewrite` and shows the Final variants (FR-031).

## Publish

`POST /api/v1/public-version-jobs/{jobId}/publish` with `{ title, steps: { text }[], shownOffer: ShownOffer }` (the cook's edited version).

- `201 { recipeId }`, or `200 { recipeId }` for a job already published (idempotent on the source page key).
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
fewer than 3 attempts are used. Attempts carry over and no allowance unit is spent.

- `409 { code: 'attemptsUsed' }` at 3 attempts. The client refetches the job (`GET`) and re-renders from its state and
  attempts.
- `409 { code: 'publicExists', recipeId }` when re-entering `pending` collides with another cook's live job on the page.
- After `privateCopyChanged` it rebuilds the facts snapshot, the source steps and the private digest from the changed private copy.
- A job in `pending`, `writing`, `published`, `cancelled` or `budgetSpent` answers `409 { code: 'notRetryable' }`.

## Cancel

`POST /api/v1/public-version-jobs/{jobId}/cancel` → `200 { state: 'cancelled' }`. Idempotent. It is accepted from
`pending`, `writing`, `ready`, `checkRefused` and `failed` (the failed screen's "Done" and "Save my copy", and `review.notNow` at 3 attempts), and it clears
`facts_snapshot`, `source_steps` and `output` in the same UPDATE.

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
