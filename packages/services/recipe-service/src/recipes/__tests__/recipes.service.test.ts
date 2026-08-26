/**
 * T025-test / T033-test — unit tests for {@link RecipesService} over a fake {@link RecipesDal}.
 *
 * Pins the domain rules the DAL delegates upward: response shaping (persistence row → `Recipe` wire
 * contract), owner-only mutation authorization (`NOT_OWNER`), public-read allowance, tombstone →
 * `RECIPE_NOT_FOUND`, pagination `hasMore`, and the T033 optimistic-concurrency check
 * (`VERSION_CONFLICT` with `details.currentVersion`). No database is involved.
 */
import { BadRequestException } from '@nestjs/common';
import { describe, it, expect, vi } from 'vitest';

import { RecipeErrorCode, RecipeVisibility, recipeIngredientViewSchema } from '@kitchensink/recipe-core';

import { PREMIUM_PERMISSION, RecipesService } from '../recipes.service.js';
import type { RecipesDal, RecipeAggregate } from '../dal/recipes.dal.js';
import type { RecipeIngredientRow } from '../../database/schema/index.js';
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
import { fakePhotosDal, RECIPE_PHOTOS_CDN } from '../__fixtures__/photosDal.fixture.js';
import { fakeRatingsDal } from '../__fixtures__/ratingsDal.fixture.js';
import type { CreateRecipeDto } from '../dto/createRecipe.dto.js';
import type { RecipeIngredientInputDto } from '../dto/createRecipe.dto.js';
import type { UpdateRecipeDto } from '../dto/updateRecipe.dto.js';
import type { Principal } from '../../auth/principal.js';
import { fakeVerificationQueue } from '../__fixtures__/verificationQueue.fixture.js';
import { fakeLineVerificationsDal } from '../__fixtures__/lineVerificationsDal.fixture.js';

/**
 * A `FoodNutritionGateway` double for suites that are NOT about nutrition (U10).
 *
 * It answers `absent` — the honest degrade shape — rather than fabricating numbers, so a suite that starts
 * depending on nutrition fails loudly here instead of quietly asserting invented values.
 */
const nutritionGatewayDouble = {
    lookup: async () => ({ byFoodId: new Map(), degraded: true }),
} as never;

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
        readConflict: vi.fn(),
        ...overrides,
    } as unknown as RecipesDal;
}

/** A catalog DAL whose `findByIds` resolves every requested id to a freeform ingredient (composition off-path). */
function fakeIngredientsDal(overrides: Partial<IngredientsDal> = {}): IngredientsDal {
    return {
        findById: vi
            .fn()
            .mockResolvedValue(makeIngredient({ id: '00000000-0000-4000-8000-0000000000ff', name: 'Onion' })),
        findByIds: vi
            .fn()
            .mockImplementation((ids: readonly string[]) =>
                Promise.resolve(ids.map((id) => makeIngredient({ id, name: 'Onion' }))),
            ),
        ...overrides,
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
        nutritionGatewayDouble,
        fakeVerificationQueue(),
        fakeLineVerificationsDal(),
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
    ingredients: [
        { ingredientId: '00000000-0000-4000-8000-0000000000ff', name: 'Onion', quantity: { kind: 'exact', value: 1 } },
    ],
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
            nutritionGatewayDouble,
            fakeVerificationQueue(),
            fakeLineVerificationsDal(),
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

    it('denormalizes the author handle from the token claims onto the recipe + version (W8-a.2)', async () => {
        const versions = makeFakeVersionsService();
        const dal = fakeDal({ create: vi.fn().mockResolvedValue(aggregate({ currentVersion: 1 })) });
        const service = new RecipesService(
            dal,
            fakeIngredientsDal(),
            versions,
            fakePhotosDal(),
            RECIPE_PHOTOS_CDN,
            fakeRatingsDal(),
            nutritionGatewayDouble,
            fakeVerificationQueue(),
            fakeLineVerificationsDal(),
        );

        // A principal carrying first/last-name claims → deriveDisplayName → "Ada Lovelace".
        await service.create(principal({ firstName: 'Ada', lastName: 'Lovelace' }), CREATE_DTO);

        expect(dal.create).toHaveBeenCalledWith(expect.objectContaining({ authorHandle: 'Ada Lovelace' }));
        expect(versions.createSnapshot).toHaveBeenCalledWith(expect.objectContaining({ editorHandle: 'Ada Lovelace' }));
    });

    it('omits the author handle when the claims yield no derivable name (→ column NULL) (W8-a.2)', async () => {
        const dal = fakeDal({ create: vi.fn().mockResolvedValue(aggregate()) });

        // The default principal carries no first/last name.
        await newService(dal).create(principal(), CREATE_DTO);

        const createArg = (dal.create as unknown as ReturnType<typeof vi.fn>).mock.calls[0]![0];
        expect(createArg).not.toHaveProperty('authorHandle');
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
            nutritionGatewayDouble,
            fakeVerificationQueue(),
            fakeLineVerificationsDal(),
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
                    quantity: { kind: 'exact', value: 2.5 },
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
                nutritionGatewayDouble,
                fakeVerificationQueue(),
                fakeLineVerificationsDal(),
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
            nutritionGatewayDouble,
            fakeVerificationQueue(),
            fakeLineVerificationsDal(),
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

    it('reports hasMore=false on a SHORT final page (fewer rows than pageSize, nothing left)', async () => {
        // S-R8 correctness fix: `total: 2` here was internally inconsistent with `rows: [aggregate()]`
        // (1 row) under the OLD `page * pageSize < total` formula, which ignored the actual row count —
        // it happened to pass regardless of whether the DAL truly returned every remaining row. The
        // shared `toPageEnvelope` formula trusts the ACTUAL row count, so the fixture must be realistic:
        // pageSize=2 but only 1 row exists in total, so the DAL genuinely returns a short (1-row) page.
        const dal = fakeDal({ findAll: vi.fn().mockResolvedValue({ rows: [aggregate()], total: 1 }) });

        const response = await newService(dal).list(OWNER, { page: 1, pageSize: 2, sortBy: 'updatedAt' });

        expect(response.hasMore).toBe(false);
    });
});

describe('RecipesService — difficulty passthrough (FR-001b)', () => {
    /** Read the object a DAL spy was called with, for a given call index. */
    function dalCallArg(fn: unknown, index: number): Record<string, unknown> {
        return (fn as { mock: { calls: unknown[][] } }).mock.calls[0]![index] as Record<string, unknown>;
    }

    /** The recorded arg the service handed the DAL for a create/update call. */

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

        await newService(dal).update(principal(), 'r-1', patch);

        // The three states must reach the DAL as three DISTINCT values (value / null / undefined) — the DAL
        // is what turns them into set / clear / leave-unchanged. Asserting the exact value (incl. the
        // undefined vs null difference) proves the service does not collapse "clear" into "leave unchanged".
        expect(dalCallArg(dal.update, 1)['difficulty']).toBe(expected);
    });
});

