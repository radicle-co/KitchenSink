/**
 * Per-method happy-path unit tests for {@link RecipeServiceClient}: EVERY public method is exercised for
 * its correct HTTP verb, URL (path-id encoding), request body / query serialization, and parsed success
 * response (the method's documented success status → typed DTO). Cross-cutting concerns (token attach,
 * status→error mapping, the identity-sync retry, and transport edge cases) live in `client.test.ts` and
 * `client.transport.test.ts`. Transport is a mocked `fetch`; no real network is touched.
 */
import { describe, expect, expectTypeOf, it } from 'vitest';

import { recipeSearchQuerySchema } from '@kitchensink/schema-recipe';
import type { RecipeSearchQuery } from '@kitchensink/schema-recipe';

import { RecipeServiceClient } from '../index.js';
import {
    FIXTURE_OTHER_PHOTO_UUID,
    FIXTURE_OTHER_RECIPE_UUID,
    FIXTURE_PHOTO_UUID,
    FIXTURE_RECIPE_UUID,
    makeCollection,
    makeCollectionRecipeMembership,
    makeCollectionWithRecipes,
    makeCreateRecipeRequest,
    makeErasureAccepted,
    makeIngredient,
    makePaginatedResponse,
    makePullDiff,
    makePullFromSourceResponse,
    makeRecipe,
    makeRecipeDetail,
    makeRecipePhoto,
    makeRecipeSearchResponse,
    makeRecipeVersion,
    makeRestoreVersionResponse,
    makeUploadUrlResponse,
} from '../__fixtures__/recipes.js';
import { requestAt, stubFetch } from './utils/fetchDouble.js';

const BASE = 'https://recipes.example.test';

/** Construct a client wired to the given fetch double and a literal token (so auth attach is exercised). */
function makeClient(fetchMock: typeof fetch): RecipeServiceClient {
    return new RecipeServiceClient({ baseUrl: BASE, token: 'tok', fetch: fetchMock });
}

/** Parse the captured JSON request body of the first recorded call. */
function jsonBody(fetchMock: typeof fetch): unknown {
    return JSON.parse(requestAt(fetchMock).body as string);
}

