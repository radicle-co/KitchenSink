/**
 * T047-test — unit tests for {@link RecipesService.clone} (FR-011 recipe clone).
 *
 * A clone creates a NEW recipe owned by the caller with `clonedFromId = source.id`, RETAINS the source's
 * attribution (`sourceType`/`sourceUrl`/`sourceAttribution`), copies content, resets
 * `hasSubstantiveEdit` to false, and sets `visibility` to the C-004 clone default for the source type.
 * Authorization: only a `public` recipe is cloneable by a non-owner; an owner may clone their own
 * (even private). The ORIGINAL is never mutated. No database is involved — a fake DAL captures the
 * create input.
 */
import { describe, it, expect, vi } from 'vitest';

import { RecipeErrorCode } from '@kitchensink/recipe-core';

import { RecipesService } from '../recipes.service.js';
import { makeFakeVersionsService } from '../__fixtures__/versions.fixture.js';
import { fakePhotosDal, RECIPE_PHOTOS_CDN } from '../__fixtures__/photos-dal.fixture.js';
import type { RecipesDal, RecipeAggregate } from '../dal/recipes.dal.js';
import type { IngredientsDal } from '../../ingredients/dal/ingredients.dal.js';
import { isRecipeDomainError } from '../recipe.error.js';
import { makeRecipeRow, makeRecipeStepRow, makeRecipeIngredientRow } from '../../__fixtures__/index.js';
import { makeIngredient } from '../../ingredients/__fixtures__/ingredients.fixtures.js';

const SOURCE_OWNER = '01J0000000000000000000PRO0';
const CLONER = '01J000000000000000000FREE0';
const INGREDIENT_ID = '00000000-0000-4000-8000-0000000000ff';

function sourceAggregate(overrides: Partial<Parameters<typeof makeRecipeRow>[0]> = {}): RecipeAggregate {
    const recipe = makeRecipeRow({
        id: 'src-1',
        ownerId: SOURCE_OWNER,
        title: 'Original Dish',
        visibility: 'public',
        sourceType: 'user_created',
        sourceUrl: null,
        sourceAttribution: null,
        clonedFromId: null,
        hasSubstantiveEdit: true,
        ingredientNamesText: 'onion',
        ...overrides,
    });

    return {
        recipe,
        steps: [makeRecipeStepRow({ recipeId: recipe.id, stepNumber: 1, instruction: 'Chop', timerSeconds: 30 })],
        ingredients: [
            makeRecipeIngredientRow({
                recipeId: recipe.id,
                ingredientId: INGREDIENT_ID,
                quantity: '2',
                unit: 'cup',
                displayText: 'diced',
                sortOrder: 0,
                ingredientName: 'Onion',
            }),
        ],
    };
}

function fakeDal(source: RecipeAggregate | undefined): { dal: RecipesDal; create: ReturnType<typeof vi.fn> } {
    // The DAL echoes back a created aggregate built from the create input so the response maps cleanly.
    const create = vi.fn().mockImplementation(
        async (input: {
            ownerId: string;
            visibility: string;
            clonedFromId?: string | null;
        }): Promise<RecipeAggregate> => ({
            recipe: makeRecipeRow({
                id: 'clone-1',
                ownerId: input.ownerId,
                visibility: input.visibility,
                clonedFromId: input.clonedFromId ?? null,
                hasSubstantiveEdit: false,
            }),
            steps: [],
            ingredients: [],
        }),
    );
    const dal = {
        create,
        findById: vi.fn().mockResolvedValue(source),
        findAll: vi.fn(),
        update: vi.fn(),
        softDelete: vi.fn(),
        setVisibility: vi.fn(),
    } as unknown as RecipesDal;

    return { dal, create };
}

function fakeIngredientsDal(): IngredientsDal {
    return {
        findById: vi.fn().mockResolvedValue(makeIngredient({ id: INGREDIENT_ID, name: 'Onion' })),
        findByIds: vi.fn().mockResolvedValue([]),
    } as unknown as IngredientsDal;
}

