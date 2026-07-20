/**
 * T025-test / T033-test — unit tests for {@link RecipesService} over a fake {@link RecipesDal}.
 *
 * Pins the domain rules the DAL delegates upward: response shaping (persistence row → `Recipe` wire
 * contract), owner-only mutation authorization (`NOT_OWNER`), public-read allowance, tombstone →
 * `RECIPE_NOT_FOUND`, pagination `hasMore`, and the T033 optimistic-concurrency check
 * (`VERSION_CONFLICT` with `details.currentVersion`). No database is involved.
 */
import { describe, it, expect, vi } from 'vitest';

import { RecipeErrorCode, RecipeVisibility } from '@kitchensink/recipe-core';

import { PREMIUM_PERMISSION, RecipesService } from '../recipes.service.js';
import type { RecipesDal, RecipeAggregate } from '../dal/recipes.dal.js';
import type { IngredientsDal } from '../../ingredients/dal/ingredients.dal.js';
import type { RatingsDal } from '../../ratings/dal/ratings.dal.js';
import { isRecipeDomainError } from '../recipe.error.js';
import {
    makeRecipeIngredientRow,
    makeRecipePhotoRow,
    makeRecipeRow,
    makeRecipeStepRow,
} from '../../__fixtures__/index.js';
import type { PhotosDal } from '../../photos/dal/photos.dal.js';
import { makeIngredient } from '../../ingredients/__fixtures__/ingredients.fixtures.js';
import { makeFakeVersionsService } from '../__fixtures__/versions.fixture.js';
import { fakePhotosDal, RECIPE_PHOTOS_CDN } from '../__fixtures__/photos-dal.fixture.js';
import { fakeRatingsDal } from '../__fixtures__/ratings-dal.fixture.js';
import type { CreateRecipeDto } from '../dto/create-recipe.dto.js';
import type { UpdateRecipeDto } from '../dto/update-recipe.dto.js';
import type { Principal } from '../../auth/principal.js';

const OWNER = '01J000000000000000000FREE0';
const OTHER = '01J00000000000000000OTHER0';

/** A verified principal keyed on `userId` (the owner key). `permissions: ['premium']` marks premium-tier. */
function principal(overrides: Partial<Principal> = {}): Principal {
    return {
        userId: OWNER,
        sub: 'user_clerk_free',
        scopes: [],
        permissions: [],
        ...overrides,
    };
}

/** A premium principal — carries the `premium` permission the C-004 policy keys on. */
function premiumPrincipal(overrides: Partial<Principal> = {}): Principal {
    return principal({ permissions: [PREMIUM_PERMISSION], ...overrides });
}

function aggregate(overrides: Partial<Parameters<typeof makeRecipeRow>[0]> = {}): RecipeAggregate {
    const recipe = makeRecipeRow({ id: 'r-1', ownerId: OWNER, ...overrides });

    return {
        recipe,
        steps: [makeRecipeStepRow({ recipeId: recipe.id, stepNumber: 1, instruction: 'Mix' })],
        ingredients: [],
    };
}

function fakeDal(overrides: Partial<RecipesDal> = {}): RecipesDal {
    return {
        create: vi.fn(),
        findById: vi.fn(),
        findAll: vi.fn(),
        update: vi.fn(),
        softDelete: vi.fn(),
        ...overrides,
    } as unknown as RecipesDal;
}

/** A catalog DAL whose `findById` resolves every line to a freeform ingredient (composition off-path). */
function fakeIngredientsDal(): IngredientsDal {
    return {
        findById: vi
            .fn()
            .mockResolvedValue(makeIngredient({ id: '00000000-0000-4000-8000-0000000000ff', name: 'Onion' })),
        findByIds: vi.fn().mockResolvedValue([]),
    } as unknown as IngredientsDal;
}

/**
 * Construct the service with a permissive catalog DAL (overridable per test via the DAL arg). `ratingsDal`
 * defaults to an unrated-viewer stub; pass a `fakeRatingsDal(stars)` to exercise the `viewerRating` path.
 */
function newService(dal: RecipesDal, ratingsDal: RatingsDal = fakeRatingsDal()): RecipesService {
    return new RecipesService(
        dal,
        fakeIngredientsDal(),
        makeFakeVersionsService(),
        fakePhotosDal(),
        RECIPE_PHOTOS_CDN,
        ratingsDal,
    );
}

/** Capture the error a rejected promise throws, or fail if it resolves. */
async function catchError(promise: Promise<unknown>): Promise<unknown> {
    try {
        await promise;
    } catch (error) {
        return error;
    }

    throw new Error('Expected the promise to reject, but it resolved.');
}

const CREATE_DTO: CreateRecipeDto = {
    title: 'Soup',
    servings: 2,
    prepTimeMinutes: 5,
    cookTimeMinutes: 10,
    totalTimeMinutes: 15,
    ingredients: [{ ingredientId: '00000000-0000-4000-8000-0000000000ff', name: 'Onion', quantity: 1 }],
    steps: [{ instruction: 'Mix' }],
};

