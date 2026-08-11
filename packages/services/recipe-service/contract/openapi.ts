/**
 * THE RECIPE API'S OPENAPI SPEC — the declarative route table `openapi.yaml` is DERIVED from.
 *
 * WHAT THIS FILE IS. `@kitchensink/contract-gen` owns the *procedure* (zod → JSON Schema → document,
 * component registry, coverage accounting, the opaque-schema guard). This file owns the one thing that is
 * genuinely recipe-specific and cannot live anywhere else: which paths exist, what each returns, and which
 * authored schema describes it. Keeping the split that way is why there is ONE generator in the repo instead
 * of one per service — see `docs/CODING_STANDARDS.md` §15.2.
 *
 * `openapi.yaml` is a DERIVED artifact for EXTERNAL consumption — `oasdiff`, published docs, third-party
 * integrators. It is NOT a code-generation input and NOT the type authority: nothing in this repo compiles
 * against it, and the authority is the zod exported from `@kitchensink/schema-recipe`.
 *
 * ── COVERAGE IS COMPLETE: 41/41 OPERATIONS CARRY A RESPONSE SCHEMA ──
 *
 * It was 30/41 when the seam was built, and the gaps were listed rather than hidden — a document that silently
 * omits the endpoints it cannot describe reads as complete, so nobody closes the gap. They are all closed now,
 * and `formatGenerationSummary` still prints any `operationId statusCode` pair with no body schema on EVERY
 * generation run, so a REGRESSION is loud. `contract/__tests__/openapi.test.ts` pins the undescribed set at
 * `[]` in both directions.
 *
 * A response earned a schema only when a zod schema TRUE of what the server actually sends existed. Two kinds
 * of evidence backed that, and it is worth keeping the distinction because it says how much each is trusted:
 *
 *  - **Observed in production.** The recipes, photos, versions, ingredient, search and rating-read bodies are
 *    described by zod `@kitchensink/recipe-core` already owned AND that
 *    `@kitchensink/recipe-service-client` PARSES production responses with today. Were `recipeDetailSchema`
 *    wrong about a detail response, the shipped client would already be throwing on every read. The health
 *    probes joined them when `contractHash` was added to their payload for drift layer 3 — the moment a
 *    consumer is expected to read a field off `/health`, that body IS wire contract.
 *  - **Proven deliberately.** The COLLECTIONS and ACCOUNT bodies had no shared schema on either side, so the
 *    same evidence is obtained on purpose: suites drive the real services over stubbed DALs and parse their
 *    ACTUAL return values with the published schema
 *    (`src/collections/__tests__/collections.schema.test.ts`, `src/account/__tests__/account.schema.test.ts`),
 *    across the widest body, the empty body, and the all-nulls body. That is what makes these descriptions true
 *    rather than hopeful — which matters most for the account bodies, where the export is the widest
 *    personal-data egress surface the service has and erasure is irreversible.
 *
 * ── WHY ONLY THE `/api/v1/...` SPELLING IS PUBLISHED ──
 *
 * Every controller answers on BOTH `api/v1/...` and a deprecated bare `v1/...` alias (ADR-0011). The alias
 * exists for consumers configured outside this repo and for already-shipped mobile binaries; it is not
 * something a NEW integrator should be pointed at. Publishing both would double the document and advertise
 * the deprecated form as an equal choice, so only the canonical prefix is emitted and the alias is described
 * in prose.
 *
 * DESIGN PATTERN: declarative Specification object consumed by a Builder (`buildOpenApiDocument`). This
 * module is PURE — it exports data and one pure function, touches no filesystem, and boots no application.
 */
import { z } from 'zod';
import { buildOpenApiDocument } from '@kitchensink/contract-gen';
import type {
    HttpMethod,
    OpenApiBuildResult,
    OpenApiOperation,
    OpenApiParameter,
    OpenApiResponse,
} from '@kitchensink/contract-gen';
import {
    createRecipeInputSchema,
    ingredientSchema,
    paginatedResponseSchema,
    recipeDetailSchema,
    recipeErrorSchema,
    recipePhotoSchema,
    recipeSchema,
    recipeVersionSchema,
    restoreVersionResponseSchema,
    updateRecipeInputSchema,
} from '@kitchensink/recipe-core';

import {
    accountExportSchema,
    erasureRequestAcceptedResponseSchema,
    erasureRequestSchema,
    serviceErasureAcceptedResponseSchema,
} from '../src/account/account.schema.js';
import {
    addRecipeToCollectionRequestSchema,
    cloneCollectionRequestSchema,
    collectionListResponseSchema,
    collectionMemberRecipeSchema,
    collectionRecipeMembershipResponseSchema,
    collectionResponseSchema,
    collectionWithRecipesResponseSchema,
    createCollectionRequestSchema,
    pullDiffSchema,
    pullFromSourceRequestSchema,
    pullFromSourceResponseSchema,
    updateCollectionRequestSchema,
} from '../src/collections/collections.schema.js';
import { healthStatusSchema, healthUnavailableSchema } from '../src/health/health.schema.js';
import {
    addIngredientByFoodRequestSchema,
    createIngredientRequestSchema,
    ingredientCandidatesResponseSchema,
    ingredientSuggestionsResponseSchema,
    resolveIngredientRequestSchema,
} from '../src/ingredients/ingredients.schema.js';
import {
    confirmPhotoRequestSchema,
    createPhotoUploadRequestSchema,
    photoUploadUrlResponseSchema,
    reorderPhotosRequestSchema,
} from '../src/photos/photos.schema.js';
import { setRatingRequestSchema } from '../src/ratings/ratings.schema.js';
import { recipeSearchResponseSchema } from '../src/search/search.schema.js';