describe('RecipeServiceClient — recipes', () => {
    it('createRecipe POSTs /api/v1/recipes with the draft body and returns the created detail (201)', async () => {
        const created = makeRecipeDetail({ id: 'rec_new' });
        const fetchMock = stubFetch(201, created);
        // A contract-valid draft: `createRecipeRequestSchema` requires at least one ingredient AND at least
        // one step, and the client validates the outbound body, so the empty arrays this used to send were a
        // `400` the service would never have accepted — the body asserted below is now one that it would.
        const input = makeCreateRecipeRequest();

        const result = await makeClient(fetchMock).createRecipe(input);

        expect(result).toEqual(created);
        const req = requestAt(fetchMock);
        expect(req.method).toBe('POST');
        expect(req.url).toBe(`${BASE}/api/v1/recipes`);
        expect(jsonBody(fetchMock)).toEqual(input);
    });

    it('listRecipes GETs /api/v1/recipes with pagination + sort params and returns the page (200)', async () => {
        const page = makePaginatedResponse([makeRecipe()], { page: 2, pageSize: 50 });
        const fetchMock = stubFetch(200, page);

        const result = await makeClient(fetchMock).listRecipes({ page: 2, pageSize: 50, sortBy: 'title' });

        expect(result).toEqual(page);
        const req = requestAt(fetchMock);
        expect(req.method).toBe('GET');
        expect(req.url).toBe(`${BASE}/api/v1/recipes?page=2&pageSize=50&sortBy=title`);
    });

    it('getRecipeById GETs /api/v1/recipes/{id} and returns the detail (200)', async () => {
        const detail = makeRecipeDetail();
        const fetchMock = stubFetch(200, detail);

        const result = await makeClient(fetchMock).getRecipeById('rec_1');

        expect(result).toEqual(detail);
        const req = requestAt(fetchMock);
        expect(req.method).toBe('GET');
        expect(req.url).toBe(`${BASE}/api/v1/recipes/rec_1`);
        expect(req.body).toBeUndefined();
    });

    it('updateRecipe PATCHes /api/v1/recipes/{id} with the update body and returns the detail (200)', async () => {
        const updated = makeRecipeDetail({ title: 'New', currentVersion: 6 });
        const fetchMock = stubFetch(200, updated);
        const input = { expectedVersion: 5, title: 'New' };

        const result = await makeClient(fetchMock).updateRecipe('rec_1', input);

        expect(result).toEqual(updated);
        const req = requestAt(fetchMock);
        expect(req.method).toBe('PATCH');
        expect(req.url).toBe(`${BASE}/api/v1/recipes/rec_1`);
        expect(jsonBody(fetchMock)).toEqual(input);
    });

    it('deleteRecipe DELETEs /api/v1/recipes/{id} and resolves void (204)', async () => {
        const fetchMock = stubFetch(204);

        await expect(makeClient(fetchMock).deleteRecipe('rec_1')).resolves.toBeUndefined();
        const req = requestAt(fetchMock);
        expect(req.method).toBe('DELETE');
        expect(req.url).toBe(`${BASE}/api/v1/recipes/rec_1`);
    });

    it('cloneRecipe POSTs /api/v1/recipes/{id}/clone (no body) and returns the clone (201)', async () => {
        const clone = makeRecipeDetail({ id: 'rec_clone', clonedFromId: 'rec_1' });
        const fetchMock = stubFetch(201, clone);

        const result = await makeClient(fetchMock).cloneRecipe('rec_1');

        expect(result).toEqual(clone);
        const req = requestAt(fetchMock);
        expect(req.method).toBe('POST');
        expect(req.url).toBe(`${BASE}/api/v1/recipes/rec_1/clone`);
        expect(req.body).toBeUndefined();
        expect(req.headers.get('content-type')).toBeNull();
    });

    it('setRecipeVisibility PATCHes /visibility with the new value and returns the detail (200)', async () => {
        const updated = makeRecipeDetail({ visibility: 'public' });
        const fetchMock = stubFetch(200, updated);

        const result = await makeClient(fetchMock).setRecipeVisibility('rec_1', 'public');

        expect(result).toEqual(updated);
        const req = requestAt(fetchMock);
        expect(req.method).toBe('PATCH');
        expect(req.url).toBe(`${BASE}/api/v1/recipes/rec_1/visibility`);
        expect(jsonBody(fetchMock)).toEqual({ visibility: 'public' });
    });

    it('setRecipeRating PUTs /api/v1/recipes/{id}/rating with { stars } and returns the refreshed detail (200)', async () => {
        const rated = makeRecipeDetail({ id: 'rec_1', ratingCount: 1, averageRating: 4 });
        const fetchMock = stubFetch(200, rated);

        const result = await makeClient(fetchMock).setRecipeRating('rec_1', { stars: 4 });

        expect(result).toEqual(rated);
        const req = requestAt(fetchMock);
        expect(req.method).toBe('PUT');
        expect(req.url).toBe(`${BASE}/api/v1/recipes/rec_1/rating`);
        // Only `stars` on the wire — the rater is the token, never a body field.
        expect(jsonBody(fetchMock)).toEqual({ stars: 4 });
    });

    it('setRecipeRating percent-encodes the path id', async () => {
        const fetchMock = stubFetch(200, makeRecipeDetail());

        await makeClient(fetchMock).setRecipeRating('rec/1', { stars: 3 });

        expect(requestAt(fetchMock).url).toBe(`${BASE}/api/v1/recipes/rec%2F1/rating`);
    });

    it('deleteRecipeRating DELETEs /api/v1/recipes/{id}/rating and resolves void (204)', async () => {
        const fetchMock = stubFetch(204);

        await expect(makeClient(fetchMock).deleteRecipeRating('rec_1')).resolves.toBeUndefined();
        const req = requestAt(fetchMock);
        expect(req.method).toBe('DELETE');
        expect(req.url).toBe(`${BASE}/api/v1/recipes/rec_1/rating`);
        expect(req.body).toBeUndefined();
    });
});