/*
 * ⛔ The "lead calories denormalization (W8-a.1)" suite was REMOVED by plan U10. It asserted that create and
 * update recomputed a DENORMALIZED column and forwarded it to the DAL — behaviour that no longer exists,
 * because the column is dropped and the figure is derived on every detail read from food's live data.
 * Keeping the tests would have pinned the design the unit deleted. The derivation is covered by
 * `recipeRowToDomain.test.ts` and by the characterization suite in `@kitchensink/recipe-core`.
 *
 * What REPLACES it is the suite below — the other half of the same removal, which U10 left standing and
 * ADR-0021 recorded as a "Follow-up owed".
 */

describe('RecipesService — ONE calorie representation on the detail read (ADR-0021 follow-up)', () => {
    /**
     * A recipe whose single line carries a USER OVERRIDE, so the per-serving figure is non-zero without any
     * food lookup at all — the degraded gateway double stays honest and the arithmetic is fully determined:
     * 250 kcal over the fixture's servings.
     */
    function overriddenAggregate(): RecipeAggregate {
        const recipe = makeRecipeRow({ id: 'r-1', ownerId: OWNER, servings: 2 });

        return {
            recipe,
            steps: [makeRecipeStepRow({ recipeId: recipe.id, stepNumber: 1, instruction: 'Mix' })],
            ingredients: [
                makeRecipeIngredientRow({
                    recipeId: recipe.id,
                    ingredientId: 'ing-A',
                    ingredientName: 'Beef',
                    quantity: '1',
                    unit: 'g',
                    displayText: null,
                    userCalories: '250',
                    userProteinG: '26',
                    userCarbsG: '0',
                    userFatG: '15',
                }),
            ],
        };
    }

    it('⛔ reports calories ONCE — `nutrition.calories`, with no second `leadCaloriesPerServing` key', async () => {
        // The drift class this closes: the detail read used to emit the SAME number twice, once inside
        // `nutrition` and once as a top-level `leadCaloriesPerServing`. Two representations of one fact have
        // no rule for which wins and no way to stay in step; DRY governs knowledge, and this is one piece of
        // knowledge. A card's figure comes from `POST /api/v1/recipes/nutrition-batch` — never from here.
        const dal = fakeDal({ findById: vi.fn().mockResolvedValue(overriddenAggregate()) });

        const detail = await newService(dal).getById(OWNER, 'r-1');

        expect(detail.nutrition?.calories).toBe(125);
        expect(detail).not.toHaveProperty('leadCaloriesPerServing');
    });

    it('emits no calorie key at all when nothing is accounted for (KTD-3b: absent, never a fabricated 0)', async () => {
        const dal = fakeDal({ findById: vi.fn().mockResolvedValue(aggregate()) });

        const detail = await newService(dal).getById(OWNER, 'r-1');

        expect(detail).not.toHaveProperty('leadCaloriesPerServing');
        // `nutrition.calories` is `0` here because the aggregate has no lines at all; the ACCOUNTED-NESS
        // signal a reader acts on is `isComplete`, and for a card the `unaccounted` member of the deferred
        // union. Neither is a second copy of the figure.
        expect(detail.nutrition?.isComplete).toBe(true);
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

        const error = await catchError(newService(dal).clone(principal({ userId: OTHER }), 'r-1'));

        expect(isRecipeDomainError(error) && error.code).toBe(RecipeErrorCode.RECIPE_NOT_FOUND);
        expect(create).not.toHaveBeenCalled();
    });

    it.each([
        [
            'update',
            (s: RecipesService) => s.update(principal({ userId: OTHER }), 'r-1', { expectedVersion: 1, title: 'x' }),
        ],
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
        // A draft that HAS content. The publish floor below is what makes that distinction load-bearing.
        const draft = publicDraft(OWNER);
        const dal = fakeDal({
            findById: vi.fn().mockResolvedValue({
                ...draft,
                ingredients: [makeRecipeIngredientRow({ recipeId: 'r-1' })],
            }),
            update: vi.fn().mockResolvedValue(aggregate({ currentVersion: 2 })),
        });

        await newService(dal).update(principal(), 'r-1', { expectedVersion: 1, status: 'published' });

        expect(dal.update).toHaveBeenCalledWith('r-1', expect.objectContaining({ status: 'published' }));
    });

    /**
     * The half of the publish floor the wire cannot enforce. `updateRecipeRequestSchema` rejects a body that
     * publishes while SENDING an empty array, but a body that publishes without resending the arrays is
     * indistinguishable from a legitimate one until you look at what is stored — so only the service can
     * refuse it. Reachable only since drafts were allowed to be empty; before that, no empty recipe existed.
     */
    it('Publish is REFUSED when the stored draft is empty and the patch does not supply content', async () => {
        const dal = fakeDal({
            findById: vi.fn().mockResolvedValue({ ...publicDraft(OWNER), ingredients: [], steps: [] }),
            update: vi.fn().mockResolvedValue(aggregate({ currentVersion: 2 })),
        });

        const error = await catchError(
            newService(dal).update(principal(), 'r-1', { expectedVersion: 1, status: 'published' }),
        );

        expect(error).toBeInstanceOf(BadRequestException);
        // Nothing was written: the refusal precedes the DAL, so a rejected publish cannot bump the version.
        expect(dal.update).not.toHaveBeenCalled();
    });

    it('Publish SUCCEEDS when the patch itself supplies the missing content', async () => {
        const dal = fakeDal({
            findById: vi.fn().mockResolvedValue({ ...publicDraft(OWNER), ingredients: [], steps: [] }),
            update: vi.fn().mockResolvedValue(aggregate({ currentVersion: 2 })),
        });

        await newService(dal).update(principal(), 'r-1', {
            expectedVersion: 1,
            status: 'published',
            ingredients: [
                {
                    ingredientId: '00000000-0000-4000-8000-0000000000ff',
                    name: 'Salt',
                    quantity: { kind: 'exact', value: 1 },
                },
            ],
            steps: [{ instruction: 'Mix' }],
        });

        expect(dal.update).toHaveBeenCalledWith('r-1', expect.objectContaining({ status: 'published' }));
    });
});