describe('RecipesService.create', () => {
    it('delegates to the DAL with the derived ingredientNamesText and maps the wire response', async () => {
        const created = aggregate();
        const dal = fakeDal({ create: vi.fn().mockResolvedValue(created) });
        const service = newService(dal);

        const response = await service.create(principal(), CREATE_DTO);

        expect(dal.create).toHaveBeenCalledWith(
            expect.objectContaining({
                ownerId: OWNER,
                title: 'Soup',
                ingredientNamesText: 'Onion',
                visibility: 'public',
            }),
        );
        expect(response).toMatchObject({
            id: 'r-1',
            ownerId: OWNER,
            currentVersion: created.recipe.currentVersion,
            ingredients: [],
            steps: [{ stepNumber: 1, instruction: 'Mix' }],
        });
        expect(typeof response.createdAt).toBe('string');
    });

    it('defaults visibility to public when the DTO omits it (free-tier)', async () => {
        const dal = fakeDal({ create: vi.fn().mockResolvedValue(aggregate()) });

        // CREATE_DTO carries no `visibility`.
        await newService(dal).create(principal(), CREATE_DTO);

        expect(dal.create).toHaveBeenCalledWith(expect.objectContaining({ visibility: 'public' }));
    });

    it('records a version snapshot of the created recipe (FR-007b history populates)', async () => {
        const created = aggregate({ currentVersion: 1 });
        const versions = makeFakeVersionsService();
        const dal = fakeDal({ create: vi.fn().mockResolvedValue(created) });
        const service = new RecipesService(
            dal,
            fakeIngredientsDal(),
            versions,
            fakePhotosDal(),
            RECIPE_PHOTOS_CDN,
            fakeRatingsDal(),
        );

        await service.create(principal(), CREATE_DTO);

        expect(versions.createSnapshot).toHaveBeenCalledWith(
            expect.objectContaining({
                recipeId: created.recipe.id,
                versionNumber: created.recipe.currentVersion,
                createdBy: OWNER,
                snapshot: expect.objectContaining({
                    version: created.recipe.currentVersion,
                    title: created.recipe.title,
                }),
            }),
        );
    });

    it('captures the FULL recipe content in the snapshot (faithful for restore)', async () => {
        const recipe = makeRecipeRow({
            id: 'r-9',
            ownerId: OWNER,
            currentVersion: 3,
            title: 'Full Recipe',
            description: 'A complete one',
            servings: 4,
            prepTimeMinutes: 7,
            cookTimeMinutes: 11,
        });
        const created: RecipeAggregate = {
            recipe,
            steps: [makeRecipeStepRow({ recipeId: 'r-9', stepNumber: 1, instruction: 'Chop', timerSeconds: 30 })],
            ingredients: [
                makeRecipeIngredientRow({
                    recipeId: 'r-9',
                    ingredientId: 'ing-1',
                    ingredientName: 'Onion',
                    quantity: '2.5',
                    unit: 'cup',
                    displayText: 'diced',
                    sortOrder: 0,
                    isUserEntered: true,
                    userCalories: '40',
                }),
            ],
        };
        const versions = makeFakeVersionsService();
        const dal = fakeDal({ create: vi.fn().mockResolvedValue(created) });

        await new RecipesService(
            dal,
            fakeIngredientsDal(),
            versions,
            fakePhotosDal(),
            RECIPE_PHOTOS_CDN,
            fakeRatingsDal(),
        ).create(principal(), CREATE_DTO);

        // Exact snapshot: every mapped field is pinned (numeric coercion, the `?? ''`/`?? 1` fallbacks,
        // and the conditional inclusion of displayText/timerSeconds/userCalories with null siblings
        // OMITTED). A mutation to any single mapping breaks this equality.
        const snapshot = (versions.createSnapshot as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0].snapshot;
        expect(snapshot).toEqual({
            version: 3,
            title: 'Full Recipe',
            description: 'A complete one',
            servings: 4,
            prepTimeMinutes: 7,
            cookTimeMinutes: 11,
            steps: [
                { id: created.steps[0]!.id, recipeId: 'r-9', stepNumber: 1, instruction: 'Chop', timerSeconds: 30 },
            ],
            ingredients: [
                {
                    id: created.ingredients[0]!.id,
                    recipeId: 'r-9',
                    ingredientId: 'ing-1',
                    quantity: 2.5,
                    unit: 'cup',
                    displayText: 'diced',
                    sortOrder: 0,
                    ingredientName: 'Onion',
                    isUserEntered: true,
                    userCalories: 40,
                },
            ],
        });
    });

    it('does NOT fail the create when snapshot recording throws (best-effort, logged not fatal)', async () => {
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const versions = makeFakeVersionsService();
        (versions.createSnapshot as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('snapshot boom'));
        const dal = fakeDal({ create: vi.fn().mockResolvedValue(aggregate()) });

        // The recipe committed; a version hiccup must be swallowed (logged), not propagated.
        await expect(
            new RecipesService(
                dal,
                fakeIngredientsDal(),
                versions,
                fakePhotosDal(),
                RECIPE_PHOTOS_CDN,
                fakeRatingsDal(),
            ).create(principal(), CREATE_DTO),
        ).resolves.toMatchObject({ id: 'r-1' });
        expect(consoleError).toHaveBeenCalled();

        consoleError.mockRestore();
    });

    // C-004 / FR-003 (ADV-3): a create is a `user_created` recipe with no substantive edit, so the
    // requested visibility MUST pass evaluateVisibility. Removing that gate (the mutation) lets a
    // free-tier caller persist `private`, which these two tests forbid.
    it('rejects a free-tier caller requesting private with INVALID_VISIBILITY and never touches the DAL', async () => {
        const dal = fakeDal({ create: vi.fn() });

        const error = await catchError(newService(dal).create(principal(), { ...CREATE_DTO, visibility: 'private' }));

        expect(isRecipeDomainError(error) && error.code).toBe(RecipeErrorCode.INVALID_VISIBILITY);
        // The gate runs BEFORE any persistence — no private row is ever written.
        expect(dal.create).not.toHaveBeenCalled();
    });

    it('lets a premium caller create a private recipe', async () => {
        const dal = fakeDal({ create: vi.fn().mockResolvedValue(aggregate({ visibility: 'private' })) });

        const response = await newService(dal).create(premiumPrincipal(), {
            ...CREATE_DTO,
            visibility: 'private',
        });

        expect(dal.create).toHaveBeenCalledWith(expect.objectContaining({ visibility: 'private' }));
        expect(response.visibility).toBe('private');
    });

    it('marks premium off the permissions claim, not scopes (a premium scope must not unlock private)', async () => {
        const dal = fakeDal({ create: vi.fn() });

        // `premium` sits in scopes, not permissions — the policy keys on permissions, so this is free-tier.
        const error = await catchError(
            newService(dal).create(principal({ scopes: [PREMIUM_PERMISSION] }), {
                ...CREATE_DTO,
                visibility: 'private',
            }),
        );

        expect(isRecipeDomainError(error) && error.code).toBe(RecipeErrorCode.INVALID_VISIBILITY);
        expect(dal.create).not.toHaveBeenCalled();
    });
});

