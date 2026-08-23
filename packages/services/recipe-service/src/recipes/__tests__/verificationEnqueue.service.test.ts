/**
 * ⛔ THE PRODUCER SEAM (plan U11 / ADR-0024) — written BEFORE the wiring (TDD red → green).
 *
 * U11 shipped the verification gate's CONSUMER and never shipped its producer: `verifyLine.ts` was deployed,
 * IAM'd, alarmed and given a queue, and nothing in the tree sent it a message. These cases are the seam that
 * closes that, pinned at the ONE layer that holds every field the contract needs — `recipeId` from the write,
 * `sourceLine`/`quantity`/`unit` from the resolved line, `foodId`/`candidateFoodName` from the catalog.
 *
 * The four properties, each written against a specific way of getting this wrong:
 *
 *  1. **A save enqueues after it persists, and never before.** The message carries the recipe's id, so a
 *     producer that ran first would have nothing to name.
 *  2. **⛔ AN ENQUEUE FAILURE MUST NOT FAIL THE SAVE.** The gate is a quality enhancement on an ASYNC path,
 *     and `0023_line_verifications.sql` establishes that absence of a verdict means PUBLISH — so a lost
 *     message degrades to exactly the behaviour the system had before the gate existed. Letting SQS take down
 *     `POST /api/v1/recipes` would trade a quality improvement for an availability regression.
 *  3. **An UPDATE never re-asks about a judgement already on record.** `replaceForRecipe` rewrites every
 *     ingredient row on every save and both shipped clients send `ingredients` on every save, so the naive
 *     producer re-pays for a whole recipe when a title changes.
 *  4. **⚠️ An UPDATE asks nothing AT ALL today, and the two cases below say why.** An unchanged line is
 *     filtered as already-requested; a CHANGED line loses its transcription to the carry-forward rule and is
 *     no longer verifiable. That is a consequence of `domain/sourceLineCarryForward.ts`, recorded here rather
 *     than discovered later — and it is the right outcome, because verifying our parse of an author's
 *     correction against the source they overrode would manufacture a wrong DISAGREE.
 *
 * The message CONTENT rules are a truth table in `domain/__tests__/verificationRequests.test.ts`; this file
 * is about the orchestration around them — ordering, failure containment, and which lines reach the policy.
 */
import { describe, expect, it, vi } from 'vitest';

import { RecipesService } from '../recipes.service.js';
import { makeFakeVersionsService } from '../__fixtures__/versions.fixture.js';
import { fakePhotosDal, RECIPE_PHOTOS_CDN } from '../__fixtures__/photosDal.fixture.js';
import { fakeRatingsDal } from '../__fixtures__/ratingsDal.fixture.js';
import { fakeVerificationQueue } from '../__fixtures__/verificationQueue.fixture.js';
import type { RecipeAggregate, RecipesDal } from '../dal/recipes.dal.js';
import type { IngredientsDal } from '../../ingredients/dal/ingredients.dal.js';
import { makeRecipeIngredientRow, makeRecipeRow, makeRecipeStepRow } from '../../__fixtures__/index.js';
import { makeIngredient } from '../../ingredients/__fixtures__/ingredients.fixtures.js';
import type { CreateRecipeDto } from '../dto/createRecipe.dto.js';
import type { UpdateRecipeDto } from '../dto/updateRecipe.dto.js';
import type { Principal } from '../../auth/principal.js';

/** A `FoodNutritionGateway` double: this suite is not about nutrition, so it degrades honestly. */
const nutritionGatewayDouble = { lookup: async () => ({ byFoodId: new Map(), degraded: true }) } as never;

const OWNER = '01J000000000000000000FREE0';
const OWNER_PRINCIPAL: Principal = { userId: OWNER, sub: 'user_clerk', scopes: [], permissions: [] };

const RECIPE_ID = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';
const FLOUR_INGREDIENT_ID = '00000000-0000-4000-8000-00000000f10a';
const FLOUR_FOOD_ID = '01JFOOD000000000000000000';
const SOURCE_LINE = '2 cups all-purpose flour, sifted';

/** The catalog row the line resolves to — food-backed, so the gate has an identity to check. */
const FLOUR = makeIngredient({
    id: FLOUR_INGREDIENT_ID,
    name: 'Flour, wheat, all-purpose',
    foodId: FLOUR_FOOD_ID,
    isUserEntered: false,
});

