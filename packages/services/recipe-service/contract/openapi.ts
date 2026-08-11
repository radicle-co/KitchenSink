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
 * ── COVERAGE IS DELIBERATELY PARTIAL, AND THE GAPS ARE REPORTED, NOT HIDDEN ──
 *
 * Every operation the service serves is listed here, including the ones whose RESPONSE BODY has no schema
 * yet. That is the honest shape of the document today, and it is the opposite of the failure §15.2.5 names:
 * a document that silently omits the endpoints it cannot describe reads as complete, so nobody closes the
 * gap. `formatGenerationSummary` prints every `operationId statusCode` pair with no body schema on EVERY
 * generation run.
 *
 * A response gets a schema here only when a zod schema that is TRUE of what the server actually sends
 * already exists. Concretely:
 *
 *  - **Covered** — the recipes, photos, versions, ingredient-CRUD, search and rating-read bodies, because
 *    `@kitchensink/recipe-core` already owns their zod AND `@kitchensink/recipe-service-client` PARSES
 *    production responses with those same schemas today. That is empirical evidence of truth, not a
 *    guess: were `recipeDetailSchema` wrong about a detail response, the shipped client would already be
 *    throwing on every read.
 *  - **NOT covered** — collections, account export/erasure, and the two blended ingredient endpoints
 *    (`suggest`, `candidates`). Those are exactly the boundaries the client validates with
 *    `expectUnvalidated`, i.e. the ones with no shared schema on either side. They are filled in as each
 *    vertical gains an authored `*.schema.ts`; publishing a hopeful shape for them now would be a contract
 *    that lies.
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
    RecipeVersion: recipeVersionSchema,
    RecipeVersionList: z.array(recipeVersionSchema),
    RestoreVersionResponse: restoreVersionResponseSchema,
    RecipeSearchResponse: recipeSearchResponseSchema,
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
            description: 'Deliberately PUBLIC — the ALB target group calls it with no credential.',
            security: [],
            responses: { '200': { description: 'The service is running.' } },
        },
    },
    '/health/ready': {
        get: {
            operationId: 'getReadiness',
            summary: 'Readiness probe (checks the database connection).',
            description: 'Deliberately PUBLIC.',
            security: [],
            responses: {
                '200': { description: 'The service is ready to serve traffic.' },
                '503': { description: 'A dependency is unavailable.' },
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
                'RESPONSE BODY NOT YET DESCRIBED. `IngredientSuggestions` is a discriminated union with no authored `*.schema.ts` on either side — it is one of the boundaries the typed client validates with `expectUnvalidated`. See §15.2.5.',
            parameters: [
                { name: 'q', in: 'query', required: true, description: 'The search term.', schema: z.string().min(1) },
                { name: 'limit', in: 'query', description: 'Maximum results.', schema: z.number().int().positive() },
            ],
            responses: {
                '200': { description: 'Blended suggestions, local section first.' },
                ...sharedErrorResponses(),
            },
        },
    },
    '/api/v1/ingredients': {
        post: {
            operationId: 'createIngredient',
            summary: 'Create a user-entered ingredient.',
            description: 'REQUEST BODY NOT YET DESCRIBED — no authored schema for `{ name }` exists.',
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
            description: 'REQUEST BODY NOT YET DESCRIBED — no authored schema for `{ name }` exists.',
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
            description: 'REQUEST BODY NOT YET DESCRIBED — no authored schema for `{ foodId }` exists.',
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
                'RESPONSE BODY NOT YET DESCRIBED, and the reason is an OWNERSHIP question, not an oversight: the body is the food service’s `CandidateView`. Whose contract owns it is recorded as an open decision — see the note in `contract/generate.ts`.',
            parameters: [uuidPathParam('id', 'The ingredient id.')],
            responses: {
                '200': { description: 'The candidates, or an empty array when the ingredient has no food id.' },
                '404': { description: 'No such ingredient.', schema: 'ErrorResponse' },
                ...sharedErrorResponses(),
            },
        },
    },
    '/api/v1/ingredients/{id}/resolve': {
        post: {
            operationId: 'resolveIngredient',
            summary: 'Resolve an unresolved ingredient by picking one or more candidates.',
            description: 'REQUEST BODY NOT YET DESCRIBED — no authored schema for `{ candidateIds }` exists.',
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
                'REQUEST AND RESPONSE BODIES NOT YET DESCRIBED — the collections vertical has no authored `*.schema.ts`; its zod lives in `collections.schemas.ts`, which imports a drizzle type and so cannot cross into the schema package.',
            responses: {
                '201': { description: 'The created collection.' },
                '409': { description: 'The caller is at the 50-collection cap.', schema: 'ErrorResponse' },
                ...sharedErrorResponses(),
            },
        },
        get: {
            operationId: 'listCollections',
            summary: 'List the caller’s collections.',
            description: 'RESPONSE BODY NOT YET DESCRIBED — see `createCollection`.',
            parameters: [
                { name: 'page', in: 'query', description: '1-based page number.', schema: z.number().int().min(1) },
                {
                    name: 'pageSize',
                    in: 'query',
                    description: 'Page size, 1..100.',
                    schema: z.number().int().min(1).max(100),
                },
            ],
            responses: { '200': { description: 'A page of collections.' }, ...sharedErrorResponses() },
        },
    },
    '/api/v1/collections/{id}': {
        get: {
            operationId: 'getCollectionById',
            summary: 'Read a collection with its member recipes.',
            description: 'RESPONSE BODY NOT YET DESCRIBED — see `createCollection`.',
            parameters: [uuidPathParam('id', 'The collection id.')],
            responses: {
                '200': { description: 'The collection and its members.' },
                '404': { description: 'No such collection.', schema: 'ErrorResponse' },
                ...sharedErrorResponses(),
            },
        },
        patch: {
            operationId: 'updateCollection',
            summary: 'Update a collection (at least one field required).',
            description: 'REQUEST AND RESPONSE BODIES NOT YET DESCRIBED — see `createCollection`.',
            parameters: [uuidPathParam('id', 'The collection id.')],
            responses: {
                '200': { description: 'The updated collection.' },
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
            description: 'REQUEST AND RESPONSE BODIES NOT YET DESCRIBED — see `createCollection`.',
            parameters: [uuidPathParam('id', 'The collection id.')],
            responses: {
                '201': { description: 'The created membership.' },
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
            description: 'REQUEST AND RESPONSE BODIES NOT YET DESCRIBED — see `createCollection`.',
            parameters: [uuidPathParam('id', 'The collection to clone.')],
            responses: {
                '201': { description: 'The caller’s new clone.' },
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
                'RESPONSE BODY NOT YET DESCRIBED — `PullDiff` has four independent declarations today; converging them is the collections step.',
            parameters: [uuidPathParam('id', 'The cloned collection id.')],
            responses: {
                '200': { description: 'The three-way diff of source against clone.' },
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
            description: 'REQUEST AND RESPONSE BODIES NOT YET DESCRIBED — see `previewPullFromSource`.',
            parameters: [uuidPathParam('id', 'The cloned collection id.')],
            responses: {
                '200': { description: 'The refreshed collection and the recipe ids the pull added.' },
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
                'RESPONSE BODY NOT YET DESCRIBED — `AccountExport` and its seven sub-shapes have no zod anywhere, and no typed-client method either. This is the largest single coverage gap in the document.',
            responses: { '200': { description: 'The caller’s full export.' }, ...sharedErrorResponses() },
        },
    },
    '/api/v1/account/erasure': {
        post: {
            operationId: 'requestAccountErasure',
            summary: 'Request irreversible erasure of the caller’s account data.',
            description:
                'REQUEST AND RESPONSE BODIES NOT YET DESCRIBED — the erasure DTO is `class-validator`-only. Idempotent: an in-flight job is returned rather than a second one started.',
            responses: {
                '202': { description: 'The queued or already-running erasure job.' },
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
                'NOT a public endpoint and NOT Clerk-authenticated: it authenticates with a signed machine token and is excluded from the Clerk middleware so its own guard is the fail-closed enforcement point (ADR-0011). RESPONSE BODY NOT YET DESCRIBED.',
            security: [SERVICE_TOKEN],
            responses: {
                '202': { description: 'The queued or already-running erasure job.' },
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