/**
 * The published component schemas, keyed by the name they appear under in `components.schemas`.
 *
 * Composed from `@kitchensink/recipe-core` and the service's authored `*.schema.ts`. Nothing is re-declared:
 * a component that is not backed by one of those two is absent from the document rather than invented here,
 * because a hand-written shape in this file would be a THIRD authority for a wire type.
 */
const components = {
    ErrorResponse: recipeErrorSchema,
    HealthStatus: healthStatusSchema,
    HealthUnavailable: healthUnavailableSchema,
    Recipe: recipeSchema,
    RecipeDetail: recipeDetailSchema,
    PaginatedRecipes: paginatedResponseSchema(recipeSchema),
    CreateRecipeRequest: createRecipeInputSchema,
    UpdateRecipeRequest: updateRecipeInputSchema,
    SetRatingRequest: setRatingRequestSchema,
    RecipePhoto: recipePhotoSchema,
    RecipePhotoList: z.array(recipePhotoSchema),
    CreatePhotoUploadRequest: createPhotoUploadRequestSchema,
    PhotoUploadUrlResponse: photoUploadUrlResponseSchema,
    ConfirmPhotoRequest: confirmPhotoRequestSchema,
    ReorderPhotosRequest: reorderPhotosRequestSchema,
    Ingredient: ingredientSchema,
    IngredientList: z.array(ingredientSchema),
    IngredientCandidateList: ingredientCandidatesResponseSchema,
    IngredientSuggestions: ingredientSuggestionsResponseSchema,
    CreateIngredientRequest: createIngredientRequestSchema,
    AddIngredientByFoodRequest: addIngredientByFoodRequestSchema,
    ResolveIngredientRequest: resolveIngredientRequestSchema,
    RecipeVersion: recipeVersionSchema,
    RecipeVersionList: z.array(recipeVersionSchema),
    RestoreVersionResponse: restoreVersionResponseSchema,
    RecipeSearchResponse: recipeSearchResponseSchema,
    Collection: collectionResponseSchema,
    PaginatedCollections: collectionListResponseSchema,
    // Declared as its OWN component (rather than left to inline inside `CollectionWithRecipes`) so an
    // integrator's generated client gets one named type for a collection member instead of an anonymous
    // shape, and so `oasdiff` reports a change to it once rather than at every use site.
    CollectionMemberRecipe: collectionMemberRecipeSchema,
    CollectionWithRecipes: collectionWithRecipesResponseSchema,
    CollectionRecipeMembership: collectionRecipeMembershipResponseSchema,
    CreateCollectionRequest: createCollectionRequestSchema,
    UpdateCollectionRequest: updateCollectionRequestSchema,
    AddRecipeToCollectionRequest: addRecipeToCollectionRequestSchema,
    CloneCollectionRequest: cloneCollectionRequestSchema,
    // ONE component for BOTH directions of the pull diff — it is the response of `previewPullFromSource` and
    // the `previewedDiff` a client echoes back on commit, and the drift check compares those two documents.
    PullDiff: pullDiffSchema,
    PullFromSourceRequest: pullFromSourceRequestSchema,
    PullFromSourceResponse: pullFromSourceResponseSchema,
    AccountExport: accountExportSchema,
    ErasureRequest: erasureRequestSchema,
    ErasureRequestAcceptedResponse: erasureRequestAcceptedResponseSchema,
    ServiceErasureAcceptedResponse: serviceErasureAcceptedResponseSchema,
} as const;

/** A component name, so a typo in a response is a `typecheck` failure rather than a missing `$ref`. */
type ComponentName = keyof typeof components & string;

/** One operation, narrowed to this document's component names. */
type Operation = OpenApiOperation<ComponentName>;

/** The Clerk bearer scheme every non-public operation requires. */
const CLERK_BEARER = 'clerkSessionToken';

/** The signed machine-token scheme the internal erasure route requires instead. */
const SERVICE_TOKEN = 'serviceErasureToken';

/**
 * A `uuid`-shaped path parameter.
 *
 * @param name - The parameter name as it appears in the path template.
 * @param description - What the id identifies.
 * @returns The parameter declaration. Pure.
 */
function uuidPathParam(name: string, description: string): OpenApiParameter {
    return { name, in: 'path', required: true, description, schema: z.uuid() };
}

/**
 * The error responses that any authenticated operation can produce.
 *
 * Declared once and spread into each operation rather than repeated: these come from the GLOBAL
 * `AuthMiddleware` / `UserThrottlerGuard` / `ErasureLockGuard` / `ApiExceptionFilter`, so they are a property
 * of the service, not of any one handler. A per-operation copy would be ~30 chances to describe one behaviour
 * differently.
 *
 * @returns The shared 4xx/5xx responses. Pure.
 */