/** The persisted aggregate a save returns. `quantity`/`unit` mirror what the DTO stated. */
function aggregate(overrides: { sourceLine?: string | null; quantity?: string; unit?: string } = {}): RecipeAggregate {
    const recipe = makeRecipeRow({ id: RECIPE_ID, ownerId: OWNER });

    return {
        recipe,
        steps: [makeRecipeStepRow({ recipeId: recipe.id, stepNumber: 1, instruction: 'Mix' })],
        ingredients: [
            makeRecipeIngredientRow({
                recipeId: recipe.id,
                ingredientId: FLOUR_INGREDIENT_ID,
                ingredientName: 'Flour, wheat, all-purpose',
                quantity: overrides.quantity ?? '2',
                unit: overrides.unit ?? 'cup',
                sortOrder: 0,
                sourceLine: overrides.sourceLine === undefined ? SOURCE_LINE : overrides.sourceLine,
            }),
        ],
    };
}

function fakeRecipesDal(overrides: Partial<RecipesDal> = {}): RecipesDal {
    return {
        create: vi.fn().mockResolvedValue(aggregate()),
        findById: vi.fn(),
        findAll: vi.fn(),
        update: vi.fn(),
        softDelete: vi.fn(),
        ...overrides,
    } as unknown as RecipesDal;
}

function fakeIngredientsDal(): IngredientsDal {
    return {
        findById: vi.fn(),
        findByIds: vi.fn().mockResolvedValue([FLOUR]),
    } as unknown as IngredientsDal;
}

function makeService(
    dal: RecipesDal,
    queue: ReturnType<typeof fakeVerificationQueue>,
    ingredientsDal: IngredientsDal = fakeIngredientsDal(),
): RecipesService {
    return new RecipesService(
        dal,
        ingredientsDal,
        makeFakeVersionsService(),
        fakePhotosDal(),
        RECIPE_PHOTOS_CDN,
        fakeRatingsDal(),
        nutritionGatewayDouble,
        queue,
    );
}

/** A create body. `sourceLine: null` means the cook AUTHORED the line — the field is simply not sent. */
const createDto = (sourceLine: string | null = SOURCE_LINE): CreateRecipeDto => ({
    title: 'Bread',
    servings: 2,
    prepTimeMinutes: 5,
    cookTimeMinutes: 10,
    totalTimeMinutes: 15,
    ingredients: [
        {
            ingredientId: FLOUR_INGREDIENT_ID,
            name: 'Flour',
            quantity: { kind: 'exact', value: 2 },
            unit: 'cup',
            ...(sourceLine !== null ? { sourceLine } : {}),
        },
    ],
    steps: [{ instruction: 'Mix' }],
});

describe('RecipesService.create — the verification producer', () => {
    it('enqueues one request for the transcribed, catalog-backed line', async () => {
        const queue = fakeVerificationQueue();
        const service = makeService(fakeRecipesDal(), queue);

        await service.create(OWNER_PRINCIPAL, createDto());

        expect(queue.enqueue).toHaveBeenCalledTimes(1);
        const [messages] = queue.enqueue.mock.calls[0] ?? [];

        expect(messages).toHaveLength(1);
        expect(messages?.[0]).toMatchObject({
            // ⛔ The PERSISTED recipe's id. A producer that ran before the write would have nothing to name.
            recipeId: RECIPE_ID,
            sourceLine: SOURCE_LINE,
            foodId: FLOUR_FOOD_ID,
            candidateFoodName: 'Flour, wheat, all-purpose',
            quantityLow: 2,
            quantityHigh: null,
            unit: 'cup',
        });
    });

    it('enqueues NOTHING when the line was authored rather than transcribed', async () => {
        const queue = fakeVerificationQueue();
        const dal = fakeRecipesDal({ create: vi.fn().mockResolvedValue(aggregate({ sourceLine: null })) });

        await makeService(dal, queue).create(OWNER_PRINCIPAL, createDto(null));

        // ⛔ Not "enqueued an empty batch" — the queue is not called at all. An empty `SendMessage` batch is a
        // round trip that can only fail.
        expect(queue.enqueue).not.toHaveBeenCalled();
    });

    it('⛔ still returns the created recipe when the queue is DOWN', async () => {
        // The gate is a quality enhancement on an ASYNC path, and absence of a verdict means PUBLISH — so a
        // lost message degrades to the behaviour the system had before the gate existed. Letting SQS take
        // down `POST /api/v1/recipes` would trade that improvement for an availability regression.
        const queue = fakeVerificationQueue();
        queue.enqueue.mockRejectedValue(new Error('sqs is unreachable'));
        const service = makeService(fakeRecipesDal(), queue);

        const response = await service.create(OWNER_PRINCIPAL, createDto());

        expect(response.id).toBe(RECIPE_ID);
    });
});