describe('RecipeServiceClient — ingredients', () => {
    it('searchIngredients GETs /api/v1/ingredients/search with q + limit and returns the matches (200)', async () => {
        const matches = [makeIngredient({ id: 'ing_a' }), makeIngredient({ id: 'ing_b', name: 'Tomatillo' })];
        const fetchMock = stubFetch(200, matches);

        const result = await makeClient(fetchMock).searchIngredients('tom', 5);

        expect(result).toEqual(matches);
        const req = requestAt(fetchMock);
        expect(req.method).toBe('GET');
        expect(req.url).toBe(`${BASE}/api/v1/ingredients/search?q=tom&limit=5`);
    });

    it('searchIngredients omits the limit query param when limit is not supplied', async () => {
        const fetchMock = stubFetch(200, []);

        await makeClient(fetchMock).searchIngredients('tom');

        expect(requestAt(fetchMock).url).toBe(`${BASE}/api/v1/ingredients/search?q=tom`);
    });

    it('suggestIngredients GETs /api/v1/ingredients/suggest with q + limit and returns the blended envelope (200)', async () => {
        const envelope = {
            suggestions: [
                { provenance: 'local', ingredient: makeIngredient({ id: 'ing_a' }) },
                { provenance: 'catalog', foodId: '01J0FOOD', name: 'Chicken breast, raw', score: 0.9 },
            ],
            catalogAvailability: 'ok',
        };
        const fetchMock = stubFetch(200, envelope);

        const result = await makeClient(fetchMock).suggestIngredients('chick', 5);

        expect(result).toEqual(envelope);
        const req = requestAt(fetchMock);
        expect(req.method).toBe('GET');
        // Mutation guard: the BLENDED read must hit `/suggest`. Falling back to `/search` would silently
        // un-blend the picker (and return an array where the caller expects an envelope).
        expect(req.url).toBe(`${BASE}/api/v1/ingredients/suggest?q=chick&limit=5`);
    });

    it('suggestIngredients omits the limit query param when limit is not supplied', async () => {
        const fetchMock = stubFetch(200, { suggestions: [], catalogAvailability: 'ok' });

        await makeClient(fetchMock).suggestIngredients('chick');

        expect(requestAt(fetchMock).url).toBe(`${BASE}/api/v1/ingredients/suggest?q=chick`);
    });

    it('suggestIngredients surfaces a degraded catalog as a SUCCESS, not an error (F2)', async () => {
        const fetchMock = stubFetch(200, { suggestions: [], catalogAvailability: 'unavailable' });

        const result = await makeClient(fetchMock).suggestIngredients('chick');

        expect(result.catalogAvailability).toBe('unavailable');
    });

    it('addIngredientByFood POSTs /api/v1/ingredients/by-food with { foodId } and returns the ingredient (200)', async () => {
        const admitted = makeIngredient({
            id: 'ing_admitted',
            name: 'Chicken breast, raw',
            foodId: '01J0FOOD',
            foodResolutionStatus: 'RESOLVED',
            caloriesPer100g: 165,
        });
        const fetchMock = stubFetch(200, admitted);

        const result = await makeClient(fetchMock).addIngredientByFood('01J0FOOD');

        expect(result).toEqual(admitted);
        const req = requestAt(fetchMock);
        expect(req.method).toBe('POST');
        // Mutation guard: the catalog pick must hit `/by-food`, NOT `/by-name` (which would re-enter the
        // async name fan-out and can split UNRESOLVED) nor the freeform `/api/v1/ingredients` create.
        expect(req.url).toBe(`${BASE}/api/v1/ingredients/by-food`);
        // And the body carries ONLY the opaque food id — never a client-chosen display name.
        expect(jsonBody(fetchMock)).toEqual({ foodId: '01J0FOOD' });
    });

    it('addIngredientByFood treats a 202 (by-name poll status) as an error, not success', async () => {
        // Guards the deliberate 200 contract: this route completes the work synchronously (row + nutrition
        // backfill), so it is NOT the 202 "go poll" contract `by-name` has.
        const fetchMock = stubFetch(202, makeIngredient({ id: 'ing_admitted' }));

        await expect(makeClient(fetchMock).addIngredientByFood('01J0FOOD')).rejects.toThrow();
    });

    it('createIngredient POSTs /api/v1/ingredients with { name } and returns the ingredient (201)', async () => {
        const created = makeIngredient({ id: 'ing_new', name: 'Sumac', isUserEntered: true });
        const fetchMock = stubFetch(201, created);

        const result = await makeClient(fetchMock).createIngredient('Sumac');

        expect(result).toEqual(created);
        const req = requestAt(fetchMock);
        expect(req.method).toBe('POST');
        expect(req.url).toBe(`${BASE}/api/v1/ingredients`);
        expect(jsonBody(fetchMock)).toEqual({ name: 'Sumac' });
    });

    it('addIngredientByName POSTs /api/v1/ingredients/by-name with { name } and returns the ingredient (202)', async () => {
        const added = makeIngredient({ id: 'ing_food', name: 'Quinoa', foodResolutionStatus: 'PENDING' });
        const fetchMock = stubFetch(202, added);

        const result = await makeClient(fetchMock).addIngredientByName('Quinoa');

        expect(result).toEqual(added);
        const req = requestAt(fetchMock);
        expect(req.method).toBe('POST');
        // Mutation guard: the add-by-name path must hit the async-resolution route, NOT the freeform
        // `/api/v1/ingredients` create — a regression to createIngredient's path fails here.
        expect(req.url).toBe(`${BASE}/api/v1/ingredients/by-name`);
        expect(jsonBody(fetchMock)).toEqual({ name: 'Quinoa' });
    });

    it('addIngredientByName treats a 201 (freeform-create status) as an error, not success', async () => {
        // Guards the deliberate 202 contract: this route is async-resolution (202 Accepted), NOT the
        // synchronous 201 freeform create. Accepting a 201 here would erase that distinction.
        const fetchMock = stubFetch(201, makeIngredient({ id: 'ing_food' }));

        await expect(makeClient(fetchMock).addIngredientByName('Quinoa')).rejects.toThrow();
    });

    it('getIngredientStatus GETs /api/v1/ingredients/{id}/status and returns the refreshed ingredient (200)', async () => {
        const refreshed = makeIngredient({ id: 'ing_p', foodResolutionStatus: 'RESOLVED' });
        const fetchMock = stubFetch(200, refreshed);

        const result = await makeClient(fetchMock).getIngredientStatus('ing_p');

        expect(result).toEqual(refreshed);
        const req = requestAt(fetchMock);
        expect(req.method).toBe('GET');
        expect(req.url).toBe(`${BASE}/api/v1/ingredients/ing_p/status`);
    });

    it('getIngredientCandidates GETs /api/v1/ingredients/{id}/candidates and returns the candidate list (200)', async () => {
        const candidates = [
            { candidateId: 'c1', source: 'usda', externalKey: 'k1', name: 'Quinoa, cooked', summary: null },
        ];
        const fetchMock = stubFetch(200, candidates);

        const result = await makeClient(fetchMock).getIngredientCandidates('ing_u');

        expect(result).toEqual(candidates);
        const req = requestAt(fetchMock);
        expect(req.method).toBe('GET');
        expect(req.url).toBe(`${BASE}/api/v1/ingredients/ing_u/candidates`);
    });

    it('resolveIngredient POSTs /api/v1/ingredients/{id}/resolve with the picked ids and returns the resolved ingredient (200)', async () => {
        const resolved = makeIngredient({ id: 'ing_u', foodResolutionStatus: 'RESOLVED' });
        const fetchMock = stubFetch(200, resolved);

        const result = await makeClient(fetchMock).resolveIngredient('ing_u', ['c1', 'c2']);

        expect(result).toEqual(resolved);
        const req = requestAt(fetchMock);
        expect(req.method).toBe('POST');
        expect(req.url).toBe(`${BASE}/api/v1/ingredients/ing_u/resolve`);
        // Mutation guard: the exact picked ids must be sent — a wrong/dropped id fails this assertion.
        expect(jsonBody(fetchMock)).toEqual({ candidateIds: ['c1', 'c2'] });
    });
});

