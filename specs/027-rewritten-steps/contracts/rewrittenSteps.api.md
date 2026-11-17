# Contract: Flow Steps API (recipe-service)

Authored as zod in `recipe-service/src/recipes/rewrittenSteps/rewrittenSteps.schema.ts` (DD15), copied to
`@kitchensink/schema-recipe` by `contract:generate`. Bearer auth. Another owner's recipe → `404` (never `403`).

## Types

```ts
type RewrittenStep = { text: string; covers: number[] };

type RewrittenStepsStatus =
    | { status: 'none' }
    | {
          status: 'ready';
          freshness: 'fresh' | 'stale';
          steps: RewrittenStep[];
          contentDigest: string;
          createdAt: string;
      }
    | { status: 'pending'; jobId: string }
    | { status: 'refused'; reason: EligibilityRefusal }
    | { status: 'failed'; jobId: string; reason: 'checkRefused' | 'budgetSpent' | 'failed' };

type EligibilityRefusal = 'draft' | 'empty' | 'held' | 'tooLong' | 'planRequired' | 'outOfUses' | 'busy';
```

After a failed update, `ready` also carries the last failure (FR-062): `{ status: 'ready', …, lastJob?: { jobId, reason } }`.

## Endpoints

| Method | Path                                              | Result                                                                                                                                                                                                               |
| ------ | ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/api/v1/recipes/:id/rewritten-steps`             | `200 RewrittenStepsStatus`. Never generates.                                                                                                                                                                         |
| POST   | `/api/v1/recipes/:id/rewritten-steps`             | `200 {status:'ready', freshness:'fresh', …}` on a hit (no use). `202 {status:'pending', jobId}` on a miss; a concurrent POST gets the same `jobId`. `409 {status:'refused', reason}` when ineligible. Body empty.    |
| GET    | `/api/v1/recipes/:id/rewritten-steps/jobs/:jobId` | `200 {jobId, state, refusal?}`.                                                                                                                                                                                      |
| POST   | `/api/v1/recipes/:id/rewritten-steps/apply`       | Body `{ expectedVersion: number, contentDigest: string, confirm: true }`. `200` updated recipe. `409` on version or digest mismatch (FR-033). Ineligible (FR-032 gate) → `409 {reason:'replaceNotOffered'}`. No use. |
| DELETE | `/api/v1/recipes/:id/rewritten-steps`             | `204`. Removes the attached version. No refund.                                                                                                                                                                      |

## Validation (GR-016)

- `:id`, `:jobId` parsed as house ids. `contentDigest` `^[0-9a-f]{64}$`. `confirm` literal `true`.
- Responses validated on receipt by clients with the same zod.
- `steps` max 80, `text` max 2,000 chars each, `covers` ints within the source step count.

## Queue message (recipe-service → recipe-workers)

`{ jobId, recipeId }` only. The worker reads the saved recipe and recomputes the digest before any call. A digest
that differs from the job's ends the job `failed`, with no model call and no use. The cook then sees the out-of-date
state and can ask again. The schema joins the existing family in `recipe-workers/src/common/messages.schema.ts`.