describe('RecipesService.update — the verification producer', () => {
    /** A stored recipe whose single line already carries the source line a request was made for. */
    const stored = (): RecipeAggregate => aggregate();

    const updateDto = (quantity: number): UpdateRecipeDto => ({
        expectedVersion: 1,
        ingredients: [
            {
                ingredientId: FLOUR_INGREDIENT_ID,
                name: 'Flour',
                quantity: { kind: 'exact', value: quantity },
                unit: 'cup',
            },
        ],
    });

    it('⛔ asks NOTHING when the author OVERRODE our parse — the transcription went stale with it', async () => {
        // ⚠️ NOT the obvious expectation, and the reason is `domain/sourceLineCarryForward.ts`: a line's raw
        // source line is carried across an update only while `[ingredientId, quantity, unit]` is unchanged,
        // and is DROPPED when it moves. So an author editing `2 cups` to `3 cups` leaves a line with no
        // source text, and `decideVerification` reads that as `skip: 'no-source-text'`.
        //
        // That is the correct outcome rather than a gap: carrying the transcription would have the gate check
        // our parse of `3 cups` against a source that said `2 cups`, and correctly DISAGREE with an edit the
        // author made on purpose — manufacturing the wrong-disagree outcome U11 names as the unacceptable
        // direction, on the one line a human has just told us we got wrong.
        const queue = fakeVerificationQueue();
        const dal = fakeRecipesDal({
            findById: vi.fn().mockResolvedValue(stored()),
            update: vi.fn().mockResolvedValue(aggregate({ quantity: '3' })),
        });

        await makeService(dal, queue).update(OWNER_PRINCIPAL, RECIPE_ID, updateDto(3));

        expect(queue.enqueue).not.toHaveBeenCalled();
    });

    it('⛔ asks NOTHING when the lines are unchanged — a title edit must not re-pay for the recipe', async () => {
        // `RecipeIngredientsDal.replaceForRecipe` deletes and re-inserts EVERY line on EVERY save, and both
        // shipped clients send `ingredients` on every save. Without the already-requested filter this is the
        // dominant call volume in the system, and every call of it is money for a verdict already on record.
        const queue = fakeVerificationQueue();
        const dal = fakeRecipesDal({
            findById: vi.fn().mockResolvedValue(stored()),
            update: vi.fn().mockResolvedValue(aggregate()),
        });

        await makeService(dal, queue).update(OWNER_PRINCIPAL, RECIPE_ID, updateDto(2));

        expect(queue.enqueue).not.toHaveBeenCalled();
    });

    it('asks nothing for a patch that carries no ingredients at all', async () => {
        const queue = fakeVerificationQueue();
        const dal = fakeRecipesDal({
            findById: vi.fn().mockResolvedValue(stored()),
            update: vi.fn().mockResolvedValue(aggregate()),
        });

        await makeService(dal, queue).update(OWNER_PRINCIPAL, RECIPE_ID, { expectedVersion: 1, title: 'Better bread' });

        expect(queue.enqueue).not.toHaveBeenCalled();
    });

    it('⛔ still returns the updated recipe when the queue is DOWN', async () => {
        // The containment property, asserted on this path too. It cannot currently be reached through a
        // send — see the two cases above, which together mean an UPDATE asks nothing today — so what this
        // pins is that the seam stays wired and non-throwing if that ever changes (U14 gives the correction
        // surface a reason to re-ask).
        const queue = fakeVerificationQueue();
        queue.enqueue.mockRejectedValue(new Error('sqs is unreachable'));
        const dal = fakeRecipesDal({
            findById: vi.fn().mockResolvedValue(stored()),
            update: vi.fn().mockResolvedValue(aggregate({ quantity: '3' })),
        });

        const response = await makeService(dal, queue).update(OWNER_PRINCIPAL, RECIPE_ID, updateDto(3));

        expect(response.id).toBe(RECIPE_ID);
    });
});
