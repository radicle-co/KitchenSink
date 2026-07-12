/**
 * Per-method happy-path unit tests for {@link RecipeServiceClient}: EVERY public method is exercised for
 * its correct HTTP verb, URL (path-id encoding), request body / query serialization, and parsed success
 * response (the method's documented success status → typed DTO). Cross-cutting concerns (token attach,
 * status→error mapping, the identity-sync retry, and transport edge cases) live in `client.test.ts` and
 * `client.transport.test.ts`. Transport is a mocked `fetch`; no real network is touched.
 */
import { describe, expect, it } from 'vitest';

import { RecipeServiceClient } from '../index.js';
import {
    makeCollection,
    makeCollectionRecipeMembership,
    makeCollectionWithRecipes,
    makeErasureAccepted,
    makeIngredient,
    makePaginatedResponse,
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
    it('createRecipe POSTs /v1/recipes with the draft body and returns the created detail (201)', async () => {
        const created = makeRecipeDetail({ id: 'rec_new' });
        const fetchMock = stubFetch(201, created);
        const input = {
            title: 'Tomato Soup',
            ingredients: [],
            steps: [],
            servings: 4,
            prepTimeMinutes: 10,
            cookTimeMinutes: 20,
            totalTimeMinutes: 30,
        };

        const result = await makeClient(fetchMock).createRecipe(input);

        expect(result).toEqual(created);
        const req = requestAt(fetchMock);
        expect(req.method).toBe('POST');
        expect(req.url).toBe(`${BASE}/v1/recipes`);
        expect(jsonBody(fetchMock)).toEqual(input);
    });

    it('listRecipes GETs /v1/recipes with pagination + sort params and returns the page (200)', async () => {
        const page = makePaginatedResponse([makeRecipe()], { page: 2, pageSize: 50 });
        const fetchMock = stubFetch(200, page);

        const result = await makeClient(fetchMock).listRecipes({ page: 2, pageSize: 50, sortBy: 'title' });

        expect(result).toEqual(page);
        const req = requestAt(fetchMock);
        expect(req.method).toBe('GET');
        expect(req.url).toBe(`${BASE}/v1/recipes?page=2&pageSize=50&sortBy=title`);
    });

    it('getRecipeById GETs /v1/recipes/{id} and returns the detail (200)', async () => {
        const detail = makeRecipeDetail();
        const fetchMock = stubFetch(200, detail);

        const result = await makeClient(fetchMock).getRecipeById('rec_1');

        expect(result).toEqual(detail);
        const req = requestAt(fetchMock);
        expect(req.method).toBe('GET');
        expect(req.url).toBe(`${BASE}/v1/recipes/rec_1`);
        expect(req.body).toBeUndefined();
    });

    it('updateRecipe PATCHes /v1/recipes/{id} with the update body and returns the detail (200)', async () => {
        const updated = makeRecipeDetail({ title: 'New', currentVersion: 6 });
        const fetchMock = stubFetch(200, updated);
        const input = { expectedVersion: 5, title: 'New' };

        const result = await makeClient(fetchMock).updateRecipe('rec_1', input);

        expect(result).toEqual(updated);
        const req = requestAt(fetchMock);
        expect(req.method).toBe('PATCH');
        expect(req.url).toBe(`${BASE}/v1/recipes/rec_1`);
        expect(jsonBody(fetchMock)).toEqual(input);
    });

    it('deleteRecipe DELETEs /v1/recipes/{id} and resolves void (204)', async () => {
        const fetchMock = stubFetch(204);

        await expect(makeClient(fetchMock).deleteRecipe('rec_1')).resolves.toBeUndefined();
        const req = requestAt(fetchMock);
        expect(req.method).toBe('DELETE');
        expect(req.url).toBe(`${BASE}/v1/recipes/rec_1`);
    });

    it('cloneRecipe POSTs /v1/recipes/{id}/clone (no body) and returns the clone (201)', async () => {
        const clone = makeRecipeDetail({ id: 'rec_clone', clonedFromId: 'rec_1' });
        const fetchMock = stubFetch(201, clone);

        const result = await makeClient(fetchMock).cloneRecipe('rec_1');

        expect(result).toEqual(clone);
        const req = requestAt(fetchMock);
        expect(req.method).toBe('POST');
        expect(req.url).toBe(`${BASE}/v1/recipes/rec_1/clone`);
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
        expect(req.url).toBe(`${BASE}/v1/recipes/rec_1/visibility`);
        expect(jsonBody(fetchMock)).toEqual({ visibility: 'public' });
    });
});

