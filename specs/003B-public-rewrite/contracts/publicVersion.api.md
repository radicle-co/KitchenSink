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

`PublicVersionOffer` is one zod schema, `publicVersionOfferSchema`, authored in recipe-service
`import/publicVersion/publicVersion.schema.ts`. The import item view and the offer route below both use it:

```text
PublicVersionOffer =
          { kind: 'choice', credit: 'free' | 'paid' }
        | { kind: 'privateOnly', reason: 'paidRecent' | 'paidSignature' | 'publisherOptOut' | 'aiOptOut' | 'budget'
                                | 'noSteps' | 'noSourceAddress' | 'languageUnsupported' | 'switchOff',
                                holdEndsOn?: string }
          // holdEndsOn is an ISO date, present only for paidRecent when the date is known.
          // A schema refine rejects holdEndsOn on any other reason.
          // Only a clearly read signal gives paidRecent, paidSignature, publisherOptOut or aiOptOut. An unknown signal
          // is never a reason: the offer is a choice (FR-012b).
          // languageUnsupported: the source language has no registry entry, or could not be read (FR-012c).
          // 'under16' is not a reason: age is checked at Publish. Spec 016 adds it back.
        | { kind: 'publicExists', status: 'published' | 'writing' | 'inReview', recipeId: string | null }
          // one public version per source page (FR-034). recipeId is null until a recipe exists.
          // 'writing' and 'inReview' are states of an existing public version, never privateOnly reasons.
        | { kind: 'publicOnly' }   // no slot left, public possible
        | { kind: 'deadEnd', reason: 'paid' | 'noWrite' }
```

The server computes `offer`. The client renders it and never derives it.

## The shown offer

Start and Publish carry `shownOffer`, the offer the client rendered, cut down to the fields the server compares:

```text
ShownOffer =
          { kind: 'choice', credit: 'free' | 'paid' }
        | { kind: 'privateOnly', reason }   // the same reasons as the offer. holdEndsOn is not compared
        | { kind: 'publicExists', status: 'published' | 'writing' | 'inReview' }   // recipeId is not compared
        | { kind: 'publicOnly' }
        | { kind: 'deadEnd', reason: 'paid' | 'noWrite' }
```

The server compares exactly these fields with the offer it computes now, and answers `409 { code: 'offerChanged', offer }`
on a difference. The client never decides on its own that the offer changed. When the server computes the offer at Start
and at Publish, it excludes the caller's own live job, so the same cook's job never reads as `publicExists`. If the page
is now held by another cook's version, the answer is `409 { code: 'publicExists', recipeId }` (`recipeId` as for starting a job), which takes precedence over
`offerChanged`. The later route sends the `shownOffer` it got from `GET /api/v1/recipes/{recipeId}/public-version/offer`.

## Read the offer for a private copy

`GET /api/v1/recipes/{recipeId}/public-version/offer` → `200 { offer: PublicVersionOffer }`. Owner only, and it needs a
token. It answers `404` for another cook's recipe, a missing recipe, or a recipe with no source record. The recipe read
carries the owner-only field `hasSourceRecord: boolean` (see below), which tells the client whether to show "Share a
public version" at all. The client calls this route on tap, with no cache (`usePublicVersionOffer(recipeId, { enabled:
false })`, `staleTime` 0). If the offer changes after that, the `409 offerChanged` of Start covers it.

## Owner-only field on the recipe read

`GET /api/v1/recipes/{id}` gains `hasSourceRecord: boolean`: true when a `recipe_source_records` row exists whose
`page_key` equals the recipe's evidence `source_key`. It is present for the owner only and omitted for every other
viewer, like the other owner-only fields (ADR-0090, #301). It is computed the way #301 computes `publicNeedsCheck`.

## Start a public version

`POST /api/v1/import/{importId}/items/{itemId}/public-version` with `{ choice: 'public' | 'both', shownOffer: ShownOffer }`.
`POST /api/v1/recipes/{recipeId}/public-version` for the later route (a private copy). A paid copy goes through the
same paid-site rules.

- `202 { jobId, state }`. A second call while a live job exists returns the same job.
- `409 { code: 'publicExists', recipeId: string | null }`: another version of this source page is already public (FR-034). The key is released by FR-034a.
- `409 { code: 'offerChanged', offer }`: the offer the server computes now differs from the `shownOffer` the client sent
  (see "The shown offer"). `offer` is the current offer. Client copy: `offerChanged.line`. Publish answers the same way.
- No allowance unit is spent by Start (C-24), so it never answers `429 importAllowance`.

## Read the job

`GET /api/v1/public-version-jobs/{jobId}` →
`{ state, output?: { title, steps: { text }[] }, refusal?: 'factMissing' | 'factAdded' | 'tooSimilar' | 'unreadable' }`.
The output is present only in `ready`. It holds no source text.

## Publish

`POST /api/v1/public-version-jobs/{jobId}/publish` with `{ title, steps: { text }[], shownOffer: ShownOffer }` (the cook's edited version).

- `201 { recipeId }`, or `200 { recipeId }` for a job already published (idempotent on the source page key).
- `422 { code: 'flags', flags: { kind: 'step' | 'allergen', line?, ingredient? }[] }` from the server fact check.
- `422 { code: 'tooSimilar' }` from the wording check, or `422 { code: 'rewriteNeeded' }` when the stored fingerprint's key version cannot be read (the cook can write it again).
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

## Cancel

`POST /api/v1/public-version-jobs/{jobId}/cancel` → `200 { state: 'cancelled' }`. Idempotent.

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