describe('RecipesService.update', () => {
    const patch: UpdateRecipeDto = { expectedVersion: 1, title: 'Renamed' };

    it('throws RECIPE_NOT_FOUND when the recipe is absent', async () => {
        const dal = fakeDal({ findById: vi.fn().mockResolvedValue(undefined) });
        const error = await catchError(newService(dal).update(principal(), 'r-1', patch));

        expect(isRecipeDomainError(error) && error.code).toBe(RecipeErrorCode.RECIPE_NOT_FOUND);
    });

    it('throws NOT_OWNER when the caller does not own the recipe', async () => {
        const dal = fakeDal({ findById: vi.fn().mockResolvedValue(aggregate()) });
        const error = await catchError(newService(dal).update(principal({ userId: OTHER }), 'r-1', patch));

        expect(isRecipeDomainError(error) && error.code).toBe(RecipeErrorCode.NOT_OWNER);
    });

    it('throws an ENRICHED VERSION_CONFLICT (server + base snapshots) when expectedVersion is stale (T033/W8-a.5)', async () => {
        const current = aggregate({ currentVersion: 5, title: 'Server title' });
        const dal = fakeDal({
            findById: vi.fn().mockResolvedValue(current),
            // The coherent conflict read: current server aggregate + the base version (v3) the client edited from.
            readConflict: vi.fn().mockResolvedValue({
                current,
                baseVersion: {
                    versionNumber: 3,
                    createdAt: new Date('2026-07-19T00:00:00.000Z'),
                    snapshot: {
                        version: 3,
                        title: 'Base title',
                        description: '',
                        steps: [],
                        ingredients: [],
                        servings: 2,
                        prepTimeMinutes: 1,
                        cookTimeMinutes: 1,
                    },
                },
            }),
        });

        const error = await catchError(newService(dal).update(principal(), 'r-1', { expectedVersion: 3, title: 'x' }));

        expect(isRecipeDomainError(error)).toBe(true);

        if (isRecipeDomainError(error)) {
            expect(error.code).toBe(RecipeErrorCode.VERSION_CONFLICT);
            const details = error.details as {
                currentVersion: number;
                conflictingVersion: number;
                server: { versionNumber: number; snapshot: { title: string } };
                base?: { versionNumber: number; snapshot: { title: string } };
            };
            expect(details.currentVersion).toBe(5);
            expect(details.conflictingVersion).toBe(3);
            // W8-a.5: the server side carries the current winning snapshot; the base side the version edited from.
            expect(details.server.versionNumber).toBe(5);
            expect(details.server.snapshot.title).toBe('Server title');
            expect(details.base?.versionNumber).toBe(3);
            expect(details.base?.snapshot.title).toBe('Base title');
            // The pre-check reads the conflict material coherently, keyed on the client's expectedVersion.
            expect(dal.readConflict).toHaveBeenCalledWith('r-1', 3);
        }
    });

    it('omits the base side when the edited-from version is evicted past the DB window (W8-a.5)', async () => {
        const current = aggregate({ currentVersion: 5 });
        const dal = fakeDal({
            findById: vi.fn().mockResolvedValue(current),
            readConflict: vi.fn().mockResolvedValue({ current }), // no baseVersion row retained
        });

        const error = await catchError(newService(dal).update(principal(), 'r-1', { expectedVersion: 3, title: 'x' }));

        if (isRecipeDomainError(error)) {
            const details = error.details as {
                server: { versionNumber: number; snapshot: { title: string } };
                base?: unknown;
            };
            // `server` is still assembled from the coherent `current` read even with no retained
            // `baseVersion` row — it must reflect the CURRENT winning version (5), not be merely present.
            expect(details.server.versionNumber).toBe(5);
            expect(details.server.snapshot.title).toBe(current.recipe.title);
            expect(details.base).toBeUndefined();
        }
    });

    it('a CAS-miss race (pre-check passes, update matches 0 rows) also raises the enriched conflict (W8-a.5)', async () => {
        const current = aggregate({ currentVersion: 4 });
        const dal = fakeDal({
            // Pre-check passes: findById still shows v3 (the client's expectedVersion) at read time...
            findById: vi.fn().mockResolvedValue(aggregate({ currentVersion: 3 })),
            update: vi.fn().mockResolvedValue(undefined), // ...but the CAS lost the race → 0 rows
            readConflict: vi.fn().mockResolvedValue({ current }),
        });

        const error = await catchError(newService(dal).update(principal(), 'r-1', { expectedVersion: 3, title: 'x' }));

        expect(isRecipeDomainError(error) && error.code).toBe(RecipeErrorCode.VERSION_CONFLICT);
        expect((isRecipeDomainError(error) && (error.details as { currentVersion: number }).currentVersion) || 0).toBe(
            4,
        );
    });

    it('a CAS-miss where the row is genuinely GONE raises 404, not a conflict (W8-a.5)', async () => {
        const dal = fakeDal({
            findById: vi.fn().mockResolvedValue(aggregate({ currentVersion: 3 })),
            update: vi.fn().mockResolvedValue(undefined),
            readConflict: vi.fn().mockResolvedValue(undefined), // recipe vanished (tombstoned) since the pre-check
        });

        const error = await catchError(newService(dal).update(principal(), 'r-1', { expectedVersion: 3, title: 'x' }));

        expect(isRecipeDomainError(error) && error.code).toBe(RecipeErrorCode.RECIPE_NOT_FOUND);
    });

    it('updates when the version matches and returns the bumped recipe', async () => {
        const updated = aggregate({ currentVersion: 2 });
        const dal = fakeDal({
            findById: vi.fn().mockResolvedValue(aggregate({ currentVersion: 1 })),
            update: vi.fn().mockResolvedValue(updated),
        });
        const service = newService(dal);

        const response = await service.update(principal(), 'r-1', patch);

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
            nutritionGatewayDouble,
            fakeVerificationQueue(),
            fakeLineVerificationsDal(),
        );

        await service.update(principal(), 'r-1', patch);

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
            nutritionGatewayDouble,
            fakeVerificationQueue(),
            fakeLineVerificationsDal(),
        );

        await service.update(principal(), 'r-1', patch, { recordSnapshot: false });

        expect(versions.createSnapshot).not.toHaveBeenCalled();
    });

    it('records the editor handle (deriveDisplayName) on the update snapshot (W6 by-@handle attribution)', async () => {
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
            nutritionGatewayDouble,
            fakeVerificationQueue(),
            fakeLineVerificationsDal(),
        );

        // An editor whose token claims derive to "Clara Oswald" — the same ONE rule create uses.
        await service.update(principal({ firstName: 'Clara', lastName: 'Oswald' }), 'r-1', patch);

        expect(versions.createSnapshot).toHaveBeenCalledWith(expect.objectContaining({ editorHandle: 'Clara Oswald' }));
    });

    it('omits the editor handle on update when the principal has no derivable name (graceful, matches create)', async () => {
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
            nutritionGatewayDouble,
            fakeVerificationQueue(),
            fakeLineVerificationsDal(),
        );

        // The default principal carries no first/last name → deriveDisplayName returns '' → the key is omitted
        // (NULL editor_handle), never persisted as an empty string.
        await service.update(principal(), 'r-1', patch);

        const input = vi.mocked(versions.createSnapshot).mock.calls[0]?.[0];
        expect(input).not.toHaveProperty('editorHandle');
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
            quantity: { kind: 'exact', value: 2 },
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
            nutritionGatewayDouble,
            fakeVerificationQueue(),
            fakeLineVerificationsDal(),
        ).create(principal(), CREATE_DTO);

        const snapshot = (versions.createSnapshot as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0].snapshot;
        // Every user-nutrition field is present and coerced to a number; the null displayText is omitted.
        expect(snapshot.ingredients[0]).toEqual({
            id: created.ingredients[0]!.id,
            recipeId: 'r-1',
            ingredientId: 'ing-A',
            quantity: { kind: 'exact', value: 3 },
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
            nutritionGatewayDouble,
            fakeVerificationQueue(),
            fakeLineVerificationsDal(),
        ).create(principal(), CREATE_DTO);

        const snapshot = (versions.createSnapshot as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0].snapshot;
        expect(snapshot.servings).toBe(2);
        expect(snapshot.prepTimeMinutes).toBe(7);
        expect(snapshot.cookTimeMinutes).toBe(23);
    });
});