function service(dal: RecipesDal): RecipesService {
    return new RecipesService(dal, fakeIngredientsDal(), makeFakeVersionsService(), fakePhotosDal(), RECIPE_PHOTOS_CDN);
}

async function catchError(promise: Promise<unknown>): Promise<unknown> {
    try {
        await promise;
    } catch (error) {
        return error;
    }

    throw new Error('Expected the promise to reject, but it resolved.');
}

describe('RecipesService.clone', () => {
    it('throws RECIPE_NOT_FOUND when the source does not exist', async () => {
        const { dal } = fakeDal(undefined);
        const error = await catchError(service(dal).clone(CLONER, 'src-1'));

        expect(isRecipeDomainError(error) && error.code).toBe(RecipeErrorCode.RECIPE_NOT_FOUND);
    });

    it('throws NOT_OWNER when a non-owner clones a PRIVATE recipe', async () => {
        const { dal } = fakeDal(sourceAggregate({ visibility: 'private', ownerId: SOURCE_OWNER }));
        const error = await catchError(service(dal).clone(CLONER, 'src-1'));

        expect(isRecipeDomainError(error) && error.code).toBe(RecipeErrorCode.NOT_OWNER);
    });

    it('lets the OWNER clone their own private recipe', async () => {
        const { dal, create } = fakeDal(sourceAggregate({ visibility: 'private', ownerId: SOURCE_OWNER }));

        await service(dal).clone(SOURCE_OWNER, 'src-1');

        expect(create).toHaveBeenCalledTimes(1);
    });

    it('creates a new recipe owned by the caller, linked via clonedFromId, with hasSubstantiveEdit reset', async () => {
        const { dal, create } = fakeDal(sourceAggregate());

        const response = await service(dal).clone(CLONER, 'src-1');

        expect(create).toHaveBeenCalledWith(
            expect.objectContaining({
                ownerId: CLONER,
                clonedFromId: 'src-1',
                hasSubstantiveEdit: false,
                title: 'Original Dish',
            }),
        );
        // Content is carried over: the source's single step + ingredient line.
        const input = create.mock.calls[0]?.[0] as { steps: unknown[]; ingredients: { ingredientId: string }[] };
        expect(input.steps).toHaveLength(1);
        expect(input.ingredients[0]?.ingredientId).toBe(INGREDIENT_ID);
        expect(response.ownerId).toBe(CLONER);
    });

    it('retains the source attribution (sourceType/sourceUrl/sourceAttribution) for an imported source', async () => {
        const { dal, create } = fakeDal(
            sourceAggregate({
                sourceType: 'imported_public',
                sourceUrl: 'https://example.com/x',
                sourceAttribution: 'Chef A',
            }),
        );

        await service(dal).clone(CLONER, 'src-1');

        expect(create).toHaveBeenCalledWith(
            expect.objectContaining({
                sourceType: 'imported_public',
                sourceUrl: 'https://example.com/x',
                sourceAttribution: 'Chef A',
            }),
        );
    });

    it('records attribution to the original author when the source is a user_created original (no attribution)', async () => {
        const { dal, create } = fakeDal(sourceAggregate({ sourceType: 'user_created', sourceAttribution: null }));

        await service(dal).clone(CLONER, 'src-1');

        const input = create.mock.calls[0]?.[0] as { sourceAttribution?: string };
        expect(input.sourceAttribution).toContain(SOURCE_OWNER);
    });

    it('defaults a user_created / imported_public clone to public visibility', async () => {
        const { dal, create } = fakeDal(sourceAggregate({ sourceType: 'imported_public' }));

        await service(dal).clone(CLONER, 'src-1');

        expect(create.mock.calls[0]?.[0]).toMatchObject({ visibility: 'public' });
    });

    it('defaults an imported_paid clone to private visibility (may never be public)', async () => {
        // A paid source is private-only, so the owner clones their own copy.
        const { dal, create } = fakeDal(
            sourceAggregate({ sourceType: 'imported_paid', visibility: 'private', ownerId: SOURCE_OWNER }),
        );

        await service(dal).clone(SOURCE_OWNER, 'src-1');

        expect(create.mock.calls[0]?.[0]).toMatchObject({ visibility: 'private' });
    });
});
