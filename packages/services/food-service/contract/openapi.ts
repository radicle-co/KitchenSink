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
import type { OpenApiBuildResult } from '@kitchensink/contract-gen';
import { z } from 'zod';

import {
    apiErrorSchema,
    controllerErrorSchema,
    errorResponseSchema,
    nestHttpErrorSchema,
} from '../src/common/api-error.schema.js';
import {
    addFoodRequestSchema,
    addResponseSchema,
    batchAddFoodRequestSchema,
    batchItemViewSchema,
    batchResponseSchema,
    candidatesResponseSchema,
    candidateViewSchema,
    foodResponseSchema,
    nutrientViewSchema,
    pendingResponseSchema,
    portionViewSchema,
    resolveFoodRequestSchema,
    resolveResponseSchema,
    searchResponseSchema,
    searchResultViewSchema,
    statusResponseSchema,
} from '../src/foods/foods.schema.js';
import {
    backlogMetricsSchema,
    operationalMetricsSchema,
    queueDepthMetricsSchema,
    sourceWindowMetricsSchema,
} from '../src/foods/admin/admin-metrics.schema.js';
import { foodServiceErasureAcceptedResponseSchema } from '../src/foods/dto/service-erasure.schema.js';
import { healthStatusSchema } from '../src/health/health.schema.js';

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
    NestHttpError: nestHttpErrorSchema,
    ControllerError: controllerErrorSchema,
    ErrorResponse: errorResponseSchema,
    NutrientView: nutrientViewSchema,
    PortionView: portionViewSchema,
    FoodResponse: foodResponseSchema,
    PendingResponse: pendingResponseSchema,
    StatusResponse: statusResponseSchema,
    CandidateView: candidateViewSchema,
    CandidatesResponse: candidatesResponseSchema,
    SearchResultView: searchResultViewSchema,
    SearchResponse: searchResponseSchema,
    AddResponse: addResponseSchema,
    BatchItemView: batchItemViewSchema,
    BatchResponse: batchResponseSchema,
    ResolveResponse: resolveResponseSchema,
    AddFoodRequest: addFoodRequestSchema,
    BatchAddFoodRequest: batchAddFoodRequestSchema,
    ResolveFoodRequest: resolveFoodRequestSchema,
    QueueDepthMetrics: queueDepthMetricsSchema,
    BacklogMetrics: backlogMetricsSchema,
    SourceWindowMetrics: sourceWindowMetricsSchema,
    OperationalMetrics: operationalMetricsSchema,
    FoodServiceErasureAcceptedResponse: foodServiceErasureAcceptedResponseSchema,
    HealthStatus: healthStatusSchema,
} as const;

/** The `id` path parameter, reused by every by-id route. */
const idParameter = {
    name: 'id',
    in: 'path',
    description: 'The internal food (ingredient) ULID. NEVER a source-native key such as a USDA `fdcId`.',
    schema: z.string(),
} as const;

/** `401` — the {@link FoodAuthGuard} rejected or found no Clerk session / M2M token. */
const unauthorized = { description: 'No valid Clerk session or M2M token (FR-051).', schema: 'ErrorResponse' } as const;

/** `400` — the id or body failed boundary validation. */
const badRequest = { description: 'Malformed id or request body (FR-006).', schema: 'ErrorResponse' } as const;

/** `403` — authenticated but lacking the `food:admin` scope. */
const forbidden = {
    description: 'Authenticated but lacking the `food:admin` scope (FR-039).',
    schema: 'ErrorResponse',
} as const;

/** `503` + `Retry-After` — backpressure / flood-shed / resolve cap. NEVER a `429` (FR-051). */
const shed = {
    description:
        'Fetch temporarily unavailable — backpressure, flood-shed, or the resolve cap. Carries `Retry-After`; ' +
        'this service never answers `429`.',
    schema: 'ErrorResponse',
    headers: {
        'Retry-After': { description: 'Seconds to wait before retrying.', schema: z.number().int().nonnegative() },
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
        '(`fdcId`) appears in any public shape (SC-013). ⚠️ Error bodies are NOT uniform: see `ErrorResponse`, a ' +
        "union of the shared `{ code, message, details? }` envelope (ARCH-PS-2), Nest's default " +
        "`{ statusCode, message, error }`, and the controller's `{ error, …extras }`. Which one a caller " +
        'receives depends on which layer failed; converging them is a tracked breaking change. ' +
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
                        description: 'The search text. Absent is treated as empty, which yields no results.',
                        schema: z.string(),
                    },
                ],
                responses: {
                    '200': { description: 'Ranked hits, possibly empty.', schema: 'SearchResponse' },
                    '401': unauthorized,
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
                    '400': { description: 'Empty name after trimming (FR-006).', schema: 'ErrorResponse' },
                    '401': unauthorized,
                    '503': shed,
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
                        description: 'Malformed `names`, or more names than the configured maximum.',
                        schema: 'ErrorResponse',
                    },
                    '401': unauthorized,
                    '503': shed,
                },
            },
        },
        '/api/v1/foods/{id}': {
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
                        description: 'No such food, or NOT_FOUND / FAILED. The status is in the body.',
                        schema: 'ErrorResponse',
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
                    '400': { description: 'Malformed id or empty `candidateIds` (DSN-14).', schema: 'ErrorResponse' },
                    '401': unauthorized,
                    '404': { description: 'No such food.', schema: 'ErrorResponse' },
                    '409': {
                        description:
                            "A candidate is not in this food's set (`CANDIDATE_MISMATCH`), or the food is not " +
                            'awaiting disambiguation (`NOT_RESOLVABLE`).',
                        schema: 'ErrorResponse',
                    },
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
                    '404': { description: 'No such food.', schema: 'ErrorResponse' },
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
                    '404': { description: 'No such food.', schema: 'ErrorResponse' },
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
                    '404': { description: 'No such food.', schema: 'ErrorResponse' },
                    '503': shed,
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
        '/api/v1/internal/account/erasure': {
            post: {
                operationId: 'eraseAccountFootprint',
                summary: "Erase the token-bound owner's ingredient footprint (service-to-service)",
                description:
                    'Called by the identity deletion-worker / erasure-reconciliation on a `user.deleted` or ' +
                    'account-closure event. Synchronous and idempotent: an owner with no footprint erases 0 ' +
                    "rows and still succeeds. The target owner comes ONLY from the verified token's bound " +
                    'claim — there is no request body (CR-002/U4b/R11).',
                security: ['serviceToken'],
                responses: {
                    '200': {
                        description: 'Erased. `deletedRequesterRows` is the reconciliation residue signal.',
                        schema: 'FoodServiceErasureAcceptedResponse',
                    },
                    '401': {
                        description: 'The service token is absent, malformed, or not bound to the food audience.',
                        schema: 'ErrorResponse',
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
                    '503': { description: 'Database not reachable (`NOT_READY`).', schema: 'ErrorResponse' },
                },
            },
        },
    },
});