describe('RecipeServiceClient — versions', () => {
    it('listRecipeVersions GETs /api/v1/recipes/{id}/versions and returns the versions (200)', async () => {
        const versions = [makeRecipeVersion({ versionNumber: 2 }), makeRecipeVersion({ versionNumber: 1 })];
        const fetchMock = stubFetch(200, versions);

        const result = await makeClient(fetchMock).listRecipeVersions('rec_1');

        expect(result).toEqual(versions);
        const req = requestAt(fetchMock);
        expect(req.method).toBe('GET');
        expect(req.url).toBe(`${BASE}/api/v1/recipes/rec_1/versions`);
    });

    it('getRecipeVersion GETs /api/v1/recipes/{id}/versions/{n} and returns the snapshot (200)', async () => {
        const version = makeRecipeVersion({ versionNumber: 3 });
        const fetchMock = stubFetch(200, version);

        const result = await makeClient(fetchMock).getRecipeVersion('rec_1', 3);

        expect(result).toEqual(version);
        const req = requestAt(fetchMock);
        expect(req.method).toBe('GET');
        expect(req.url).toBe(`${BASE}/api/v1/recipes/rec_1/versions/3`);
    });

    it('restoreRecipeVersion POSTs /versions/{n}/restore and returns the restore response (200)', async () => {
        const restored = makeRestoreVersionResponse({ restoredFromVersion: 2, currentVersion: 7 });
        const fetchMock = stubFetch(200, restored);

        const result = await makeClient(fetchMock).restoreRecipeVersion('rec_1', 2);

        expect(result).toEqual(restored);
        const req = requestAt(fetchMock);
        expect(req.method).toBe('POST');
        expect(req.url).toBe(`${BASE}/api/v1/recipes/rec_1/versions/2/restore`);
        expect(req.body).toBeUndefined();
    });
});

