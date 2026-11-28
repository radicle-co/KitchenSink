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

import type { ReadableRecipeAggregate, RecipeAggregate, RecipesDal } from '../dal/recipes.dal.js';
import type { ReadableRecipeRow } from '../dal/recipePredicates.js';
import type { RecipeRow } from '../../database/schema/index.js';
import type { RecipeTx } from '../../database/unitOfWork.js';
import { makeRecipeRow } from '../../__fixtures__/index.js';
import { lockedFactsOf } from './lockedRecipeFacts.fixture.js';

/** True when `T` is `any`: the one type `0 extends 1 & T` accepts. */
type IsAny<T> = 0 extends 1 & T ? true : false;

/**
 * What a double may hold for each member it names: the member itself when it is a function that does not answer `any`,
 * else `never` (a compile error to pass). A name that is not a public member of `RecipesDal`, a non-function, and a
 * function answering `any` (a bare `vi.fn()`, `vi.fn().mockResolvedValue(...)`, `() => any`) are all `never`: `any` is
 * assignable to every member, so it would hide a wrong answer, which is the drift this type exists to stop.
 *
 * Used as the F-bound of `recipesDalDouble`'s `M`, so a member's own parameters are still typed from `RecipesDal`.
 *
 * @typeParam M - The members the caller passes, inferred from the argument.
 */
export type RecipesDalMembers<M> = {
    [K in keyof M]: K extends keyof RecipesDal
        ? IsAny<M[K]> extends true
            ? never
            : M[K] extends (...args: never[]) => infer R
              ? IsAny<R> extends true
                  ? never
                  : IsAny<Awaited<R>> extends true
                    ? never
                    : M[K]
              : never
        : never;
};

/**
 * A `RecipesDal` stub whose `transaction` executes its callback immediately.
 *
 * @param overrides - Members to replace, e.g. `{ create: vi.fn<RecipesDal['create']>().mockResolvedValue(aggregate) }`.
 * @returns The stub, cast to the DAL type.
 */
export function fakeRecipesDal(overrides: Partial<RecipesDal> = {}): RecipesDal {
    const findById: RecipesDal['findById'] = overrides.findById ?? vi.fn<RecipesDal['findById']>();
    const dal = {
        create: vi.fn<RecipesDal['create']>(),
        findById,
        findRowById: vi.fn<RecipesDal['findRowById']>(),
        findAll: vi.fn<RecipesDal['findAll']>(),
        update: vi.fn<RecipesDal['update']>(),
        softDelete: vi.fn<RecipesDal['softDelete']>(),
        readConflict: vi.fn<RecipesDal['readConflict']>(),
        // ADR-0073: a cook with no private recipes by default. A suite about slots overrides these with the count it
        // needs.
        lockAndCountPrivateSlots: vi.fn<RecipesDal['lockAndCountPrivateSlots']>(() => Promise.resolve(0)),
        countPrivateSlots: vi.fn<RecipesDal['countPrivateSlots']>(() => Promise.resolve(0)),
        // The row lock reads the row `findById` holds, so a suite sees the same recipe before and under the lock unless
        // it overrides this to stage a race. With no row staged: a public, cook-written DRAFT (publishing one is never
        // counted).
        lockSlotFacts: vi.fn<RecipesDal['lockSlotFacts']>(async (_tx, id) => {
            const found: RecipeAggregate | undefined = await findById(id);

            return lockedFactsOf(found?.recipe ?? makeRecipeRow({ visibility: 'public', status: 'draft' }));
        }),
        // ADR-0029 section 4: no captured owners to clear and no private lines by default.
        clearPublicFoodOwners: vi.fn<RecipesDal['clearPublicFoodOwners']>(() => Promise.resolve(undefined)),
        privateFoodLines: vi.fn<RecipesDal['privateFoodLines']>(() => Promise.resolve([])),
        setVisibility: vi.fn<RecipesDal['setVisibility']>(),
    } satisfies Partial<RecipesDal>;

    // Outside the `satisfies`: `vi.fn` erases a generic signature, so `transaction<T>` cannot be typed through it.
    const transaction = vi.fn(async (fn: (tx: RecipeTx) => Promise<unknown>) => fn(FAKE_TX));

    // `RecipesDal` is a class with private members, so it is nominal and no object literal is assignable to it. The
    // `satisfies` above checks every member the fake sets against the DAL's own type, so a mistyped one is still a
    // compile error; this is the one cast.
    return { ...dal, transaction, ...overrides } as unknown as RecipesDal;
}

/**
 * The stand-in transaction handle the fake hands its callback.
 *
 * Identity matters: a suite asserting that the version write joined the recipe write's transaction
 * compares the handle `versions.createSnapshot` received against THIS object, so a service that passed
 * something else — the base client, say — fails rather than merely looking plausible.
 */
export const FAKE_TX = { __fakeTx: true } as unknown as RecipeTx;

/**
 * A stored row as the read rule's select returns it: the row plus its `heldFromReaders` flag (`false`: not held).
 * `RecipesDal.findRowById` and `findById` answer this shape, so a double that answers a bare `RecipeRow` is wrong.
 *
 * @param row - The stored recipe row.
 * @param heldFromReaders - Whether a hold keeps it from readers.
 * @returns The row as a reader loads it.
 */
export function readableRowOf(row: RecipeRow, heldFromReaders = false): ReadableRecipeRow {
    return { ...row, heldFromReaders };
}

/**
 * A stored aggregate as `RecipesDal.findById` returns it (see {@link readableRowOf}).
 *
 * @param aggregate - The stored aggregate.
 * @param heldFromReaders - Whether a hold keeps it from readers.
 * @returns The aggregate as a reader loads it.
 */
export function readableAggregateOf(aggregate: RecipeAggregate, heldFromReaders = false): ReadableRecipeAggregate {
    return { ...aggregate, recipe: readableRowOf(aggregate.recipe, heldFromReaders) };
}
