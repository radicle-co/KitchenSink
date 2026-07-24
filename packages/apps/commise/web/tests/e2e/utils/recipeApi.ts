import type { Page } from '@playwright/test';
import {
    usesPremiumCapability,
    type Collection,
    type Ingredient,
    type PaginatedResponse,
    type Recipe,
    type RecipeDetail,
    type RecipeDifficulty,
    type RecipeFacetCount,
    type RecipePhoto,
    type RecipeStatus,
    type RecipeVisibility,
} from '@kitchensink/recipe-core';
import type {
    CollectionRecipeMembership,
    RecipeSearchFacets,
    RecipeSearchResponse,
    UploadUrlResponse,
} from '@kitchensink/recipe-service-client';

/**
 * The mock "S3" origin the presign step hands back as `uploadUrl` (T067/CP-6/P3 photo-upload e2e). A
 * dedicated `page.route` below fulfils any `PUT` here with a bare 200, standing in for the real direct-to-S3
 * upload the recipe service's presigned URL targets in production.
 */
const MOCK_S3_ORIGIN = 'https://mock-s3.recipe-photos.e2e.example.com';

/**
 * Recipe-service route mocks for the web E2E specs (T079/T080/T104/T109/T110). The recipe pages are
 * auth-gated server shells that render CLIENT containers fetching the recipe service via TanStack Query in
 * the browser, so a `page.route` glob over the `/v1/` API intercepts every call. This installs a small
 * in-memory store so a happy path is
 * coherent across requests (create → the list/detail reflect it, edit bumps the version, delete removes it,
 * clone yields a new recipe, visibility toggles, a collection's membership changes, search narrows). The
 * real backend is covered separately by the recipe-service's own e2e + k6 tiers; these specs verify the full
 * UI integration against a controlled contract.
 *
 * **The store is the contract, not a yes-man.** Every handler below mirrors the shape, status code, and
 * READ PROJECTION the deployed service emits (`contracts/api.openapi.yaml` + the service's own response
 * DTOs) — notably that list/search/collection reads return recipe METADATA while only the single-recipe
 * detail reads embed `photos`/`nutrition`. A mock that answers more generously than production is worse
 * than no mock: it stays green forever while the real call 500s.
 */

const ISO = '2026-01-01T00:00:00.000Z';

/** The contract's `ErrorResponse` body for a 404 (`required: [code, message]`). */
const NOT_FOUND_BODY = { code: 'NOT_FOUND', message: 'Resource not found' };

/** The contract's `VersionConflictErrorResponse` body for a 409 (`details.currentVersion`/`conflictingVersion`). */
function versionConflictBody(currentVersion: number, conflictingVersion: number) {
    return {
        code: 'VERSION_CONFLICT',
        message: 'Recipe version conflict',
        details: { currentVersion, conflictingVersion },
    };
}

/**
 * Apply an `UpdateRecipeInput` body onto a stored recipe, exactly as the service's update path does: overlay
 * each PROVIDED field (title/description/cuisine/times/servings/visibility/flags/tags and the ingredient +
 * step sets, mapped to their read-projection shapes), leave absent fields untouched, and bump
 * `currentVersion`. Faithful enough that a merged write's per-field composition is observable on the next
 * read — a mock that ignored the merged fields would stay green while the real service persisted them.
 */
function applyUpdate(current: RecipeDetail, input: Record<string, unknown>): RecipeDetail {
    const next: RecipeDetail = { ...current, currentVersion: current.currentVersion + 1 };
    const scalars = [
        'title',
        'description',
        'cuisine',
        'servings',
        'prepTimeMinutes',
        'cookTimeMinutes',
        'totalTimeMinutes',
        'visibility',
    ] as const;

    for (const key of scalars) {
        if (input[key] !== undefined) {
            (next as unknown as Record<string, unknown>)[key] = input[key];
        }
    }

    // Difficulty is THREE-state on update (FR-001b), unlike the plain scalars above: an explicit `null`
    // CLEARS it back to "not stated" (the read projection then omits it), a value sets it, and an absent
    // field leaves it unchanged — exactly as the service's update path treats it.
    if ('difficulty' in input) {
        if (input['difficulty'] === null) {
            delete (next as { difficulty?: RecipeDifficulty }).difficulty;
        } else if (typeof input['difficulty'] === 'string') {
            next.difficulty = input['difficulty'] as RecipeDifficulty;
        }
    }

    if (Array.isArray(input['tags'])) {
        next.tags = input['tags'] as string[];
    }

    if (Array.isArray(input['dietaryFlags'])) {
        next.dietaryFlags = input['dietaryFlags'] as string[];
    }

    if (Array.isArray(input['ingredients'])) {
        next.ingredients = (input['ingredients'] as Record<string, unknown>[]).map((line) => ({
            ingredientId: String(line['ingredientId']),
            name: String(line['name']),
            quantity: Number(line['quantity']),
            ...(line['unit'] === undefined ? {} : { unit: String(line['unit']) }),
            ...(line['notes'] === undefined ? {} : { notes: String(line['notes']) }),
            isUserEntered: false,
        }));
    }

    if (Array.isArray(input['steps'])) {
        next.steps = (input['steps'] as Record<string, unknown>[]).map((step, index) => ({
            stepNumber: index + 1,
            instruction: String(step['instruction']),
            ...(step['timerSeconds'] === undefined ? {} : { timerSeconds: Number(step['timerSeconds']) }),
        }));
    }

    return next;
}