function sharedErrorResponses(): Readonly<Record<string, OpenApiResponse<ComponentName>>> {
    return {
        '400': { description: 'The request body or query failed validation.', schema: 'ErrorResponse' },
        '401': {
            description: 'No, invalid, expired, or wrong-authorized-party bearer token.',
            schema: 'ErrorResponse',
        },
        '423': {
            description: 'The caller has an in-flight account erasure, so writes are locked (HAZ-052).',
            schema: 'ErrorResponse',
        },
        '429': {
            description: 'Per-user rate limit exceeded.',
            schema: 'ErrorResponse',
            headers: {
                'Retry-After': { description: 'Seconds until the limit resets.', schema: z.number().int().positive() },
            },
        },
        '500': { description: 'Unexpected server error. The body never carries internals.', schema: 'ErrorResponse' },
    };
}

/** The `404` a recipe-scoped operation produces for a missing, tombstoned, or invisible recipe. */
const RECIPE_NOT_FOUND: OpenApiResponse<ComponentName> = {
    description: 'No such recipe, or it is not visible to the caller.',
    schema: 'ErrorResponse',
};

/** The `403` an owner-only operation produces for another owner's resource. */
const NOT_OWNER: OpenApiResponse<ComponentName> = {
    description: 'The caller does not own the resource.',
    schema: 'ErrorResponse',
};