describe('RecipesService.getById', () => {
    it('throws RECIPE_NOT_FOUND when the recipe does not exist', async () => {
        const dal = fakeDal({ findById: vi.fn().mockResolvedValue(undefined) });
        const error = await catchError(newService(dal).getById(OWNER, 'r-1'));

        expect(isRecipeDomainError(error) && error.code).toBe(RecipeErrorCode.RECIPE_NOT_FOUND);
    });

    it('throws RECIPE_NOT_FOUND (404, not 403) when a non-owner reads a private recipe (W8-a.4 IDOR)', async () => {
        // A private recipe the caller can't see is indistinguishable from a missing id — a 403 here would
        // confirm the id exists (an existence oracle). getById is the hottest such path.
        const dal = fakeDal({ findById: vi.fn().mockResolvedValue(aggregate({ visibility: 'private' })) });
        const error = await catchError(newService(dal).getById(OTHER, 'r-1'));

        expect(isRecipeDomainError(error) && error.code).toBe(RecipeErrorCode.RECIPE_NOT_FOUND);
    });

    it('allows a non-owner to read a public recipe', async () => {
        const dal = fakeDal({ findById: vi.fn().mockResolvedValue(aggregate({ visibility: 'public' })) });

        const response = await newService(dal).getById(OTHER, 'r-1');

        expect(response.id).toBe('r-1');
    });

    it("includes the VIEWER's own rating as viewerRating, scoped to (recipe, viewer)", async () => {
        const dal = fakeDal({ findById: vi.fn().mockResolvedValue(aggregate({ visibility: 'public' })) });
        // The viewer (OTHER) has rated this recipe 4 stars.
        const ratingsDal = fakeRatingsDal(4);

        const response = await newService(dal, ratingsDal).getById(OTHER, 'r-1');

        expect(response.viewerRating).toBe(4);
        // Viewer-scoping pin: the lookup MUST use the VIEWER's id (OTHER), never the recipe's owner. If the
        // code passed the owner (or any other id), this argument assertion fails — the leak this guards.
        expect(ratingsDal.findStars).toHaveBeenCalledWith('r-1', OTHER);
    });

    it('OMITS viewerRating when the viewer has not rated the recipe (never a fabricated 0)', async () => {
        const dal = fakeDal({ findById: vi.fn().mockResolvedValue(aggregate({ visibility: 'public' })) });
        // Default stub: findStars resolves undefined (viewer has no rating).
        const response = await newService(dal).getById(OTHER, 'r-1');

        expect(response.viewerRating).toBeUndefined();
        expect('viewerRating' in response).toBe(false);
    });
});

describe('RecipesService.getById — cover thumbnail (FOLLOW-UP-CR-001-A)', () => {
    /** A service whose embedded PhotosDal returns the given photo rows (cover comes from the first). */
    function serviceWithPhotos(dal: RecipesDal, photoRows: Parameters<typeof makeRecipePhotoRow>[0][]): RecipesService {
        const photosDal = {
            findByRecipe: vi.fn().mockResolvedValue(photoRows.map((r) => makeRecipePhotoRow(r))),
        } as unknown as PhotosDal;

        return new RecipesService(
            dal,
            fakeIngredientsDal(),
            makeFakeVersionsService(),
            photosDal,
            RECIPE_PHOTOS_CDN,
            fakeRatingsDal(),
        );
    }

    it("serves the cover from the first photo's THUMBNAIL, while the gallery keeps the full-size original", async () => {
        const dal = fakeDal({ findById: vi.fn().mockResolvedValue(aggregate({ visibility: 'public' })) });
        const s3Key = 'recipes/01JOWNER/r-1/photos/p1';
        const thumbnailKey = `${s3Key}.thumb.jpg`;
        const service = serviceWithPhotos(dal, [{ s3Key, thumbnailKey, sortOrder: 0 }]);

        const response = await service.getById(OTHER, 'r-1');

        // The cover is the thumbnail — a mutation that served `s3Key` (the original) fails here.
        expect(response.coverPhotoUrl).toBe(`${RECIPE_PHOTOS_CDN}/${thumbnailKey}`);
        // ...but the embedded gallery photo is still the full-size original.
        expect(response.photos?.[0]?.url).toBe(`${RECIPE_PHOTOS_CDN}/${s3Key}`);
    });

    it('falls back to the original for a cover photo that has no thumbnail (pre-feature / degraded)', async () => {
        const dal = fakeDal({ findById: vi.fn().mockResolvedValue(aggregate({ visibility: 'public' })) });
        const s3Key = 'recipes/01JOWNER/r-1/photos/p1';
        const service = serviceWithPhotos(dal, [{ s3Key, thumbnailKey: null, sortOrder: 0 }]);

        const response = await service.getById(OTHER, 'r-1');

        expect(response.coverPhotoUrl).toBe(`${RECIPE_PHOTOS_CDN}/${s3Key}`);
    });
});

describe('RecipesService.list', () => {
    it('maps rows and computes hasMore from page/pageSize/total', async () => {
        const dal = fakeDal({ findAll: vi.fn().mockResolvedValue({ rows: [aggregate()], total: 5 }) });

        const response = await newService(dal).list(OWNER, { page: 1, pageSize: 2, sortBy: 'updatedAt' });

        expect(response.total).toBe(5);
        expect(response.hasMore).toBe(true); // 1*2 < 5
        expect(response.data).toHaveLength(1);
    });

    it('reports hasMore=false on the last page', async () => {
        const dal = fakeDal({ findAll: vi.fn().mockResolvedValue({ rows: [aggregate()], total: 2 }) });

        const response = await newService(dal).list(OWNER, { page: 1, pageSize: 2, sortBy: 'updatedAt' });

        expect(response.hasMore).toBe(false);
    });
});

describe('RecipesService — difficulty passthrough (FR-001b)', () => {
    /** The recorded arg the service handed the DAL for a create/update call. */
    function dalCallArg(fn: unknown, index: number): Record<string, unknown> {
        return (fn as unknown as ReturnType<typeof vi.fn>).mock.calls[0][index] as Record<string, unknown>;
    }

    it('forwards a stated difficulty to the DAL on create', async () => {
        const dal = fakeDal({ create: vi.fn().mockResolvedValue(aggregate({ difficulty: 'medium' })) });

        await newService(dal).create(principal(), { ...CREATE_DTO, difficulty: 'medium' });

        expect(dal.create).toHaveBeenCalledWith(expect.objectContaining({ difficulty: 'medium' }));
    });

    it('does NOT forward a difficulty key to the DAL create when the author stated none', async () => {
        const dal = fakeDal({ create: vi.fn().mockResolvedValue(aggregate()) });

        // CREATE_DTO carries no difficulty → the DAL create arg must omit the key (row stays NULL).
        await newService(dal).create(principal(), CREATE_DTO);

        expect(dalCallArg(dal.create, 0)).not.toHaveProperty('difficulty');
    });

    it('maps a persisted difficulty into the wire response (round-trips what was written)', async () => {
        const dal = fakeDal({ create: vi.fn().mockResolvedValue(aggregate({ difficulty: 'hard' })) });

        const response = await newService(dal).create(principal(), { ...CREATE_DTO, difficulty: 'hard' });

        expect(response.difficulty).toBe('hard');
    });

    it.each([
        ['a value', { expectedVersion: 1, difficulty: 'hard' } as UpdateRecipeDto, 'hard'],
        ['null (clear)', { expectedVersion: 1, difficulty: null } as UpdateRecipeDto, null],
        ['absent (unchanged)', { expectedVersion: 1, title: 'Renamed' } as UpdateRecipeDto, undefined],
    ])('forwards difficulty=%s straight through to the DAL update', async (_label, patch, expected) => {
        const dal = fakeDal({
            findById: vi.fn().mockResolvedValue(aggregate({ currentVersion: 1 })),
            update: vi.fn().mockResolvedValue(aggregate({ currentVersion: 2 })),
        });

        await newService(dal).update(OWNER, 'r-1', patch);

        // The three states must reach the DAL as three DISTINCT values (value / null / undefined) — the DAL
        // is what turns them into set / clear / leave-unchanged. Asserting the exact value (incl. the
        // undefined vs null difference) proves the service does not collapse "clear" into "leave unchanged".
        expect(dalCallArg(dal.update, 1)['difficulty']).toBe(expected);
    });
});

