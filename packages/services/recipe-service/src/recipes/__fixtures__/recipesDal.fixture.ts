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

import type { RecipesDal } from '../dal/recipes.dal.js';
import type { RecipeTx } from '../../database/unitOfWork.js';

/**
 * A `RecipesDal` stub whose `transaction` executes its callback immediately.
 *
 * @param overrides - Members to replace, e.g. `{ create: vi.fn().mockResolvedValue(aggregate) }`.
 * @returns The stub, cast to the DAL type.
 */
export function fakeRecipesDal(overrides: Partial<RecipesDal> = {}): RecipesDal {
    const dal = {
        create: vi.fn(),
        findById: vi.fn(),
        findAll: vi.fn(),
        update: vi.fn(),
        softDelete: vi.fn(),
        readConflict: vi.fn(),
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