describe('RecipesService — C-004 substantive-edit detection, per field (Tier-2)', () => {
    /**
     * Run an update against a rich existing aggregate and report whether it was flagged substantive.
     *
     * `storedQuantity` overrides the persisted line's two quantity COLUMNS (strings, as `pg` surfaces
     * `numeric`), so a case can state what the recipe already said before the patch — needed for the
     * upper-bound cases, where the interesting comparison is range-against-range.
     */
    async function isSubstantive(
        patch: Partial<UpdateRecipeDto>,
        // ⚠️ WIDENED for U26/U27 from a quantity-only pair to any column override. The narrower type could
        // not express "the STORED line already carries a preparation", which is the half of the comparison
        // that proves CLEARING a field is an edit — an accept-only suite would pass against a
        // `ingredientsChanged` that never looks at the stored side at all.
        storedColumns: Partial<RecipeIngredientRow> = { quantity: '2', quantityHigh: null },
    ): Promise<boolean> {
        const base = richAggregate({ hasSubstantiveEdit: false, currentVersion: 1 });
        const existing: RecipeAggregate = {
            ...base,
            ingredients: base.ingredients.map((line) => ({ ...line, ...storedColumns })),
        };
        const dal = fakeDal({
            findById: vi.fn().mockResolvedValue(existing),
            update: vi.fn().mockResolvedValue(existing),
        });

        await newService(dal).update(principal(), 'r-1', { expectedVersion: 1, ...patch });

        const updateArgs = (dal.update as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1];

        return updateArgs.hasSubstantiveEdit === true;
    }

    // The existing rich aggregate: 1 step (instruction 'Mix', timer 45) + 1 ingredient
    // (ing-A, qty 2, unit 'cup', notes 'diced').
    const SAME_INGREDIENT = {
        ingredientId: 'ing-A',
        name: 'Onion',
        quantity: { kind: 'exact', value: 2 },
        unit: 'cup',
        notes: 'diced',
    } as const satisfies RecipeIngredientInputDto;
    const SAME_STEP = { instruction: 'Mix', timerSeconds: 45 };

    it('metadata-only change (title) is NOT substantive', async () => {
        expect(await isSubstantive({ title: 'Renamed' })).toBe(false);
    });

    it('an identical ingredients+steps patch is NOT substantive', async () => {
        expect(await isSubstantive({ ingredients: [SAME_INGREDIENT], steps: [SAME_STEP] })).toBe(false);
    });

    it('an ingredient QUANTITY-only change is substantive', async () => {
        expect(
            await isSubstantive({ ingredients: [{ ...SAME_INGREDIENT, quantity: { kind: 'exact', value: 3 } }] }),
        ).toBe(true);
    });

    /**
     * ⚠️ U8 — THE EDIT MOST LIKELY TO GO UNNOTICED, on the server side of the same trap the plan names for
     * the client diff. `ingredientsChanged` is a positive field-by-field enumeration, so a new bound is
     * invisible to it BY CONSTRUCTION and no compile error catches the omission. Widening `2 cups` to
     * `2 to 3 cups` changes what a cook makes; it must mint a version and, under C-004, re-judge visibility.
     */
    it('widening an exact quantity into a RANGE is substantive', async () => {
        expect(
            await isSubstantive({
                ingredients: [{ ...SAME_INGREDIENT, quantity: { kind: 'range', low: 2, high: 3 } }],
            }),
        ).toBe(true);
    });

    it('changing ONLY a range’s upper bound is substantive', async () => {
        expect(
            await isSubstantive(
                { ingredients: [{ ...SAME_INGREDIENT, quantity: { kind: 'range', low: 2, high: 4 } }] },
                {
                    quantity: '2',
                    quantityHigh: '3',
                },
            ),
        ).toBe(true);
    });

    // ⛔ THE OTHER HALF, and the one a reference comparison would have broken silently: an identical range
    // must NOT read as an edit. `!==` against a value object is `true` for every pair of distinct objects,
    // so without `quantitiesEqual` every metadata-only PATCH would mint a version.
    it('an identical RANGE patch is NOT substantive — the comparison is by value, not by reference', async () => {
        expect(
            await isSubstantive(
                {
                    ingredients: [{ ...SAME_INGREDIENT, quantity: { kind: 'range', low: 2, high: 3 } }],
                    steps: [SAME_STEP],
                },
                { quantity: '2', quantityHigh: '3' },
            ),
        ).toBe(false);
    });

    it('narrowing a RANGE back to an exact quantity is substantive', async () => {
        expect(
            await isSubstantive(
                { ingredients: [{ ...SAME_INGREDIENT, quantity: { kind: 'exact', value: 2 } }] },
                {
                    quantity: '2',
                    quantityHigh: '3',
                },
            ),
        ).toBe(true);
    });

    it('dropping a stated quantity to ABSENT is substantive', async () => {
        expect(await isSubstantive({ ingredients: [{ ...SAME_INGREDIENT, quantity: { kind: 'absent' } }] })).toBe(true);
    });

    it('an ingredient UNIT-only change is substantive', async () => {
        expect(await isSubstantive({ ingredients: [{ ...SAME_INGREDIENT, unit: 'tbsp' }] })).toBe(true);
    });

    it('an ingredient NOTES-only change is substantive', async () => {
        expect(await isSubstantive({ ingredients: [{ ...SAME_INGREDIENT, notes: 'minced' }] })).toBe(true);
    });

    /**
     * U26/U27 — the same trap as the range case above, one field further on. `ingredientsChanged` is a
     * POSITIVE enumeration, so a line field it does not name is invisible to it and nothing fails to
     * compile. Left out, an edit that changes ONLY how a cook chops the onion — or which section the line
     * sits in — is saved with `hasSubstantiveEdit: false`: no version is minted, so the previous value is
     * unrecoverable, and C-004 never re-judges visibility for a recipe whose content moved.
     */
    it('an ingredient PREPARATION-only change is substantive', async () => {
        expect(await isSubstantive({ ingredients: [{ ...SAME_INGREDIENT, preparation: 'roughly torn' }] })).toBe(true);
    });

    it('an ingredient GROUP-LABEL-only change is substantive — moving a line changes what the recipe says', async () => {
        expect(await isSubstantive({ ingredients: [{ ...SAME_INGREDIENT, groupLabel: 'For the topping' }] })).toBe(
            true,
        );
    });

    // ⛔ The other half, and the one a careless `!== undefined` comparison breaks: a patch that carries
    // NEITHER field against a row that stores NEITHER must read as unchanged. Without the `?? null`
    // normalization on both sides, `undefined !== null` makes every metadata-only PATCH mint a version.
    it('a patch stating neither preparation nor group, against a line storing neither, is NOT substantive', async () => {
        expect(await isSubstantive({ ingredients: [SAME_INGREDIENT], steps: [SAME_STEP] })).toBe(false);
    });

    // CLEARING is an edit too: removing "finely chopped" changes what a cook makes.
    it('CLEARING a stored preparation is substantive', async () => {
        expect(await isSubstantive({ ingredients: [SAME_INGREDIENT] }, { preparation: 'finely chopped' })).toBe(true);
    });

    it('CLEARING a stored group label (ungrouping a line) is substantive', async () => {
        expect(await isSubstantive({ ingredients: [SAME_INGREDIENT] }, { groupLabel: 'For the marinade' })).toBe(true);
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

        await newService(dal).clone(principal(), 'src');

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
                        quantity: { kind: 'exact', value: 2 },
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

        await newService(dal).clone(principal(), 'src');

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

        await newService(dal).clone(principal(), 'src');

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

        const error = await catchError(newService(dal).clone(principal(), 'src'));

        expect(isRecipeDomainError(error) && error.code).toBe(RecipeErrorCode.RECIPE_NOT_FOUND);
        expect(create).not.toHaveBeenCalled();
    });

    it('throws RECIPE_NOT_FOUND when the clone source does not exist', async () => {
        const dal = fakeDal({ findById: vi.fn().mockResolvedValue(undefined) });
        const error = await catchError(newService(dal).clone(principal(), 'missing'));

        expect(isRecipeDomainError(error) && error.code).toBe(RecipeErrorCode.RECIPE_NOT_FOUND);
    });
});