describe('RecipeServiceClient — photos', () => {
    it('createPhotoUploadUrl POSTs /photos/upload-url with the request and returns the presigned URL (200)', async () => {
        const response = makeUploadUrlResponse();
        const fetchMock = stubFetch(200, response);
        const request = { fileName: 'soup.jpg', contentType: 'image/jpeg', fileSize: 1024 };

        const result = await makeClient(fetchMock).createPhotoUploadUrl('rec_1', request);

        expect(result).toEqual(response);
        const req = requestAt(fetchMock);
        expect(req.method).toBe('POST');
        expect(req.url).toBe(`${BASE}/api/v1/recipes/rec_1/photos/upload-url`);
        expect(jsonBody(fetchMock)).toEqual(request);
    });

    it('confirmPhotoUpload POSTs /photos/confirm with the request and returns the photo record (201)', async () => {
        const photo = makeRecipePhoto();
        const fetchMock = stubFetch(201, photo);
        const request = { key: 'recipes/rec_1/pending/x.jpg', contentType: 'image/jpeg' };

        const result = await makeClient(fetchMock).confirmPhotoUpload('rec_1', request);

        expect(result).toEqual(photo);
        const req = requestAt(fetchMock);
        expect(req.method).toBe('POST');
        expect(req.url).toBe(`${BASE}/api/v1/recipes/rec_1/photos/confirm`);
        expect(jsonBody(fetchMock)).toEqual(request);
    });

    it('listRecipePhotos GETs /api/v1/recipes/{id}/photos and returns the photos (200)', async () => {
        const photos = [makeRecipePhoto({ id: 'pho_1', order: 1 }), makeRecipePhoto({ id: 'pho_2', order: 2 })];
        const fetchMock = stubFetch(200, photos);

        const result = await makeClient(fetchMock).listRecipePhotos('rec_1');

        expect(result).toEqual(photos);
        expect(requestAt(fetchMock).url).toBe(`${BASE}/api/v1/recipes/rec_1/photos`);
    });

    it('deleteRecipePhoto DELETEs /photos/{photoId} and resolves void (204)', async () => {
        const fetchMock = stubFetch(204);

        await expect(makeClient(fetchMock).deleteRecipePhoto('rec_1', 'pho_9')).resolves.toBeUndefined();
        const req = requestAt(fetchMock);
        expect(req.method).toBe('DELETE');
        expect(req.url).toBe(`${BASE}/api/v1/recipes/rec_1/photos/pho_9`);
    });

    it('reorderRecipePhotos PATCHes /photos/reorder with { photoIds } and returns the ordered photos (200)', async () => {
        // The ids sent are v4 UUIDs because `reorderPhotosRequestSchema.photoIds` is
        // `z.array(z.uuid({ version: 'v4' })).min(1)` — a `'pho_2'` token is not a photo id the service can
        // resolve, so the old fixture asserted a reorder request that would have come back `400`. (The
        // RESPONSE keeps readable ids: response id fields are deliberately `z.string().min(1)`.)
        const desiredOrder = [FIXTURE_OTHER_PHOTO_UUID, FIXTURE_PHOTO_UUID];
        const reordered = [makeRecipePhoto({ id: 'pho_2', order: 1 }), makeRecipePhoto({ id: 'pho_1', order: 2 })];
        const fetchMock = stubFetch(200, reordered);

        const result = await makeClient(fetchMock).reorderRecipePhotos('rec_1', desiredOrder);

        expect(result).toEqual(reordered);
        const req = requestAt(fetchMock);
        expect(req.method).toBe('PATCH');
        expect(req.url).toBe(`${BASE}/api/v1/recipes/rec_1/photos/reorder`);
        expect(jsonBody(fetchMock)).toEqual({ photoIds: desiredOrder });
    });
});