describe('RecipesService — lead calories denormalization (W8-a.1)', () => {
    /** The recorded arg the service handed the DAL for a create/update call. */
    function dalCallArg(fn: unknown, index: number): Record<string, unknown> {
        return (fn as unknown as ReturnType<typeof vi.fn>).mock.calls[0][index] as Record<string, unknown>;
    }

    /** A create DTO with one user-override line (200 cal), so nutrition is accountable without a catalog. */
    const CREATE_WITH_CALORIES: CreateRecipeDto = {
        ...CREATE_DTO,
        servings: 2,
        ingredients: [
            { ingredientId: '00000000-0000-4000-8000-0000000000ff', name: 'Onion', quantity: 1, userCalories: 200 },
        ],
    };

    it('recomputes lead calories at write time and forwards it to the DAL create (200 cal / 2 servings = 100)', async () => {
        const dal = fakeDal({ create: vi.fn().mockResolvedValue(aggregate({ leadCaloriesPerServing: '100' })) });

        await newService(dal).create(principal(), CREATE_WITH_CALORIES);

        expect(dal.create).toHaveBeenCalledWith(expect.objectContaining({ leadCaloriesPerServing: 100 }));
    });

    it('OMITS the lead-calories key on create when the recipe has no accounted nutrition (column stays NULL)', async () => {
        const dal = fakeDal({ create: vi.fn().mockResolvedValue(aggregate()) });

        // CREATE_DTO's single line has no userCalories and the catalog resolves no per-100g → nothing accounted.
        await newService(dal).create(principal(), CREATE_DTO);

        expect(dalCallArg(dal.create, 0)).not.toHaveProperty('leadCaloriesPerServing');
    });

    it('maps a persisted lead-calories value into the wire response (numeric string → number)', async () => {
        const dal = fakeDal({ create: vi.fn().mockResolvedValue(aggregate({ leadCaloriesPerServing: '150' })) });

        const response = await newService(dal).create(principal(), CREATE_WITH_CALORIES);

        expect(response.leadCaloriesPerServing).toBe(150);
    });

    it('OMITS lead calories from the response (never 0) when the column is NULL', async () => {
        const dal = fakeDal({ create: vi.fn().mockResolvedValue(aggregate({ leadCaloriesPerServing: null })) });

        const response = await newService(dal).create(principal(), CREATE_DTO);

        expect(response.leadCaloriesPerServing).toBeUndefined();
    });

    it('recomputes lead calories on a servings-ONLY update (rescaling the existing lines)', async () => {
        // Existing recipe: one 200-cal user-override line. A servings-only edit (no ingredients in the patch)
        // must recompute the per-serving figure from the EXISTING lines against the new servings: 200/4 = 50.
        const existing: RecipeAggregate = {
            ...aggregate({ currentVersion: 1, servings: 2 }),
            ingredients: [makeRecipeIngredientRow({ userCalories: '200' })],
        };
        const dal = fakeDal({
            findById: vi.fn().mockResolvedValue(existing),
            update: vi.fn().mockResolvedValue(aggregate({ currentVersion: 2 })),
        });

        await newService(dal).update(OWNER, 'r-1', { expectedVersion: 1, servings: 4 });

        expect(dalCallArg(dal.update, 1)['leadCaloriesPerServing']).toBe(50);
    });

    it('does NOT touch the lead-calories column on an update that changes neither lines nor servings', async () => {
        const dal = fakeDal({
            findById: vi.fn().mockResolvedValue(aggregate({ currentVersion: 1 })),
            update: vi.fn().mockResolvedValue(aggregate({ currentVersion: 2 })),
        });

        await newService(dal).update(OWNER, 'r-1', { expectedVersion: 1, title: 'Renamed' });

        expect(dalCallArg(dal.update, 1)).not.toHaveProperty('leadCaloriesPerServing');
    });

    it('CLEARS lead calories (null) when an update removes the last accounted nutrition', async () => {
        // Existing recipe has an accounted line; the patch replaces ingredients with a no-nutrition line →
        // the recompute yields nothing accountable and must write `null` to clear the stale stored value.
        const existing: RecipeAggregate = {
            ...aggregate({ currentVersion: 1 }),
            ingredients: [makeRecipeIngredientRow({ userCalories: '200' })],
        };
        const dal = fakeDal({
            findById: vi.fn().mockResolvedValue(existing),
            update: vi.fn().mockResolvedValue(aggregate({ currentVersion: 2 })),
        });

        await newService(dal).update(OWNER, 'r-1', {
            expectedVersion: 1,
            ingredients: [{ ingredientId: '00000000-0000-4000-8000-0000000000ff', name: 'Onion', quantity: 1 }],
        });

        expect(dalCallArg(dal.update, 1)['leadCaloriesPerServing']).toBeNull();
    });
});