/** The paths, canonical `/api/v1` spelling only. */
const paths: Readonly<Record<string, Partial<Record<HttpMethod, Operation>>>> = {
    '/health': {
        get: {
            operationId: 'getHealth',
            summary: 'Liveness probe.',
            description:
                'Deliberately PUBLIC — the ALB target group calls it with no credential, and a consumer checking for contract skew must be able to ask before it holds one. `contractHash` is that skew signal (§15.2.5).',
            security: [],
            responses: {
                '200': { description: 'The service is running.', schema: 'HealthStatus' },
            },
        },
    },
    '/health/ready': {
        get: {
            operationId: 'getReadiness',
            summary: 'Readiness probe (checks the database connection).',
            description: 'Deliberately PUBLIC.',
            security: [],
            responses: {
                '200': { description: 'The database answered; the service is ready.', schema: 'HealthStatus' },
                '503': {
                    description: 'The database did not answer within the probe timeout.',
                    schema: 'HealthUnavailable',
                },
            },
        },
    },
    '/api/v1/recipes': {
        post: {
            operationId: 'createRecipe',
            summary: 'Create a recipe owned by the caller.',
            requestBody: { description: 'The recipe to create.', required: true, schema: 'CreateRecipeRequest' },
            responses: {
                '201': { description: 'The created recipe.', schema: 'RecipeDetail' },
                ...sharedErrorResponses(),
            },
        },
        get: {
            operationId: 'listRecipes',
            summary: "List the caller's recipes, newest-updated first by default.",
            parameters: [
                { name: 'page', in: 'query', description: '1-based page number.', schema: z.number().int().min(1) },
                {
                    name: 'pageSize',
                    in: 'query',
                    description: 'Page size, 1..100.',
                    schema: z.number().int().min(1).max(100),
                },
                {
                    name: 'sortBy',
                    in: 'query',
                    description: 'Sort key.',
                    schema: z.enum(['updatedAt', 'createdAt', 'title']),
                },
            ],
            responses: {
                '200': { description: 'A page of the caller’s recipes.', schema: 'PaginatedRecipes' },
                ...sharedErrorResponses(),
            },
        },
    },
    '/api/v1/recipes/{id}': {
        get: {
            operationId: 'getRecipeById',
            summary: 'Read one recipe (the owner’s, or any public recipe).',
            parameters: [uuidPathParam('id', 'The recipe id.')],
            responses: {
                '200': { description: 'The recipe, with photos and nutrition.', schema: 'RecipeDetail' },
                '404': RECIPE_NOT_FOUND,
                '410': { description: 'The recipe was erased (tombstoned).', schema: 'ErrorResponse' },
                ...sharedErrorResponses(),
            },
        },
        patch: {
            operationId: 'updateRecipe',
            summary: 'Update the caller’s recipe (optimistic concurrency on `currentVersion`).',
            parameters: [uuidPathParam('id', 'The recipe id.')],
            requestBody: { description: 'The fields to change.', required: true, schema: 'UpdateRecipeRequest' },
            responses: {
                '200': { description: 'The updated recipe.', schema: 'RecipeDetail' },
                '403': NOT_OWNER,
                '404': RECIPE_NOT_FOUND,
                '409': {
                    description: 'Version conflict — the recipe changed since the caller read it.',
                    schema: 'ErrorResponse',
                },
                ...sharedErrorResponses(),
            },
        },
        delete: {
            operationId: 'deleteRecipe',
            summary: 'Soft-delete the caller’s recipe.',
            parameters: [uuidPathParam('id', 'The recipe id.')],
            responses: {
                '204': { description: 'Deleted.' },
                '403': NOT_OWNER,
                '404': RECIPE_NOT_FOUND,
                ...sharedErrorResponses(),
            },
        },
    },
    '/api/v1/recipes/{id}/clone': {
        post: {
            operationId: 'cloneRecipe',
            summary: 'Clone a visible recipe into the caller’s collection.',
            parameters: [uuidPathParam('id', 'The recipe to clone.')],
            responses: {
                '201': { description: 'The caller’s new clone.', schema: 'RecipeDetail' },
                '404': RECIPE_NOT_FOUND,
                ...sharedErrorResponses(),
            },
        },
    },
    '/api/v1/recipes/{id}/visibility': {
        patch: {
            operationId: 'setRecipeVisibility',
            summary: 'Set the caller’s recipe visibility (`public` | `private`).',
            description:
                'The request body is NOT described yet: the visibility body has no authored `*.schema.ts`, and inventing one here would be a third authority for it.',
            parameters: [uuidPathParam('id', 'The recipe id.')],
            responses: {
                '200': { description: 'The updated recipe.', schema: 'RecipeDetail' },
                '403': NOT_OWNER,
                '404': RECIPE_NOT_FOUND,
                ...sharedErrorResponses(),
            },
        },
    },
    '/api/v1/recipes/{id}/rating': {
        put: {
            operationId: 'setRecipeRating',
            summary: 'Set the caller’s rating on someone else’s recipe (idempotent upsert).',
            description: 'The rater is always the bearer token’s subject; a body `userId` is stripped.',
            parameters: [uuidPathParam('id', 'The recipe id.')],
            requestBody: { description: 'Whole stars, 1..5.', required: true, schema: 'SetRatingRequest' },
            responses: {
                '200': { description: 'The recipe with refreshed rating aggregates.', schema: 'RecipeDetail' },
                '403': { description: 'A caller may not rate their own recipe.', schema: 'ErrorResponse' },
                '404': RECIPE_NOT_FOUND,
                ...sharedErrorResponses(),
            },
        },
        delete: {
            operationId: 'deleteRecipeRating',
            summary: 'Remove the caller’s rating (idempotent).',
            parameters: [uuidPathParam('id', 'The recipe id.')],
            responses: { '204': { description: 'Removed.' }, '404': RECIPE_NOT_FOUND, ...sharedErrorResponses() },
        },
    },
    '/api/v1/recipes/{recipeId}/photos': {
        get: {
            operationId: 'listRecipePhotos',
            summary: 'List a recipe’s photos in display order.',
            parameters: [uuidPathParam('recipeId', 'The recipe id.')],
            responses: {
                '200': { description: 'The recipe’s photos.', schema: 'RecipePhotoList' },
                '404': RECIPE_NOT_FOUND,
                ...sharedErrorResponses(),
            },
        },
    },
    '/api/v1/recipes/{recipeId}/photos/upload-url': {
        post: {
            operationId: 'createPhotoUploadUrl',
            summary: 'Presign a direct-to-S3 upload for a new photo.',
            description:
                'Returns `200`, not `201`: nothing is created here — the row is created at `confirm`. A content type outside the jpeg/png/webp allowlist is a `415`, and a declared size above 5 MB a `413`; neither is a `400`.',
            parameters: [uuidPathParam('recipeId', 'The recipe id.')],
            requestBody: {
                description: 'The file the client intends to upload.',
                required: true,
                schema: 'CreatePhotoUploadRequest',
            },
            responses: {
                '200': { description: 'A presigned upload target.', schema: 'PhotoUploadUrlResponse' },
                '403': NOT_OWNER,
                '404': RECIPE_NOT_FOUND,
                '413': { description: 'The declared size exceeds the 5 MB cap.', schema: 'ErrorResponse' },
                '415': { description: 'The content type is not jpeg, png, or webp.', schema: 'ErrorResponse' },
                ...sharedErrorResponses(),
            },
        },
    },
    '/api/v1/recipes/{recipeId}/photos/confirm': {
        post: {
            operationId: 'confirmPhotoUpload',
            summary: 'Validate the uploaded object by magic bytes and persist the photo.',
            parameters: [uuidPathParam('recipeId', 'The recipe id.')],
            requestBody: { description: 'The object key to confirm.', required: true, schema: 'ConfirmPhotoRequest' },
            responses: {
                '201': { description: 'The persisted photo.', schema: 'RecipePhoto' },
                '403': NOT_OWNER,
                '404': RECIPE_NOT_FOUND,
                '409': { description: 'The recipe already has the maximum of 10 photos.', schema: 'ErrorResponse' },
                '413': { description: 'The stored object exceeds the 5 MB cap.', schema: 'ErrorResponse' },
                '422': {
                    description: 'The stored bytes are not a servable jpeg, png, or webp.',
                    schema: 'ErrorResponse',
                },
                ...sharedErrorResponses(),
            },
        },
    },
    '/api/v1/recipes/{recipeId}/photos/reorder': {
        patch: {
            operationId: 'reorderRecipePhotos',
            summary: 'Set the recipe’s photo display order.',
            parameters: [uuidPathParam('recipeId', 'The recipe id.')],
            requestBody: {
                description: 'Photo ids in the desired order.',
                required: true,
                schema: 'ReorderPhotosRequest',
            },
            responses: {
                '200': { description: 'The photos in their new order.', schema: 'RecipePhotoList' },
                '403': NOT_OWNER,
                '404': RECIPE_NOT_FOUND,
                ...sharedErrorResponses(),
            },
        },
    },
    '/api/v1/recipes/{recipeId}/photos/{photoId}': {
        delete: {
            operationId: 'deleteRecipePhoto',
            summary: 'Remove a photo from the recipe (and invalidate its CDN paths).',
            parameters: [uuidPathParam('recipeId', 'The recipe id.'), uuidPathParam('photoId', 'The photo id.')],
            responses: {
                '204': { description: 'Removed.' },
                '403': NOT_OWNER,
                '404': RECIPE_NOT_FOUND,
                ...sharedErrorResponses(),
            },
        },
    },
    '/api/v1/recipes/{recipeId}/versions': {
        get: {
            operationId: 'listRecipeVersions',
            summary: 'List a recipe’s version history, newest first.',
            parameters: [uuidPathParam('recipeId', 'The recipe id.')],
            responses: {
                '200': { description: 'The version history.', schema: 'RecipeVersionList' },
                '404': RECIPE_NOT_FOUND,
                ...sharedErrorResponses(),
            },
        },
    },
    '/api/v1/recipes/{recipeId}/versions/{versionNumber}': {
        get: {
            operationId: 'getRecipeVersion',
            summary: 'Read one archived version.',
            parameters: [
                uuidPathParam('recipeId', 'The recipe id.'),
                {
                    name: 'versionNumber',
                    in: 'path',
                    required: true,
                    description: 'The 1-based version number.',
                    schema: z.number().int().positive(),
                },
            ],
            responses: {
                '200': { description: 'The archived version.', schema: 'RecipeVersion' },
                '404': { description: 'No such recipe or version.', schema: 'ErrorResponse' },
                ...sharedErrorResponses(),
            },
        },
    },
    '/api/v1/recipes/{recipeId}/versions/{versionNumber}/restore': {
        post: {
            operationId: 'restoreRecipeVersion',
            summary: 'Restore an archived version onto the live recipe.',
            parameters: [
                uuidPathParam('recipeId', 'The recipe id.'),
                {
                    name: 'versionNumber',
                    in: 'path',
                    required: true,
                    description: 'The version to restore.',
                    schema: z.number().int().positive(),
                },
            ],
            responses: {
                '200': {
                    description: 'The restored recipe and the version it created.',
                    schema: 'RestoreVersionResponse',
                },
                '403': NOT_OWNER,
                '404': { description: 'No such recipe or version.', schema: 'ErrorResponse' },
                '409': { description: 'The version archive is still pending.', schema: 'ErrorResponse' },
                ...sharedErrorResponses(),
            },
        },
    },
    '/api/v1/search/recipes': {
        get: {
            operationId: 'searchRecipes',
            summary: 'Full-text and facet search over visible recipes.',
            description:
                'Array filters accept either repeated params (`?tags=a&tags=b`) or one comma-separated value (`?tags=a,b`).',
            parameters: [
                { name: 'query', in: 'query', description: 'Free-text query.', schema: z.string() },
                { name: 'cuisine', in: 'query', description: 'Exact cuisine filter.', schema: z.string() },
                { name: 'dietaryFlags', in: 'query', description: 'Dietary-flag filter.', schema: z.array(z.string()) },
                { name: 'tags', in: 'query', description: 'Tag filter.', schema: z.array(z.string()) },
                { name: 'ingredientIds', in: 'query', description: 'Ingredient filter.', schema: z.array(z.string()) },
                {
                    name: 'maxPrepTime',
                    in: 'query',
                    description: 'Maximum prep minutes.',
                    schema: z.number().int().min(0),
                },
                {
                    name: 'maxCookTime',
                    in: 'query',
                    description: 'Maximum cook minutes.',
                    schema: z.number().int().min(0),
                },
                {
                    name: 'maxTotalTime',
                    in: 'query',
                    description: 'Maximum total minutes.',
                    schema: z.number().int().min(0),
                },
                { name: 'page', in: 'query', description: '1-based page number.', schema: z.number().int().min(1) },
                { name: 'pageSize', in: 'query', description: 'Page size.', schema: z.number().int().min(1) },
                {
                    name: 'sortBy',
                    in: 'query',
                    description: 'Sort key.',
                    schema: z.enum(['relevance', 'newest', 'rating', 'most-cloned', 'quickest']),
                },
            ],
            responses: {
                '200': { description: 'A ranked page of hits plus facet counts.', schema: 'RecipeSearchResponse' },
                ...sharedErrorResponses(),
            },
        },
    },
    '/api/v1/ingredients/search': {
        get: {
            operationId: 'searchIngredients',
            summary: 'Search the local ingredient catalog.',
            parameters: [
                { name: 'q', in: 'query', required: true, description: 'The search term.', schema: z.string().min(1) },
                { name: 'limit', in: 'query', description: 'Maximum results.', schema: z.number().int().positive() },
            ],
            responses: {
                '200': { description: 'Matching catalog rows.', schema: 'IngredientList' },
                ...sharedErrorResponses(),
            },
        },
    },
    '/api/v1/ingredients/suggest': {
        get: {
            operationId: 'suggestIngredients',
            summary: 'Blended typeahead over the local catalog and the food (ingredient) service.',
            description:
                'Sectioned, never interleaved: every `local` suggestion precedes every `catalog` one, so the familiar list does not reorder when the catalog section appears or vanishes. A `catalog` hit has no ingredient id and must be admitted via `by-food` before it can go on a recipe line — narrow on `provenance`.',
            parameters: [
                { name: 'q', in: 'query', required: true, description: 'The search term.', schema: z.string().min(1) },
                { name: 'limit', in: 'query', description: 'Maximum results.', schema: z.number().int().positive() },
            ],
            responses: {
                '200': { description: 'Blended suggestions, local section first.', schema: 'IngredientSuggestions' },
                ...sharedErrorResponses(),
            },
        },
    },
    '/api/v1/ingredients': {
        post: {
            operationId: 'createIngredient',
            summary: 'Create a user-entered ingredient.',
            requestBody: { description: 'The ingredient name.', required: true, schema: 'CreateIngredientRequest' },
            responses: {
                '201': { description: 'The created ingredient.', schema: 'Ingredient' },
                ...sharedErrorResponses(),
            },
        },
    },
    '/api/v1/ingredients/by-name': {
        post: {
            operationId: 'addIngredientByName',
            summary: 'Admit an ingredient by name, resolving it against the food catalog asynchronously.',
            description:
                'Returns `202`, not `201`: the row is created synchronously but nutrition resolution is not, so the caller polls `GET …/{id}/status`.',
            requestBody: { description: 'The ingredient name.', required: true, schema: 'CreateIngredientRequest' },
            responses: {
                '202': { description: 'Accepted; resolution continues in the background.', schema: 'Ingredient' },
                ...sharedErrorResponses(),
            },
        },
    },
    '/api/v1/ingredients/by-food': {
        post: {
            operationId: 'addIngredientByFood',
            summary: 'Admit a food-catalog golden record as a local ingredient row.',
            requestBody: {
                description: 'The opaque food id from a `catalog` suggestion.',
                required: true,
                schema: 'AddIngredientByFoodRequest',
            },
            responses: {
                '200': { description: 'The admitted ingredient.', schema: 'Ingredient' },
                ...sharedErrorResponses(),
            },
        },
    },
    '/api/v1/ingredients/{id}/status': {
        get: {
            operationId: 'getIngredientStatus',
            summary: 'Read an ingredient’s food-resolution status.',
            parameters: [uuidPathParam('id', 'The ingredient id.')],
            responses: {
                '200': { description: 'The ingredient.', schema: 'Ingredient' },
                '404': { description: 'No such ingredient.', schema: 'ErrorResponse' },
                ...sharedErrorResponses(),
            },
        },
    },
    '/api/v1/ingredients/{id}/candidates': {
        get: {
            operationId: 'getIngredientCandidates',
            summary: 'List cross-source disambiguation candidates for an unresolved ingredient.',
            description:
                'The body is RECIPE’s own `IngredientCandidate`, mapped at the gateway from the food service’s `CandidateView` — see `src/ingredients/ingredients.schema.ts` for that ownership decision and its accepted consequences. Source-agnostic: keyed by the candidate’s opaque handle, never a USDA `fdcId`.',
            parameters: [uuidPathParam('id', 'The ingredient id.')],
            responses: {
                '200': {
                    description: 'The candidates, or an empty array when the ingredient has no food id.',
                    schema: 'IngredientCandidateList',
                },
                '404': { description: 'No such ingredient.', schema: 'ErrorResponse' },
                ...sharedErrorResponses(),
            },
        },
    },
    '/api/v1/ingredients/{id}/resolve': {
        post: {
            operationId: 'resolveIngredient',
            summary: 'Resolve an unresolved ingredient by picking one or more candidates.',
            requestBody: {
                description: 'The candidate handles to resolve against (1..20).',
                required: true,
                schema: 'ResolveIngredientRequest',
            },
            parameters: [uuidPathParam('id', 'The ingredient id.')],
            responses: {
                '200': { description: 'The resolved ingredient.', schema: 'Ingredient' },
                '400': { description: 'A candidate id is unknown to this ingredient.', schema: 'ErrorResponse' },
                '404': { description: 'No such ingredient.', schema: 'ErrorResponse' },
                ...sharedErrorResponses(),
            },
        },
    },
    '/api/v1/collections': {
        post: {
            operationId: 'createCollection',
            summary: 'Create a collection owned by the caller.',
            description:
                'Visibility defaults to `private` (FR-010). `ownerId` is not an accepted field — ownership comes from the verified token, and an `ownerId` in the body is stripped.',
            requestBody: {
                description: 'The collection to create.',
                required: true,
                schema: 'CreateCollectionRequest',
            },
            responses: {
                '201': { description: 'The created collection.', schema: 'Collection' },
                '409': { description: 'The caller is at the 50-collection cap.', schema: 'ErrorResponse' },
                ...sharedErrorResponses(),
            },
        },
        get: {
            operationId: 'listCollections',
            summary: 'List the caller’s collections.',
            description:
                'Newest first. `recipeCount` is OMITTED on this list projection (it is present on the single-collection read) — counting members per row would be an N+1.',
            parameters: [
                { name: 'page', in: 'query', description: '1-based page number.', schema: z.number().int().min(1) },
                {
                    name: 'pageSize',
                    in: 'query',
                    description: 'Page size, 1..100.',
                    schema: z.number().int().min(1).max(100),
                },
            ],
            responses: {
                '200': { description: 'A page of collections.', schema: 'PaginatedCollections' },
                ...sharedErrorResponses(),
            },
        },
    },
    '/api/v1/collections/{id}': {
        get: {
            operationId: 'getCollectionById',
            summary: 'Read a collection with its member recipes.',
            description:
                '`recipes` is ALWAYS present — an empty array means “no members you can see”, which is a real state. Members are filtered to those the caller may view, so a member that has since gone private simply disappears. `coverPhotoUrl` is never populated on this embed.',
            parameters: [uuidPathParam('id', 'The collection id.')],
            responses: {
                '200': { description: 'The collection and its members.', schema: 'CollectionWithRecipes' },
                '404': { description: 'No such collection.', schema: 'ErrorResponse' },
                ...sharedErrorResponses(),
            },
        },
        patch: {
            operationId: 'updateCollection',
            summary: 'Update a collection (at least one field required).',
            description:
                'AT LEAST ONE FIELD IS REQUIRED, and that rule is NOT expressible in this document: it is a zod `.refine()`, which JSON Schema cannot represent, so an empty object validates here and is answered `400` by the service. Stated rather than dropped — dropping the rule would turn a client bug into a silent success.',
            parameters: [uuidPathParam('id', 'The collection id.')],
            requestBody: { description: 'The fields to change.', required: true, schema: 'UpdateCollectionRequest' },
            responses: {
                '200': { description: 'The updated collection.', schema: 'Collection' },
                '403': NOT_OWNER,
                '404': { description: 'No such collection.', schema: 'ErrorResponse' },
                ...sharedErrorResponses(),
            },
        },
        delete: {
            operationId: 'deleteCollection',
            summary: 'Delete a collection (its recipes are untouched).',
            parameters: [uuidPathParam('id', 'The collection id.')],
            responses: {
                '204': { description: 'Deleted.' },
                '403': NOT_OWNER,
                '404': { description: 'No such collection.', schema: 'ErrorResponse' },
                ...sharedErrorResponses(),
            },
        },
    },
    '/api/v1/collections/{id}/recipes': {
        post: {
            operationId: 'addRecipeToCollection',
            summary: 'Add a recipe to a collection.',
            description:
                'Idempotent. A recipe the caller cannot VIEW is answered `404`, not `403`, so a private recipe’s existence is never disclosed. The response body’s timestamp field is `createdAt`, while the persisted column and the shared domain type both call it `addedAt`.',
            parameters: [uuidPathParam('id', 'The collection id.')],
            requestBody: {
                description: 'The recipe to add.',
                required: true,
                schema: 'AddRecipeToCollectionRequest',
            },
            responses: {
                '201': { description: 'The created membership.', schema: 'CollectionRecipeMembership' },
                '403': NOT_OWNER,
                '404': { description: 'No such collection or recipe.', schema: 'ErrorResponse' },
                ...sharedErrorResponses(),
            },
        },
    },
    '/api/v1/collections/{id}/recipes/{recipeId}': {
        delete: {
            operationId: 'removeRecipeFromCollection',
            summary: 'Remove a recipe from a collection.',
            parameters: [uuidPathParam('id', 'The collection id.'), uuidPathParam('recipeId', 'The recipe to remove.')],
            responses: {
                '204': { description: 'Removed.' },
                '403': NOT_OWNER,
                '404': { description: 'No such collection or membership.', schema: 'ErrorResponse' },
                ...sharedErrorResponses(),
            },
        },
    },
    '/api/v1/collections/{id}/clone': {
        post: {
            operationId: 'cloneCollection',
            summary: 'Clone a visible collection, seeding it with the source’s recipes.',
            description:
                'The BODY IS OPTIONAL — a bodyless POST inherits the source’s name/description. The clone is always `private` regardless of the source’s visibility, and its source attribution is FROZEN at clone time (a later rename of the source owner does not propagate). The seed set is read through the CLONER’s eyes, so the source’s private recipes are excluded.',
            parameters: [uuidPathParam('id', 'The collection to clone.')],
            requestBody: {
                description: 'Optional name/description overrides for the clone.',
                required: false,
                schema: 'CloneCollectionRequest',
            },
            responses: {
                '201': { description: 'The caller’s new clone.', schema: 'Collection' },
                '404': { description: 'No such collection.', schema: 'ErrorResponse' },
                '409': { description: 'The caller is at the 50-collection cap.', schema: 'ErrorResponse' },
                ...sharedErrorResponses(),
            },
        },
    },
    '/api/v1/collections/{id}/pull-from-source/preview': {
        post: {
            operationId: 'previewPullFromSource',
            summary: 'Preview what a pull from the source collection would add.',
            description:
                'READ-ONLY — the service runs it in a read-only transaction, so a preview is structurally incapable of writing. Echo the returned document back as `previewedDiff` on the commit call to get the drift guard. Buckets are sorted and de-duplicated, and that ordering is significant: byte-equality is the drift signal.',
            parameters: [uuidPathParam('id', 'The cloned collection id.')],
            responses: {
                '200': { description: 'The three-way diff of source against clone.', schema: 'PullDiff' },
                '400': {
                    description: 'The collection was never cloned, so it has no source.',
                    schema: 'ErrorResponse',
                },
                '403': NOT_OWNER,
                '404': { description: 'No such collection.', schema: 'ErrorResponse' },
                ...sharedErrorResponses(),
            },
        },
    },
    '/api/v1/collections/{id}/pull-from-source': {
        post: {
            operationId: 'pullCollectionFromSource',
            summary: 'Pull new recipes from the source collection into the clone.',
            description:
                'ADDITIVE ONLY: recipes the source owner has since removed are LEFT IN PLACE, so there is deliberately no `removed` field in the response. An empty `addedRecipeIds` is the ordinary “nothing new” outcome. The BODY IS OPTIONAL — omitting `previewedDiff` applies directly with no drift guard.',
            parameters: [uuidPathParam('id', 'The cloned collection id.')],
            requestBody: {
                description: 'Optionally echoes the previewed diff as the drift baseline.',
                required: false,
                schema: 'PullFromSourceRequest',
            },
            responses: {
                '200': {
                    description: 'The refreshed collection and the recipe ids the pull added.',
                    schema: 'PullFromSourceResponse',
                },
                '400': {
                    description: 'The collection was never cloned, so it has no source.',
                    schema: 'ErrorResponse',
                },
                '403': NOT_OWNER,
                '404': { description: 'No such collection.', schema: 'ErrorResponse' },
                '409': { description: 'The previewed diff no longer matches the source.', schema: 'ErrorResponse' },
                ...sharedErrorResponses(),
            },
        },
    },
    '/api/v1/account/export': {
        get: {
            operationId: 'exportAccount',
            summary: 'Export everything the recipe service holds for the caller.',
            description:
                'GDPR Art. 15 (access) + Art. 20 (portability). The read-only INVERSE of erasure: it returns the same owner-scoped roots erasure removes or keeps. Scoped ENTIRELY by the verified token — there is no body or query parameter that can point it at another account. Two shape decisions differ from the API’s read contracts on purpose: an absent value is an explicit `null` rather than an omitted key, and `numeric` columns (`averageRating`, `leadCaloriesPerServing`) stay STRINGS, because a portability document reports what is stored. Photo and version entries carry METADATA and resolved CDN URLs, never bytes. Rate-limited with the tightest (export) cap.',
            responses: {
                '200': { description: 'The caller’s full export.', schema: 'AccountExport' },
                ...sharedErrorResponses(),
            },
        },
    },
    '/api/v1/account/erasure': {
        post: {
            operationId: 'requestAccountErasure',
            summary: 'Request irreversible erasure of the caller’s account data.',
            description:
                'IRREVERSIBLE. `confirmationPhrase` is the intent gate and is REQUIRED; its VALUE is checked by the service, not by request validation, so the accepted literal is deliberately NOT published as an enum here — a `400` reports a mismatch without echoing what was expected. There is no `ownerId` field: the owner comes from the verified token, and a smuggled one is stripped. Idempotent per C-007 — an in-flight job is RETURNED rather than a second one started, and there is no `409`, because a duplicate erasure request is the same request again. `publishRecipeIds` is the optional per-recipe DONATE election (CR-002 / U3b): a listed recipe is published and KEPT under a pseudonymous handle the erased owner no longer controls, instead of being removed; absent or empty means donate nothing.',
            requestBody: {
                description: 'The confirmation phrase, plus the optional donate election.',
                required: true,
                schema: 'ErasureRequest',
            },
            responses: {
                '202': {
                    description: 'The queued or already-running erasure job.',
                    schema: 'ErasureRequestAcceptedResponse',
                },
                '410': { description: 'The account was already erased.', schema: 'ErrorResponse' },
                ...sharedErrorResponses(),
            },
        },
    },
    '/api/v1/internal/account/erasure': {
        post: {
            operationId: 'requestServiceErasure',
            summary: 'Service-principal erasure trigger, called by the identity deletion worker.',
            description:
                'NOT a public endpoint and NOT Clerk-authenticated: it authenticates with a signed machine token and is excluded from the Clerk middleware so its own guard is the fail-closed enforcement point (ADR-0011). It takes NO REQUEST BODY, deliberately — the target owner is the token’s bound claim, so there is nothing for a caller to supply and no confirmation phrase (the token IS the authorization). Unlike the user route, an already-erased account is an idempotent no-op SUCCESS reporting `status: completed` with no `jobId`, not a `410`: the deletion-worker caller only needs to know the erasure is handled. There is no donate election on this path (KTD-2) — every owner-only recipe is removed.',
            security: [SERVICE_TOKEN],
            responses: {
                '202': {
                    description: 'The queued, already-running, or already-completed erasure job.',
                    schema: 'ServiceErasureAcceptedResponse',
                },
                '401': { description: 'Missing, invalid, or expired service token.', schema: 'ErrorResponse' },
                '500': { description: 'Unexpected server error.', schema: 'ErrorResponse' },
            },
        },
    },
};

