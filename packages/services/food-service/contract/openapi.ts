/**
 * THE FOOD (INGREDIENT) API's OpenAPI DOCUMENT — declared from the authored zod, for external consumption.
 *
 * This file is the ONE place the service's routes, status codes and security requirements are described for
 * integrators, and it composes the SAME zod the service validates and the clients import — so a shape cannot
 * appear in the document that the service does not actually serve.
 *
 * WHAT IT IS NOT: a code-generation input, and not the type authority (§15.2.1). Nothing in this repo compiles
 * against `openapi.yaml`; the authority is the zod exported from `@kitchensink/schema-food`.
 *
 * WHY IT IS HAND-DECLARED RATHER THAN SCRAPED FROM THE CONTROLLERS. `@nestjs/swagger` emits no response schema
 * for a handler returning an `interface` (§15.2.5), and every handler in this service returns one — so a scraped
 * document would be blind to response changes, which is most of what breaks a client. Declaring the routes costs
 * a few lines per endpoint and buys a document whose response bodies are real, `$ref`'d component schemas.
 *
 * ⚠️ This is the INGREDIENT service (see `foods.schema.ts`). The `food_*` naming is historical and deliberate.
 *
 * ADDING AN ENDPOINT: add its schemas to a `*.schema.ts`, register the component here, and declare the path.
 * `openApiComponents` is typed, so referencing a component that does not exist is a `typecheck` failure, and the
 * generator prints every response left without a body schema on each run.
 */
import { buildOpenApiDocument } from '@kitchensink/contract-gen';
import type { OpenApiBuildResult, OpenApiResponse } from '@kitchensink/contract-gen';
import { z } from 'zod';

import { apiErrorSchema } from '../src/common/apiError.schema.js';
import {
    foodNutritionBatchResponseSchema,
    addFoodRequestSchema,
    adoptRemoteFoodRequestSchema,
    adoptRemoteFoodResponseSchema,
    authoredFoodSearchResponseSchema,
    authoredFoodSearchResultViewSchema,
    authoredMacrosSchema,
    authoredPortionInputSchema,
    createAuthoredFoodRequestSchema,
    updateAuthoredFoodRequestSchema,
    addResponseSchema,
    batchAddFoodRequestSchema,
    batchItemViewSchema,
    batchResponseSchema,
    candidatesResponseSchema,
    candidateViewSchema,
    catalogSearchResponseSchema,
    catalogSearchResultViewSchema,
    foodErrorSchema,
    foodResponseSchema,
    nutrientViewSchema,
    pendingResponseSchema,
    portionViewSchema,
    foodRefEntrySchema,
    MAX_FOOD_REFS,
    resolveFoodRefsRequestSchema,
    resolveFoodRefsResponseSchema,
    resolveFoodRequestSchema,
    resolveResponseSchema,
    searchFoodQuerySchema,
    searchResponseSchema,
    searchResultViewSchema,
    searchTermQuerySchema,
    statusResponseSchema,
    variantPartViewSchema,
    variantViewSchema,
    corroboratedResponseSchema,
    authoredFoodTestPurgeResponseSchema,
} from '../src/foods/foods.schema.js';
import {
    backlogMetricsSchema,
    operationalMetricsSchema,
    queueDepthMetricsSchema,
    sourceWindowMetricsSchema,
} from '../src/foods/admin/adminMetrics.schema.js';
import { requeueResponseSchema } from '../src/foods/admin/foodRecovery.schema.js';
import {
    foodServiceErasureBeginResponseSchema,
    foodServiceErasureRequestSchema,
    foodServiceErasureAcceptedResponseSchema,
} from '../src/foods/dto/serviceErasure.schema.js';
import { healthStatusSchema } from '../src/health/health.schema.js';
import { dataSourcesResponseSchema, dataSourceViewSchema } from '../src/foods/dataSources.schema.js';
import { progressiveSearchFrameSchema, remoteFoodViewSchema } from '../src/foods/progressiveSearch.schema.js';

/**
 * The named component schemas, keyed by the name the document publishes them under.
 *
 * EXPORTED so `contract/__tests__/contract.test.ts` can hold the published document against the authored zod it
 * came from — specifically, that the document's `additionalProperties` matches what each schema actually does
 * with an unknown key. Nothing else imports it.
 *
 * `GetFoodResult` is intentionally ABSENT: it is a client-side convenience union over the `200`/`202` fork of
 * `GET /api/v1/foods/{id}`, and OpenAPI already expresses that fork as two separate responses. Publishing the
 * union as well would describe the same knowledge twice, in a document whose whole purpose is being the single
 * external description.
 */