describe('RecipesService — draft status boundary (W8-a.3 security + W8-a.4 IDOR)', () => {
    /** A public DRAFT owned by `owner` — the leak class the status term closes (public, but owner-only). */
    function publicDraft(owner = OWNER): RecipeAggregate {
        return aggregate({ ownerId: owner, visibility: 'public', status: 'draft', currentVersion: 1 });
    }

    it('a non-owner CANNOT read a public draft — 404 (indistinguishable from a missing id)', async () => {
        const dal = fakeDal({ findById: vi.fn().mockResolvedValue(publicDraft(OWNER)) });
        const error = await catchError(newService(dal).getById(OTHER, 'r-1'));

        expect(isRecipeDomainError(error) && error.code).toBe(RecipeErrorCode.RECIPE_NOT_FOUND);
    });

    it('the OWNER sees their own draft, and the projection reports status=draft', async () => {
        const dal = fakeDal({ findById: vi.fn().mockResolvedValue(publicDraft(OWNER)) });

        const response = await newService(dal).getById(OWNER, 'r-1');

        expect(response.status).toBe('draft');
    });

    it('a non-owner CANNOT clone a public draft — 404, never creating', async () => {
        const create = vi.fn();
        const dal = fakeDal({ findById: vi.fn().mockResolvedValue(publicDraft(OWNER)), create });

        const error = await catchError(newService(dal).clone(OTHER, 'r-1'));

        expect(isRecipeDomainError(error) && error.code).toBe(RecipeErrorCode.RECIPE_NOT_FOUND);
        expect(create).not.toHaveBeenCalled();
    });

    it.each([
        ['update', (s: RecipesService) => s.update(OTHER, 'r-1', { expectedVersion: 1, title: 'x' })],
        ['delete', (s: RecipesService) => s.delete(OTHER, 'r-1')],
        [
            'setVisibility',
            (s: RecipesService) => s.setVisibility(principal({ userId: OTHER }), 'r-1', RecipeVisibility.PRIVATE),
        ],
    ])('a non-owner mutation (%s) on a public draft returns 404, not 403 (no existence oracle)', async (_l, act) => {
        const dal = fakeDal({ findById: vi.fn().mockResolvedValue(publicDraft(OWNER)) });

        const error = await catchError(act(newService(dal)));

        expect(isRecipeDomainError(error) && error.code).toBe(RecipeErrorCode.RECIPE_NOT_FOUND);
    });

    it('a viewable-but-not-owned recipe (public, published) still returns 403 on a mutation (not an oracle)', async () => {
        // W8-a.4: seeing ≠ owning. You can see a public published recipe you don't own, so a modify attempt
        // is a legitimate 403 — the id is not secret. Only the UNSEEABLE case is masked as 404.
        const dal = fakeDal({ findById: vi.fn().mockResolvedValue(aggregate({ ownerId: OWNER })) });

        const error = await catchError(newService(dal).delete(OTHER, 'r-1'));

        expect(isRecipeDomainError(error) && error.code).toBe(RecipeErrorCode.NOT_OWNER);
    });

    it('Save-Draft: create forwards status=draft to the DAL', async () => {
        const dal = fakeDal({ create: vi.fn().mockResolvedValue(publicDraft(OWNER)) });

        await newService(dal).create(principal(), { ...CREATE_DTO, status: 'draft' });

        expect(dal.create).toHaveBeenCalledWith(expect.objectContaining({ status: 'draft' }));
    });

    it('Publish: an owner update forwards status=published to the DAL', async () => {
        const dal = fakeDal({
            findById: vi.fn().mockResolvedValue(publicDraft(OWNER)),
            update: vi.fn().mockResolvedValue(aggregate({ currentVersion: 2 })),
        });

        await newService(dal).update(OWNER, 'r-1', { expectedVersion: 1, status: 'published' });

        expect(dal.update).toHaveBeenCalledWith('r-1', expect.objectContaining({ status: 'published' }));
    });
});

describe('RecipesService.update', () => {
    const patch: UpdateRecipeDto = { expectedVersion: 1, title: 'Renamed' };

    it('throws RECIPE_NOT_FOUND when the recipe is absent', async () => {
        const dal = fakeDal({ findById: vi.fn().mockResolvedValue(undefined) });
        const error = await catchError(newService(dal).update(OWNER, 'r-1', patch));

        expect(isRecipeDomainError(error) && error.code).toBe(RecipeErrorCode.RECIPE_NOT_FOUND);
    });

    it('throws NOT_OWNER when the caller does not own the recipe', async () => {
        const dal = fakeDal({ findById: vi.fn().mockResolvedValue(aggregate()) });
        const error = await catchError(newService(dal).update(OTHER, 'r-1', patch));

        expect(isRecipeDomainError(error) && error.code).toBe(RecipeErrorCode.NOT_OWNER);
    });

    it('throws VERSION_CONFLICT with the current version when expectedVersion is stale (T033)', async () => {
        const dal = fakeDal({ findById: vi.fn().mockResolvedValue(aggregate({ currentVersion: 5 })) });
        const error = await catchError(newService(dal).update(OWNER, 'r-1', { expectedVersion: 3, title: 'x' }));

        expect(isRecipeDomainError(error)).toBe(true);

        if (isRecipeDomainError(error)) {
            expect(error.code).toBe(RecipeErrorCode.VERSION_CONFLICT);
            expect(error.details).toEqual({ currentVersion: 5, conflictingVersion: 3 });
        }
    });

    it('updates when the version matches and returns the bumped recipe', async () => {
        const updated = aggregate({ currentVersion: 2 });
        const dal = fakeDal({
            findById: vi.fn().mockResolvedValue(aggregate({ currentVersion: 1 })),
            update: vi.fn().mockResolvedValue(updated),
        });
        const service = newService(dal);

        const response = await service.update(OWNER, 'r-1', patch);

        expect(dal.update).toHaveBeenCalledWith('r-1', expect.objectContaining({ title: 'Renamed' }));
        expect(response.currentVersion).toBe(2);
    });

    it('records a version snapshot after a successful update', async () => {
        const versions = makeFakeVersionsService();
        const dal = fakeDal({
            findById: vi.fn().mockResolvedValue(aggregate({ currentVersion: 1 })),
            update: vi.fn().mockResolvedValue(aggregate({ currentVersion: 2 })),
        });
        const service = new RecipesService(
            dal,
            fakeIngredientsDal(),
            versions,
            fakePhotosDal(),
            RECIPE_PHOTOS_CDN,
            fakeRatingsDal(),
        );

        await service.update(OWNER, 'r-1', patch);

        expect(versions.createSnapshot).toHaveBeenCalledWith(
            expect.objectContaining({ recipeId: 'r-1', versionNumber: 2, createdBy: OWNER }),
        );
    });

    it('does NOT record a snapshot when the caller opts out (restore path avoids a double version)', async () => {
        const versions = makeFakeVersionsService();
        const dal = fakeDal({
            findById: vi.fn().mockResolvedValue(aggregate({ currentVersion: 1 })),
            update: vi.fn().mockResolvedValue(aggregate({ currentVersion: 2 })),
        });
        const service = new RecipesService(
            dal,
            fakeIngredientsDal(),
            versions,
            fakePhotosDal(),
            RECIPE_PHOTOS_CDN,
            fakeRatingsDal(),
        );

        await service.update(OWNER, 'r-1', patch, { recordSnapshot: false });

        expect(versions.createSnapshot).not.toHaveBeenCalled();
    });
});

