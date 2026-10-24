/**
 * `RecipeDetailAssembler` over the binding grain (plan 002 R9, R46, R47, R6; U4).
 *
 * A line's name comes from following its binding through food's refs answer, and its status runs the real
 * overlay chain `resolveLineStatus → foodPresenceStatus → viewerLineStatus`. Every nameless path is driven here
 * through that chain rather than through stubs, because the view composer THROWS on a nameless line whose status
 * does not say why — and on the detail read that throw is a 500 for the whole recipe.
 */
import { describe, expect, it, vi } from 'vitest';
import { FoodResolutionStatus } from '@kitchensink/recipe-core';
import { verificationKey } from '@kitchensink/recipe-core/resolution/verification-key';

import { makeIngredientLineRow, makeRecipeRow, makeRecipeStepRow } from '../../__fixtures__/index.js';
import { CallerToken } from '../../auth/CallerToken.js';
import { sha256Hex } from '../../common/sha256.js';
import { foodRefOf, type FoodLookupArm, type FoodRef } from '../../database/schema/foodLookupArm.js';
import { fakeFoodLookupsDal } from '../../ingredients/__fixtures__/foodLookups.fixture.js';
import type { FoodRefAnswer } from '../../ingredients/domain/foodRefAnswer.js';
import { canonicalIngredientName } from '../../ingredients/domain/ingredientName.js';
import type { FoodNutritionGateway, FoodNutritionLookup } from '../../ingredients/foodNutrition.gateway.js';
import type { FoodRefsGateway } from '../../ingredients/foodRefs.gateway.js';
import { makeRecipeDetailAssembler } from '../__fixtures__/recipeDetailAssembler.fixture.js';
import { fakeLineVerificationsDal } from '../__fixtures__/lineVerificationsDal.fixture.js';
import { fakeRecipesDal } from '../__fixtures__/recipesDal.fixture.js';
import type { RecipeAggregate } from '../dal/recipes.dal.js';
import { verifiedLineIdentity } from '../domain/lineVerification.js';

const AT = new Date('2026-09-30T00:00:00.000Z');
const AUTHOR = '01JAUTHOR0000000000000000A';
const STRANGER = '01JSTRANGER000000000000000';
const CALLER = CallerToken.fromAuthorizationHeader('Bearer viewer-token');

const SHARED: FoodLookupArm = {
    kind: 'root',
    lookupId: 'l-shared',
    foodId: 'food-shared',
    foodOwnerId: null,
    createdAt: AT,
};
const PRIVATE: FoodLookupArm = {
    kind: 'root',
    lookupId: 'l-private',
    foodId: 'food-private',
    foodOwnerId: AUTHOR,
    createdAt: AT,
};
const VARIANT: FoodLookupArm = { kind: 'variant', lookupId: 'l-variant', foodVariantId: 'var-1', createdAt: AT };
const DECLARED: FoodLookupArm = {
    kind: 'unresolved',
    lookupId: 'l-declared',
    createdAt: AT,
    failure: {
        unresolvedFoodId: 'f-declared',
        name: 'grandma’s spice mix',
        normalizedKey: 'grandma’s spice mix',
        reasonCode: 'author_declared',
        status: 'UNRESOLVED',
        foodHandleId: null,
        tiersConsulted: [],
        tiersUnavailable: [],
        attempts: 1,
        settledLookupId: null,
    },
};
const AWAITING: FoodLookupArm = {
    kind: 'unresolved',
    lookupId: 'l-awaiting',
    createdAt: AT,
    failure: {
        ...DECLARED.failure,
        unresolvedFoodId: 'f-awaiting',
        name: 'yuzu kosho',
        normalizedKey: 'yuzu kosho',
        reasonCode: 'awaiting_source',
        status: 'PENDING',
        foodHandleId: 'food-9',
    },
};

const found = (name: string, status: 'RESOLVED' | 'WITHDRAWN' = 'RESOLVED', rootId = 'food-shared'): FoodRefAnswer => ({
    outcome: 'found',
    name: canonicalIngredientName(name),
    status,
    isPrivate: false,
    rootId,
});

const FLAT = { id: 'var-1', parts: [{ attribute: 'cut', text: 'flat' }] };

/** Food's answer about the flat-cut variant: the brisket root's name, the root, and the variant's parts. */
const FLAT_ANSWER: FoodRefAnswer = {
    ...(found('beef brisket', 'RESOLVED', 'R-brisket') as object),
    variant: FLAT,
} as FoodRefAnswer;