/**
 * Build the recipe API's OpenAPI document and its coverage report.
 *
 * @returns The document to serialize plus what it does and does not cover.
 * @throws When a component schema degenerates to an opaque `object`, or two operations share an id.
 */
export function buildRecipeOpenApiDocument(): OpenApiBuildResult {
    return buildOpenApiDocument({
        title: 'Commise Recipe API',
        version: '1.0.0',
        description: [
            'The recipe service owns this contract. It is DERIVED from the service’s authored zod',
            '(`src/**/*.schema.ts` plus the `@kitchensink/recipe-core` schemas those compose), never',
            'hand-written, and it is not a code-generation input.',
            '',
            'Every path is also served under a deprecated bare `/v1/...` alias for consumers configured',
            'outside this repo and for already-shipped mobile binaries (ADR-0011). New integrators must use',
            'the `/api/v1/...` spelling published here.',
            '',
            'Coverage is partial and the gaps are enumerated by the generator on every run: an operation with',
            'no response schema is one whose body has no authored zod yet, not one whose body is empty.',
        ].join('\n'),
        servers: [
            { url: 'https://recipe.commise.app', description: 'Production' },
            { url: 'https://recipe.sandbox.commise.app', description: 'Sandbox' },
        ],
        securitySchemes: {
            [CLERK_BEARER]: {
                type: 'http',
                scheme: 'bearer',
                bearerFormat: 'JWT',
                description:
                    'A Clerk session token. Verified networklessly against the instance JWT key, with the signed `azp` checked against the service’s authorized-party pattern.',
            },
            [SERVICE_TOKEN]: {
                type: 'http',
                scheme: 'bearer',
                bearerFormat: 'JWT',
                description: 'A signed service-principal token, used only by the internal erasure route.',
            },
        },
        defaultSecurity: [CLERK_BEARER],
        components,
        paths,
    });
}