/**
 * A fully-valid base recipe; overrides win.
 *
 * Faithful to the service's read projection: `usesPremiumCapability` is the materialized badge rule (never
 * restated), and the seed is UNRATED (`ratingCount: 0`, no `averageRating`) with no stated difficulty and no
 * cover photo — the honest default for a freshly-seeded recipe with an empty `photos` list. A parity spec
 * overrides `ratingCount`/`averageRating`/`difficulty`/`coverPhotoUrl` to exercise the enriched card.
 */
function makeRecipe(over: Partial<Recipe> = {}): Recipe {
    const base = {
        id: 'rec_seed',
        ownerId: 'usr_e2e',
        title: 'Seed Recipe',
        description: 'A seeded recipe.',
        prepTimeMinutes: 10,
        cookTimeMinutes: 20,
        totalTimeMinutes: 30,
        servings: 4,
        visibility: 'public' as RecipeVisibility,
        status: 'published' as RecipeStatus,
        sourceType: 'user_created' as const,
        hasSubstantiveEdit: false,
        dietaryFlags: [],
        tags: [],
        hasPartialNutrition: false,
        currentVersion: 1,
        ratingCount: 0,
        createdAt: ISO,
        updatedAt: ISO,
        ...over,
    };

    return {
        ...base,
        usesPremiumCapability: over.usesPremiumCapability ?? usesPremiumCapability(base),
        // recipe-core invariant: an average exists only alongside a non-zero count.
        averageRating: base.ratingCount > 0 ? base.averageRating : undefined,
    };
}

/** A fully-valid recipe detail (base + embedded ingredients/steps/photos/nutrition); overrides win. */
export function makeRecipeDetail(over: Partial<RecipeDetail> = {}): RecipeDetail {
    return {
        ...makeRecipe(over),
        ingredients: over.ingredients ?? [
            { ingredientId: 'ing_salt', name: 'Salt', quantity: 1, unit: 'tsp', isUserEntered: false },
        ],
        steps: over.steps ?? [{ stepNumber: 1, instruction: 'Combine and cook.' }],
        photos: over.photos ?? [],
        nutrition: over.nutrition ?? { calories: 420, proteinG: 12, carbsG: 40, fatG: 18, isComplete: true },
    };
}

/**
 * The collection record the mock STORES. It is the service's `Collection` wire shape (see the service's
 * `collections.types.ts` → `CollectionResponse`: the shared `Collection` plus the boundary-only
 * `visibility`), with the MEMBERSHIP held alongside as `recipeIds` — a join, exactly as the service holds
 * one, rather than an embedded recipe array. `GET /v1/collections/{id}` composes `recipes` from the recipe
 * store at read time, so removing a member is observable for the same reason it is in production.
 */
export interface MockCollection extends Collection {
    /** Collection visibility (FR-010) — emitted by the service; `recipe-core`'s `Collection` omits it. */
    readonly visibility: RecipeVisibility;
    /** Ids of the recipes in this collection (the `collection_recipes` join), in insertion order. */
    readonly recipeIds: readonly string[];
}

/** A fully-valid, private collection owned by the viewer with no members; overrides win. */
export function makeCollection(over: Partial<MockCollection> = {}): MockCollection {
    return {
        id: 'col_seed',
        ownerId: 'usr_e2e',
        name: 'Seed Collection',
        visibility: 'private',
        recipeIds: [],
        createdAt: ISO,
        updatedAt: ISO,
        ...over,
    };
}

/** The `Collection` wire shape the service emits: the stored record minus its join, plus a derived count. */
interface CollectionResponse extends Collection {
    readonly visibility: RecipeVisibility;
    readonly recipeCount: number;
}