export const openApiComponents = {
    ApiError: apiErrorSchema,
    FoodError: foodErrorSchema,
    NutrientView: nutrientViewSchema,
    PortionView: portionViewSchema,
    VariantPartView: variantPartViewSchema,
    VariantView: variantViewSchema,
    FoodResponse: foodResponseSchema,
    // U8's batch projection — documented late (U18): the shared route predates the doc-parity habit, and
    // the authored variant needed the component, so both routes are documented together now.
    FoodNutritionBatchResponse: foodNutritionBatchResponseSchema,
    PendingResponse: pendingResponseSchema,
    StatusResponse: statusResponseSchema,
    CandidateView: candidateViewSchema,
    CandidatesResponse: candidatesResponseSchema,
    SearchResultView: searchResultViewSchema,
    SearchResponse: searchResponseSchema,
    // Plan 002 S3: the split search's two bodies.
    CatalogSearchResultView: catalogSearchResultViewSchema,
    CatalogSearchResponse: catalogSearchResponseSchema,
    AuthoredFoodSearchResultView: authoredFoodSearchResultViewSchema,
    AuthoredFoodSearchResponse: authoredFoodSearchResponseSchema,
    AddResponse: addResponseSchema,
    BatchItemView: batchItemViewSchema,
    BatchResponse: batchResponseSchema,
    ResolveResponse: resolveResponseSchema,
    AddFoodRequest: addFoodRequestSchema,
    CreateAuthoredFoodRequest: createAuthoredFoodRequestSchema,
    UpdateAuthoredFoodRequest: updateAuthoredFoodRequestSchema,
    AuthoredMacros: authoredMacrosSchema,
    AuthoredPortionInput: authoredPortionInputSchema,
    BatchAddFoodRequest: batchAddFoodRequestSchema,
    ResolveFoodRequest: resolveFoodRequestSchema,
    // Curated U8's reference resolver (roots slice): the per-caller name channel a recipe line reads through.
    ResolveFoodRefsRequest: resolveFoodRefsRequestSchema,
    FoodRefEntry: foodRefEntrySchema,
    ResolveFoodRefsResponse: resolveFoodRefsResponseSchema,
    QueueDepthMetrics: queueDepthMetricsSchema,
    BacklogMetrics: backlogMetricsSchema,
    SourceWindowMetrics: sourceWindowMetricsSchema,
    OperationalMetrics: operationalMetricsSchema,
    RequeueResponse: requeueResponseSchema,
    CorroboratedResponse: corroboratedResponseSchema,
    AuthoredFoodTestPurgeResponse: authoredFoodTestPurgeResponseSchema,
    FoodServiceErasureAcceptedResponse: foodServiceErasureAcceptedResponseSchema,
    FoodServiceErasureBeginResponse: foodServiceErasureBeginResponseSchema,
    FoodServiceErasureRequest: foodServiceErasureRequestSchema,
    HealthStatus: healthStatusSchema,
    // ADR-0055 point 9: the progressive search's frames, one per line of its body.
    ProgressiveSearchFrame: progressiveSearchFrameSchema,
    RemoteFoodView: remoteFoodViewSchema,
    // ADR-0055 point 10: the remote pick command.
    AdoptRemoteFoodRequest: adoptRemoteFoodRequestSchema,
    AdoptRemoteFoodResponse: adoptRemoteFoodResponseSchema,
    // Plan R55: the Data sources page's read.
    DataSourceView: dataSourceViewSchema,
    DataSourcesResponse: dataSourcesResponseSchema,
} as const;

/** The `id` path parameter, reused by every by-id route. */
const idParameter = {
    name: 'id',
    in: 'path',
    description: 'The internal food (ingredient) ULID. NEVER a source-native key such as a USDA `fdcId`.',
    schema: z.string(),
} as const;

/** `401` — the `FoodAuthGuard` rejected or found no Clerk session / M2M token. */
const unauthorized = {
    description:
        'No valid Clerk session or M2M token — `code: UNAUTHORIZED`, or `IDENTITY_SYNC_PENDING` when the token is ' +
        'valid but its `external_id` has not synced yet (retry with a refreshed token, FR-051/CR-002).',
    schema: 'ApiError',
} as const;

/** `400` — the id or body failed boundary validation. */
const badRequest = {
    description: 'Malformed id — `code: INVALID_ID` (FR-006).',
    schema: 'ApiError',
} as const;

/** `403` — authenticated but lacking the `food:admin` scope. */
const forbidden = {
    description: 'Authenticated but lacking the `food:admin` scope — `code: FORBIDDEN` (FR-039).',
    schema: 'ApiError',
} as const;

/** `503` + `Retry-After` — the source window is full, a resolve's wait ran out, or the budget is unreadable. NEVER a `429` (FR-051). */
const shed = {
    description:
        'Fetch temporarily unavailable — the shared source window is at its ceiling, a resolve waited for room and ' +
        "none came, or the caller's source budget could not be read. `code: FETCH_UNAVAILABLE`, " +
        'with the same seconds in `details.retryAfterSeconds` and in `Retry-After`. Capacity pressure is never a ' +
        '`429`: that status means only a per-caller cap, on the routes that declare one.',
    schema: 'ApiError',
    headers: {
        'Retry-After': { description: 'Seconds to wait before retrying.', schema: z.number().int().nonnegative() },
    },
} as const;

/**
 * `429` + `Retry-After` — the caller reached its own limit on a route that makes source calls (row editor item 10).
 *
 * @param counted - What the per-minute cap counts on the route.
 * @returns The response.
 */
function requesterLimitReached(counted: string): OpenApiResponse<'ApiError'> {
    return {
        description:
            `This caller reached its per-minute cap on ${counted}, or its hourly source budget — ` +
            '`code: REQUESTER_LIMIT_REACHED`, with the same seconds in `details.retryAfterSeconds` and in ' +
            '`Retry-After`. Refused before the source is called, so it spends no quota. Never the source being busy, ' +
            'which is a `503`. The budget is charged up front and the calls a request did not make are given back.',
        schema: 'ApiError',
        headers: {
            'Retry-After': {
                description: 'Seconds until the limit admits this caller again.',
                schema: z.number().int().positive(),
            },
        },
    };
}