/** A refs double answering from a table keyed `kind:id`; an unlisted reference is `unreachable`. */
function refsOf(answers: Record<string, FoodRefAnswer>) {
    const resolve = vi.fn((_caller: unknown, refs: readonly FoodRef[]) =>
        Promise.resolve({
            answers: new Map(
                refs.map((ref): [string, FoodRefAnswer] => [
                    `${ref.kind}:${ref.id}`,
                    answers[`${ref.kind}:${ref.id}`] ?? { outcome: 'unreachable' },
                ]),
            ),
            degraded: false,
        }),
    );

    return { gateway: { resolve } as unknown as FoodRefsGateway, resolve };
}

/** A nutrition double that answers per-100g numbers for the given food ids, and which roots have live variants. */
function nutritionOf(foodIds: readonly string[], withLiveVariants: readonly string[] = []) {
    const lookup = vi.fn(() => {
        const answer: FoodNutritionLookup = {
            byFoodId: new Map(
                foodIds.map((id) => [
                    id,
                    {
                        caloriesPer100g: 100,
                        portions: [],
                        freshness: 'fresh' as const,
                        status: 'RESOLVED' as const,
                        ...(withLiveVariants.includes(id) ? { hasLiveVariants: true } : {}),
                    },
                ]),
            ),
            unansweredIds: new Set(),
        };

        return Promise.resolve(answer);
    });

    return { gateway: { lookup } as unknown as FoodNutritionGateway, lookup };
}

/** A recipe with one line per binding, each with its own row id. */
function aggregateOf(...lookupIds: readonly string[]): RecipeAggregate {
    const recipe = makeRecipeRow({ ownerId: AUTHOR });

    return {
        recipe,
        steps: [makeRecipeStepRow({ recipeId: recipe.id })],
        ingredients: lookupIds.map((foodLookupId, index) =>
            makeIngredientLineRow({
                id: `line-${index}`,
                recipeId: recipe.id,
                foodLookupId,
                quantity: '100',
                unit: 'g',
                sortOrder: index,
            }),
        ),
    };
}

async function detailOf(
    aggregate: RecipeAggregate,
    arms: readonly FoodLookupArm[],
    answers: Record<string, FoodRefAnswer>,
    viewerId: string,
) {
    const assembler = makeRecipeDetailAssembler({
        lookups: fakeFoodLookupsDal(...arms),
        refs: refsOf(answers).gateway,
    });

    return assembler.toDetailResponse(aggregate, [], { caller: CALLER, budget: 'read', viewerId });
}

