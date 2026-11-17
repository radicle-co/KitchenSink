# Contract: public versions (recipe-service)

The zod is authored in-service (DD15, ADR-0014) beside the controller, and copied to `@kitchensink/schema-recipe` by
`contract:generate`. This file states the shape for planning only. All routes need a Bearer token. Another cook's job
or recipe answers 404, never 403.

## Classification in the import item read

`GET /api/v1/import/{importId}` items gain:

```text
source: { classification: 'open' | 'thirdParty' | 'paid', domain: string | null }
offer:  { kind: 'choice', credit: 'free' | 'paid' } | { kind: 'privateOnly', reason: 'paidRecent' | 'paidSignature' | 'publisherOptOut' | 'budget' | 'optOut' | 'under16' | 'noSteps' | 'switchOff' | 'publicPending' | 'publicReview' | 'optOut' }
        | { kind: 'publicExists', recipeId: string }   // one public version per source page (FR-034)
        | { kind: 'publicOnly' }   // no slot left, public possible
        | { kind: 'deadEnd', reason: 'paid' | 'noWrite' }
```

The server computes `offer`. The client renders it and never derives it.

## Start a public version

`POST /api/v1/import/{importId}/items/{itemId}/public-version` with `{ choice: 'public' | 'both' }`.
`POST /api/v1/recipes/{recipeId}/public-version` for the later route (a private copy). A paid copy goes through the
same paid-site rules.

- `202 { jobId, state }`. A second call while a live job exists returns the same job.
- `409 { code: 'publicExists', recipeId }`: another version of this source page is already public (FR-034). The key is released by FR-034a.
- `409 { code: 'offerChanged', offer }`: the offer moved (budget hint, slots, allowance).
- `429 { code: 'importAllowance' }` past the one import allowance (004-FR-061).

## Read the job

`GET /api/v1/public-version-jobs/{jobId}` →
`{ state, output?: { title, steps: { text }[] }, refusal?: 'factMissing' | 'factAdded' | 'tooSimilar' | 'unreadable' }`.
The output is present only in `ready`. It holds no source text.

## Publish

`POST /api/v1/public-version-jobs/{jobId}/publish` with `{ title, steps: { text }[] }` (the cook's edited version).

- `201 { recipeId }`, or `200 { recipeId }` for a job already published (idempotent on the source page key).
- `422 { code: 'flags', flags: { kind: 'step' | 'allergen', line?, ingredient? }[] }` from the server fact check.
- `422 { code: 'tooSimilar' }` from the wording check, or `422 { code: 'rewriteNeeded' }` when the key version cannot be read (FR-050a).
- `409 { code: 'privateCopyChanged' }` on the Both path (FR-045).

## Cancel

`POST /api/v1/public-version-jobs/{jobId}/cancel` → `200 { state: 'cancelled' }`. Idempotent.

## Recipe writes

`PATCH /api/v1/recipes/{id}` and version restore on a public version answer `422 { code: 'tooSimilar' }` on a
refusal by the wording guard (FR-050). No new route.
