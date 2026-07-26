import type { Page } from '@playwright/test';
import {
    usesPremiumCapability,
    type Ingredient,
    type PaginatedResponse,
    type Recipe,
    type RecipeDetail,
    type RecipeDifficulty,
    type RecipeFacetCount,
    type RecipePhoto,
    type RecipeSnapshot,
    type RecipeStatus,
    type RecipeVersion,
    type RecipeVisibility,
    type VersionConflictSide,
} from '@kitchensink/recipe-core';
import type {
    Collection,
    CollectionMemberRecipe,
    CollectionRecipeAddedVia,
    CollectionRecipeMembership,
    PullDiff,
    PullFromSourceResponse,
    RecipeSearchFacets,
    RecipeSearchResponse,
    RestoreVersionResponse,
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
/** Distinct from {@link ISO} so a spec can observe `lastPulledAt` actually CHANGING after a pull commits. */
const PULLED_ISO = '2026-01-02T00:00:00.000Z';
/** Distinct from {@link ISO}/{@link PULLED_ISO} — the `createdAt` a version-restore records (W6 Task 6). */
const RESTORED_ISO = '2026-01-03T00:00:00.000Z';

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
 * Resolve whether a recipe line's referenced catalog ingredient is user-entered (freeform). The wire input
 * carries NO `isUserEntered` — the service re-resolves it from the catalog row the `ingredientId` points at
 * (`CreateRecipeIngredientInput`'s own contract: "the server re-resolves the CANONICAL name from the
 * catalog") — so the mock has to resolve it the same way, from the ingredients it has minted.
 */
type ResolveUserEntered = (ingredientId: string) => boolean;

/**
 * Project a create/update body's `ingredients` array onto the read projection's ingredient lines, resolving
 * each line's `isUserEntered` through the catalog rather than assuming it. Pure.
 *
 * @param lines - The raw `ingredients` array from the request body.
 * @param resolveUserEntered - Catalog lookup for the referenced ingredient's `isUserEntered` flag.
 * @returns The projected `RecipeDetail['ingredients']`.
 */
function toIngredientProjection(
    lines: readonly Record<string, unknown>[],
    resolveUserEntered: ResolveUserEntered,
): RecipeDetail['ingredients'] {
    return lines.map((line) => {
        const ingredientId = String(line['ingredientId']);

        return {
            ingredientId,
            name: String(line['name']),
            quantity: Number(line['quantity']),
            ...(line['unit'] === undefined ? {} : { unit: String(line['unit']) }),
            ...(line['notes'] === undefined ? {} : { notes: String(line['notes']) }),
            isUserEntered: resolveUserEntered(ingredientId),
        };
    });
}

/** Project a create/update body's `steps` array onto the read projection's steps (server assigns order). Pure. */
function toStepProjection(lines: readonly Record<string, unknown>[]): RecipeDetail['steps'] {
    return lines.map((step, index) => ({
        stepNumber: index + 1,
        instruction: String(step['instruction']),
        ...(step['timerSeconds'] === undefined ? {} : { timerSeconds: Number(step['timerSeconds']) }),
    }));
}

/**
 * Apply an `UpdateRecipeInput` body onto a stored recipe, exactly as the service's update path does: overlay
 * each PROVIDED field (title/description/cuisine/times/servings/visibility/flags/tags and the ingredient +
 * step sets, mapped to their read-projection shapes), leave absent fields untouched, and bump
 * `currentVersion`. Faithful enough that a merged write's per-field composition is observable on the next
 * read — a mock that ignored the merged fields would stay green while the real service persisted them.
 */
function applyUpdate(
    current: RecipeDetail,
    input: Record<string, unknown>,
    resolveUserEntered: ResolveUserEntered,
): RecipeDetail {
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
        // Draft/publish (w3/e7): the wizard's Save Draft / Publish actions both PATCH an explicit `status`
        // onto the update body (`toUpdateRecipeInput`'s optional second parameter) — apply it exactly like
        // any other provided scalar so a spec can observe the persisted status on the next read/list.
        'status',
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
        next.ingredients = toIngredientProjection(
            input['ingredients'] as Record<string, unknown>[],
            resolveUserEntered,
        );
    }

    if (Array.isArray(input['steps'])) {
        next.steps = toStepProjection(input['steps'] as Record<string, unknown>[]);
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

/** A fully-valid version snapshot (W6 Task 6) — the full domain shape `RecipeVersion.snapshot` carries
 *  (distinct from `RecipeDetail`'s lighter wire-projection ingredients/steps); overrides win. */
function makeVersionSnapshot(over: Partial<RecipeSnapshot> = {}): RecipeSnapshot {
    return {
        version: 1,
        title: 'Seed Recipe',
        description: 'A seeded recipe.',
        steps: [{ id: 'step_seed_1', recipeId: 'rec_seed', stepNumber: 1, instruction: 'Combine and cook.' }],
        ingredients: [
            {
                id: 'ri_seed_1',
                recipeId: 'rec_seed',
                ingredientId: 'ing_salt',
                quantity: 1,
                unit: 'tsp',
                sortOrder: 1,
                ingredientName: 'Salt',
                isUserEntered: false,
            },
        ],
        servings: 4,
        prepTimeMinutes: 10,
        cookTimeMinutes: 20,
        ...over,
    };
}

/**
 * Project a stored {@link RecipeDetail} into the {@link RecipeSnapshot} shape a 409's `server`/`base`
 * {@link VersionConflictSide} carries (W7 Task 7 / W8-a.5) — the mock-side inverse of the conflict view's own
 * `applyServerSnapshotToRecipeDetail`. Synthesizes `id`/`recipeId`/`sortOrder` (never read by
 * `computeConflictDiff`'s content comparisons — only the 7 diffable fields carry real content) so an
 * enriched-conflict seed needs to state only the fields that actually changed. Pure.
 *
 * @param detail - The stored recipe to project.
 * @param version - The snapshot's own sequence number (the side's `versionNumber`).
 * @returns The `RecipeSnapshot`-shaped projection.
 */
function detailToConflictSnapshot(detail: RecipeDetail, version: number): RecipeSnapshot {
    return {
        version,
        title: detail.title,
        description: detail.description,
        servings: detail.servings,
        prepTimeMinutes: detail.prepTimeMinutes,
        cookTimeMinutes: detail.cookTimeMinutes,
        steps: detail.steps.map((step, index) => ({
            id: `snap_step_${index}`,
            recipeId: detail.id,
            stepNumber: step.stepNumber,
            instruction: step.instruction,
            ...(step.timerSeconds === undefined ? {} : { timerSeconds: step.timerSeconds }),
        })),
        ingredients: detail.ingredients.map((ingredient, index) => ({
            id: `snap_ingredient_${index}`,
            recipeId: detail.id,
            ingredientId: ingredient.ingredientId,
            quantity: ingredient.quantity,
            // `RecipeIngredient.unit` is REQUIRED non-empty (`versionConflictDetailsSchema` rejects an empty
            // string), unlike the view's OPTIONAL `unit` — a view ingredient with no stated unit (e.g. "2
            // eggs") falls back to a neutral placeholder rather than producing a body the client's own
            // `safeParse` would silently drop `server`/`base` from.
            unit: ingredient.unit !== undefined && ingredient.unit.length > 0 ? ingredient.unit : 'unit',
            sortOrder: index,
            ingredientName: ingredient.name,
            isUserEntered: ingredient.isUserEntered,
            ...(ingredient.notes === undefined || ingredient.notes === '' ? {} : { displayText: ingredient.notes }),
        })),
    };
}

/** A fully-valid recipe version-history row (W6 Task 6); overrides win. Derives a matching snapshot
 *  `version` from `versionNumber` (mirroring `@kitchensink/recipe-core/testing`'s `makeRecipeVersion`) so an
 *  override of `versionNumber` alone still produces an internally-consistent pair. */
export function makeRecipeVersion(over: Partial<RecipeVersion> = {}): RecipeVersion {
    const versionNumber = over.versionNumber ?? 1;

    return {
        id: `ver_${versionNumber}`,
        recipeId: 'rec_seed',
        versionNumber,
        snapshot: makeVersionSnapshot({ version: versionNumber }),
        createdBy: 'usr_e2e',
        createdAt: ISO,
        ...over,
    };
}

/**
 * The collection record the mock STORES. It is the service's `Collection` wire shape — the WIDENED
 * `@kitchensink/recipe-service-client` `Collection` (core `Collection` plus the pull-provenance projections
 * `sourceOwnerHandle`/`sourceCollectionName`/`lastPulledAt`, W5 Task 5) — with the MEMBERSHIP held alongside
 * as `recipeIds` — a join, exactly as the service holds one, rather than an embedded recipe array. `GET
 * /v1/collections/{id}` composes `recipes` from the recipe store at read time, so removing a member is
 * observable for the same reason it is in production.
 */
export interface MockCollection extends Collection {
    /** Ids of the recipes in this collection (the `collection_recipes` join), in insertion order. */
    readonly recipeIds: readonly string[];
    /**
     * Per-member provenance (recipe id -> `addedVia`, W5 Task 4) — mirrors the service's per-row
     * `RecipeCollectionAddedVia`. An id with no entry here defaults to `'manual'` (the honest default for a
     * hand-added member); a clone/pull route stamps `'clone_seed'`/`'pull'` for the ids it seeds/adds.
     */
    readonly memberAddedVia?: Readonly<Record<string, CollectionRecipeAddedVia>>;
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
    readonly recipeCount: number;
}

/** The `CollectionWithRecipes` wire shape: a collection plus its member recipes as METADATA + provenance. */
interface CollectionWithRecipesResponse extends CollectionResponse {
    readonly recipes: readonly CollectionMemberRecipe[];
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
    const { recipeIds, memberAddedVia: _memberAddedVia, ...collection } = record;

    return { ...collection, recipeCount: recipeIds.length };
}

/**
 * Compose the `CollectionWithRecipes` read: the collection plus its live members, resolved through the
 * recipe store, projected to metadata, and tagged with each member's `addedVia` provenance (W5 Task 4/9 —
 * absent from `memberAddedVia` defaults to `'manual'`, the honest default for a hand-added member).
 * Tombstoned (soft-deleted) recipes are excluded, as the service excludes them from every read path (C-007).
 * Pure.
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
            .map(
                (recipe): CollectionMemberRecipe => ({
                    ...toRecipeMetadata(recipe),
                    addedVia: record.memberAddedVia?.[recipe.id] ?? 'manual',
                }),
            ),
    };
}

/**
 * The three-way pull-from-source diff (W5 Task 5) between a clone's CURRENT membership and its source's
 * membership as VISIBLE to the pulling viewer — mirrors the recipe service's pure `computePullDiff` over two
 * id sets. `sourceVisibleIds` must already be scoped to what the viewer can see (public + their own); this
 * function performs no visibility filtering of its own. Pure.
 *
 * @param sourceVisibleIds - The source collection's member ids the viewer can currently see.
 * @param cloneIds - The clone's current member ids.
 * @returns The `{ added, removed, unchanged }` partition of `source ∪ clone`.
 */
function computePullDiff(sourceVisibleIds: readonly string[], cloneIds: readonly string[]): PullDiff {
    const sourceSet = new Set(sourceVisibleIds);
    const cloneSet = new Set(cloneIds);

    return {
        added: sourceVisibleIds.filter((id) => !cloneSet.has(id)),
        removed: cloneIds.filter((id) => !sourceSet.has(id)),
        unchanged: cloneIds.filter((id) => sourceSet.has(id)),
    };
}

/** Order-independent id-set equality — the building block of {@link pullDiffsAgree}. Pure. */
function sameIdSet(a: readonly string[], b: readonly string[]): boolean {
    if (a.length !== b.length) {
        return false;
    }

    const sortedA = [...a].sort();
    const sortedB = [...b].sort();

    return sortedA.every((id, index) => id === sortedB[index]);
}

/**
 * Whether a previously-previewed diff still matches the LIVE one — the drift guard `pullFromSource` applies
 * (Decision 7): a caller-echoed `previewedDiff` that disagrees with a freshly-computed diff means the source
 * (or the clone's own membership) changed since the preview, and the commit must be rejected with a fresh
 * diff rather than silently applying a different set. Pure.
 */
function pullDiffsAgree(a: PullDiff, b: PullDiff): boolean {
    return sameIdSet(a.added, b.added) && sameIdSet(a.removed, b.removed) && sameIdSet(a.unchanged, b.unchanged);
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
    // Re-read the token each poll with `skipCache` so a freshly-backfilled claim is observed (Clerk otherwise
    // serves a cached token for ~60s). Polling mirrors the app's own tolerance of the first-token sync race
    // (`RecipeServiceClient` retries `IDENTITY_SYNC_PENDING` with a force-refreshed token) — the harness must
    // tolerate the SAME async `external_id` backfill instead of reading once and racing it.
    const getToken = (): Promise<string | null> =>
        page.evaluate(async () => {
            const clerk = (
                window as unknown as {
                    Clerk?: { session?: { getToken(opts?: { skipCache?: boolean }): Promise<string | null> } };
                }
            ).Clerk;

            return clerk?.session ? await clerk.session.getToken({ skipCache: true }) : null;
        });

    return pollForExternalId(getToken);
}

/**
 * Decode a JWT's payload and return its `external_id` claim, or `undefined` when the token is malformed or the
 * claim is absent/empty. Pure — never throws, never falls back to `sub`. The owner-key contract is
 * external_id-only (see {@link readViewerAppId}); the fail-loud lives in {@link pollForExternalId}'s timeout.
 */
export function extractExternalIdFromJwt(token: string): string | undefined {
    const payload = token.split('.')[1];

    if (payload === undefined) {
        return undefined;
    }

    try {
        const claims = JSON.parse(Buffer.from(payload, 'base64').toString('utf8')) as Record<string, unknown>;
        const externalId = claims['external_id'];

        return typeof externalId === 'string' && externalId.length > 0 ? externalId : undefined;
    } catch {
        return undefined;
    }
}

/**
 * Poll `getToken` until a returned token carries a non-empty `external_id` claim, then resolve it. Tolerates a
 * `null` token (session still initializing) and a claim that has not yet been backfilled onto the Clerk user
 * by the async `user.created` webhook. Throws a loud, diagnostic error ONLY after `timeoutMs` — never a silent
 * fallback: a persistent absence here is a real regression (webhook down, or the session-token customization
 * removed), exactly what this owner-gated suite exists to catch.
 *
 * @sideEffect Calls `getToken` repeatedly (a live network/token read) and sleeps between attempts.
 */
export async function pollForExternalId(
    getToken: () => Promise<string | null>,
    { timeoutMs = 10_000, intervalMs = 500 }: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<string> {
    // Date.now()/setTimeout are fine here — this is Playwright harness code, not the deterministic workflow sandbox.
    const deadline = Date.now() + timeoutMs;

    for (;;) {
        const token = await getToken();

        if (token !== null) {
            const externalId = extractExternalIdFromJwt(token);

            if (externalId !== undefined) {
                return externalId;
            }
        }

        if (Date.now() >= deadline) {
            throw new Error(
                "readViewerAppId: the Clerk session token carries no 'external_id' claim. The session-token " +
                    'customization (feature-001 T000-prereq) must emit the app-user ULID on both Clerk instances, ' +
                    `and the user.created webhook must backfill it; waited ${timeoutMs}ms. Without it, recipe ` +
                    'ownership is broken app-wide (owner controls never render, service 401s).',
            );
        }

        await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
}

/**
 * Seed for a one-shot ENRICHED `409 VERSION_CONFLICT` (W7 Task 7) — unlike {@link
 * MockRecipeApiOptions.concurrentEdits}'s bare `{ currentVersion, conflictingVersion }` body, this produces
 * the full W8-a.5 wire shape (`details.server`/`details.base`, each a `VersionConflictSide`) the rebuilt
 * conflict resolver's banner + changed-only diff + A/B/C cards + per-element merge actually read, with
 * `server`'s content DIFFERING from `base`'s (via {@link serverChanges}) so a spec observes real changed-only
 * rows instead of a diff-empty phantom conflict.
 */
export interface EnrichedConflictSeed {
    /** Fields to overlay onto the recipe's CURRENT stored state to produce the winning "server" side (e.g.
     *  `{ servings: 8 }`) — applied to the store immediately the 409 fires, mirroring how the real service
     *  already committed the other device's write by the time a client observes this conflict. */
    readonly serverChanges: Partial<RecipeDetail>;
    /** The server side's `deviceLabel` (W8-a.6), when a spec needs to assert the banner's device suffix.
     *  Omitted → the server side carries no device (the banner renders with no " on {device}" suffix). */
    readonly deviceLabel?: string;
    /** How many versions the server side is ahead of the base (the X6 staleness signal) — defaults to `1`
     *  (a single intervening save). A spec exercising the >10-versions-behind stale-base warning overrides
     *  this directly rather than the mock replaying N literal intervening writes. */
    readonly versionsAhead?: number;
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
    /**
     * One-shot ENRICHED conflicts keyed by recipe id (W7 Task 7) — like {@link concurrentEdits} but producing
     * the full W8-a.5 `server`/`base` wire shape the rebuilt conflict resolver (banner, changed-only diff,
     * A/B/C cards, per-element merge) actually reads, instead of the bare `{ currentVersion, conflictingVersion
     * }` body {@link concurrentEdits} returns. The FIRST update to a listed recipe id fires the enriched 409
     * and applies its `serverChanges`, bumping the store; the entry is then cleared, so a retry against the
     * fresh version succeeds normally. A recipe id present in BOTH this and `concurrentEdits` is not a
     * supported combination — no spec needs both, and this entry is checked first.
     */
    readonly enrichedConflicts?: Readonly<Record<string, EnrichedConflictSeed>>;
    /**
     * How many of the NEXT photo-upload presign calls (across every recipe) fail with a `500`, one-shot —
     * decremented per call, so the (N+1)th and later presigns succeed normally (w3/e7 per-file photo status:
     * lets a spec drive a queue item to `failed` deterministically, then prove Retry recovers it). Defaults
     * to `0` (every upload succeeds), matching every existing photo spec's behavior unchanged.
     */
    readonly failPhotoUploads?: number;
    /**
     * Author handles resolved for a collection's source owner AT CLONE time (mirrors the service's
     * `AuthorHandlesDal.findHandle`, W5 Task 2) — keyed by app-user id. An owner with no entry here clones
     * with `sourceOwnerHandle` OMITTED, exactly as the real service degrades when a handle hasn't resolved
     * yet (the attribution falls back to the collection name only).
     */
    readonly authorHandles?: Readonly<Record<string, string>>;
    /**
     * Page size for `GET /v1/collections` (W5/C7 "Load more" pagination). Defaults to the service's own
     * default (20, `pageQuerySchema`) so every existing small seed still renders on a single page with no
     * `hasMore`; a pagination spec overrides this to a small number rather than seeding 21+ collections.
     */
    readonly collectionsPageSize?: number;
    /**
     * A recipe's version history (W6 Task 6), keyed by recipe id — `GET /v1/recipes/{id}/versions` serves
     * these DESCENDING by `versionNumber` regardless of the array order given here (mirrors the service's
     * real `ORDER BY version_number DESC`, `versions.dal.ts`). A recipe absent here has no version history
     * (an empty list) — the honest default for a recipe seeded without one. Restoring a version APPENDS a
     * new, higher-numbered version (never rewrites history) and advances the recipe's `currentVersion`,
     * exactly as the real restore endpoint does.
     */
    readonly recipeVersions?: Readonly<Record<string, readonly RecipeVersion[]>>;
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
    const authorHandles = options.authorHandles ?? {};
    const collectionsPageSize = options.collectionsPageSize ?? 20;
    const store = new Map<string, RecipeDetail>();
    const collections = new Map<string, MockCollection>();
    // Version history (W6 Task 6) — id -> its versions, MUTATED in place by a restore (appended, never
    // rewritten) so a subsequent `GET .../versions` reflects it.
    const recipeVersions = new Map<string, RecipeVersion[]>(
        Object.entries(options.recipeVersions ?? {}).map(([id, versions]) => [id, [...versions]]),
    );
    // Ratings (FR-013). The viewer's OWN rating per recipe (id → stars), held apart from the base aggregate of
    // OTHER users' ratings captured at seed time, so the recomputed `averageRating`/`ratingCount` model the
    // real trigger: a per-user upsert (re-rating REPLACES, never adds — Sc7) plus an idempotent remove (Sc10).
    const viewerRatings = new Map<string, number>();
    const baseAggregates = new Map<string, { sum: number; count: number }>();
    // One-shot concurrent edits (T070): consumed on the first update to each listed recipe.
    const pendingConcurrentEdits = new Map<string, Partial<RecipeDetail>>(
        Object.entries(options.concurrentEdits ?? {}),
    );
    // One-shot ENRICHED conflicts (W7 Task 7): consumed on the first update to each listed recipe, ahead of
    // `pendingConcurrentEdits` (see its own JSDoc — the two are not meant to be combined for the same id).
    const pendingEnrichedConflicts = new Map<string, EnrichedConflictSeed>(
        Object.entries(options.enrichedConflicts ?? {}),
    );
    let nextId = 1;
    let nextCollectionId = 1;
    // Freeform (user-entered) ingredient create — REQ-032b requires every freeform line to come back
    // flagged `isUserEntered: true`, distinct from the fixed catalog-resolved `catalogIngredient` double.
    let nextFreeformIngredientId = 1;
    // The ingredient CATALOG this mock has handed out (id → `isUserEntered`), so a recipe write can resolve
    // each line's flag from the catalog exactly as the service does — the wire input never carries it. Seeded
    // with the food-backed typeahead double; every freeform `POST /v1/ingredients` registers its own row.
    const ingredientCatalog = new Map<string, boolean>([[catalogIngredient.id, catalogIngredient.isUserEntered]]);
    const resolveUserEntered: ResolveUserEntered = (ingredientId) => ingredientCatalog.get(ingredientId) ?? false;
    // Photos (T067/CP-6/P3): a recipe id → its confirmed photos, in display order. Seeded from each
    // recipe's embedded `photos` so a spec that pre-seeds a cover photo sees it on both the detail's
    // embedded list AND `GET /v1/recipes/{id}/photos`, exactly as the two stay in sync in production.
    const photoStore = new Map<string, RecipePhoto[]>();
    let nextPhotoId = 1;
    // One-shot photo-upload failure countdown (w3/e7): decremented on every presign call while positive.
    let remainingPhotoUploadFailures = options.failPhotoUploads ?? 0;

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

    /**
     * Project a stored recipe to the DETAIL read response: the stored aggregate plus the VIEWER's own rating
     * (`viewerRating`, FR-013). The real service attaches this on the detail read ONLY — a per-(recipe,viewer)
     * lookup that the list/search projections deliberately omit — and the rating INPUT pre-selects its stars
     * (and offers "Remove my rating") from it. Keeping it out of the store is what makes that split hold:
     * `toRecipeListRow` cannot leak a viewer-scoped field it never sees.
     */
    const toRecipeDetailResponse = (detail: RecipeDetail): RecipeDetail => {
        const mine = viewerRatings.get(detail.id);

        return mine === undefined ? detail : { ...detail, viewerRating: mine };
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
            const { name } = body() as { name?: string };
            const freeform: Ingredient = {
                id: `ing_freeform_${nextFreeformIngredientId++}`,
                name: name ?? 'Custom ingredient',
                isUserEntered: true,
                createdAt: ISO,
            };
            // Register it so a recipe line referencing it projects `isUserEntered: true` on the next read —
            // the gate REQ-034's partial-nutrition disclosure turns on.
            ingredientCatalog.set(freeform.id, freeform.isUserEntered);

            return route.fulfill({ status: 201, json: freeform });
        }

        // Photos (T067/CP-6/P3 — presign → direct S3 PUT → confirm, driven by `useRecipePhotoUpload`).
        // Matched BEFORE the bare `/photos` list route so the longer, more specific paths win.

        // Presign: mint a mock S3 URL under MOCK_S3_ORIGIN; the object key encodes the recipe + a counter
        // so a confirm can be traced back to the presign that minted it, exactly as the real key does.
        const uploadUrlPath = path.match(/\/v1\/recipes\/([^/]+)\/photos\/upload-url$/);

        if (uploadUrlPath && method === 'POST') {
            // A short artificial delay so the busy affordance the hook drives (`uploading`) is observable
            // by the spec rather than resolving within the same event-loop turn as the click.
            await new Promise((resolve) => setTimeout(resolve, 200));

            // One-shot failure injection (w3/e7 per-file photo status): the presign step is the single
            // simplest point to fail an upload deterministically — `useRecipePhotoUpload` treats a rejected
            // presign identically to a failed PUT or a failed confirm (its `catch` doesn't distinguish),
            // so failing HERE exercises the exact same `errorMessage` → queue-item-`failed` path a real S3
            // or confirm failure would.
            if (remainingPhotoUploadFailures > 0) {
                remainingPhotoUploadFailures -= 1;

                return route.fulfill({
                    status: 500,
                    json: { code: 'INTERNAL_ERROR', message: 'Simulated upload failure' },
                });
            }

            const id = uploadUrlPath[1] as string;
            const key = `uploads/${id}/mock_${nextPhotoId}.jpg`;
            const response: UploadUrlResponse = {
                uploadUrl: `${MOCK_S3_ORIGIN}/${key}`,
                key,
                expiresIn: 900,
                maxBytes: 5_242_880,
            };

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

        // ─── Version history (W6 Task 6) ───────────────────────────────────────────────────────────
        // Ordered most-specific-first (restore, then a single version, then the list) so a longer path
        // always wins — the same discipline the photo/rating routes above follow.

        // Restore: rewrite the recipe from the target version's snapshot and APPEND a new, higher-numbered
        // version recording the restore (never rewrites history — mirrors `RecipesService.restore`).
        const restoreVersionPath = path.match(/\/v1\/recipes\/([^/]+)\/versions\/([^/]+)\/restore$/);

        if (restoreVersionPath && method === 'POST') {
            const id = restoreVersionPath[1] as string;
            const versionNumber = Number(restoreVersionPath[2]);
            const current = store.get(id);
            const versions = recipeVersions.get(id) ?? [];
            const target = versions.find((version) => version.versionNumber === versionNumber);

            if (!current || !target) {
                return route.fulfill({ status: 404, json: NOT_FOUND_BODY });
            }

            const nextVersionNumber =
                Math.max(current.currentVersion, ...versions.map((version) => version.versionNumber)) + 1;
            const { snapshot } = target;
            const restoredDetail: RecipeDetail = {
                ...current,
                title: snapshot.title,
                description: snapshot.description,
                servings: snapshot.servings,
                prepTimeMinutes: snapshot.prepTimeMinutes,
                cookTimeMinutes: snapshot.cookTimeMinutes,
                totalTimeMinutes: snapshot.prepTimeMinutes + snapshot.cookTimeMinutes,
                currentVersion: nextVersionNumber,
                ingredients: snapshot.ingredients.map((ingredient) => ({
                    ingredientId: ingredient.ingredientId,
                    name: ingredient.ingredientName,
                    quantity: ingredient.quantity,
                    ...(ingredient.unit !== undefined ? { unit: ingredient.unit } : {}),
                    ...(ingredient.displayText !== undefined ? { notes: ingredient.displayText } : {}),
                    isUserEntered: ingredient.isUserEntered,
                })),
                steps: snapshot.steps.map((step) => ({
                    stepNumber: step.stepNumber,
                    instruction: step.instruction,
                    ...(step.timerSeconds !== undefined ? { timerSeconds: step.timerSeconds } : {}),
                })),
            };
            store.set(id, restoredDetail);

            const restoredVersion: RecipeVersion = {
                id: `ver_restore_${nextVersionNumber}`,
                recipeId: id,
                versionNumber: nextVersionNumber,
                snapshot: { ...snapshot, version: nextVersionNumber },
                createdBy: viewerId,
                changeSummary: `Restored from version ${versionNumber}`,
                createdAt: RESTORED_ISO,
            };
            recipeVersions.set(id, [...versions, restoredVersion]);

            const response: RestoreVersionResponse = {
                recipe: restoredDetail,
                restoredFromVersion: versionNumber,
                currentVersion: nextVersionNumber,
            };

            return route.fulfill({ json: response });
        }

        // A single version snapshot — served for completeness; the version-history container reads
        // Preview/Compare data straight off the already-loaded list (`useRecipeVersions`), never this route.
        const singleVersionPath = path.match(/\/v1\/recipes\/([^/]+)\/versions\/([^/]+)$/);

        if (singleVersionPath && method === 'GET') {
            const id = singleVersionPath[1] as string;
            const versionNumber = Number(singleVersionPath[2]);
            const version = (recipeVersions.get(id) ?? []).find((v) => v.versionNumber === versionNumber);

            return version ? route.fulfill({ json: version }) : route.fulfill({ status: 404, json: NOT_FOUND_BODY });
        }

        // The version list — newest-first, mirroring the service's real `ORDER BY version_number DESC`.
        const versionsListPath = path.match(/\/v1\/recipes\/([^/]+)\/versions$/);

        if (versionsListPath && method === 'GET') {
            const id = versionsListPath[1] as string;
            const versions = [...(recipeVersions.get(id) ?? [])].sort((a, b) => b.versionNumber - a.versionNumber);

            return route.fulfill({ json: versions });
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

                // The service returns the same DETAIL read `GET` does (`ratings.service.setRating` →
                // `recipesService.getById`), so the response carries the viewer's own `viewerRating` too — the
                // field the rating control pre-selects its stars and its "Remove my rating" affordance from.
                return route.fulfill({ json: toRecipeDetailResponse(store.get(id) ?? current) });
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
                    ? route.fulfill({ json: toRecipeDetailResponse(current) })
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

                // One-shot ENRICHED conflict (W7 Task 7): another device saved first, reported with the full
                // W8-a.5 `server`/`base` wire shape the rebuilt conflict resolver reads — see
                // `EnrichedConflictSeed`'s own JSDoc. Checked ahead of the bare `pendingConcurrentEdits` below.
                const enrichedSeed = pendingEnrichedConflicts.get(id);

                if (enrichedSeed) {
                    pendingEnrichedConflicts.delete(id);

                    const baseVersion = current.currentVersion;
                    const baseSide: VersionConflictSide = {
                        versionNumber: baseVersion,
                        updatedAt: current.updatedAt,
                        snapshot: detailToConflictSnapshot(current, baseVersion),
                    };
                    const serverVersion = baseVersion + (enrichedSeed.versionsAhead ?? 1);
                    const serverDetail: RecipeDetail = {
                        ...current,
                        ...enrichedSeed.serverChanges,
                        currentVersion: serverVersion,
                    };
                    const serverSide: VersionConflictSide = {
                        versionNumber: serverVersion,
                        updatedAt: new Date().toISOString(),
                        snapshot: detailToConflictSnapshot(serverDetail, serverVersion),
                        ...(enrichedSeed.deviceLabel === undefined ? {} : { deviceLabel: enrichedSeed.deviceLabel }),
                    };
                    // The other device's write already landed — the store reflects it from here on, exactly
                    // as the real service already committed it by the time this 409 is observed.
                    store.set(id, serverDetail);

                    return route.fulfill({
                        status: 409,
                        json: {
                            code: 'VERSION_CONFLICT',
                            message: 'Recipe version conflict',
                            details: {
                                currentVersion: serverVersion,
                                conflictingVersion,
                                server: serverSide,
                                base: baseSide,
                            },
                        },
                    });
                }

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

                const updated = applyUpdate(current, input, resolveUserEntered);
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
                    // The AUTHORED content, not a canned fixture: the service persists what was posted, so the
                    // created recipe's read projection must carry the caller's own ingredient + step sets (each
                    // line's `isUserEntered` resolved through the catalog, as the service resolves it). A mock
                    // that fell back to the fixture's food-backed "Salt" would silently erase a freeform line —
                    // and with it every downstream projection gated on one (REQ-034's disclosure notice).
                    ...(Array.isArray(input['ingredients'])
                        ? {
                              ingredients: toIngredientProjection(
                                  input['ingredients'] as Record<string, unknown>[],
                                  resolveUserEntered,
                              ),
                          }
                        : {}),
                    ...(Array.isArray(input['steps'])
                        ? { steps: toStepProjection(input['steps'] as Record<string, unknown>[]) }
                        : {}),
                    // Carry a stated difficulty (FR-001b); create has no clear sentinel, so absence = not stated.
                    ...(typeof input['difficulty'] === 'string'
                        ? { difficulty: input['difficulty'] as RecipeDifficulty }
                        : {}),
                    // Draft/publish (w3/e7): the wizard's create-flow always sends an explicit `status`
                    // (Save Draft → 'draft', Publish → 'published') — carry it so a spec can assert the
                    // created recipe's persisted status (e.g. the "Draft" card badge appearing in the list).
                    ...(typeof input['status'] === 'string' ? { status: input['status'] as RecipeStatus } : {}),
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

        // Clone (FR-011): a new PRIVATE collection owned by the viewer, seeded from the source's current
        // (viewer-visible) members as `clone_seed`, with source attribution FROZEN at clone time (W5 Task 2)
        // — matched BEFORE the single-collection route so the longer path wins.
        const cloneCollectionPath = path.match(/\/v1\/collections\/([^/]+)\/clone$/);

        if (cloneCollectionPath && method === 'POST') {
            const sourceId = cloneCollectionPath[1] as string;
            const source = collections.get(sourceId);

            // 404 (not 403) for someone else's private collection — a private collection's existence is
            // never revealed (mirrors the service's `cloneCollection` guard).
            if (!source || (source.visibility !== 'public' && source.ownerId !== viewerId)) {
                return route.fulfill({ status: 404, json: NOT_FOUND_BODY });
            }

            const overrides = body();
            const clonedId = `col_clone_${nextCollectionId++}`;
            const seededAddedVia: Record<string, CollectionRecipeAddedVia> = {};

            for (const recipeId of source.recipeIds) {
                seededAddedVia[recipeId] = 'clone_seed';
            }

            const clone: MockCollection = {
                id: clonedId,
                ownerId: viewerId,
                name: typeof overrides['name'] === 'string' ? overrides['name'] : source.name,
                ...(typeof overrides['description'] === 'string'
                    ? { description: overrides['description'] }
                    : source.description !== undefined
                      ? { description: source.description }
                      : {}),
                // A clone always starts PRIVATE regardless of the source's visibility — publishing is the
                // cloner's own, separate decision (FR-010).
                visibility: 'private',
                recipeIds: [...source.recipeIds],
                memberAddedVia: seededAddedVia,
                sourceCollectionId: sourceId,
                ...(authorHandles[source.ownerId] !== undefined
                    ? { sourceOwnerHandle: authorHandles[source.ownerId] }
                    : {}),
                sourceCollectionName: source.name,
                createdAt: ISO,
                updatedAt: ISO,
            };
            collections.set(clonedId, clone);

            return route.fulfill({ status: 201, json: toCollectionResponse(clone) });
        }

        // PREVIEW a pull without mutating (W5 Task 5 / decision 7) — 200 with the `{ added, removed,
        // unchanged }` diff, echoed back on commit as the drift baseline. Matched BEFORE the commit route
        // (`/pull-from-source$`) so the longer, more specific path wins.
        const previewPullPath = path.match(/\/v1\/collections\/([^/]+)\/pull-from-source\/preview$/);

        if (previewPullPath && method === 'POST') {
            const id = previewPullPath[1] as string;
            const collection = collections.get(id);

            if (!collection) {
                return route.fulfill({ status: 404, json: NOT_FOUND_BODY });
            }

            const source = collection.sourceCollectionId ? collections.get(collection.sourceCollectionId) : undefined;

            if (!source) {
                return route.fulfill({
                    status: 400,
                    json: { code: 'COLLECTION_NOT_CLONED', message: 'Collection has no source to pull from' },
                });
            }

            const sourceVisible = source.recipeIds.filter((recipeId) => {
                const recipe = store.get(recipeId);

                return (
                    recipe !== undefined &&
                    recipe.deletedAt === undefined &&
                    (recipe.visibility === 'public' || recipe.ownerId === viewerId)
                );
            });

            return route.fulfill({ json: computePullDiff(sourceVisible, collection.recipeIds) });
        }

        // Pull new recipes from a clone's source (FR-011 / W5 Task 5). A caller-echoed `previewedDiff` that
        // disagrees with the freshly-computed live diff is rejected with `409 PULL_DRIFT` + the fresh diff
        // (decision 7 — never silently apply a different set than the caller confirmed). Otherwise, the
        // `added` set is appended as `'pull'`-provenance members and `lastPulledAt` is stamped — even when
        // `added` is empty, "last pulled" means the user synced, not "something changed" (W5 Task 3).
        const commitPullPath = path.match(/\/v1\/collections\/([^/]+)\/pull-from-source$/);

        if (commitPullPath && method === 'POST') {
            const id = commitPullPath[1] as string;
            const collection = collections.get(id);

            if (!collection) {
                return route.fulfill({ status: 404, json: NOT_FOUND_BODY });
            }

            const source = collection.sourceCollectionId ? collections.get(collection.sourceCollectionId) : undefined;

            if (!source) {
                return route.fulfill({
                    status: 400,
                    json: { code: 'COLLECTION_NOT_CLONED', message: 'Collection has no source to pull from' },
                });
            }

            const sourceVisible = source.recipeIds.filter((recipeId) => {
                const recipe = store.get(recipeId);

                return (
                    recipe !== undefined &&
                    recipe.deletedAt === undefined &&
                    (recipe.visibility === 'public' || recipe.ownerId === viewerId)
                );
            });
            const diff = computePullDiff(sourceVisible, collection.recipeIds);
            const previewedDiff = body()['previewedDiff'] as PullDiff | undefined;

            if (previewedDiff !== undefined && !pullDiffsAgree(previewedDiff, diff)) {
                return route.fulfill({
                    status: 409,
                    json: {
                        code: 'PULL_DRIFT',
                        message: 'The source collection changed since you last checked.',
                        details: { diff },
                    },
                });
            }

            const nextMemberAddedVia: Record<string, CollectionRecipeAddedVia> = { ...collection.memberAddedVia };

            for (const addedId of diff.added) {
                nextMemberAddedVia[addedId] = 'pull';
            }

            const updated: MockCollection = {
                ...collection,
                recipeIds: [...collection.recipeIds, ...diff.added],
                memberAddedVia: nextMemberAddedVia,
                lastPulledAt: PULLED_ISO,
            };
            collections.set(id, updated);

            const result: PullFromSourceResponse = {
                collection: toCollectionResponse(updated),
                addedRecipeIds: [...diff.added],
            };

            return route.fulfill({ json: result });
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

        // Collections: list (the caller's own, REALLY paginated — W5/C7 "Load more") + create.
        if (path.endsWith('/v1/collections')) {
            if (method === 'GET') {
                const owned = [...collections.values()].filter((collection) => collection.ownerId === viewerId);
                const requestedPage = Number(url.searchParams.get('page') ?? '1');
                const page = Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
                const start = (page - 1) * collectionsPageSize;
                const rows = owned.slice(start, start + collectionsPageSize);
                const response: PaginatedResponse<CollectionResponse> = {
                    data: rows.map(toCollectionResponse),
                    total: owned.length,
                    page,
                    pageSize: collectionsPageSize,
                    hasMore: start + rows.length < owned.length,
                };

                return route.fulfill({ json: response });
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
            const maxCookTimeRaw = url.searchParams.get('maxCookTime');
            const maxCookTime = maxCookTimeRaw === null ? undefined : Number(maxCookTimeRaw);
            // FR-006 gap #3 — the ingredient filter. Read server-side off the STORED `RecipeDetail.ingredients`
            // (present on `store`, stripped by `toRecipeMetadata` below) — the real search DAL's
            // `EXISTS … recipe_ingredients` clause matches the same way, on the recipe's actual ingredient rows.
            const ingredientIds = url.searchParams.getAll('ingredientIds');
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
                const cookTimeOk =
                    maxCookTime === undefined || Number.isNaN(maxCookTime) || recipe.cookTimeMinutes <= maxCookTime;
                const ingredientOk =
                    ingredientIds.length === 0 ||
                    recipe.ingredients.some((ingredient) => ingredientIds.includes(ingredient.ingredientId));

                return dietaryOk && tagsOk && timeOk && cookTimeOk && ingredientOk;
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