describe('RecipeServiceClient — ingredients', () => {
    it('searchIngredients GETs /v1/ingredients/search with q + limit and returns the matches (200)', async () => {
        const matches = [makeIngredient({ id: 'ing_a' }), makeIngredient({ id: 'ing_b', name: 'Tomatillo' })];
        const fetchMock = stubFetch(200, matches);

        const result = await makeClient(fetchMock).searchIngredients('tom', 5);

        expect(result).toEqual(matches);
        const req = requestAt(fetchMock);
        expect(req.method).toBe('GET');
        expect(req.url).toBe(`${BASE}/v1/ingredients/search?q=tom&limit=5`);
    });

    it('searchIngredients omits the limit query param when limit is not supplied', async () => {
        const fetchMock = stubFetch(200, []);

        await makeClient(fetchMock).searchIngredients('tom');

        expect(requestAt(fetchMock).url).toBe(`${BASE}/v1/ingredients/search?q=tom`);
    });

    it('createIngredient POSTs /v1/ingredients with { name } and returns the ingredient (201)', async () => {
        const created = makeIngredient({ id: 'ing_new', name: 'Sumac', isUserEntered: true });
        const fetchMock = stubFetch(201, created);

        const result = await makeClient(fetchMock).createIngredient('Sumac');

        expect(result).toEqual(created);
        const req = requestAt(fetchMock);
        expect(req.method).toBe('POST');
        expect(req.url).toBe(`${BASE}/v1/ingredients`);
        expect(jsonBody(fetchMock)).toEqual({ name: 'Sumac' });
    });
});

describe('RecipeServiceClient — versions', () => {
    it('listRecipeVersions GETs /v1/recipes/{id}/versions and returns the versions (200)', async () => {
        const versions = [makeRecipeVersion({ versionNumber: 2 }), makeRecipeVersion({ versionNumber: 1 })];
        const fetchMock = stubFetch(200, versions);

        const result = await makeClient(fetchMock).listRecipeVersions('rec_1');

        expect(result).toEqual(versions);
        const req = requestAt(fetchMock);
        expect(req.method).toBe('GET');
        expect(req.url).toBe(`${BASE}/v1/recipes/rec_1/versions`);
    });

    it('getRecipeVersion GETs /v1/recipes/{id}/versions/{n} and returns the snapshot (200)', async () => {
        const version = makeRecipeVersion({ versionNumber: 3 });
        const fetchMock = stubFetch(200, version);

        const result = await makeClient(fetchMock).getRecipeVersion('rec_1', 3);

        expect(result).toEqual(version);
        const req = requestAt(fetchMock);
        expect(req.method).toBe('GET');
        expect(req.url).toBe(`${BASE}/v1/recipes/rec_1/versions/3`);
    });

    it('restoreRecipeVersion POSTs /versions/{n}/restore and returns the restore response (200)', async () => {
        const restored = makeRestoreVersionResponse({ restoredFromVersion: 2, currentVersion: 7 });
        const fetchMock = stubFetch(200, restored);

        const result = await makeClient(fetchMock).restoreRecipeVersion('rec_1', 2);

        expect(result).toEqual(restored);
        const req = requestAt(fetchMock);
        expect(req.method).toBe('POST');
        expect(req.url).toBe(`${BASE}/v1/recipes/rec_1/versions/2/restore`);
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
        expect(req.url).toBe(`${BASE}/v1/recipes/rec_1/photos/upload-url`);
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
        expect(req.url).toBe(`${BASE}/v1/recipes/rec_1/photos/confirm`);
        expect(jsonBody(fetchMock)).toEqual(request);
    });

    it('listRecipePhotos GETs /v1/recipes/{id}/photos and returns the photos (200)', async () => {
        const photos = [makeRecipePhoto({ id: 'pho_1', order: 1 }), makeRecipePhoto({ id: 'pho_2', order: 2 })];
        const fetchMock = stubFetch(200, photos);

        const result = await makeClient(fetchMock).listRecipePhotos('rec_1');

        expect(result).toEqual(photos);
        expect(requestAt(fetchMock).url).toBe(`${BASE}/v1/recipes/rec_1/photos`);
    });

    it('deleteRecipePhoto DELETEs /photos/{photoId} and resolves void (204)', async () => {
        const fetchMock = stubFetch(204);

        await expect(makeClient(fetchMock).deleteRecipePhoto('rec_1', 'pho_9')).resolves.toBeUndefined();
        const req = requestAt(fetchMock);
        expect(req.method).toBe('DELETE');
        expect(req.url).toBe(`${BASE}/v1/recipes/rec_1/photos/pho_9`);
    });

    it('reorderRecipePhotos PATCHes /photos/reorder with { photoIds } and returns the ordered photos (200)', async () => {
        const reordered = [makeRecipePhoto({ id: 'pho_2', order: 1 }), makeRecipePhoto({ id: 'pho_1', order: 2 })];
        const fetchMock = stubFetch(200, reordered);

        const result = await makeClient(fetchMock).reorderRecipePhotos('rec_1', ['pho_2', 'pho_1']);

        expect(result).toEqual(reordered);
        const req = requestAt(fetchMock);
        expect(req.method).toBe('PATCH');
        expect(req.url).toBe(`${BASE}/v1/recipes/rec_1/photos/reorder`);
        expect(jsonBody(fetchMock)).toEqual({ photoIds: ['pho_2', 'pho_1'] });
    });
});