// ── S-R6: ingredient-line resolution is a SINGLE batch `findByIds`, never a serial per-line loop ────
describe('RecipesService — ingredient-line resolution batching (S-R6)', () => {
    const ID_A = '00000000-0000-4000-8000-0000000000a1';
    const ID_B = '00000000-0000-4000-8000-0000000000b2';
    const ID_C = '00000000-0000-4000-8000-0000000000c3';

    /** A 3-line create DTO: A, B, then A again (a repeated ingredientId across two lines). */
    const MULTI_LINE_DTO: CreateRecipeDto = {
        title: 'Stew',
        servings: 2,
        prepTimeMinutes: 5,
        cookTimeMinutes: 10,
        totalTimeMinutes: 15,
        ingredients: [
            { ingredientId: ID_A, name: 'Carrot', quantity: { kind: 'exact', value: 1 } },
            { ingredientId: ID_B, name: 'Potato', quantity: { kind: 'exact', value: 2 } },
            { ingredientId: ID_A, name: 'Carrot', quantity: { kind: 'exact', value: 3 } },
        ],
        steps: [{ instruction: 'Simmer' }],
    };

    /** A catalog DAL whose `findByIds` resolves the given ids to named ingredients; `findById` must never fire. */
    function catalogDal(entries: Record<string, string>): IngredientsDal {
        return {
            findById: vi.fn(),
            findByIds: vi
                .fn()
                .mockImplementation((ids: readonly string[]) =>
                    Promise.resolve(
                        ids.filter((id) => id in entries).map((id) => makeIngredient({ id, name: entries[id]! })),
                    ),
                ),
        } as unknown as IngredientsDal;
    }

    function serviceWith(ingredientsDal: IngredientsDal): RecipesService {
        return new RecipesService(
            fakeDal({ create: vi.fn().mockResolvedValue(aggregate()) }),
            ingredientsDal,
            makeFakeVersionsService(),
            fakePhotosDal(),
            RECIPE_PHOTOS_CDN,
            fakeRatingsDal(),
            nutritionGatewayDouble,
            fakeVerificationQueue(),
            fakeLineVerificationsDal(),
        );
    }

    it('resolves M lines with ONE findByIds call over the deduped ids — findById is never looped', async () => {
        const ingredientsDal = catalogDal({ [ID_A]: 'Carrot', [ID_B]: 'Potato' });

        await serviceWith(ingredientsDal).create(principal(), MULTI_LINE_DTO);

        // resolveIngredientLines runs FIRST in `create` (before the lead-calories/detail-nutrition batch
        // calls that legitimately also hit findByIds) — its call is a SINGLE batch over the 2 unique ids
        // for the 3 input lines, not 3 separate per-line queries.
        const calls = (ingredientsDal.findByIds as unknown as ReturnType<typeof vi.fn>).mock.calls;
        expect(calls[0]).toEqual([[ID_A, ID_B]]);
        // findByIds is never called once per line (which would be 3 calls of length-1 arrays) — every
        // recorded call is a multi-id (or empty) batch.
        expect(calls.every((call) => (call[0] as string[]).length !== 1)).toBe(true);
        expect(ingredientsDal.findById).not.toHaveBeenCalled();
    });

    it('a line with an unknown ingredientId still throws unknownIngredient(id) (fail-fast preserved)', async () => {
        // The catalog resolves B but not A — A's line must fail fast with the SAME error the old loop threw.
        const ingredientsDal = catalogDal({ [ID_B]: 'Potato' });

        const error = await catchError(serviceWith(ingredientsDal).create(principal(), MULTI_LINE_DTO));

        expect(isRecipeDomainError(error) && error.code).toBe(RecipeErrorCode.UNKNOWN_INGREDIENT);
    });

    it('resolves lines in INPUT order, and a duplicate id dedupes in the query but resolves BOTH lines', async () => {
        const ingredientsDal = catalogDal({ [ID_A]: 'Carrot', [ID_B]: 'Potato', [ID_C]: 'Onion' });
        const dal = fakeDal({ create: vi.fn().mockResolvedValue(aggregate()) });
        const service = new RecipesService(
            dal,
            ingredientsDal,
            makeFakeVersionsService(),
            fakePhotosDal(),
            RECIPE_PHOTOS_CDN,
            fakeRatingsDal(),
            nutritionGatewayDouble,
            fakeVerificationQueue(),
            fakeLineVerificationsDal(),
        );

        await service.create(principal(), {
            ...MULTI_LINE_DTO,
            ingredients: [
                { ingredientId: ID_C, name: 'Onion', quantity: { kind: 'exact', value: 1 } },
                { ingredientId: ID_A, name: 'Carrot', quantity: { kind: 'exact', value: 2 } },
                { ingredientId: ID_B, name: 'Potato', quantity: { kind: 'exact', value: 3 } },
                { ingredientId: ID_A, name: 'Carrot', quantity: { kind: 'exact', value: 4 } },
            ],
        });

        const createArg = (dal.create as unknown as ReturnType<typeof vi.fn>).mock.calls[0]![0] as {
            ingredients: Array<{ ingredientId: string; sortOrder: number }>;
        };
        // Input order preserved (C, A, B, A) with sortOrder matching position — NOT catalog/query order.
        expect(createArg.ingredients.map((line) => [line.ingredientId, line.sortOrder])).toEqual([
            [ID_C, 0],
            [ID_A, 1],
            [ID_B, 2],
            [ID_A, 3],
        ]);
        // The duplicate id (ID_A) was deduped in the query...
        expect(ingredientsDal.findByIds).toHaveBeenCalledWith([ID_C, ID_A, ID_B]);
        // ...but BOTH of its lines still resolved (not dropped).
        expect(createArg.ingredients.filter((line) => line.ingredientId === ID_A)).toHaveLength(2);
    });
});