/** The `query` parameter of the two split search routes (plan 002 S3): required, and canonicalized by the service. */
const searchTermParameter = {
    name: 'query',
    in: 'query',
    required: true,
    description:
        'The search text. The service trims it, collapses inner whitespace and lowercases it, so a client that builds ' +
        'its URL from the same canonical form sends one URL per search. Below the shared search minimum ' +
        '(003-FR-010a) the answer is an empty `200`. Any other query parameter is a `400`.',
    schema: searchTermQuerySchema.shape.query,
} as const;

/** `400` — the split search's term failed boundary validation, or the request carried another parameter. */
const searchTermRejected = {
    description:
        'No term, a blank or over-long one, one holding a NUL byte, or an unknown query parameter — ' +
        '`code: VALIDATION_FAILED`.',
    schema: 'ApiError',
} as const;

/** `429` + `Retry-After` — the caller reached its per-minute limit on the split search (plan 002 R42). */
const searchRateLimited = {
    description:
        'This caller reached its per-minute limit on this search route — `code: SEARCH_RATE_LIMITED`, with the same ' +
        'seconds in `details.retryAfterSeconds` and in `Retry-After`. Never `REQUESTER_LIMIT_REACHED`: the search ' +
        'makes no source call.',
    schema: 'ApiError',
    headers: {
        'Retry-After': {
            description: 'Seconds until the limit admits this caller again.',
            schema: z.number().int().positive(),
        },
    },
} as const;