describe('RecipeServiceClient — collections', () => {
    it('createCollection POSTs /v1/collections with the request and returns the collection (201)', async () => {
        const created = makeCollection({ id: 'col_new' });
        const fetchMock = stubFetch(201, created);
        const request = { name: 'Weeknight dinners', visibility: 'private' as const };

        const result = await makeClient(fetchMock).createCollection(request);

        expect(result).toEqual(created);
        const req = requestAt(fetchMock);
        expect(req.method).toBe('POST');
        expect(req.url).toBe(`${BASE}/v1/collections`);
        expect(jsonBody(fetchMock)).toEqual(request);
    });

    it('listCollections GETs /v1/collections with pagination and returns the page (200)', async () => {
        const page = makePaginatedResponse([makeCollection()], { page: 3, pageSize: 10 });
        const fetchMock = stubFetch(200, page);

        const result = await makeClient(fetchMock).listCollections({ page: 3, pageSize: 10 });

        expect(result).toEqual(page);
        expect(requestAt(fetchMock).url).toBe(`${BASE}/v1/collections?page=3&pageSize=10`);
    });

    it('getCollectionById GETs /v1/collections/{id} and returns the collection with recipes (200)', async () => {
        const collection = makeCollectionWithRecipes();
        const fetchMock = stubFetch(200, collection);

        const result = await makeClient(fetchMock).getCollectionById('col_1');

        expect(result).toEqual(collection);
        expect(requestAt(fetchMock).url).toBe(`${BASE}/v1/collections/col_1`);
    });

    it('updateCollection PATCHes /v1/collections/{id} with the update and returns the collection (200)', async () => {
        const updated = makeCollection({ name: 'Renamed' });
        const fetchMock = stubFetch(200, updated);
        const request = { name: 'Renamed' };

        const result = await makeClient(fetchMock).updateCollection('col_1', request);

        expect(result).toEqual(updated);
        const req = requestAt(fetchMock);
        expect(req.method).toBe('PATCH');
        expect(req.url).toBe(`${BASE}/v1/collections/col_1`);
        expect(jsonBody(fetchMock)).toEqual(request);
    });

    it('deleteCollection DELETEs /v1/collections/{id} and resolves void (204)', async () => {
        const fetchMock = stubFetch(204);

        await expect(makeClient(fetchMock).deleteCollection('col_1')).resolves.toBeUndefined();
        const req = requestAt(fetchMock);
        expect(req.method).toBe('DELETE');
        expect(req.url).toBe(`${BASE}/v1/collections/col_1`);
    });

    it('addRecipeToCollection POSTs /{id}/recipes with { recipeId } and returns the membership (201)', async () => {
        const membership = makeCollectionRecipeMembership();
        const fetchMock = stubFetch(201, membership);

        const result = await makeClient(fetchMock).addRecipeToCollection('col_1', 'rec_1');

        expect(result).toEqual(membership);
        const req = requestAt(fetchMock);
        expect(req.method).toBe('POST');
        expect(req.url).toBe(`${BASE}/v1/collections/col_1/recipes`);
        expect(jsonBody(fetchMock)).toEqual({ recipeId: 'rec_1' });
    });

    it('removeRecipeFromCollection DELETEs /{id}/recipes/{recipeId} and resolves void (204)', async () => {
        const fetchMock = stubFetch(204);

        await expect(makeClient(fetchMock).removeRecipeFromCollection('col_1', 'rec_1')).resolves.toBeUndefined();
        const req = requestAt(fetchMock);
        expect(req.method).toBe('DELETE');
        expect(req.url).toBe(`${BASE}/v1/collections/col_1/recipes/rec_1`);
    });

    it('cloneCollection POSTs /{id}/clone WITH overrides body and returns the clone (201)', async () => {
        const clone = makeCollection({ id: 'col_clone', sourceCollectionId: 'col_1' });
        const fetchMock = stubFetch(201, clone);
        const request = { name: 'My copy' };

        const result = await makeClient(fetchMock).cloneCollection('col_1', request);

        expect(result).toEqual(clone);
        const req = requestAt(fetchMock);
        expect(req.method).toBe('POST');
        expect(req.url).toBe(`${BASE}/v1/collections/col_1/clone`);
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
        expect(req.url).toBe(`${BASE}/v1/collections/col_1/pull-from-source`);
        expect(req.body).toBeUndefined();
    });
});