describe('RecipeDetailAssembler.toDetailResponse — names and statuses through the real overlay chain', () => {
    it('names a shared food’s line from food’s answer, with its root food id', async () => {
        const detail = await detailOf(
            aggregateOf('l-shared'),
            [SHARED],
            { 'root:food-shared': found('beef brisket') },
            STRANGER,
        );

        expect(detail.ingredients[0]).toMatchObject({
            ingredientId: 'l-shared',
            name: 'beef brisket',
            foodId: 'food-shared',
            isUserEntered: false,
            resolutionStatus: FoodResolutionStatus.RESOLVED,
        });
    });

    it('⛔ renders FOOD_UNREACHABLE with NO name when food cannot be asked — never a stale or placeholder name', async () => {
        const detail = await detailOf(aggregateOf('l-shared'), [SHARED], {}, STRANGER);

        expect(detail.ingredients[0]).toStrictEqual(
            expect.objectContaining({ resolutionStatus: FoodResolutionStatus.FOOD_UNREACHABLE }),
        );
        expect(detail.ingredients[0]).not.toHaveProperty('name');
    });

    it('⛔ shows a stranger RESOLVED_UNAVAILABLE for another author’s private food — no name, no food id, never FOOD_REMOVED', async () => {
        // Food shows a private food to its author only, so for the stranger its answer is `absent`.
        const detail = await detailOf(
            aggregateOf('l-private'),
            [PRIVATE],
            { 'root:food-private': { outcome: 'absent' } },
            STRANGER,
        );

        expect(detail.ingredients[0]?.resolutionStatus).toBe(FoodResolutionStatus.RESOLVED_UNAVAILABLE);
        expect(detail.ingredients[0]).not.toHaveProperty('name');
        expect(detail.ingredients[0]).not.toHaveProperty('foodId');
    });

    it('shows the author their own private food by name', async () => {
        const detail = await detailOf(
            aggregateOf('l-private'),
            [PRIVATE],
            {
                'root:food-private': {
                    ...found('grandma’s rub', 'RESOLVED', 'food-private'),
                    isPrivate: true,
                } as FoodRefAnswer,
            },
            AUTHOR,
        );

        expect(detail.ingredients[0]).toMatchObject({ name: 'grandma’s rub', foodId: 'food-private' });
    });

    it('keeps a withdrawn food’s name and marks the line FOOD_REMOVED', async () => {
        const detail = await detailOf(
            aggregateOf('l-shared'),
            [SHARED],
            { 'root:food-shared': found('beef brisket', 'WITHDRAWN') },
            STRANGER,
        );

        expect(detail.ingredients[0]).toMatchObject({
            name: 'beef brisket',
            resolutionStatus: FoodResolutionStatus.FOOD_REMOVED,
        });
    });

    it('marks a food food no longer shows as FOOD_REMOVED, with no name', async () => {
        const detail = await detailOf(
            aggregateOf('l-shared'),
            [SHARED],
            { 'root:food-shared': { outcome: 'absent' } },
            STRANGER,
        );

        expect(detail.ingredients[0]?.resolutionStatus).toBe(FoodResolutionStatus.FOOD_REMOVED);
        expect(detail.ingredients[0]).not.toHaveProperty('name');
        // Curated U9: `foodId` is the LIVE root, and food named none. It used to echo the bound id here.
        expect(detail.ingredients[0]).not.toHaveProperty('foodId');
    });

    it('carries a declared line’s own name, its reason and the user-entered flag, and no status', async () => {
        const detail = await detailOf(aggregateOf('l-declared'), [DECLARED], {}, STRANGER);

        expect(detail.ingredients[0]).toStrictEqual(
            expect.objectContaining({
                name: 'grandma’s spice mix',
                unresolvedReason: 'author_declared',
                isUserEntered: true,
            }),
        );
        expect(detail.ingredients[0]).not.toHaveProperty('resolutionStatus');
        expect(detail.ingredients[0]).not.toHaveProperty('foodId');
    });

    it('carries a line awaiting its source as PENDING, named from its failure record', async () => {
        const detail = await detailOf(aggregateOf('l-awaiting'), [AWAITING], {}, STRANGER);

        expect(detail.ingredients[0]).toMatchObject({
            name: 'yuzu kosho',
            unresolvedReason: 'awaiting_source',
            resolutionStatus: FoodResolutionStatus.PENDING,
            isUserEntered: false,
        });
    });

    // Rewritten for curated U9: a variant line used to carry no root food id. It now carries its live root and its
    // variant, and its name is the root's (R24).
    it('names a variant line by its root, and carries the live root id and the variant’s parts', async () => {
        const detail = await detailOf(aggregateOf('l-variant'), [VARIANT], { 'variant:var-1': FLAT_ANSWER }, STRANGER);

        expect(detail.ingredients[0]).toMatchObject({ name: 'beef brisket', foodId: 'R-brisket', variant: FLAT });
        expect(detail.ingredients[0]).not.toHaveProperty('hasVariants');
    });

    it('gives two lines on ONE binding their own entries, and asks food about the binding once', async () => {
        const refs = refsOf({ 'root:food-shared': found('beef brisket') });
        const assembler = makeRecipeDetailAssembler({ lookups: fakeFoodLookupsDal(SHARED), refs: refs.gateway });

        const detail = await assembler.toDetailResponse(aggregateOf('l-shared', 'l-shared'), [], {
            caller: CALLER,
            budget: 'read',
            viewerId: STRANGER,
        });

        expect(detail.ingredients.map((line) => line.name)).toStrictEqual(['beef brisket', 'beef brisket']);
        expect(refs.resolve).toHaveBeenCalledTimes(1);
        expect(refs.resolve.mock.calls[0]?.[1]).toStrictEqual([{ kind: 'root', id: 'food-shared' }]);
    });
});

describe('RecipeDetailAssembler — a binding that vanished between the recipe read and the bindings read', () => {
    it('renders that line unreachable and nameless rather than failing the whole recipe', async () => {
        const detail = await detailOf(
            aggregateOf('l-shared', 'l-gone'),
            [SHARED],
            { 'root:food-shared': found('beef brisket') },
            STRANGER,
        );

        expect(detail.ingredients[0]?.name).toBe('beef brisket');
        expect(detail.ingredients[1]).toStrictEqual(
            expect.objectContaining({
                ingredientId: 'l-gone',
                resolutionStatus: FoodResolutionStatus.FOOD_UNREACHABLE,
            }),
        );
        expect(detail.ingredients[1]).not.toHaveProperty('name');
    });
});