describe('RecipeServiceClient — collections', () => {
    it('createCollection POSTs /api/v1/collections with the request and returns the collection (201)', async () => {
        const created = makeCollection({ id: 'col_new' });
        const fetchMock = stubFetch(201, created);
        const request = { name: 'Weeknight dinners', visibility: 'private' as const };

        const result = await makeClient(fetchMock).createCollection(request);

        expect(result).toEqual(created);
        const req = requestAt(fetchMock);
        expect(req.method).toBe('POST');
        expect(req.url).toBe(`${BASE}/api/v1/collections`);
        expect(jsonBody(fetchMock)).toEqual(request);
    });

    it('listCollections GETs /api/v1/collections with pagination and returns the page (200)', async () => {
        const page = makePaginatedResponse([makeCollection()], { page: 3, pageSize: 10 });
        const fetchMock = stubFetch(200, page);

        const result = await makeClient(fetchMock).listCollections({ page: 3, pageSize: 10 });

        expect(result).toEqual(page);
        expect(requestAt(fetchMock).url).toBe(`${BASE}/api/v1/collections?page=3&pageSize=10`);
    });

    it('getCollectionById GETs /api/v1/collections/{id} and returns the collection with recipes (200)', async () => {
        const collection = makeCollectionWithRecipes();
        const fetchMock = stubFetch(200, collection);

        const result = await makeClient(fetchMock).getCollectionById('col_1');

        expect(result).toEqual(collection);
        expect(requestAt(fetchMock).url).toBe(`${BASE}/api/v1/collections/col_1`);
    });

    it('createCollection preserves the widened pull-provenance fields through schema validation (not stripped)', async () => {
        // `collectionSchema` (from @kitchensink/recipe-core) does not declare these fields, and zod drops
        // unrecognized keys by default — this pins that the client's own `collectionResponseSchema`
        // extension is actually wired in, not just declared as dead code.
        const created = makeCollection({
            sourceOwnerHandle: 'chef_amy',
            sourceCollectionName: 'Weeknight dinners (original)',
            lastPulledAt: '2026-07-20T00:00:00.000Z',
        });
        const fetchMock = stubFetch(201, created);

        const result = await makeClient(fetchMock).createCollection({ name: 'Weeknight dinners' });

        expect(result).toEqual(created);
    });

    it('updateCollection PATCHes /api/v1/collections/{id} with the update and returns the collection (200)', async () => {
        const updated = makeCollection({ name: 'Renamed' });
        const fetchMock = stubFetch(200, updated);
        const request = { name: 'Renamed' };

        const result = await makeClient(fetchMock).updateCollection('col_1', request);

        expect(result).toEqual(updated);
        const req = requestAt(fetchMock);
        expect(req.method).toBe('PATCH');
        expect(req.url).toBe(`${BASE}/api/v1/collections/col_1`);
        expect(jsonBody(fetchMock)).toEqual(request);
    });

    it('deleteCollection DELETEs /api/v1/collections/{id} and resolves void (204)', async () => {
        const fetchMock = stubFetch(204);

        await expect(makeClient(fetchMock).deleteCollection('col_1')).resolves.toBeUndefined();
        const req = requestAt(fetchMock);
        expect(req.method).toBe('DELETE');
        expect(req.url).toBe(`${BASE}/api/v1/collections/col_1`);
    });

    it('addRecipeToCollection POSTs /{id}/recipes with { recipeId } and returns the membership (201)', async () => {
        const membership = makeCollectionRecipeMembership();
        const fetchMock = stubFetch(201, membership);

        // `addRecipeToCollectionRequestSchema.recipeId` is `z.uuid()` (the `recipes.id uuid` column), so the
        // BODY must carry a UUID — `'rec_1'` was never a resolvable recipe id. The collection id stays a
        // readable token because it travels in the PATH, which this schema does not describe.
        const result = await makeClient(fetchMock).addRecipeToCollection('col_1', FIXTURE_RECIPE_UUID);

        expect(result).toEqual(membership);
        const req = requestAt(fetchMock);
        expect(req.method).toBe('POST');
        expect(req.url).toBe(`${BASE}/api/v1/collections/col_1/recipes`);
        expect(jsonBody(fetchMock)).toEqual({ recipeId: FIXTURE_RECIPE_UUID });
    });

    it('removeRecipeFromCollection DELETEs /{id}/recipes/{recipeId} and resolves void (204)', async () => {
        const fetchMock = stubFetch(204);

        await expect(makeClient(fetchMock).removeRecipeFromCollection('col_1', 'rec_1')).resolves.toBeUndefined();
        const req = requestAt(fetchMock);
        expect(req.method).toBe('DELETE');
        expect(req.url).toBe(`${BASE}/api/v1/collections/col_1/recipes/rec_1`);
    });

    it('cloneCollection POSTs /{id}/clone WITH overrides body and returns the clone (201)', async () => {
        const clone = makeCollection({ id: 'col_clone', sourceCollectionId: 'col_1' });
        const fetchMock = stubFetch(201, clone);
        const request = { name: 'My copy' };

        const result = await makeClient(fetchMock).cloneCollection('col_1', request);

        expect(result).toEqual(clone);
        const req = requestAt(fetchMock);
        expect(req.method).toBe('POST');
        expect(req.url).toBe(`${BASE}/api/v1/collections/col_1/clone`);
        expect(jsonBody(fetchMock)).toEqual(request);
    });

    it('cloneCollection POSTs /{id}/clone with NO body when overrides are omitted', async () => {
        const clone = makeCollection({ id: 'col_clone', sourceCollectionId: 'col_1' });
        const fetchMock = stubFetch(201, clone);

        const result = await makeClient(fetchMock).cloneCollection('col_1');

        expect(result).toEqual(clone);
        const req = requestAt(fetchMock);
        expect(req.body).toBeUndefined();
        expect(req.headers.get('content-type')).toBeNull();
    });

    it('pullCollectionFromSource POSTs /{id}/pull-from-source and returns the pull result (200)', async () => {
        const response = makePullFromSourceResponse();
        const fetchMock = stubFetch(200, response);

        const result = await makeClient(fetchMock).pullCollectionFromSource('col_1');

        expect(result).toEqual(response);
        const req = requestAt(fetchMock);
        expect(req.method).toBe('POST');
        expect(req.url).toBe(`${BASE}/api/v1/collections/col_1/pull-from-source`);
        expect(req.body).toBeUndefined();
    });

    it('pullCollectionFromSource sends { previewedDiff } in the body when a preview is echoed back', async () => {
        const previewedDiff = makePullDiff();
        const response = makePullFromSourceResponse();
        const fetchMock = stubFetch(200, response);

        const result = await makeClient(fetchMock).pullCollectionFromSource('col_1', { previewedDiff });

        expect(result).toEqual(response);
        const req = requestAt(fetchMock);
        expect(req.method).toBe('POST');
        expect(req.url).toBe(`${BASE}/api/v1/collections/col_1/pull-from-source`);
        expect(jsonBody(fetchMock)).toEqual({ previewedDiff });
    });

    it('previewPullFromSource POSTs /{id}/pull-from-source/preview with no body and returns the diff (200)', async () => {
        const diff = makePullDiff();
        const fetchMock = stubFetch(200, diff);

        const result = await makeClient(fetchMock).previewPullFromSource('col_1');

        expect(result).toEqual(diff);
        const req = requestAt(fetchMock);
        expect(req.method).toBe('POST');
        expect(req.url).toBe(`${BASE}/api/v1/collections/col_1/pull-from-source/preview`);
        expect(req.body).toBeUndefined();
    });
});