/** The `CollectionWithRecipes` wire shape: a collection plus its member recipes as METADATA. */
interface CollectionWithRecipesResponse extends CollectionResponse {
    readonly recipes: readonly Recipe[];
}

/**
 * Strip a stored {@link RecipeDetail} down to the `Recipe` METADATA the search + collection read paths
 * actually return: the service's `rowToRecipe` emits no `ingredients`/`steps`/`photos`/`nutrition` there.
 * Serving the richer detail would let a UI that (wrongly) read a detail-only field off a search hit or a
 * collection member stay green here and throw in production. Pure.
 *
 * @param detail - The stored recipe.
 * @returns The metadata-only projection.
 */
function toRecipeMetadata(detail: RecipeDetail): Recipe {
    const { ingredients: _ingredients, steps: _steps, photos: _photos, nutrition: _nutrition, ...metadata } = detail;

    return metadata;
}

/**
 * Project a stored recipe to the row `GET /v1/recipes` returns: metadata PLUS the composed
 * `ingredients`/`steps`, but WITHOUT `photos`/`nutrition` (the service's `RecipeResponse` documents both as
 * "ABSENT on list/search"). Typed `Recipe`, which is what the client contract promises the list page. Pure.
 *
 * @param detail - The stored recipe.
 * @returns The list-row projection.
 */
function toRecipeListRow(detail: RecipeDetail): Recipe {
    const { photos: _photos, nutrition: _nutrition, ...row } = detail;

    return row;
}

/**
 * Project a stored collection to its wire response — the join is replaced by the server-derived
 * `recipeCount`, which is the only membership signal the `Collection` shape carries. Pure.
 *
 * @param record - The stored collection.
 * @returns The `Collection` wire response.
 */
function toCollectionResponse(record: MockCollection): CollectionResponse {
    const { recipeIds, ...collection } = record;

    return { ...collection, recipeCount: recipeIds.length };
}

/**
 * Compose the `CollectionWithRecipes` read: the collection plus its live members, resolved through the
 * recipe store and projected to metadata. Tombstoned (soft-deleted) recipes are excluded, as the service
 * excludes them from every read path (C-007). Pure.
 *
 * @param record - The stored collection.
 * @param recipes - The recipe store to resolve members against.
 * @returns The `CollectionWithRecipes` wire response.
 */
function toCollectionWithRecipes(
    record: MockCollection,
    recipes: ReadonlyMap<string, RecipeDetail>,
): CollectionWithRecipesResponse {
    return {
        ...toCollectionResponse(record),
        recipes: record.recipeIds
            .map((id) => recipes.get(id))
            .filter((recipe): recipe is RecipeDetail => recipe !== undefined && recipe.deletedAt === undefined)
            .map(toRecipeMetadata),
    };
}

/** Wrap rows in the API's paginated envelope. The mock never pages — one page holds every row. Pure. */
function paginate<T>(rows: readonly T[]): PaginatedResponse<T> {
    return { data: [...rows], total: rows.length, page: 1, pageSize: 20, hasMore: false };
}

/** Count each distinct value into the contract's object-per-bucket facet shape. Pure. */
function toFacetCounts(values: readonly string[]): RecipeFacetCount[] {
    const counts = new Map<string, number>();

    for (const value of values) {
        counts.set(value, (counts.get(value) ?? 0) + 1);
    }

    return [...counts].map(([value, count]) => ({ value, count }));
}

/** Aggregate the dietary-flag + tag facet buckets over a match set, as the search DAL's facet CTE does. Pure. */
function toSearchFacets(recipes: readonly Recipe[]): RecipeSearchFacets {
    return {
        dietaryFlags: toFacetCounts(recipes.flatMap((recipe) => recipe.dietaryFlags)),
        tags: toFacetCounts(recipes.flatMap((recipe) => recipe.tags)),
    };
}

const catalogIngredient: Ingredient = {
    id: 'ing_salt',
    name: 'Salt',
    foodId: 'food_salt',
    isUserEntered: false,
    createdAt: ISO,
};