describe('RecipesService.delete', () => {
    it('throws RECIPE_NOT_FOUND when the recipe is absent', async () => {
        const dal = fakeDal({ findById: vi.fn().mockResolvedValue(undefined) });
        const error = await catchError(newService(dal).delete(OWNER, 'r-1'));

        expect(isRecipeDomainError(error) && error.code).toBe(RecipeErrorCode.RECIPE_NOT_FOUND);
    });

    it('throws NOT_OWNER for a non-owner', async () => {
        const dal = fakeDal({ findById: vi.fn().mockResolvedValue(aggregate()) });
        const error = await catchError(newService(dal).delete(OTHER, 'r-1'));

        expect(isRecipeDomainError(error) && error.code).toBe(RecipeErrorCode.NOT_OWNER);
    });

    it('soft-deletes when the caller owns the recipe', async () => {
        const softDelete = vi.fn().mockResolvedValue(true);
        const dal = fakeDal({ findById: vi.fn().mockResolvedValue(aggregate()), softDelete });

        await newService(dal).delete(OWNER, 'r-1');

        expect(softDelete).toHaveBeenCalledWith('r-1');
    });
});

// ── Tier-2 hardening: pure mapping + change-detection fidelity ────────────────────────────────────
// These pin the conditional field-mapping and the C-004 substantive-edit branches that the happy-path
// tests left mutable (optional-field inclusion/omission, per-field diff detection, snapshot fallbacks).

/** An aggregate whose single ingredient + step carry every optional field populated. */
function richAggregate(recipeOverrides: Partial<Parameters<typeof makeRecipeRow>[0]> = {}): RecipeAggregate {
    const recipe = makeRecipeRow({ id: 'r-1', ownerId: OWNER, ...recipeOverrides });

    return {
        recipe,
        steps: [makeRecipeStepRow({ recipeId: recipe.id, stepNumber: 1, instruction: 'Mix', timerSeconds: 45 })],
        ingredients: [
            makeRecipeIngredientRow({
                recipeId: recipe.id,
                ingredientId: 'ing-A',
                ingredientName: 'Onion',
                quantity: '2',
                unit: 'cup',
                displayText: 'diced',
                sortOrder: 0,
            }),
        ],
    };
}

describe('RecipesService — response mapping fidelity (Tier-2)', () => {
    it('getById INCLUDES optional fields (description, cuisine, unit, notes, timerSeconds) when present', async () => {
        const dal = fakeDal({
            findById: vi.fn().mockResolvedValue(richAggregate({ description: 'D', cuisine: 'Thai', deletedAt: null })),
        });

        const res = await newService(dal).getById(OWNER, 'r-1');

        expect(res.description).toBe('D');
        expect(res.cuisine).toBe('Thai');
        // An active recipe OMITS deletedAt (absent, not null) to match the optional Recipe.deletedAt contract.
        expect(res.deletedAt).toBeUndefined();
        expect(res.steps[0]).toEqual({ stepNumber: 1, instruction: 'Mix', timerSeconds: 45 });
        expect(res.ingredients[0]).toEqual({
            ingredientId: 'ing-A',
            name: 'Onion',
            quantity: 2,
            unit: 'cup',
            notes: 'diced',
            isUserEntered: false,
        });
    });

    it('getById OMITS optional fields when their columns are null/empty', async () => {
        const bare: RecipeAggregate = {
            recipe: makeRecipeRow({ id: 'r-2', ownerId: OWNER, description: null, cuisine: null, deletedAt: null }),
            steps: [makeRecipeStepRow({ recipeId: 'r-2', stepNumber: 1, instruction: 'Mix', timerSeconds: null })],
            ingredients: [
                makeRecipeIngredientRow({
                    recipeId: 'r-2',
                    ingredientId: 'ing-A',
                    ingredientName: 'Salt',
                    quantity: '1',
                    unit: '',
                    displayText: null,
                }),
            ],
        };
        const dal = fakeDal({ findById: vi.fn().mockResolvedValue(bare) });

        const res = await newService(dal).getById(OWNER, 'r-2');

        expect(res).not.toHaveProperty('description');
        expect(res).not.toHaveProperty('cuisine');
        expect(res.steps[0]).not.toHaveProperty('timerSeconds'); // null timer → omitted
        expect(res.ingredients[0]).not.toHaveProperty('unit'); // empty unit → omitted
        expect(res.ingredients[0]).not.toHaveProperty('notes'); // null displayText → omitted
    });

    it('reflects a tombstone deletedAt as an ISO string (not null) when set', async () => {
        const tombstoned = richAggregate({ deletedAt: new Date('2026-05-01T00:00:00.000Z') });
        const dal = fakeDal({ findById: vi.fn().mockResolvedValue(tombstoned) });

        // getById allows the owner to read their own (even tombstoned) recipe.
        const res = await newService(dal).getById(OWNER, 'r-1');

        expect(res.deletedAt).toBe('2026-05-01T00:00:00.000Z');
    });
});

describe('RecipesService — snapshot mapping fidelity (Tier-2)', () => {
    it('captures ALL user-nutrition overrides and coerces numeric strings', async () => {
        const created: RecipeAggregate = {
            recipe: makeRecipeRow({ id: 'r-1', ownerId: OWNER, currentVersion: 1 }),
            steps: [makeRecipeStepRow({ recipeId: 'r-1', stepNumber: 1, instruction: 'Mix', timerSeconds: null })],
            ingredients: [
                makeRecipeIngredientRow({
                    recipeId: 'r-1',
                    ingredientId: 'ing-A',
                    ingredientName: 'Beef',
                    quantity: '3',
                    unit: 'g',
                    displayText: null,
                    userCalories: '250',
                    userProteinG: '26',
                    userCarbsG: '0',
                    userFatG: '15',
                }),
            ],
        };
        const versions = makeFakeVersionsService();
        const dal = fakeDal({ create: vi.fn().mockResolvedValue(created) });

        await new RecipesService(
            dal,
            fakeIngredientsDal(),
            versions,
            fakePhotosDal(),
            RECIPE_PHOTOS_CDN,
            fakeRatingsDal(),
        ).create(principal(), CREATE_DTO);

        const snapshot = (versions.createSnapshot as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0].snapshot;
        // Every user-nutrition field is present and coerced to a number; the null displayText is omitted.
        expect(snapshot.ingredients[0]).toEqual({
            id: created.ingredients[0]!.id,
            recipeId: 'r-1',
            ingredientId: 'ing-A',
            quantity: 3,
            unit: 'g',
            sortOrder: 0,
            ingredientName: 'Beef',
            isUserEntered: false,
            userCalories: 250,
            userProteinG: 26,
            userCarbsG: 0,
            userFatG: 15,
        });
        // A null step timer is omitted from the snapshot.
        expect(snapshot.steps[0]).not.toHaveProperty('timerSeconds');
    });

    it('carries servings + times through to the snapshot faithfully (never fabricated)', async () => {
        // servings + all three times are NON-NULL by schema (contracts #4/#6): the snapshot must copy the
        // persisted values exactly, with no `?? 0` fabrication (which the NOT NULL columns made dead).
        const created: RecipeAggregate = {
            recipe: makeRecipeRow({
                id: 'r-1',
                ownerId: OWNER,
                currentVersion: 1,
                servings: 2,
                prepTimeMinutes: 7,
                cookTimeMinutes: 23,
                totalTimeMinutes: 45,
            }),
            steps: [],
            ingredients: [],
        };
        const versions = makeFakeVersionsService();
        const dal = fakeDal({ create: vi.fn().mockResolvedValue(created) });

        await new RecipesService(
            dal,
            fakeIngredientsDal(),
            versions,
            fakePhotosDal(),
            RECIPE_PHOTOS_CDN,
            fakeRatingsDal(),
        ).create(principal(), CREATE_DTO);

        const snapshot = (versions.createSnapshot as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0].snapshot;
        expect(snapshot.servings).toBe(2);
        expect(snapshot.prepTimeMinutes).toBe(7);
        expect(snapshot.cookTimeMinutes).toBe(23);
    });
});