describe('RecipeDetailAssembler — nutrition and verdicts follow the binding', () => {
    // Rewritten for curated U9: the lookup used to ask about ROOT foods only, leaving a variant line unaccounted.
    it('asks food for the nutrition of BOTH arms, and counts the variant line’s own figure (R21)', async () => {
        const nutrition = nutritionOf(['food-shared', 'var-1']);
        const assembler = makeRecipeDetailAssembler({
            lookups: fakeFoodLookupsDal(SHARED, VARIANT, DECLARED),
            refs: refsOf({ 'root:food-shared': found('beef brisket'), 'variant:var-1': FLAT_ANSWER }).gateway,
            foodNutrition: nutrition.gateway,
        });

        const detail = await assembler.toDetailResponse(aggregateOf('l-shared', 'l-variant', 'l-declared'), [], {
            caller: CALLER,
            budget: 'read',
            viewerId: STRANGER,
        });

        expect(nutrition.lookup).toHaveBeenCalledWith(CALLER, ['food-shared', 'var-1'], 'read');
        // Two lines of 100 g at 100 kcal/100 g, over the fixture recipe's 4 servings; the declared line has none.
        expect(detail.nutrition?.calories).toBe(50);
        expect(detail.nutrition?.isComplete).toBe(false);
    });

    it('⛔ finds a verdict under the key the PRODUCER derives from the same binding, and withholds the figure', async () => {
        const aggregate = aggregateOf('l-shared');
        const line = { ...aggregate.ingredients[0]!, sourceLine: '100 g beef brisket' };
        const stored: RecipeAggregate = { ...aggregate, ingredients: [line] };
        const identity = verifiedLineIdentity(
            {
                sourceLine: line.sourceLine,
                quantity: { kind: 'exact', value: 100 },
                unit: 'g',
                statedMeasure: undefined,
            },
            foodRefOf(SHARED)?.id,
        );
        const key = verificationKey(identity!, sha256Hex);
        const assembler = makeRecipeDetailAssembler({
            lookups: fakeFoodLookupsDal(SHARED),
            refs: refsOf({ 'root:food-shared': found('beef brisket') }).gateway,
            foodNutrition: nutritionOf(['food-shared']).gateway,
            lineVerificationsDal: fakeLineVerificationsDal(new Map([[key, 'contradicted']])),
        });

        const detail = await assembler.toDetailResponse(stored, [], {
            caller: CALLER,
            budget: 'read',
            viewerId: STRANGER,
        });

        expect(detail.ingredients[0]?.resolutionStatus).toBe(FoodResolutionStatus.NEEDS_REVIEW);
        expect(detail.nutrition?.calories).toBe(0);
    });
});

describe('RecipeDetailAssembler.getNutritionForRecipes — the card batch', () => {
    it('⛔ never asks food for names: the cards carry no lines', async () => {
        const refs = refsOf({});
        const nutrition = nutritionOf(['food-shared']);
        const recipe = makeRecipeRow({ id: 'recipe-1', servings: 1 });
        const dal = fakeRecipesDal({
            findNutritionInputs: vi.fn().mockResolvedValue([
                {
                    recipeId: 'recipe-1',
                    servings: recipe.servings,
                    lines: [makeIngredientLineRow({ foodLookupId: 'l-shared', quantity: '100', unit: 'g' })],
                },
            ]),
        });

        const assembler = makeRecipeDetailAssembler({
            dal,
            lookups: fakeFoodLookupsDal(SHARED),
            refs: refs.gateway,
            foodNutrition: nutrition.gateway,
        });

        const response = await assembler.getNutritionForRecipes(STRANGER, ['recipe-1'], CALLER);

        expect(refs.resolve).not.toHaveBeenCalled();
        expect(nutrition.lookup).toHaveBeenCalledWith(CALLER, ['food-shared'], 'read');
        expect(response.nutrition['recipe-1']).toMatchObject({ state: 'known' });
    });
});