/**
 * Read the authenticated viewer's app-user id from the live Clerk session token's `external_id` claim — the
 * SAME claim the recipe UI (and the recipe service, fail-closed) uses as the owner key for owner-only actions
 * (delete/edit/visibility). The mock seeds recipe `ownerId` with this so those controls render for the test
 * user. `external_id` is emitted by the Clerk session-token customization on both instances (feature-001
 * task T000-prereq), so it MUST be present here.
 *
 * This deliberately **throws** rather than falling back to a sentinel when the claim (or session) is missing:
 * a silent fallback would surface later as a confusing "owner control not found" assertion, whereas a real
 * regression in the session-token customization is exactly what this owner-gated suite exists to catch — so
 * it fails loud, at the source, with a diagnostic message.
 *
 * @param page - A page with a live Clerk session (call after `signInWithTicket`).
 * @returns The viewer's app-user ULID from the token's `external_id` claim.
 * @throws {Error} when no Clerk session/token is present, the token is malformed, or `external_id` is absent.
 * @sideEffect Reads the Clerk session token in the page context.
 */
export async function readViewerAppId(page: Page): Promise<string> {
    const jwt = await page.evaluate(async () => {
        const clerk = (window as unknown as { Clerk?: { session?: { getToken(): Promise<string | null> } } }).Clerk;

        return clerk?.session ? await clerk.session.getToken() : null;
    });

    if (jwt === null) {
        throw new Error('readViewerAppId: no live Clerk session — call after signInWithTicket().');
    }

    const payload = jwt.split('.')[1];

    if (payload === undefined) {
        throw new Error('readViewerAppId: malformed Clerk session token (no JWT payload segment).');
    }

    const claims = JSON.parse(Buffer.from(payload, 'base64').toString('utf8')) as Record<string, unknown>;
    const externalId = claims['external_id'];

    if (typeof externalId !== 'string' || externalId.length === 0) {
        throw new Error(
            "readViewerAppId: the Clerk session token carries no 'external_id' claim. The session-token " +
                'customization (feature-001 T000-prereq) must emit the app-user ULID on both Clerk instances; ' +
                'without it, recipe ownership is broken app-wide (owner controls never render, service 401s).',
        );
    }

    return externalId;
}

/** Options for {@link mockRecipeApi}. */
export interface MockRecipeApiOptions {
    /** Recipes to seed the store with (defaults to one public "Seed Recipe" owned by the viewer). */
    readonly recipes?: readonly RecipeDetail[];
    /** The viewer's subscription tier surfaced at `/v1/users/me` (defaults to premium so private is enabled). */
    readonly tier?: 'free' | 'premium';
    /** The app-user id the viewer owns recipes as (matches the recipe `ownerId` so owner controls show). */
    readonly viewerId?: string;
    /** Collections to seed the store with (defaults to none — the collection list starts empty). */
    readonly collections?: readonly MockCollection[];
    /**
     * One-shot concurrent edits keyed by recipe id (T070). The FIRST update to a listed recipe simulates
     * another device having saved first: the mock applies these fields, bumps the version, and rejects the
     * user's write with a `409 VERSION_CONFLICT` (so the client refetches and enters conflict mode). The
     * entry is then cleared, so the retry against the fresh version succeeds — exactly the optimistic-
     * concurrency race FR-007c's merge resolves. Modelled in the mock (not by mutating the store mid-test)
     * so the 409 is deterministic regardless of any client-side refetch timing.
     */
    readonly concurrentEdits?: Readonly<Record<string, Partial<RecipeDetail>>>;
}

/**
 * Install the recipe-service route mocks on `page`. Returns the live store so a spec can assert server state.
 *
 * @param page - The Playwright page.
 * @param options - Seed data + viewer identity/tier.
 * @returns The in-memory recipe store (id → detail).
 * @sideEffect Registers a `page.route` handler.
 */