describe('RecipesService — C-004 substantive-edit detection, per field (Tier-2)', () => {
    /** Run an update against a rich existing aggregate and report whether it was flagged substantive. */
    async function isSubstantive(patch: Partial<UpdateRecipeDto>): Promise<boolean> {
        const existing = richAggregate({ hasSubstantiveEdit: false, currentVersion: 1 });
        const dal = fakeDal({
            findById: vi.fn().mockResolvedValue(existing),
            update: vi.fn().mockResolvedValue(existing),
        });

        await newService(dal).update(OWNER, 'r-1', { expectedVersion: 1, ...patch });

        const updateArgs = (dal.update as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1];

        return updateArgs.hasSubstantiveEdit === true;
    }

    // The existing rich aggregate: 1 step (instruction 'Mix', timer 45) + 1 ingredient
    // (ing-A, qty 2, unit 'cup', notes 'diced').
    const SAME_INGREDIENT = { ingredientId: 'ing-A', name: 'Onion', quantity: 2, unit: 'cup', notes: 'diced' };
    const SAME_STEP = { instruction: 'Mix', timerSeconds: 45 };

    it('metadata-only change (title) is NOT substantive', async () => {
        expect(await isSubstantive({ title: 'Renamed' })).toBe(false);
    });

    it('an identical ingredients+steps patch is NOT substantive', async () => {
        expect(await isSubstantive({ ingredients: [SAME_INGREDIENT], steps: [SAME_STEP] })).toBe(false);
    });

    it('an ingredient QUANTITY-only change is substantive', async () => {
        expect(await isSubstantive({ ingredients: [{ ...SAME_INGREDIENT, quantity: 3 }] })).toBe(true);
    });

    it('an ingredient UNIT-only change is substantive', async () => {
        expect(await isSubstantive({ ingredients: [{ ...SAME_INGREDIENT, unit: 'tbsp' }] })).toBe(true);
    });

    it('an ingredient NOTES-only change is substantive', async () => {
        expect(await isSubstantive({ ingredients: [{ ...SAME_INGREDIENT, notes: 'minced' }] })).toBe(true);
    });

    it('an ingredientId SWAP is substantive', async () => {
        expect(await isSubstantive({ ingredients: [{ ...SAME_INGREDIENT, ingredientId: 'ing-B' }] })).toBe(true);
    });

    it('adding an ingredient (length change) is substantive', async () => {
        expect(
            await isSubstantive({ ingredients: [SAME_INGREDIENT, { ...SAME_INGREDIENT, ingredientId: 'ing-B' }] }),
        ).toBe(true);
    });

    it('a step INSTRUCTION-only change is substantive', async () => {
        expect(await isSubstantive({ steps: [{ instruction: 'Chop', timerSeconds: 45 }] })).toBe(true);
    });

    it('a step TIMER-only change is substantive', async () => {
        expect(await isSubstantive({ steps: [{ instruction: 'Mix', timerSeconds: 99 }] })).toBe(true);
    });

    it('adding a step (length change) is substantive', async () => {
        expect(await isSubstantive({ steps: [SAME_STEP, { instruction: 'Rest' }] })).toBe(true);
    });
});

describe('RecipesService.setVisibility — C-004 policy gate (Tier-2)', () => {
    it('throws RECIPE_NOT_FOUND when the recipe is absent', async () => {
        const dal = fakeDal({ findById: vi.fn().mockResolvedValue(undefined) });
        const error = await catchError(newService(dal).setVisibility(principal(), 'r-1', RecipeVisibility.PRIVATE));

        expect(isRecipeDomainError(error) && error.code).toBe(RecipeErrorCode.RECIPE_NOT_FOUND);
    });

    it('throws NOT_OWNER when the caller does not own the recipe', async () => {
        const dal = fakeDal({ findById: vi.fn().mockResolvedValue(aggregate()) });
        const error = await catchError(
            newService(dal).setVisibility(principal({ userId: OTHER }), 'r-1', RecipeVisibility.PRIVATE),
        );

        expect(isRecipeDomainError(error) && error.code).toBe(RecipeErrorCode.NOT_OWNER);
    });

    it('DENIES free-tier user_created → private (INVALID_VISIBILITY) and never touches the DAL', async () => {
        const setVisibility = vi.fn();
        const dal = fakeDal({
            findById: vi.fn().mockResolvedValue(aggregate({ sourceType: 'user_created' })),
            setVisibility,
        });

        const error = await catchError(newService(dal).setVisibility(principal(), 'r-1', RecipeVisibility.PRIVATE));

        expect(isRecipeDomainError(error) && error.code).toBe(RecipeErrorCode.INVALID_VISIBILITY);
        expect(setVisibility).not.toHaveBeenCalled();
    });

    it('ALLOWS premium user_created → private and persists it', async () => {
        const updated = aggregate({ sourceType: 'user_created', visibility: 'private' });
        const setVisibility = vi.fn().mockResolvedValue(updated);
        const dal = fakeDal({
            findById: vi.fn().mockResolvedValue(aggregate({ sourceType: 'user_created' })),
            setVisibility,
        });

        const res = await newService(dal).setVisibility(premiumPrincipal(), 'r-1', RecipeVisibility.PRIVATE);

        expect(setVisibility).toHaveBeenCalledWith('r-1', 'private');
        expect(res.visibility).toBe('private');
    });

    it('derives premium from permissions, not scopes (a premium SCOPE must not unlock private)', async () => {
        const setVisibility = vi.fn();
        const dal = fakeDal({
            findById: vi.fn().mockResolvedValue(aggregate({ sourceType: 'user_created' })),
            setVisibility,
        });

        // `premium` in scopes, not permissions → still free-tier → denied.
        const error = await catchError(
            newService(dal).setVisibility(principal({ scopes: [PREMIUM_PERMISSION] }), 'r-1', RecipeVisibility.PRIVATE),
        );

        expect(isRecipeDomainError(error) && error.code).toBe(RecipeErrorCode.INVALID_VISIBILITY);
        expect(setVisibility).not.toHaveBeenCalled();
    });

    it('re-throws RECIPE_NOT_FOUND when the row vanished before the write (concurrent tombstone)', async () => {
        const setVisibility = vi.fn().mockResolvedValue(undefined);
        const dal = fakeDal({
            findById: vi.fn().mockResolvedValue(aggregate({ sourceType: 'user_created' })),
            setVisibility,
        });

        const error = await catchError(
            newService(dal).setVisibility(premiumPrincipal(), 'r-1', RecipeVisibility.PUBLIC),
        );

        expect(isRecipeDomainError(error) && error.code).toBe(RecipeErrorCode.RECIPE_NOT_FOUND);
    });
});