describe('RecipeDetailAssembler — the variant on the line (curated U9)', () => {
    /** Read one recipe's detail over these bindings, answers and nutrition. */
    async function readWith(
        lookupIds: readonly string[],
        arms: readonly FoodLookupArm[],
        answers: Record<string, FoodRefAnswer>,
        nutrition: ReturnType<typeof nutritionOf>,
        viewerId = STRANGER,
    ) {
        const assembler = makeRecipeDetailAssembler({
            lookups: fakeFoodLookupsDal(...arms),
            refs: refsOf(answers).gateway,
            foodNutrition: nutrition.gateway,
        });

        return assembler.toDetailResponse(aggregateOf(...lookupIds), [], { caller: CALLER, budget: 'read', viewerId });
    }

    it('a root line carries hasVariants from the root’s cached batch entry', async () => {
        const detail = await readWith(
            ['l-shared'],
            [SHARED],
            { 'root:food-shared': found('beef brisket') },
            nutritionOf(['food-shared'], ['food-shared']),
        );

        expect(detail.ingredients[0]).toMatchObject({ foodId: 'food-shared', hasVariants: true });
        expect(detail.ingredients[0]).not.toHaveProperty('variant');
    });

    it('a root line whose root has no live variant, or no batch entry, reads hasVariants: false', async () => {
        const noVariants = await readWith(
            ['l-shared'],
            [SHARED],
            { 'root:food-shared': found('beef brisket') },
            nutritionOf(['food-shared']),
        );
        const noEntry = await readWith(
            ['l-shared'],
            [SHARED],
            { 'root:food-shared': found('beef brisket') },
            nutritionOf([]),
        );

        expect(noVariants.ingredients[0]).toMatchObject({ hasVariants: false });
        expect(noEntry.ingredients[0]).toMatchObject({ hasVariants: false });
    });

    it('⛔ a ROOT line food forwarded to a variant renders variant-bound, under the variant’s root', async () => {
        const detail = await readWith(
            ['l-shared'],
            [SHARED],
            { 'root:food-shared': FLAT_ANSWER },
            nutritionOf(['food-shared'], ['food-shared']),
        );

        expect(detail.ingredients[0]).toMatchObject({ name: 'beef brisket', foodId: 'R-brisket', variant: FLAT });
        expect(detail.ingredients[0]).not.toHaveProperty('hasVariants');
    });

    it('⛔ food unreachable: the line is FOOD_UNREACHABLE, keeps its bound root id, reads hasVariants: false', async () => {
        const detail = await readWith(['l-shared'], [SHARED], {}, nutritionOf([]));

        expect(detail.ingredients[0]).toMatchObject({
            foodId: 'food-shared',
            hasVariants: false,
            resolutionStatus: FoodResolutionStatus.FOOD_UNREACHABLE,
        });
    });

    it('food unreachable for a VARIANT line: no root id, no variant, no hasVariants — nothing food did not say', async () => {
        const detail = await readWith(['l-variant'], [VARIANT], {}, nutritionOf([]));

        expect(detail.ingredients[0]?.resolutionStatus).toBe(FoodResolutionStatus.FOOD_UNREACHABLE);

        for (const key of ['foodId', 'variant', 'hasVariants']) {
            expect(detail.ingredients[0]).not.toHaveProperty(key);
        }
    });

    it('⛔ a line the viewer may not see carries no variant and no hasVariants either', async () => {
        const detail = await readWith(
            ['l-private'],
            [PRIVATE],
            { 'root:food-private': { outcome: 'absent' } },
            nutritionOf(['food-private'], ['food-private']),
        );

        expect(detail.ingredients[0]?.resolutionStatus).toBe(FoodResolutionStatus.RESOLVED_UNAVAILABLE);

        for (const key of ['foodId', 'variant', 'hasVariants']) {
            expect(detail.ingredients[0]).not.toHaveProperty(key);
        }
    });
});

describe('RecipeDetailAssembler — a VARIANT line’s verdict (curated U9)', () => {
    it('⛔ finds the verdict the producer keyed on the VARIANT, and withholds the variant’s figure', async () => {
        const aggregate = aggregateOf('l-variant');
        const line = { ...aggregate.ingredients[0]!, sourceLine: '100 g flat-cut brisket' };
        const stored: RecipeAggregate = { ...aggregate, ingredients: [line] };
        const identity = verifiedLineIdentity(
            {
                sourceLine: line.sourceLine,
                quantity: { kind: 'exact', value: 100 },
                unit: 'g',
                statedMeasure: undefined,
            },
            'var-1',
        );
        const assembler = makeRecipeDetailAssembler({
            lookups: fakeFoodLookupsDal(VARIANT),
            refs: refsOf({ 'variant:var-1': FLAT_ANSWER }).gateway,
            foodNutrition: nutritionOf(['var-1']).gateway,
            lineVerificationsDal: fakeLineVerificationsDal(
                new Map([[verificationKey(identity!, sha256Hex), 'contradicted']]),
            ),
        });

        const detail = await assembler.toDetailResponse(stored, [], {
            caller: CALLER,
            budget: 'read',
            viewerId: STRANGER,
        });

        expect(detail.ingredients[0]?.resolutionStatus).toBe(FoodResolutionStatus.NEEDS_REVIEW);
        expect(detail.nutrition?.calories).toBe(0);
    });
});
