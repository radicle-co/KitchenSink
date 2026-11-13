/**
 * Test fixture: a fake `RecipesDal` for constructing `RecipesService` in unit tests.
 *
 * Five suites each carried their own near-identical copy of this stub. That was tolerable while the DAL
 * was a bag of independent methods, and stopped being so when a recipe write and its version row became
 * one Unit of Work (owner ruling 2026-09-06): every one of those copies then needed the same new
 * `transaction` member, and a copy that lacked it failed with `dal.transaction is not a function` rather
 * than with anything about the behaviour under test.
 *
 * ⛔ `transaction` RUNS ITS CALLBACK, with the fake itself standing in for the handle. A stub that merely
 * recorded the call would swallow every write inside the boundary, so `create`/`update` would appear never
 * to be called and the suites would pass while asserting nothing. The real `db.transaction` invokes its
 * callback; so does this — the same choice `makeFakeDrizzle` documents for the layer below.
 */
import { vi } from 'vitest';

import type { LockedRecipeFacts, RecipeAggregate, RecipesDal } from '../dal/recipes.dal.js';
import type { RecipeTx } from '../../database/unitOfWork.js';

/**
 * A `RecipesDal` stub whose `transaction` executes its callback immediately.
 *
 * @param overrides - Members to replace, e.g. `{ create: vi.fn().mockResolvedValue(aggregate) }`.
 * @returns The stub, cast to the DAL type.
 */
export function fakeRecipesDal(overrides: Partial<RecipesDal> = {}): RecipesDal {
    const findById = overrides.findById ?? vi.fn();
    const dal = {
        create: vi.fn(),
        findById,
        findRowById: vi.fn(),
        findAll: vi.fn(),
        update: vi.fn(),
        softDelete: vi.fn(),
        readConflict: vi.fn(),
        // ADR-0073: a cook with no private recipes by default. A suite about slots overrides these with the count it needs.
        lockAndCountPrivateSlots: vi.fn(async () => 0),
        countPrivateSlots: vi.fn(async () => 0),
        // The row lock reads the row `findById` holds, so a suite sees the same recipe before and under the lock unless it
        // overrides this to stage a race. With no row staged: a public, cook-written DRAFT (publishing one is never counted).
        lockSlotFacts: vi.fn(async (_tx: RecipeTx, id: string): Promise<LockedRecipeFacts> => {
            const found: RecipeAggregate | undefined = await findById(id);

            return found === undefined
                ? { visibility: 'public', status: 'draft', sourceType: 'user_created', sourceKind: null }
                : {
                      visibility: found.recipe.visibility,
                      status: found.recipe.status,
                      sourceType: found.recipe.sourceType,
                      sourceKind: found.recipe.sourceKind,
                  };
        }),
        // ADR-0029 section 4: no captured owners to clear and no private lines by default.
        clearPublicFoodOwners: vi.fn(async () => undefined),
        privateFoodLines: vi.fn(async () => []),
        setVisibility: vi.fn(),
        transaction: vi.fn(async (fn: (tx: RecipeTx) => Promise<unknown>) => fn(FAKE_TX)),
        ...overrides,
    };

    return dal as unknown as RecipesDal;
}

/**
 * The stand-in transaction handle the fake hands its callback.
 *
 * Identity matters: a suite asserting that the version write joined the recipe write's transaction
 * compares the handle `versions.createSnapshot` received against THIS object, so a service that passed
 * something else — the base client, say — fails rather than merely looking plausible.
 */
export const FAKE_TX = { __fakeTx: true } as unknown as RecipeTx;