describe('RecipesService.clone — content fidelity + provenance (Tier-2)', () => {
    it('copies content (ingredient displayText, step timer) + retains provenance, and never mutates the source', async () => {
        const source: RecipeAggregate = {
            recipe: makeRecipeRow({
                id: 'src',
                ownerId: OTHER,
                visibility: 'public',
                sourceType: 'imported_public',
                sourceUrl: 'https://example.com/r',
                sourceAttribution: 'Chef Ada',
                title: 'Original',
            }),
            steps: [makeRecipeStepRow({ recipeId: 'src', stepNumber: 1, instruction: 'Bake', timerSeconds: 600 })],
            ingredients: [
                makeRecipeIngredientRow({
                    recipeId: 'src',
                    ingredientId: 'ing-A',
                    ingredientName: 'Flour',
                    quantity: '2',
                    unit: 'cup',
                    displayText: 'sifted',
                    sortOrder: 0,
                }),
            ],
        };
        const create = vi.fn().mockResolvedValue({ ...source, recipe: makeRecipeRow({ id: 'clone', ownerId: OWNER }) });
        const update = vi.fn();
        const setVisibility = vi.fn();
        const softDelete = vi.fn();
        const dal = fakeDal({ findById: vi.fn().mockResolvedValue(source), create, update, setVisibility, softDelete });

        await newService(dal).clone(OWNER, 'src');

        expect(create).toHaveBeenCalledWith(
            expect.objectContaining({
                ownerId: OWNER,
                title: 'Original',
                sourceType: 'imported_public',
                sourceUrl: 'https://example.com/r',
                sourceAttribution: 'Chef Ada', // retained verbatim for an imported source
                clonedFromId: 'src',
                hasSubstantiveEdit: false,
                visibility: 'public', // defaultCloneVisibility(imported_public)
                ingredients: [
                    expect.objectContaining({
                        ingredientId: 'ing-A',
                        ingredientName: 'Flour',
                        quantity: 2,
                        unit: 'cup',
                        displayText: 'sifted',
                        sortOrder: 0,
                    }),
                ],
                steps: [{ instruction: 'Bake', timerSeconds: 600 }],
            }),
        );
        // The ORIGINAL is never touched.
        expect(update).not.toHaveBeenCalled();
        expect(setVisibility).not.toHaveBeenCalled();
        expect(softDelete).not.toHaveBeenCalled();
    });

    it('clones an imported_paid source (owner clones own) to the PRIVATE default', async () => {
        const source: RecipeAggregate = {
            recipe: makeRecipeRow({
                id: 'src',
                ownerId: OWNER,
                visibility: 'private',
                sourceType: 'imported_paid',
                sourceAttribution: 'Book',
            }),
            steps: [],
            ingredients: [],
        };
        const create = vi.fn().mockResolvedValue({
            ...source,
            recipe: makeRecipeRow({ id: 'c', ownerId: OWNER, visibility: 'private' }),
        });
        const dal = fakeDal({ findById: vi.fn().mockResolvedValue(source), create });

        await newService(dal).clone(OWNER, 'src');

        expect(create).toHaveBeenCalledWith(
            expect.objectContaining({ visibility: 'private', sourceType: 'imported_paid' }),
        );
    });

    it('records attribution to the original author when a user_created source carries none', async () => {
        const source: RecipeAggregate = {
            recipe: makeRecipeRow({
                id: 'src',
                ownerId: OTHER,
                visibility: 'public',
                sourceType: 'user_created',
                sourceAttribution: null,
            }),
            steps: [],
            ingredients: [],
        };
        const create = vi.fn().mockResolvedValue({ ...source, recipe: makeRecipeRow({ id: 'c', ownerId: OWNER }) });
        const dal = fakeDal({ findById: vi.fn().mockResolvedValue(source), create });

        await newService(dal).clone(OWNER, 'src');

        expect(create).toHaveBeenCalledWith(
            expect.objectContaining({ sourceAttribution: expect.stringContaining(OTHER) }),
        );
    });

    it('rejects a non-owner cloning a PRIVATE recipe with 404 (W8-a.4 IDOR), never creating', async () => {
        // An unreadable source is 404 — indistinguishable from a missing id, not a 403 that confirms it exists.
        const source: RecipeAggregate = {
            recipe: makeRecipeRow({ id: 'src', ownerId: OTHER, visibility: 'private', sourceType: 'user_created' }),
            steps: [],
            ingredients: [],
        };
        const create = vi.fn();
        const dal = fakeDal({ findById: vi.fn().mockResolvedValue(source), create });

        const error = await catchError(newService(dal).clone(OWNER, 'src'));

        expect(isRecipeDomainError(error) && error.code).toBe(RecipeErrorCode.RECIPE_NOT_FOUND);
        expect(create).not.toHaveBeenCalled();
    });

    it('throws RECIPE_NOT_FOUND when the clone source does not exist', async () => {
        const dal = fakeDal({ findById: vi.fn().mockResolvedValue(undefined) });
        const error = await catchError(newService(dal).clone(OWNER, 'missing'));

        expect(isRecipeDomainError(error) && error.code).toBe(RecipeErrorCode.RECIPE_NOT_FOUND);
    });
});