/*
 * ⛔ The write-time lead-calorie suite was U10 REMOVED. It asserted that create/update recomputed a
 * DENORMALIZED column and forwarded it to the DAL — behaviour that no longer exists, because the column is
 * gone and the figure is derived on every detail read from food's live data instead. Keeping the tests
 * would have pinned a design the unit deleted.
 */

/**
 * U26/U27 — THE FIVE PLACES A NEW LINE FIELD HAS TO BE ADDED, and the ONE reason they need a suite of
 * their own: **not one of them is enforced by the compiler.**
 *
 * `toIngredientResponse`, `resolveIngredientLines`, `toResolvedIngredientLine` (clone), the version-snapshot
 * builder and `ingredientsChanged` are each a POSITIVE field-by-field enumeration built from conditional
 * spreads — the idiom TypeScript's excess-property check cannot see through. `ingredientsChanged`'s own
 * docstring says so outright: _"a newly-modelled part of a quantity is invisible to it by construction and
 * nothing would fail to compile."_ `toResolvedIngredientLine` already shipped this exact defect once, for
 * `sourceLine`, and `clone.service.test.ts` carries the pin that was added when it was noticed.
 *
 * So every case below is written to KILL a specific deletion. Removing the two fields from any one of the
 * five sites must red exactly one of these and leave the rest green.
 */