describe('RecipeServiceClient — search & account', () => {
    it('searchRecipes GETs /api/v1/search/recipes with all filters and returns ranked results (200)', async () => {
        const response = makeRecipeSearchResponse();
        const fetchMock = stubFetch(200, response);

        const result = await makeClient(fetchMock).searchRecipes({
            query: 'chicken pie',
            cuisine: 'british',
            dietaryFlags: ['vegan', 'gluten_free'],
            tags: ['dinner'],
            maxPrepTime: 30,
            maxCookTime: 45,
            maxTotalTime: 60,
            ingredientIds: ['ing_1', 'ing_2'],
            page: 2,
            pageSize: 10,
            sortBy: 'relevance',
        });

        expect(result).toEqual(response);
        expect(requestAt(fetchMock).url).toBe(
            `${BASE}/api/v1/search/recipes?query=chicken+pie&cuisine=british` +
                `&dietaryFlags=vegan&dietaryFlags=gluten_free&tags=dinner` +
                `&maxPrepTime=30&maxCookTime=45&maxTotalTime=60&ingredientIds=ing_1&ingredientIds=ing_2` +
                `&page=2&pageSize=10&sortBy=relevance`,
        );
    });

    it('searchRecipes with no params issues a bare GET (no query string) — browse mode', async () => {
        const fetchMock = stubFetch(200, makeRecipeSearchResponse({ results: [] }));

        await makeClient(fetchMock).searchRecipes();

        expect(requestAt(fetchMock).url).toBe(`${BASE}/api/v1/search/recipes`);
    });

    /*
     * ── THE SEARCH REQUEST TYPE IS DERIVED, NOT DECLARED (§15.1, GR-015 §15-b.2/15-b.3, ADR-0014 rule 4) ──
     *
     * `searchRecipes` was typed with `recipe-core`'s hand-written `RecipeSearchParams`, the type half of a twin
     * whose zod half (`recipeSearchParamsSchema`) had no callers at all — the same shape `CreateRecipeInput` and
     * `UpdateRecipeInput` were deleted for, sitting five lines below the banner that declares them forbidden. The
     * twin was strictly LOOSER than the contract (mutable arrays, no bounds, no coercion), so `typecheck` reported
     * agreement between two representations that had never been compared.
     *
     * The two cases below are what make the convergence hold rather than merely happen once, and they are
     * deliberately different in kind: the first pins the TYPE (a re-declared looser twin fails it, because
     * `string[]` is not `readonly string[]`), the second pins the WIRE. Neither implies the other — a retyped
     * method still compiles while sending the wrong fields, because a SPREAD is exempt from excess-property
     * checking, which is exactly how a `visibility` key survived on the recipe PATCH body.
     */
    it('types searchRecipes with the published RecipeSearchQuery, not a local twin', () => {
        expectTypeOf<Parameters<RecipeServiceClient['searchRecipes']>[0]>().toEqualTypeOf<
            RecipeSearchQuery | undefined
        >();
    });

    it('puts every field the published query declares on the wire, and no others', async () => {
        const params: RecipeSearchQuery = {
            query: 'chicken pie',
            cuisine: 'british',
            dietaryFlags: ['vegan'],
            tags: ['dinner'],
            maxPrepTime: 30,
            maxCookTime: 45,
            maxTotalTime: 60,
            ingredientIds: ['ing_1'],
            page: 2,
            pageSize: 10,
            sortBy: 'relevance',
        };
        // ⚠️ RATCHET, and it must come first: every field is OPTIONAL, so a contract that grows a twelfth one
        // would leave this case quietly exercising eleven and reporting success. Asserting the INPUT covers the
        // published shape is what forces this test — and then the client — to be updated. Same device as
        // `recipe-service`'s `contract/__tests__/openapi.test.ts`.
        expect(Object.keys(params).sort()).toStrictEqual(Object.keys(recipeSearchQuerySchema.shape).sort());

        const fetchMock = stubFetch(200, makeRecipeSearchResponse());
        await makeClient(fetchMock).searchRecipes(params);

        const sent = [...new URL(requestAt(fetchMock).url).searchParams.keys()];

        expect([...new Set(sent)].sort()).toStrictEqual(Object.keys(recipeSearchQuerySchema.shape).sort());
    });

    it('requestAccountErasure POSTs /api/v1/account/erasure WITH a confirmation body and returns the job (202)', async () => {
        const accepted = makeErasureAccepted({ status: 'running' });
        const fetchMock = stubFetch(202, accepted);
        const request = { confirmationPhrase: 'DELETE MY ACCOUNT' };

        const result = await makeClient(fetchMock).requestAccountErasure(request);

        expect(result).toEqual(accepted);
        const req = requestAt(fetchMock);
        expect(req.method).toBe('POST');
        expect(req.url).toBe(`${BASE}/api/v1/account/erasure`);
        expect(jsonBody(fetchMock)).toEqual(request);
    });

    it('requestAccountErasure forwards the per-recipe donate election (publishRecipeIds) in the body', async () => {
        const accepted = makeErasureAccepted({ status: 'queued' });
        const fetchMock = stubFetch(202, accepted);
        // Each entry is a UUID because `erasureRequestSchema.publishRecipeIds` is `z.array(z.uuid())` — the
        // election names `recipes.id` rows for the worker to publish, and `'rec-1'` names nothing. This
        // fixture now exercises an election the service would actually honour.
        const request = {
            confirmationPhrase: 'ERASE MY DATA',
            publishRecipeIds: [FIXTURE_RECIPE_UUID, FIXTURE_OTHER_RECIPE_UUID],
        } as const;

        const result = await makeClient(fetchMock).requestAccountErasure(request);

        expect(result).toEqual(accepted);
        // The election must reach the wire unchanged — a dropped `publishRecipeIds` silently deletes recipes
        // the owner elected to keep (the exact conflation U4b guards against), so this pins the whole body.
        expect(jsonBody(fetchMock)).toEqual(request);
    });

    it('requestAccountErasure PARSES the 202 body, so a server that changed its shape fails here not in the UI', async () => {
        // Replaces a test that asserted the client POSTs with NO body when no request is supplied. That call
        // is no longer expressible — the argument is required, because `confirmationPhrase` is the intent gate
        // on an irreversible action and a bodyless request could only ever have produced a `400`.
        //
        // The property worth holding instead is that this boundary is now VALIDATED: it was the last
        // `expectUnvalidated` call site in the client, so a `202` whose shape drifted used to be cast blindly
        // to `ErasureRequestAcceptedResponse` and surface as `undefined` somewhere in the account UI.
        const fetchMock = stubFetch(202, { jobId: 'job_1', status: 'not-a-status' });

        await expect(
            makeClient(fetchMock).requestAccountErasure({ confirmationPhrase: 'ERASE MY DATA' }),
        ).rejects.toThrow();
    });
});