export async function mockRecipeApi(
    page: Page,
    options: MockRecipeApiOptions = {},
): Promise<Map<string, RecipeDetail>> {
    const viewerId = options.viewerId ?? 'usr_e2e';
    const tier = options.tier ?? 'premium';
    const store = new Map<string, RecipeDetail>();
    const collections = new Map<string, MockCollection>();
    // Ratings (FR-013). The viewer's OWN rating per recipe (id → stars), held apart from the base aggregate of
    // OTHER users' ratings captured at seed time, so the recomputed `averageRating`/`ratingCount` model the
    // real trigger: a per-user upsert (re-rating REPLACES, never adds — Sc7) plus an idempotent remove (Sc10).
    const viewerRatings = new Map<string, number>();
    const baseAggregates = new Map<string, { sum: number; count: number }>();
    // One-shot concurrent edits (T070): consumed on the first update to each listed recipe.
    const pendingConcurrentEdits = new Map<string, Partial<RecipeDetail>>(
        Object.entries(options.concurrentEdits ?? {}),
    );
    let nextId = 1;
    let nextCollectionId = 1;
    // Photos (T067/CP-6/P3): a recipe id → its confirmed photos, in display order. Seeded from each
    // recipe's embedded `photos` so a spec that pre-seeds a cover photo sees it on both the detail's
    // embedded list AND `GET /v1/recipes/{id}/photos`, exactly as the two stay in sync in production.
    const photoStore = new Map<string, RecipePhoto[]>();
    let nextPhotoId = 1;

    const seed = options.recipes ?? [makeRecipeDetail({ id: 'rec_seed', ownerId: viewerId, title: 'Seed Recipe' })];

    for (const recipe of seed) {
        store.set(recipe.id, recipe);
        photoStore.set(recipe.id, [...recipe.photos]);
        // Capture the seed's aggregate as the base of OTHER users' ratings — the viewer has not rated yet, so
        // whatever the seed carries is attributable to everyone else. A viewer rating layers on top of this.
        baseAggregates.set(recipe.id, {
            count: recipe.ratingCount,
            sum: (recipe.averageRating ?? 0) * recipe.ratingCount,
        });
    }

    /**
     * Recompute a recipe's stored `averageRating`/`ratingCount` from its base (other users) plus the viewer's
     * current rating, exactly as the DB trigger would: the viewer contributes AT MOST one rating (a re-rate
     * replaces, never stacks), and a removed rating drops back to the base. An aggregate of zero ratings has
     * NO average (absent, never `0` — the recipe-core invariant).
     */
    const applyRating = (id: string): void => {
        const current = store.get(id);
        const base = baseAggregates.get(id);

        if (current === undefined || base === undefined) {
            return;
        }

        const mine = viewerRatings.get(id);
        const count = base.count + (mine !== undefined ? 1 : 0);
        const sum = base.sum + (mine ?? 0);
        const next: RecipeDetail = { ...current, ratingCount: count };

        if (count > 0) {
            next.averageRating = sum / count;
        } else {
            delete (next as { averageRating?: number }).averageRating;
        }

        store.set(id, next);
    };

    for (const collection of options.collections ?? []) {
        collections.set(collection.id, collection);
    }

    await page.route('**/v1/**', async (route) => {
        const request = route.request();
        const method = request.method();
        const url = new URL(request.url());
        const path = url.pathname;
        const body = (): Record<string, unknown> =>
            request.postData() ? JSON.parse(request.postData() as string) : {};

        // Identity profile → drives the premium visibility gate.
        if (path.endsWith('/v1/users/me')) {
            return route.fulfill({
                json: {
                    user: { id: viewerId, displayName: 'E2E', email: 'e2e@example.com', status: 'active' },
                    account: { subscriptionTier: tier },
                },
            });
        }

        // Ingredient typeahead + freeform create.
        if (path.endsWith('/v1/ingredients/search')) {
            return route.fulfill({ json: [catalogIngredient] });
        }

        if (path.endsWith('/v1/ingredients') && method === 'POST') {
            return route.fulfill({ status: 201, json: catalogIngredient });
        }

        // Photos (T067/CP-6/P3 — presign → direct S3 PUT → confirm, driven by `useRecipePhotoUpload`).
        // Matched BEFORE the bare `/photos` list route so the longer, more specific paths win.

        // Presign: mint a mock S3 URL under MOCK_S3_ORIGIN; the object key encodes the recipe + a counter
        // so a confirm can be traced back to the presign that minted it, exactly as the real key does.
        const uploadUrlPath = path.match(/\/v1\/recipes\/([^/]+)\/photos\/upload-url$/);

        if (uploadUrlPath && method === 'POST') {
            const id = uploadUrlPath[1] as string;
            const key = `uploads/${id}/mock_${nextPhotoId}.jpg`;
            const response: UploadUrlResponse = {
                uploadUrl: `${MOCK_S3_ORIGIN}/${key}`,
                key,
                expiresIn: 900,
                maxBytes: 5_242_880,
            };

            // A short artificial delay so the busy affordance the hook drives (`uploading`) is observable
            // by the spec rather than resolving within the same event-loop turn as the click.
            await new Promise((resolve) => setTimeout(resolve, 200));

            return route.fulfill({ json: response });
        }

        // Confirm: record the uploaded key against the recipe, appended at the next display order — the
        // same shape `POST /v1/recipes/{id}/photos/confirm` returns (201, the created `RecipePhoto`).
        const confirmPhotoPath = path.match(/\/v1\/recipes\/([^/]+)\/photos\/confirm$/);

        if (confirmPhotoPath && method === 'POST') {
            const id = confirmPhotoPath[1] as string;
            const input = body();
            const key = typeof input['key'] === 'string' ? input['key'] : `uploads/${id}/mock_${nextPhotoId}.jpg`;
            const contentType = typeof input['contentType'] === 'string' ? input['contentType'] : 'image/jpeg';
            const existing = photoStore.get(id) ?? [];
            const photo: RecipePhoto = {
                id: `pht_${nextPhotoId++}`,
                recipeId: id,
                key,
                url: `https://cdn.example.com/${key}`,
                contentType,
                order: existing.length + 1,
                createdAt: ISO,
            };
            photoStore.set(id, [...existing, photo]);

            return route.fulfill({ status: 201, json: photo });
        }

        // List (edit surface mounts the uploader): the recipe's confirmed photos, in order.
        const photosListPath = path.match(/\/v1\/recipes\/([^/]+)\/photos$/);

        if (photosListPath && method === 'GET') {
            const id = photosListPath[1] as string;

            return route.fulfill({ json: photoStore.get(id) ?? [] });
        }

        // Clone → a new recipe owned by the viewer, attributed to the source.
        const clone = path.match(/\/v1\/recipes\/([^/]+)\/clone$/);

        if (clone && method === 'POST') {
            const source = store.get(clone[1] as string);
            const created = makeRecipeDetail({
                id: `rec_clone_${nextId++}`,
                ownerId: viewerId,
                title: `${source?.title ?? 'Recipe'} (copy)`,
                visibility: 'private',
                clonedFromId: clone[1] as string,
                sourceAttribution: source?.title,
            });
            store.set(created.id, created);

            return route.fulfill({ status: 201, json: created });
        }

        // Visibility toggle.
        const visibility = path.match(/\/v1\/recipes\/([^/]+)\/visibility$/);

        if (visibility && method === 'PATCH') {
            const id = visibility[1] as string;
            const current = store.get(id);

            if (!current) {
                return route.fulfill({ status: 404, json: NOT_FOUND_BODY });
            }

            const updated = {
                ...current,
                visibility: (body()['visibility'] as RecipeVisibility) ?? current.visibility,
            };
            store.set(id, updated);

            return route.fulfill({ json: updated });
        }

        // Rating (FR-013): PUT upsert / DELETE remove. Matched BEFORE the single-recipe route so the longer
        // path wins. Models the service's guards faithfully so the UI's own-recipe gate + honest error copy
        // are exercised against the REAL response codes:
        //   - a recipe the viewer cannot READ (private, not theirs) → 404, indistinguishable from missing (Sc9);
        //   - the viewer's OWN recipe → 403 (Sc8) — the owner already knows it exists, so this may be explicit;
        //   - otherwise PUT returns 200 with the recomputed detail (Sc6/Sc7), DELETE returns 204 (Sc10).
        const ratingPath = path.match(/\/v1\/recipes\/([^/]+)\/rating$/);

        if (ratingPath && (method === 'PUT' || method === 'DELETE')) {
            const id = ratingPath[1] as string;
            const current = store.get(id);
            const canRead = current !== undefined && (current.visibility === 'public' || current.ownerId === viewerId);

            if (!canRead) {
                return route.fulfill({ status: 404, json: NOT_FOUND_BODY });
            }

            if (current.ownerId === viewerId) {
                return route.fulfill({
                    status: 403,
                    json: { code: 'FORBIDDEN', message: 'Cannot rate your own recipe' },
                });
            }

            if (method === 'PUT') {
                const stars = body()['stars'];

                if (typeof stars !== 'number' || !Number.isInteger(stars) || stars < 1 || stars > 5) {
                    return route.fulfill({
                        status: 400,
                        json: { code: 'VALIDATION_ERROR', message: 'stars must be 1–5' },
                    });
                }

                viewerRatings.set(id, stars);
                applyRating(id);

                return route.fulfill({ json: store.get(id) });
            }

            // DELETE — idempotent: removing a rating that is not present still succeeds (Sc10).
            viewerRatings.delete(id);
            applyRating(id);

            return route.fulfill({ status: 204, body: '' });
        }

        // Single recipe: get / update / delete.
        const single = path.match(/\/v1\/recipes\/([^/]+)$/);

        if (single) {
            const id = single[1] as string;
            const current = store.get(id);

            if (method === 'GET') {
                return current
                    ? route.fulfill({ json: current })
                    : route.fulfill({ status: 404, json: NOT_FOUND_BODY });
            }

            if (method === 'PATCH') {
                if (!current) {
                    return route.fulfill({ status: 404, json: NOT_FOUND_BODY });
                }

                const input = body();
                const expectedVersion = input['expectedVersion'];
                const conflictingVersion =
                    typeof expectedVersion === 'number' ? expectedVersion : current.currentVersion;

                // One-shot concurrent edit: another device saved first. Apply it, bump the version, and reject
                // this write with a 409 so the client refetches and enters conflict mode.
                const pending = pendingConcurrentEdits.get(id);

                if (pending) {
                    pendingConcurrentEdits.delete(id);
                    const bumped = makeRecipeDetail({
                        ...current,
                        ...pending,
                        currentVersion: current.currentVersion + 1,
                    });
                    store.set(id, bumped);

                    return route.fulfill({
                        status: 409,
                        json: versionConflictBody(bumped.currentVersion, conflictingVersion),
                    });
                }

                // Optimistic-concurrency check: a stale `expectedVersion` loses the race (FR-007c).
                if (typeof expectedVersion === 'number' && expectedVersion !== current.currentVersion) {
                    return route.fulfill({
                        status: 409,
                        json: versionConflictBody(current.currentVersion, expectedVersion),
                    });
                }

                const updated = applyUpdate(current, input);
                store.set(id, updated);

                return route.fulfill({ json: updated });
            }

            if (method === 'DELETE') {
                store.delete(id);

                return route.fulfill({ status: 204, body: '' });
            }
        }

        // Recipes: list + create.
        if (path.endsWith('/v1/recipes')) {
            if (method === 'GET') {
                return route.fulfill({ json: paginate([...store.values()].map(toRecipeListRow)) });
            }

            if (method === 'POST') {
                const input = body();
                const created = makeRecipeDetail({
                    id: `rec_new_${nextId++}`,
                    ownerId: viewerId,
                    title: typeof input['title'] === 'string' ? input['title'] : 'New Recipe',
                    servings: typeof input['servings'] === 'number' ? input['servings'] : 4,
                    // Carry a stated difficulty (FR-001b); create has no clear sentinel, so absence = not stated.
                    ...(typeof input['difficulty'] === 'string'
                        ? { difficulty: input['difficulty'] as RecipeDifficulty }
                        : {}),
                });
                store.set(created.id, created);

                return route.fulfill({ status: 201, json: created });
            }
        }

        // ─── Collections (T109) ─────────────────────────────────────────────────────────────────
        // Membership: remove a recipe from a collection (204). Matched BEFORE the collection routes so
        // the longer path wins.
        const member = path.match(/\/v1\/collections\/([^/]+)\/recipes\/([^/]+)$/);

        if (member && method === 'DELETE') {
            const current = collections.get(member[1] as string);

            if (!current) {
                return route.fulfill({ status: 404, json: NOT_FOUND_BODY });
            }

            collections.set(current.id, {
                ...current,
                recipeIds: current.recipeIds.filter((recipeId) => recipeId !== member[2]),
            });

            return route.fulfill({ status: 204, body: '' });
        }

        // Membership: add a recipe to a collection (201 with the join record).
        const members = path.match(/\/v1\/collections\/([^/]+)\/recipes$/);

        if (members && method === 'POST') {
            const current = collections.get(members[1] as string);
            const recipeId = body()['recipeId'];

            if (!current || typeof recipeId !== 'string' || !store.has(recipeId)) {
                return route.fulfill({ status: 404, json: NOT_FOUND_BODY });
            }

            if (!current.recipeIds.includes(recipeId)) {
                collections.set(current.id, { ...current, recipeIds: [...current.recipeIds, recipeId] });
            }

            const membership: CollectionRecipeMembership = {
                collectionId: current.id,
                recipeId,
                addedVia: 'manual',
                createdAt: ISO,
            };

            return route.fulfill({ status: 201, json: membership });
        }

        // Single collection: get (with members) / update / delete.
        const singleCollection = path.match(/\/v1\/collections\/([^/]+)$/);

        if (singleCollection) {
            const id = singleCollection[1] as string;
            const current = collections.get(id);

            if (!current) {
                return route.fulfill({ status: 404, json: NOT_FOUND_BODY });
            }

            if (method === 'GET') {
                return route.fulfill({ json: toCollectionWithRecipes(current, store) });
            }

            if (method === 'PATCH') {
                const input = body();
                const updated: MockCollection = {
                    ...current,
                    ...(typeof input['name'] === 'string' ? { name: input['name'] } : {}),
                    ...(typeof input['description'] === 'string' ? { description: input['description'] } : {}),
                    ...(typeof input['visibility'] === 'string'
                        ? { visibility: input['visibility'] as RecipeVisibility }
                        : {}),
                };
                collections.set(id, updated);

                return route.fulfill({ json: toCollectionResponse(updated) });
            }

            if (method === 'DELETE') {
                // No cascade (FR-012): the collection goes, its recipes stay in the recipe store.
                collections.delete(id);

                return route.fulfill({ status: 204, body: '' });
            }
        }

        // Collections: list (the caller's own) + create.
        if (path.endsWith('/v1/collections')) {
            if (method === 'GET') {
                const owned = [...collections.values()].filter((collection) => collection.ownerId === viewerId);

                return route.fulfill({ json: paginate(owned.map(toCollectionResponse)) });
            }

            if (method === 'POST') {
                const input = body();
                const created = makeCollection({
                    id: `col_new_${nextCollectionId++}`,
                    ownerId: viewerId,
                    name: typeof input['name'] === 'string' ? input['name'] : 'New Collection',
                    ...(typeof input['description'] === 'string' ? { description: input['description'] } : {}),
                    // The contract defaults an unspecified collection visibility to `private` (FR-010).
                    visibility:
                        typeof input['visibility'] === 'string' ? (input['visibility'] as RecipeVisibility) : 'private',
                });
                collections.set(created.id, created);

                return route.fulfill({ status: 201, json: toCollectionResponse(created) });
            }
        }

        // ─── Search (T110 / FR-006 search + filter) ───────────────────────────────────────────────
        if (path.endsWith('/v1/search/recipes')) {
            const term = (url.searchParams.get('query') ?? '').trim().toLowerCase();
            const dietaryFlags = url.searchParams.getAll('dietaryFlags');
            const tags = url.searchParams.getAll('tags');
            const maxTotalTimeRaw = url.searchParams.get('maxTotalTime');
            const maxTotalTime = maxTotalTimeRaw === null ? undefined : Number(maxTotalTimeRaw);
            // Scope to what the caller may see (public + their own) and drop tombstones, as the DAL does.
            const visible = [...store.values()].filter(
                (recipe) =>
                    recipe.deletedAt === undefined && (recipe.visibility === 'public' || recipe.ownerId === viewerId),
            );
            // The keyword narrowing is a case-insensitive substring over the title — a deliberate
            // simplification of the service's Postgres full-text ranking. It is enough to make the specs REAL:
            // the term must actually reach the API for the result set to change, so a UI that drops it fails
            // here. An absent/empty term matches every visible recipe (browse mode), as the service does.
            const termMatched = visible.filter((recipe) => recipe.title.toLowerCase().includes(term));
            // Facets reflect the QUERY (keyword + visibility), independent of the facet selections — exactly
            // as a faceted search's aggregation does — so a selected chip's count stays available.
            const facets = toSearchFacets(termMatched.map(toRecipeMetadata));
            // Filters narrow the results (OR within a dimension, AND across them; the time bound is inclusive),
            // mirroring the search DAL's WHERE. Each is enforced server-side so a UI that dropped a filter
            // param would keep rendering the non-matching recipe and fail the spec.
            const filtered = termMatched.filter((recipe) => {
                const dietaryOk =
                    dietaryFlags.length === 0 || dietaryFlags.some((f) => recipe.dietaryFlags.includes(f));
                const tagsOk = tags.length === 0 || tags.some((t) => recipe.tags.includes(t));
                const timeOk =
                    maxTotalTime === undefined || Number.isNaN(maxTotalTime) || recipe.totalTimeMinutes <= maxTotalTime;

                return dietaryOk && tagsOk && timeOk;
            });
            const metadata = filtered.map(toRecipeMetadata);
            const response: RecipeSearchResponse = {
                // `rank` is a relevance score, present only for a text query — omitted in browse mode.
                results: metadata.map((recipe) => (term.length === 0 ? { recipe } : { recipe, rank: 1 })),
                facets,
                total: metadata.length,
                page: 1,
                pageSize: 20,
                hasMore: false,
            };

            return route.fulfill({ json: response });
        }

        // Pass everything else through untouched — critically Clerk's Frontend API, which ALSO lives under
        // `/v1/` (`/v1/client`, `/v1/environment`, token minting). 404-ing those would break `getToken()`
        // and hang every recipe request that awaits a token. Only the recipe/identity endpoints matched
        // above are mocked; the rest reach the real network.
        return route.continue();
    });

    // The direct-to-S3 PUT the hook sends to the presigned `uploadUrl` above — a distinct origin, so it
    // needs its own route (the `/v1/**` glob above only matches the recipe-service's own origin/path).
    await page.route(`${MOCK_S3_ORIGIN}/**`, (route) => route.fulfill({ status: 200, body: '' }));

    return store;
}