describe('RecipesService — preparation + groupLabel travel with the line (U26/U27)', () => {
    /** A one-line aggregate carrying both new columns populated. */
    const groupedAggregate = (): RecipeAggregate => {
        const recipe = makeRecipeRow({ id: 'r-1', ownerId: OWNER, deletedAt: null });

        return {
            recipe,
            steps: [makeRecipeStepRow({ recipeId: recipe.id, stepNumber: 1, instruction: 'Mix' })],
            ingredients: [
                makeRecipeIngredientRow({
                    recipeId: recipe.id,
                    ingredientId: 'ing-A',
                    ingredientName: 'Onion',
                    quantity: '2',
                    unit: 'cup',
                    displayText: '2 cups onion, finely chopped',
                    preparation: 'finely chopped',
                    groupLabel: 'For the marinade',
                    sortOrder: 0,
                }),
            ],
        };
    };

    it('the DETAIL read emits both fields when the columns carry them', async () => {
        const dal = fakeDal({ findById: vi.fn().mockResolvedValue(groupedAggregate()) });

        const res = await newService(dal).getById(OWNER, 'r-1');

        expect(res.ingredients[0]).toMatchObject({
            name: 'Onion',
            preparation: 'finely chopped',
            groupLabel: 'For the marinade',
        });
    });

    // ⛔ U26's headline assertion. The name is what a `food_id` resolves to in the catalog; the preparation
    // is what THIS recipe does to it. A projection that concatenated them would produce a name matching no
    // catalog row — and it is the shape `versions/model.ts`'s preview uses for `displayText`, so it is one
    // copy-paste away at all times.
    it('⛔ NEVER folds the preparation into the food NAME, on read', async () => {
        const dal = fakeDal({ findById: vi.fn().mockResolvedValue(groupedAggregate()) });

        const res = await newService(dal).getById(OWNER, 'r-1');

        expect(res.ingredients[0]?.name).toBe('Onion');
        expect(res.ingredients[0]?.name).not.toContain('finely chopped');
    });

    // ⛔ `notes` (the wire name for `display_text`) and `preparation` are DIFFERENT FACTS with different
    // producers — U26 resolved that rather than renaming one into the other. This pins that both reach the
    // wire independently, so a later "these look redundant, drop one" edit reds here.
    it('emits `notes` and `preparation` as SEPARATE keys — U26 did not merge them', async () => {
        const dal = fakeDal({ findById: vi.fn().mockResolvedValue(groupedAggregate()) });

        const res = await newService(dal).getById(OWNER, 'r-1');

        expect(res.ingredients[0]?.notes).toBe('2 cups onion, finely chopped');
        expect(res.ingredients[0]?.preparation).toBe('finely chopped');
    });

    // ⛔ `null` → the key is OMITTED, never emitted as `''`. `recipeIngredientViewSchema` rejects `''`
    // (`min(1)`), so emitting a blank is a body this server can write and no client can read — the exact
    // break `notes` had before its `min(1)` landed.
    it('OMITS both keys for an ungrouped, unprepared line rather than emitting `""`', async () => {
        const bare: RecipeAggregate = {
            recipe: makeRecipeRow({ id: 'r-2', ownerId: OWNER, deletedAt: null }),
            steps: [makeRecipeStepRow({ recipeId: 'r-2', stepNumber: 1, instruction: 'Mix' })],
            ingredients: [
                makeRecipeIngredientRow({
                    recipeId: 'r-2',
                    ingredientId: 'ing-A',
                    ingredientName: 'Salt',
                    preparation: null,
                    groupLabel: null,
                }),
            ],
        };
        const dal = fakeDal({ findById: vi.fn().mockResolvedValue(bare) });

        const res = await newService(dal).getById(OWNER, 'r-2');

        expect(res.ingredients[0]).not.toHaveProperty('preparation');
        expect(res.ingredients[0]).not.toHaveProperty('groupLabel');
    });

    // ⛔ A whole recipe's read must parse under the PUBLISHED read schema, not merely look right in a
    // `toMatchObject`. `recipeIngredientViewSchema` is a NON-STRICT `z.object`, which silently STRIPS an
    // unlisted key — so a field added to the service and forgotten on the schema would vanish client-side
    // with every server test green. Parsing through the schema is what detects that.
    it('round-trips through the PUBLISHED read schema, which would otherwise strip an unlisted key', async () => {
        const dal = fakeDal({ findById: vi.fn().mockResolvedValue(groupedAggregate()) });

        const res = await newService(dal).getById(OWNER, 'r-1');
        const parsed = recipeIngredientViewSchema.parse(res.ingredients[0]);

        expect(parsed.preparation).toBe('finely chopped');
        expect(parsed.groupLabel).toBe('For the marinade');
    });

    /** The lines `RecipesService.create` handed the DAL for the given body. */
    const persistedLines = async (over: Partial<CreateRecipeDto>): Promise<Record<string, unknown>[]> => {
        const dal = fakeDal({ create: vi.fn().mockResolvedValue(aggregate()) });

        await newService(dal).create(principal(), { ...CREATE_DTO, ...over });

        return (dal.create as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0].ingredients;
    };

    it('carries both from the CREATE body through to the persisted line', async () => {
        const lines = await persistedLines({
            ingredients: [
                {
                    ingredientId: '00000000-0000-4000-8000-0000000000ff',
                    name: 'Onion',
                    quantity: { kind: 'exact', value: 2 },
                    unit: 'cup',
                    preparation: 'finely chopped',
                    groupLabel: 'For the marinade',
                },
            ],
        });

        expect(lines[0]).toMatchObject({ preparation: 'finely chopped', groupLabel: 'For the marinade' });
    });

    it('OMITS both on the persisted line when the body states neither', async () => {
        const lines = await persistedLines({});

        expect(lines[0]).not.toHaveProperty('preparation');
        expect(lines[0]).not.toHaveProperty('groupLabel');
    });
});