describe('RecipeServiceClient — search & account', () => {
    it('searchRecipes GETs /v1/search/recipes with all filters and returns ranked results (200)', async () => {
        const response = makeRecipeSearchResponse();
        const fetchMock = stubFetch(200, response);

        const result = await makeClient(fetchMock).searchRecipes({
            query: 'chicken pie',
            cuisine: 'british',
            dietaryFlags: ['vegan', 'gluten_free'],
            tags: ['dinner'],
            maxPrepTime: 30,
            maxTotalTime: 60,
            ingredientIds: ['ing_1', 'ing_2'],
            page: 2,
            pageSize: 10,
            sortBy: 'relevance',
        });

        expect(result).toEqual(response);
        expect(requestAt(fetchMock).url).toBe(
            `${BASE}/v1/search/recipes?query=chicken+pie&cuisine=british` +
                `&dietaryFlags=vegan&dietaryFlags=gluten_free&tags=dinner` +
                `&maxPrepTime=30&maxTotalTime=60&ingredientIds=ing_1&ingredientIds=ing_2` +
                `&page=2&pageSize=10&sortBy=relevance`,
        );
    });

    it('searchRecipes with no params issues a bare GET (no query string) — browse mode', async () => {
        const fetchMock = stubFetch(200, makeRecipeSearchResponse({ results: [] }));

        await makeClient(fetchMock).searchRecipes();

        expect(requestAt(fetchMock).url).toBe(`${BASE}/v1/search/recipes`);
    });

    it('requestAccountErasure POSTs /v1/account/erasure WITH a confirmation body and returns the job (202)', async () => {
        const accepted = makeErasureAccepted({ status: 'running' });
        const fetchMock = stubFetch(202, accepted);
        const request = { confirmationPhrase: 'DELETE MY ACCOUNT' };

        const result = await makeClient(fetchMock).requestAccountErasure(request);

        expect(result).toEqual(accepted);
        const req = requestAt(fetchMock);
        expect(req.method).toBe('POST');
        expect(req.url).toBe(`${BASE}/v1/account/erasure`);
        expect(jsonBody(fetchMock)).toEqual(request);
    });

    it('requestAccountErasure POSTs with NO body when no request is supplied', async () => {
        const fetchMock = stubFetch(202, makeErasureAccepted());

        await makeClient(fetchMock).requestAccountErasure();

        expect(requestAt(fetchMock).body).toBeUndefined();
    });
});