/** The derived document plus its response-schema coverage report. */
export const foodOpenApiDocument: OpenApiBuildResult = buildOpenApiDocument({
    title: 'Commise Food (Ingredient) API',
    version: '1.0.0',
    description:
        'The source-agnostic ingredient catalog. Despite the `food_*` naming, this service holds INGREDIENTS ' +
        'sourced from the USDA, not dishes: a recipe is a method, not a substance, and is never written back ' +
        'here (feature 001 T150). Every food is addressed by its internal ULID; no source-native key ' +
        '(`fdcId`) appears in any public shape (SC-013). EVERY non-2xx body is the shared ' +
        '`{ code, message, details? }` envelope (`ApiError`, ARCH-PS-2) — there is exactly one error shape, ' +
        'and `code` is the discriminant a client branches on, NEVER `message`. `FoodError` publishes the ' +
        'TYPED view of the same bodies: the codes this API emits and the `details` each one carries. A client ' +
        'must still tolerate a code it has not been taught (a deployed service adds codes ahead of a released ' +
        'mobile binary), so parse with `ApiError` and narrow with `FoodError`. ' +
        'Every path is also served under the DEPRECATED `/v1/*` alias held by already-shipped clients ' +
        '(ADR-0011); only the canonical `/api/v1/*` form is documented.',
    servers: [
        { url: 'https://food.commise.app', description: 'production' },
        { url: 'https://food-pr-{n}.commise.app', description: 'per-PR sandbox preview (ADR-0010)' },
    ],
    securitySchemes: {
        clerkSession: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT',
            description:
                'A Clerk session token (user) or an M2M token, verified in-process by `FoodAuthGuard`. Admin ' +
                "routes additionally require the `food:admin` scope from the token's `public_metadata`.",
        },
        serviceToken: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT',
            description:
                'A signed, single-target service token with the food audience, verified by ' +
                '`FoodServiceErasureGuard`. The target owner is BOUND IN THE TOKEN — there is no request body ' +
                'and no `ownerId` to smuggle.',
        },
    },
    defaultSecurity: ['clerkSession'],
    components: openApiComponents,
    paths: {
        '/api/v1/foods/search': {
            get: {
                operationId: 'searchFoods',
                summary: 'Search the local ingredient catalog',
                description:
                    'Local fuzzy / barcode-crosswalk search. NEVER calls an upstream source, so a miss is an ' +
                    'empty result set rather than a fetch (FR-008).',
                parameters: [
                    {
                        name: 'query',
                        in: 'query',
                        required: true,
                        description:
                            'The search text. An absent or blank one, or one holding a NUL byte, is a `400`; below the ' +
                            'shared search minimum (003-FR-010a) the answer is an empty `200`.',
                        schema: searchFoodQuerySchema.shape.query,
                    },
                ],
                responses: {
                    '200': { description: 'Ranked hits, possibly empty.', schema: 'SearchResponse' },
                    '400': {
                        description:
                            'No term, a blank or over-long one, one holding a NUL byte, or an unknown query ' +
                            'parameter — `code: VALIDATION_FAILED`.',
                        schema: 'ApiError',
                    },
                    '401': unauthorized,
                },
            },
        },
        '/api/v1/foods/catalog/search': {
            get: {
                operationId: 'searchCatalogFoods',
                summary: 'Search the shared ingredient catalog (the same answer for every caller)',
                description:
                    'Catalog roots only, ranked by text match, each with the one variant the query names, and a ' +
                    'barcode or USDA-key crosswalk hit at score 1. NEVER calls an upstream source. The answer does ' +
                    'not depend on who asks, so the production edge caches it on its URL across callers: a `200` ' +
                    "carries no `Cache-Control`, and every error is `private, no-store`. The cook's own foods are " +
                    '`GET /api/v1/foods/authored/search`, whose scores are on the same scale (plan 002 R40).',
                parameters: [searchTermParameter],
                responses: {
                    '200': { description: 'Ranked catalog roots, possibly empty.', schema: 'CatalogSearchResponse' },
                    '400': searchTermRejected,
                    '401': unauthorized,
                    '429': searchRateLimited,
                },
            },
        },
        '/api/v1/foods/authored/search': {
            get: {
                operationId: 'searchAuthoredFoods',
                summary: "Search the caller's own authored foods",
                description:
                    "The caller's own authored foods matching the term, scored on the catalog search's scale. The " +
                    "route is what makes them the caller's own: a hit carries no visibility. A withdrawn food is not " +
                    'listed. A service principal owns no foods and gets an ' +
                    'empty list. Always `private, no-store` (plan 002 R40).',
                parameters: [searchTermParameter],
                responses: {
                    '200': { description: "The caller's own matching foods.", schema: 'AuthoredFoodSearchResponse' },
                    '400': searchTermRejected,
                    '401': unauthorized,
                    '429': searchRateLimited,
                },
            },
        },
        '/api/v1/foods/authored': {
            post: {
                operationId: 'createAuthoredFood',
                summary: 'Create a user-authored food',
                description:
                    'The sibling CREATE door (U10/D9a): answers `201` with the COMPLETE entity, born RESOLVED ' +
                    'and author-PRIVATE. Walking through this door IS the provenance — there is no `source` ' +
                    'field, the author comes from the verified principal, and the food never syncs against ' +
                    'any external source. Macros are per-100g (Q3a: macros-only at launch).',
                requestBody: {
                    description: 'The name, macros and optional portions.',
                    schema: 'CreateAuthoredFoodRequest',
                },
                responses: {
                    '201': { description: 'The created food (visibility `private`).', schema: 'FoodResponse' },
                    '400': badRequest,
                    '401': unauthorized,
                    '403': {
                        description: 'A service (`svc_*`) principal — authored foods belong to user accounts.',
                        schema: 'ApiError',
                    },
                    '409': {
                        description:
                            'The caller already authored a food with this normalized name — ' +
                            '`code: DUPLICATE_AUTHORED_NAME`, with the colliding id in `details.existingId`.',
                        schema: 'ApiError',
                    },
                },
            },
        },
        '/api/v1/foods/authored/test-purge': {
            post: {
                operationId: 'purgeTestPrincipalAuthoredFoods',
                summary: "Delete the calling TEST PRINCIPAL's own private authored foods (a fixture door — ADR-0040)",
                description:
                    'NOT a product surface. Only a caller whose verified token carries ' +
                    '`public_metadata.testPrincipal === true` may use it; every other authenticated caller — a real ' +
                    'user, a `svc_*` principal, or a test principal whose `external_id` has not synced — receives ' +
                    'exactly the `404 NOT_FOUND` this service answers for a path it does not route. There is NO ' +
                    'request body: the principal is the token, and it purges only itself. Synchronous and ' +
                    "REPEATABLE: the caller's PRIVATE authored foods (withdrawn ones included) are hard-deleted " +
                    'with their nutrients, portions and versions, freeing each per-author name; PROMOTED foods are ' +
                    'kept and counted, because other cooks may depend on them; foods mid-erasure are left to the ' +
                    'erasure protocol; catalog foods are never touched.',
                responses: {
                    '200': {
                        description: 'The purge counts (both `0`-safe on a repeat run).',
                        schema: 'AuthoredFoodTestPurgeResponse',
                    },
                    '401': unauthorized,
                    '404': {
                        description: 'Not found — the caller is not an admitted test principal (`code: NOT_FOUND`).',
                        schema: 'ApiError',
                    },
                },
            },
        },
        '/api/v1/foods': {
            post: {
                operationId: 'addFoodByName',
                summary: 'Add an ingredient by name',
                description:
                    'Deduplicates against the existing catalog and enqueues a source fetch on a miss. Always ' +
                    '`202` — resolution is asynchronous (FR-005).',
                requestBody: { description: 'The display name to resolve.', schema: 'AddFoodRequest' },
                responses: {
                    '202': { description: 'Accepted; poll the id for its lifecycle.', schema: 'AddResponse' },
                    '400': {
                        description: 'Empty name after trimming — `code: VALIDATION_FAILED` (FR-006).',
                        schema: 'ApiError',
                    },
                    '401': unauthorized,
                },
            },
        },
        '/api/v1/foods/batch': {
            post: {
                operationId: 'addFoodsByNameBatch',
                summary: 'Add up to the configured maximum of ingredients by name',
                description:
                    'Per-item partial result: inline hits come back `RESOLVED`, misses `PENDING`. The maximum ' +
                    'name count is the service-configured `FOOD_MAX_BATCH_NAMES` and is reported in the `400` ' +
                    'body when exceeded, so it is discoverable at runtime rather than pinned in this document ' +
                    '(FR-045).',
                requestBody: { description: 'The names to add.', schema: 'BatchAddFoodRequest' },
                responses: {
                    '201': { description: 'Per-item partial results.', schema: 'BatchResponse' },
                    '400': {
                        description:
                            'Malformed `names` (`code: VALIDATION_FAILED`), or more names than the configured ' +
                            'maximum (`code: BATCH_TOO_LARGE`, with the cap in `details.maxNames`).',
                        schema: 'ApiError',
                    },
                    '401': unauthorized,
                },
            },
        },
        '/api/v1/foods/sources': {
            get: {
                operationId: 'listDataSources',
                summary: 'The data sources a stored nutrition value cites, for the Data sources page',
                description:
                    'Lists only the sources some stored value cites, never a registered source the catalog does not ' +
                    'use, in the register’s order. Each entry carries every word the page shows — the licence by name ' +
                    'and link, and the attribution word for word with its language — so no client maps an id to ' +
                    'anything. `converted` says some stored value from the source was converted to this app’s units ' +
                    '(per 100 g, kcal), which CC BY 4.0 §3(a)(1)(B) requires stating. Caller-independent: the answer ' +
                    'is the same for every authenticated principal.',
                responses: {
                    '200': { description: 'The cited sources, possibly none.', schema: 'DataSourcesResponse' },
                    '401': unauthorized,
                },
            },
        },
        '/api/v1/foods/nutrition': {
            get: {
                operationId: 'getNutritionBatch',
                summary: 'Batch per-100g nutrition + normalized portions (edge-cached)',
                description:
                    'Caller-INDEPENDENT by standing invariant (ADR-0020): the edge caches this on the URL ' +
                    'alone, so nothing derived from the requester may enter the response — which is exactly ' +
                    'why private authored foods land in `unknownIds` here and are served by ' +
                    '`/authored-nutrition` instead. The `ids` list is canonicalized server-side.',
                parameters: [
                    {
                        name: 'ids',
                        in: 'query',
                        required: true,
                        description: 'Comma-separated food ids (canonicalized server-side).',
                        schema: z.string(),
                    },
                ],
                responses: {
                    '200': {
                        description: 'One entry per known id, in the given order.',
                        schema: 'FoodNutritionBatchResponse',
                    },
                    '400': badRequest,
                    '401': unauthorized,
                },
            },
        },
        '/api/v1/foods/authored-nutrition': {
            get: {
                operationId: 'getAuthoredNutritionBatch',
                summary: "Batch nutrition for the caller's OWN authored foods (U18's cache split)",
                description:
                    'The authenticated, per-caller half of the nutrition read: private authored foods are ' +
                    'excluded from the edge-cached `/nutrition` route by construction, so their author reads ' +
                    'them here. Same shape; an id the caller does not own lands in `unknownIds`. Never cached.',
                parameters: [
                    {
                        name: 'ids',
                        in: 'query',
                        required: true,
                        description: 'Comma-separated food ids (canonicalized server-side).',
                        schema: z.string(),
                    },
                ],
                responses: {
                    '200': { description: 'One entry per owned id.', schema: 'FoodNutritionBatchResponse' },
                    '400': badRequest,
                    '401': unauthorized,
                },
            },
        },
        '/api/v1/foods/refs/resolve': {
            post: {
                operationId: 'resolveFoodRefs',
                summary: 'Resolve food references to what the caller may know about each',
                description:
                    'The per-caller name channel a recipe line reads through (curated U8, roots slice). Answers ' +
                    'ONE entry per distinct ref, in order of first appearance: `found` (name, status — ' +
                    '`WITHDRAWN` included — and `visibility: private` only on a PRIVATE food, which only its author can ' +
                    'resolve) or ' +
                    '`absent`. The SAME authorship policy as `GET /{id}` decides: an unknown id, a food ' +
                    "mid-erasure, a `variant` ref (none exist yet) and another user's private food all answer " +
                    'the identical `absent` entry, so a private food cannot be probed. `200` (it creates ' +
                    'nothing), `Cache-Control: private, no-store`, and deliberately outside the edge-cached ' +
                    '`/nutrition*` prefix (ADR-0020).',
                requestBody: {
                    description: `The refs (1 to ${MAX_FOOD_REFS}; duplicates allowed).`,
                    schema: 'ResolveFoodRefsRequest',
                },
                responses: {
                    '200': { description: 'One entry per distinct ref.', schema: 'ResolveFoodRefsResponse' },
                    '400': {
                        description:
                            'Empty, over-cap or malformed refs, or an unknown key — `code: VALIDATION_FAILED`.',
                        schema: 'ApiError',
                    },
                    '401': unauthorized,
                },
            },
        },
        '/api/v1/foods/search/progressive': {
            get: {
                operationId: 'searchFoodsProgressive',
                summary: 'Search our database and every remote source, answered as frames while it runs',
                description:
                    'The one search the apps read (ADR-0055 points 5 and 9). The body is newline-delimited JSON ' +
                    '(`application/x-ndjson`), one `ProgressiveSearchFrame` per line: a `database` frame holding the ' +
                    "catalog group and the caller's own authored group, each with its own outcome; one `source` frame " +
                    "per remote source as it settles (answered, busy, the caller's limit, or unavailable), naming the " +
                    'source by register id; then `complete`. A body without `complete` is incomplete. A remote hit ' +
                    'carries the name its root will carry and an opaque reference for `POST /api/v1/foods/remote/adopt`, ' +
                    'never a source key or a variant. Ignore unknown frame types, and read an unknown outcome as ' +
                    "unavailable. `Cache-Control: private, no-store`. The caller's source budget is charged per remote " +
                    'miss, never per request.',
                parameters: [searchTermParameter],
                responses: {
                    '200': {
                        description: 'Newline-delimited `ProgressiveSearchFrame`s; this schema describes one line.',
                        schema: 'ProgressiveSearchFrame',
                    },
                    '400': searchTermRejected,
                    '401': unauthorized,
                    '429': searchRateLimited,
                },
            },
        },
        '/api/v1/foods/remote/adopt': {
            post: {
                operationId: 'adoptRemoteFood',
                summary: 'Pick a remote food by the reference food issued with it',
                description:
                    'The remote pick (ADR-0055 point 10). The body carries the opaque reference a remote hit carried; the ' +
                    "source's own key never crosses the wire. Answers the catalog root the hit now is: the root that " +
                    'already stood for the item, a live catalog root that already carries its name, or a new root made ' +
                    'from one fetch of the item under the name the hit was shown with. Idempotent on the item, so a ' +
                    "`200` either way. The fetch is charged to the caller's hourly source budget and given back when " +
                    'none was made. `Cache-Control: private, no-store`.',
                requestBody: { description: 'The reference.', schema: 'AdoptRemoteFoodRequest' },
                responses: {
                    '200': { description: 'The root the remote food now is.', schema: 'AdoptRemoteFoodResponse' },
                    '400': {
                        description:
                            'A missing, empty or over-long reference, or an unknown key — `code: VALIDATION_FAILED`.',
                        schema: 'ApiError',
                    },
                    '401': unauthorized,
                    '409': {
                        description:
                            'The hit can no longer be picked: the catalog retired its item with no forward, the source no ' +
                            'longer has it, or the reference cannot be opened — `code: REMOTE_FOOD_GONE`. Search again.',
                        schema: 'ApiError',
                    },
                    '429': requesterLimitReached('remote picks, one source call per pick'),
                    '503': shed,
                },
            },
        },
        '/api/v1/foods/{id}': {
            delete: {
                operationId: 'deleteAuthoredFood',
                summary: 'Delete a user-authored food (tombstone-first, reference-checked)',
                description:
                    'R22: the food flips to an internal DELETING state (admission refuses to bind it), the ' +
                    "cross-service reference check runs with the caller's own authority, and only an " +
                    'unreferenced food deletes. Referenced → `409 FOOD_REFERENCED` with the live count and ' +
                    "the caller's OWN referencing recipe ids. Check unavailable → `503`, failed closed. " +
                    'Orphaning is erasure-only; this route never orphans.',
                parameters: [idParameter],
                responses: {
                    '204': { description: 'Deleted.' },
                    '400': badRequest,
                    '401': unauthorized,
                    '403': {
                        description: 'A stranger deleting a PROMOTED food, or a `svc_*` principal.',
                        schema: 'ApiError',
                    },
                    '404': {
                        description: 'No such food — or a PRIVATE authored food the caller does not own.',
                        schema: 'ApiError',
                    },
                    '409': {
                        description:
                            'Referenced (`code: FOOD_REFERENCED`, count + own recipe ids in `details`), or a ' +
                            'pipeline food (`code: NOT_EDITABLE`).',
                        schema: 'ApiError',
                    },
                    '503': {
                        description: 'The reference check could not run (`code: REFERENCE_CHECK_UNAVAILABLE`).',
                        schema: 'ApiError',
                    },
                },
            },
            put: {
                operationId: 'updateAuthoredFood',
                summary: 'Replace a user-authored food',
                description:
                    'Full replacement, author-only (U10): the pure authorship policy answers a stranger on a ' +
                    'PRIVATE food with the same `404` a missing id gets (existence concealed), a stranger on a ' +
                    'PROMOTED food with `403`, and ANY caller on a pipeline (catalog) food with `409 ' +
                    'NOT_EDITABLE` — catalog rows have a single writer.',
                parameters: [idParameter],
                requestBody: { description: 'The full replacement body.', schema: 'UpdateAuthoredFoodRequest' },
                responses: {
                    '200': { description: 'The updated food.', schema: 'FoodResponse' },
                    '400': badRequest,
                    '401': unauthorized,
                    '403': {
                        description: 'A stranger writing a PROMOTED food, or a `svc_*` principal.',
                        schema: 'ApiError',
                    },
                    '404': {
                        description: 'No such food — or a PRIVATE authored food the caller does not own.',
                        schema: 'ApiError',
                    },
                    '409': {
                        description:
                            "A pipeline food (`code: NOT_EDITABLE`), or a rename colliding with the caller's " +
                            'other authored food (`code: DUPLICATE_AUTHORED_NAME`).',
                        schema: 'ApiError',
                    },
                },
            },
            get: {
                operationId: 'getFood',
                summary: 'Read an ingredient golden record',
                description:
                    'The lifecycle IS the status code: `200` a golden record, `202` still pending or awaiting ' +
                    'disambiguation, `404` tombstoned (`NOT_FOUND`) or exhausted (`FAILED`) — with the status ' +
                    'still in the body (FR-002/FR-003/FR-004).',
                parameters: [idParameter],
                responses: {
                    '200': { description: 'The golden record.', schema: 'FoodResponse' },
                    '202': {
                        description: 'PENDING or UNRESOLVED — not yet readable.',
                        schema: 'PendingResponse',
                    },
                    '400': badRequest,
                    '401': unauthorized,
                    '404': {
                        description:
                            'No such food, or NOT_FOUND / FAILED — `code: FOOD_NOT_FOUND`, with the terminal ' +
                            'status in `details.status` (absent when there is no row at all).',
                        schema: 'ApiError',
                    },
                },
            },
            patch: {
                operationId: 'resolveFood',
                summary: 'Resolve an UNRESOLVED ingredient from a candidate pick',
                description: 'Merges the picked candidates into the golden record (FR-RES-2).',
                parameters: [idParameter],
                requestBody: { description: 'The picked candidate row ids.', schema: 'ResolveFoodRequest' },
                responses: {
                    '200': { description: 'Resolved.', schema: 'ResolveResponse' },
                    '400': {
                        description:
                            'Malformed id (`code: INVALID_ID`), or `candidateIds` empty, longer than the bound, or ' +
                            'naming a candidate twice (`code: VALIDATION_FAILED`, DSN-14). Refused before the ' +
                            'source is called.',
                        schema: 'ApiError',
                    },
                    '401': unauthorized,
                    '404': { description: 'No such food — `code: FOOD_NOT_FOUND`.', schema: 'ApiError' },
                    '409': {
                        description:
                            "A candidate is not in this food's set (`code: CANDIDATE_MISMATCH`), or the food is " +
                            'not awaiting disambiguation (`code: NOT_RESOLVABLE`). Both are `409`s, so the CODE — ' +
                            'never the message — is what tells them apart.',
                        schema: 'ApiError',
                    },
                    '429': requesterLimitReached('resolves, one source call per pick'),
                    '503': shed,
                },
            },
        },
        '/api/v1/foods/{id}/status': {
            get: {
                operationId: 'getFoodStatus',
                summary: 'Poll an ingredient lifecycle status',
                description: 'Never enqueues a fetch. Includes the golden record once `RESOLVED` (FR-007).',
                parameters: [idParameter],
                responses: {
                    '200': { description: 'The current status.', schema: 'StatusResponse' },
                    '400': badRequest,
                    '401': unauthorized,
                    '404': {
                        description:
                            'No such food, a food mid-erasure, or a PRIVATE authored food the caller does not own — ' +
                            'one indistinguishable `code: FOOD_NOT_FOUND`, as on `GET /{id}`.',
                        schema: 'ApiError',
                    },
                },
            },
        },
        '/api/v1/foods/{id}/candidates': {
            get: {
                operationId: 'getFoodCandidates',
                summary: 'Read the disambiguation candidate set',
                description:
                    'The non-expired cross-source candidates for an `UNRESOLVED` food; empty for any other ' +
                    'status (FR-RES-1).',
                parameters: [idParameter],
                responses: {
                    '200': { description: 'The candidate set, possibly empty.', schema: 'CandidatesResponse' },
                    '400': badRequest,
                    '401': unauthorized,
                    '404': {
                        description:
                            'No such food, a food mid-erasure, or a PRIVATE authored food the caller does not own — ' +
                            'one indistinguishable `code: FOOD_NOT_FOUND`, as on `GET /{id}`.',
                        schema: 'ApiError',
                    },
                },
            },
        },
        '/api/v1/foods/{id}/corroborated': {
            post: {
                operationId: 'corroborateFood',
                summary: 'Mark a PENDING food complete on corroborated identity (U19).',
                description:
                    "The recipe side's corroboration-promotion trigger (R10): a PENDING food completes and " +
                    'leaves the sync queue — the community agreement IS the identity source for a novel name ' +
                    'the upstream source will never carry. Every other status no-ops, answering the current ' +
                    'status: the trigger is an async quality signal, never a command.',
                parameters: [idParameter],
                responses: {
                    '200': { description: 'The (possibly unchanged) status.', schema: 'CorroboratedResponse' },
                    '400': badRequest,
                    '401': unauthorized,
                    '404': { description: 'No such food — `code: FOOD_NOT_FOUND`.', schema: 'ApiError' },
                },
            },
        },
        '/api/v1/foods/{id}/refetch': {
            post: {
                operationId: 'refetchFood',
                summary: 'Re-enqueue an ingredient fetch (admin)',
                description:
                    'Operational manual re-enqueue. Requires the `food:admin` scope, checked BEFORE id ' +
                    'validation so `403` precedes `400` (FR-039/FR-051).',
                parameters: [idParameter],
                responses: {
                    '202': { description: 'Re-enqueued.', schema: 'AddResponse' },
                    '400': badRequest,
                    '401': unauthorized,
                    '403': forbidden,
                    '404': { description: 'No such food — `code: FOOD_NOT_FOUND`.', schema: 'ApiError' },
                    '409': {
                        description:
                            'The food cannot be queued: its author withdrew it, or the seed owns it and is its one ' +
                            'writer. `code: NOT_REQUEUEABLE`, with the observed status in `details.status`.',
                        schema: 'ApiError',
                    },
                },
            },
        },
        '/api/v1/foods/admin/metrics': {
            get: {
                operationId: 'getAdminMetrics',
                summary: 'Read the full operational dashboard signals (admin)',
                description: 'Queue depths, lifecycle backlog, and per-source rolling-window utilization (FR-039).',
                responses: {
                    '200': { description: 'The operational metrics.', schema: 'OperationalMetrics' },
                    '401': unauthorized,
                    '403': forbidden,
                },
            },
        },
        '/api/v1/foods/admin/queue': {
            get: {
                operationId: 'getAdminQueueDepths',
                summary: 'Read the fetch-queue depths (admin)',
                description: 'The focused queue-depth signals on their own (FR-039).',
                responses: {
                    '200': { description: 'The queue depths.', schema: 'QueueDepthMetrics' },
                    '401': unauthorized,
                    '403': forbidden,
                },
            },
        },
        '/api/v1/foods/admin/foods/{id}/requeue': {
            post: {
                operationId: 'requeueFood',
                summary: 'Requeue a blackholed ingredient (admin)',
                description:
                    'The operator escape hatch for a food the retry budget tombstoned: it clears the terminal ' +
                    'lifecycle mark AND the attempt count so the normal drain picks the food up again (U9). ' +
                    'Requires the `food:admin` scope, checked BEFORE id validation so `403` precedes `400` ' +
                    '(FR-039/FR-051). Idempotent — requeuing an already-`PENDING` food answers `202`.',
                parameters: [idParameter],
                responses: {
                    '202': { description: 'Requeued; the food is `PENDING` again.', schema: 'RequeueResponse' },
                    '400': badRequest,
                    '401': unauthorized,
                    '403': forbidden,
                    '404': { description: 'No such food — `code: FOOD_NOT_FOUND`.', schema: 'ApiError' },
                    '409': {
                        description:
                            'The food is not blackholed — a `RESOLVED`/`UNRESOLVED` food has nothing to clear. ' +
                            '`code: NOT_REQUEUEABLE`, with the observed status in `details.status` and the ' +
                            'route that IS applicable (`POST /api/v1/foods/{id}/refetch`) named in the message.',
                        schema: 'ApiError',
                    },
                },
            },
        },
        '/api/v1/internal/account/erasure': {
            post: {
                operationId: 'eraseAccountFootprint',
                summary: "Erase the token-bound owner's ingredient footprint (service-to-service)",
                description:
                    'Called by the identity deletion-worker / erasure-reconciliation on a `user.deleted` or ' +
                    'account-closure event. Synchronous and idempotent: an owner with no footprint erases 0 ' +
                    "rows and still succeeds. The target owner comes ONLY from the verified token's bound " +
                    "claim. The optional body (U18) carries NO authority: it names which of the owner's " +
                    "authored foods the worker's reference check found still referenced — those are KEPT as " +
                    'pseudonymous orphans (Q3b); everything else deletes.',
                requestBody: {
                    description: "The worker's referenced-food list (optional).",
                    required: false,
                    schema: 'FoodServiceErasureRequest',
                },
                security: ['serviceToken'],
                responses: {
                    '200': {
                        description: 'Erased. `deletedRequesterRows` is the reconciliation residue signal.',
                        schema: 'FoodServiceErasureAcceptedResponse',
                    },
                    '401': {
                        description:
                            'The service token is absent, malformed, or not bound to the food audience — ' +
                            '`code: UNAUTHORIZED`.',
                        schema: 'ApiError',
                    },
                },
            },
        },
        '/api/v1/internal/account/erasure/begin': {
            post: {
                operationId: 'beginAccountErasure',
                summary: "Tombstone the token-bound owner's authored foods (erasure protocol step 1, U18)",
                description:
                    'Flips every authored food to an internal DELETING state — admission refuses to bind them ' +
                    'while the worker runs the cross-service reference check — and returns their ids for that ' +
                    'check. Idempotent on redelivery.',
                security: ['serviceToken'],
                responses: {
                    '200': {
                        description: 'The tombstoned authored food ids.',
                        schema: 'FoodServiceErasureBeginResponse',
                    },
                    '401': {
                        description: 'The service token is absent, malformed, or not food-audience-bound.',
                        schema: 'ApiError',
                    },
                },
            },
        },
        '/health': {
            get: {
                operationId: 'getHealth',
                summary: 'Liveness probe',
                description:
                    'Static. Deliberately does NOT touch the database — a transient RDS blip must not make ECS ' +
                    'kill an otherwise-healthy container. Deliberately PUBLIC — the ALB target group calls it ' +
                    'with no credential, and a consumer checking for contract skew must be able to ask before it ' +
                    'holds one. `contractHash` is that skew signal (§15.2.5): a client whose pinned ' +
                    '`@kitchensink/schema-food` fingerprint differs WARNS and keeps working.',
                security: [],
                responses: { '200': { description: 'The process is up.', schema: 'HealthStatus' } },
            },
        },
        '/health/ready': {
            get: {
                operationId: 'getReadiness',
                summary: 'Readiness probe',
                description:
                    'Probes the database pool so the ALB can drain an instance whose database is unreachable ' +
                    '(ARCH-PS-3).',
                security: [],
                responses: {
                    '200': { description: 'Ready to serve traffic.', schema: 'HealthStatus' },
                    '503': { description: 'Database not reachable (`NOT_READY`).', schema: 'ApiError' },
                },
            },
        },
    },
});
