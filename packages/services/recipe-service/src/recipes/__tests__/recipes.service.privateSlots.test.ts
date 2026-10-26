/**
 * ADR-0073 - the free-tier private slots, as `RecipesService` enforces them on create, set-visibility and clone.
 *
 * Written BEFORE the service change (test-first). It pins what a fake DAL CAN pin: that the per-user lock + count is the
 * first statement of the write's transaction, that the decision is made from the number it returns, that the refusal is
 * the distinct 403 carrying `used` and `limit`, and which requests skip the count. That the lock really excludes a second
 * connection is `tests/e2e/recipes/privateSlots.e2e.test.ts`, against a real database.
 */
import { describe, expect, it, vi } from 'vitest';

import { RecipeErrorCode, RecipeVisibility } from '@kitchensink/recipe-core';

import type { Principal } from '../../auth/principal.js';
import { makeRecipeRow, makeRecipeStepRow } from '../../__fixtures__/index.js';
import { CURATOR_IMPORT_SCOPE } from '../recipes.schema.js';
import type { RecipeAggregate, RecipesDal } from '../dal/recipes.dal.js';
import type { CreateRecipeDto } from '../dto/createRecipe.dto.js';
import { fakeRecipesDal, FAKE_TX } from '../__fixtures__/recipesDal.fixture.js';
import { makeRecipesService } from '../__fixtures__/recipesService.fixture.js';
import { isRecipeDomainError, type RecipeDomainError } from '../recipe.error.js';

const OWNER = '01J000000000000000000FREE0';
const LINE_LOOKUP_ID = '00000000-0000-4000-8000-0000000000ff';

const nutritionGatewayDouble = {
    lookup: async (_caller: unknown, ids: readonly string[]) => ({ byFoodId: new Map(), unansweredIds: new Set(ids) }),
} as never;

function principal(overrides: Partial<Principal> = {}): Principal {
    return {
        userId: OWNER,
        sub: 'user_clerk_free',
        scopes: [],
        permissions: [],
        roles: [],
        principalKind: 'real',
        containment: 'enforce',
        ...overrides,
    };
}

const premium = (): Principal => principal({ roles: ['premium'] });

const CREATE_DTO: CreateRecipeDto = {
    title: 'Soup',
    cuisine: 'Thai',
    servings: 2,
    prepTimeMinutes: 5,
    cookTimeMinutes: 10,
    totalTimeMinutes: 15,
    ingredients: [{ ingredientId: LINE_LOOKUP_ID, quantity: { kind: 'exact', value: 1 } }],
    steps: [{ instruction: 'Mix' }],
};

function aggregate(overrides: Partial<Parameters<typeof makeRecipeRow>[0]> = {}): RecipeAggregate {
    const recipe = makeRecipeRow({ id: 'r-1', ownerId: OWNER, ...overrides });

    return {
        recipe,
        steps: [makeRecipeStepRow({ recipeId: recipe.id, stepNumber: 1, instruction: 'Mix' })],
        ingredients: [],
    };
}

function serviceOver(dal: RecipesDal) {
    return makeRecipesService({ dal, foodNutrition: nutritionGatewayDouble });
}

async function refusalOf(promise: Promise<unknown>): Promise<RecipeDomainError> {
    try {
        await promise;
    } catch (error) {
        if (isRecipeDomainError(error)) {
            return error;
        }

        throw error;
    }

    throw new Error('Expected a refusal, but the call resolved.');
}

/** A DAL whose live private count is `used`. */
function dalHolding(used: number, overrides: Partial<RecipesDal> = {}) {
    const lockAndCountPrivateSlots = vi.fn(async () => used);
    const create = vi.fn().mockResolvedValue(aggregate({ visibility: 'private' }));
    const dal = fakeRecipesDal({ lockAndCountPrivateSlots, create, ...overrides });

    return { dal, lockAndCountPrivateSlots, create };
}

describe('RecipesService.create - private slots (ADR-0073)', () => {
    it.each([0, 48, 49])('lets a free cook holding %i private recipes create one more private', async (used) => {
        const { dal, create } = dalHolding(used);

        const response = await serviceOver(dal).create(
            principal(),
            { ...CREATE_DTO, visibility: 'private' },
            undefined,
        );

        expect(create).toHaveBeenCalledWith(expect.objectContaining({ visibility: 'private' }), FAKE_TX);
        expect(response.visibility).toBe('private');
    });

    it.each([50, 51, 60])(
        'refuses a free cook holding %i with 403 PRIVATE_SLOTS_FULL carrying used and limit, writing nothing',
        async (used) => {
            const { dal, create } = dalHolding(used);

            const error = await refusalOf(
                serviceOver(dal).create(principal(), { ...CREATE_DTO, visibility: 'private' }, undefined),
            );

            expect(error.code).toBe(RecipeErrorCode.PRIVATE_SLOTS_FULL);
            expect(error.details).toEqual({ used, limit: 50 });
            expect(create).not.toHaveBeenCalled();
        },
    );

    it('takes the lock and counts for THIS cook, in the write transaction, BEFORE the row is written', async () => {
        const { dal, lockAndCountPrivateSlots, create } = dalHolding(0);

        await serviceOver(dal).create(principal(), { ...CREATE_DTO, visibility: 'private' }, undefined);

        expect(lockAndCountPrivateSlots).toHaveBeenCalledWith(FAKE_TX, OWNER);
        expect(lockAndCountPrivateSlots.mock.invocationCallOrder[0]).toBeLessThan(
            create.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
        );
    });

    it('decides from the count read UNDER the lock: an answer that changes between two creates changes the verdict', async () => {
        const lockAndCountPrivateSlots = vi.fn().mockResolvedValueOnce(49).mockResolvedValueOnce(50);
        const create = vi.fn().mockResolvedValue(aggregate({ visibility: 'private' }));
        const service = serviceOver(fakeRecipesDal({ lockAndCountPrivateSlots, create }));
        const dto = { ...CREATE_DTO, visibility: 'private' } as const;

        await expect(service.create(principal(), dto, undefined)).resolves.toBeDefined();
        const second = await refusalOf(service.create(principal(), dto, undefined));

        expect(second.code).toBe(RecipeErrorCode.PRIVATE_SLOTS_FULL);
        expect(create).toHaveBeenCalledTimes(1);
    });

    it('never counts for Premium: no lock, no count, however many they hold', async () => {
        const { dal, lockAndCountPrivateSlots, create } = dalHolding(5_000);

        await serviceOver(dal).create(premium(), { ...CREATE_DTO, visibility: 'private' }, undefined);

        expect(lockAndCountPrivateSlots).not.toHaveBeenCalled();
        expect(create).toHaveBeenCalledOnce();
    });

    it('never counts for a PUBLIC create: making a recipe public takes no slot', async () => {
        const { dal, lockAndCountPrivateSlots, create } = dalHolding(60);
        create.mockResolvedValue(aggregate({ visibility: 'public' }));

        await serviceOver(dal).create(principal(), { ...CREATE_DTO, visibility: 'public' }, undefined);

        expect(lockAndCountPrivateSlots).not.toHaveBeenCalled();
    });

    it('treats an OMITTED visibility as the public request it defaults to: no count', async () => {
        const { dal, lockAndCountPrivateSlots, create } = dalHolding(60);
        create.mockResolvedValue(aggregate({ visibility: 'public' }));

        await serviceOver(dal).create(principal(), CREATE_DTO, undefined);

        expect(lockAndCountPrivateSlots).not.toHaveBeenCalled();
    });

    it('does not mistake a premium SCOPE or PERMISSION for Premium: a full cook is still refused', async () => {
        const { dal, create } = dalHolding(50);

        const error = await refusalOf(
            serviceOver(dal).create(
                principal({ scopes: ['premium'], permissions: ['premium'] }),
                { ...CREATE_DTO, visibility: 'private' },
                undefined,
            ),
        );

        expect(error.code).toBe(RecipeErrorCode.PRIVATE_SLOTS_FULL);
        expect(create).not.toHaveBeenCalled();
    });

    it('imported_public chosen private by a free cook stays INVALID_VISIBILITY (Premium + edit), whatever the count; no count is taken', async () => {
        const { dal, lockAndCountPrivateSlots, create } = dalHolding(0);

        const error = await refusalOf(
            serviceOver(dal).create(
                principal({ scopes: [CURATOR_IMPORT_SCOPE] }),
                {
                    ...CREATE_DTO,
                    visibility: 'private',
                    source: { sourceType: 'imported_public', sourceUrl: 'https://example.com/r' },
                } as CreateRecipeDto,
                undefined,
            ),
        );

        expect(error.code).toBe(RecipeErrorCode.INVALID_VISIBILITY);
        expect(lockAndCountPrivateSlots).not.toHaveBeenCalled();
        expect(create).not.toHaveBeenCalled();
    });

    it('a contained test principal on a free plan is held to the same count for a private create', async () => {
        const { dal } = dalHolding(50);

        const error = await refusalOf(
            serviceOver(dal).create(
                principal({ principalKind: 'test', containment: 'enforce' }),
                { ...CREATE_DTO, visibility: 'private' },
                undefined,
            ),
        );

        expect(error.code).toBe(RecipeErrorCode.PRIVATE_SLOTS_FULL);
    });
});

describe('RecipesService.setVisibility - private slots (ADR-0073)', () => {
    function holding(used: number, currentVisibility: 'public' | 'private', sourceType = 'user_created') {
        const found = aggregate({ visibility: currentVisibility, sourceType });
        const setVisibility = vi.fn().mockResolvedValue(aggregate({ visibility: 'private', sourceType }));
        const lockAndCountPrivateSlots = vi.fn(async () => used);
        const lockVisibility = vi.fn(async () => currentVisibility as RecipeVisibility);
        const dal = fakeRecipesDal({
            findById: vi.fn().mockResolvedValue(found),
            setVisibility,
            lockAndCountPrivateSlots,
            lockVisibility,
        });

        return { dal, setVisibility, lockAndCountPrivateSlots, lockVisibility };
    }

    it('lets a free cook holding 49 make a public recipe private, writing in the SAME transaction', async () => {
        const { dal, setVisibility } = holding(49, 'public');

        const response = await serviceOver(dal).setVisibility(principal(), 'r-1', RecipeVisibility.PRIVATE, undefined);

        expect(setVisibility).toHaveBeenCalledWith('r-1', 'private', FAKE_TX);
        expect(response.visibility).toBe('private');
    });

    it('refuses a free cook holding 50 with PRIVATE_SLOTS_FULL (used 50, limit 50), writing nothing', async () => {
        const { dal, setVisibility } = holding(50, 'public');

        const error = await refusalOf(
            serviceOver(dal).setVisibility(principal(), 'r-1', RecipeVisibility.PRIVATE, undefined),
        );

        expect(error.code).toBe(RecipeErrorCode.PRIVATE_SLOTS_FULL);
        expect(error.details).toEqual({ used: 50, limit: 50 });
        expect(setVisibility).not.toHaveBeenCalled();
    });

    it('DOWNGRADE: a cook holding 60 is refused a new private recipe, and the refusal says 60', async () => {
        const { dal } = holding(60, 'public');

        const error = await refusalOf(
            serviceOver(dal).setVisibility(principal(), 'r-1', RecipeVisibility.PRIVATE, undefined),
        );

        expect(error.details).toEqual({ used: 60, limit: 50 });
    });

    it('DOWNGRADE: asking for private on a recipe that is ALREADY private is a no-op, not a refusal, at 60', async () => {
        const { dal, setVisibility } = holding(60, 'private');

        const response = await serviceOver(dal).setVisibility(principal(), 'r-1', RecipeVisibility.PRIVATE, undefined);

        expect(response.visibility).toBe('private');
        expect(setVisibility).toHaveBeenCalledOnce();
    });

    it('decides "already private" from the row read UNDER the lock, not the read before the transaction', async () => {
        // The pre-transaction read says public; by the time the lock is held another request has made it private.
        const { dal, lockVisibility } = holding(60, 'private');
        (dal.findById as ReturnType<typeof vi.fn>).mockResolvedValue(aggregate({ visibility: 'public' }));

        await expect(
            serviceOver(dal).setVisibility(principal(), 'r-1', RecipeVisibility.PRIVATE, undefined),
        ).resolves.toBeDefined();
        expect(lockVisibility).toHaveBeenCalledWith(FAKE_TX, 'r-1');
    });

    it('answers 404 when the row vanished under the lock (a concurrent tombstone)', async () => {
        const { dal } = holding(0, 'public');
        (dal.lockVisibility as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

        const error = await refusalOf(
            serviceOver(dal).setVisibility(principal(), 'r-1', RecipeVisibility.PRIVATE, undefined),
        );

        expect(error.code).toBe(RecipeErrorCode.RECIPE_NOT_FOUND);
    });

    it('imported_physical and imported_paid use a slot too: refused at 50, allowed at 49, no Premium needed', async () => {
        for (const sourceType of ['imported_physical', 'imported_paid']) {
            const allowed = holding(49, 'public', sourceType);
            const refused = holding(50, 'public', sourceType);

            await expect(
                serviceOver(allowed.dal).setVisibility(principal(), 'r-1', RecipeVisibility.PRIVATE, undefined),
            ).resolves.toBeDefined();
            const error = await refusalOf(
                serviceOver(refused.dal).setVisibility(principal(), 'r-1', RecipeVisibility.PRIVATE, undefined),
            );
            expect(error.code).toBe(RecipeErrorCode.PRIVATE_SLOTS_FULL);
        }
    });

    it('PUBLIC takes no lock and no count (it frees a slot), whatever the cook holds', async () => {
        const { dal, lockAndCountPrivateSlots, setVisibility } = holding(60, 'private');
        setVisibility.mockResolvedValue(aggregate({ visibility: 'public' }));

        await serviceOver(dal).setVisibility(principal(), 'r-1', RecipeVisibility.PUBLIC, undefined);

        expect(lockAndCountPrivateSlots).not.toHaveBeenCalled();
    });

    it('Premium takes no lock and no count', async () => {
        const { dal, lockAndCountPrivateSlots } = holding(5_000, 'public');

        await serviceOver(dal).setVisibility(premium(), 'r-1', RecipeVisibility.PRIVATE, undefined);

        expect(lockAndCountPrivateSlots).not.toHaveBeenCalled();
    });

    it('an imported_public recipe is refused for want of Premium, never for want of a slot', async () => {
        const { dal, lockAndCountPrivateSlots } = holding(0, 'public', 'imported_public');

        const error = await refusalOf(
            serviceOver(dal).setVisibility(principal(), 'r-1', RecipeVisibility.PRIVATE, undefined),
        );

        expect(error.code).toBe(RecipeErrorCode.INVALID_VISIBILITY);
        expect(lockAndCountPrivateSlots).not.toHaveBeenCalled();
    });
});

describe('RecipesService.clone - a clone that lands private is a move to private (ADR-0073 section 6)', () => {
    function sourceOf(overrides: Partial<Parameters<typeof makeRecipeRow>[0]>): RecipeAggregate {
        return {
            recipe: makeRecipeRow({ id: 'src', ownerId: OWNER, ...overrides }),
            steps: [],
            ingredients: [],
        };
    }

    it('REFUSES a free cook out of slots cloning a book recipe, instead of slipping a private row past the check', async () => {
        const create = vi.fn();
        const dal = fakeRecipesDal({
            findById: vi.fn().mockResolvedValue(sourceOf({ visibility: 'private', sourceType: 'imported_physical' })),
            lockAndCountPrivateSlots: vi.fn(async () => 50),
            create,
        });

        const error = await refusalOf(serviceOver(dal).clone(principal(), 'src', undefined));

        expect(error.code).toBe(RecipeErrorCode.PRIVATE_SLOTS_FULL);
        expect(create).not.toHaveBeenCalled();
    });

    it('lets a free cook with a free slot clone a book recipe, counting under the lock first', async () => {
        const lockAndCountPrivateSlots = vi.fn(async () => 10);
        const create = vi.fn().mockResolvedValue(aggregate({ visibility: 'private', sourceType: 'imported_paid' }));
        const dal = fakeRecipesDal({
            findById: vi.fn().mockResolvedValue(sourceOf({ visibility: 'private', sourceType: 'imported_paid' })),
            lockAndCountPrivateSlots,
            create,
        });

        await serviceOver(dal).clone(principal(), 'src', undefined);

        expect(lockAndCountPrivateSlots).toHaveBeenCalledWith(FAKE_TX, OWNER);
        expect(lockAndCountPrivateSlots.mock.invocationCallOrder[0]).toBeLessThan(
            create.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
        );
        expect(create).toHaveBeenCalledWith(expect.objectContaining({ visibility: 'private' }), FAKE_TX);
    });

    it('FR-005c: an owner cloning their OWN private user_created recipe gets a private copy, counted', async () => {
        const create = vi.fn().mockResolvedValue(aggregate({ visibility: 'private' }));
        const lockAndCountPrivateSlots = vi.fn(async () => 3);
        const dal = fakeRecipesDal({
            findById: vi.fn().mockResolvedValue(sourceOf({ visibility: 'private', sourceType: 'user_created' })),
            lockAndCountPrivateSlots,
            create,
        });

        await serviceOver(dal).clone(principal(), 'src', undefined);

        expect(create).toHaveBeenCalledWith(expect.objectContaining({ visibility: 'private' }), FAKE_TX);
        expect(lockAndCountPrivateSlots).toHaveBeenCalledOnce();
    });

    it('a PUBLIC clone takes no slot and no lock', async () => {
        const lockAndCountPrivateSlots = vi.fn(async () => 60);
        const create = vi.fn().mockResolvedValue(aggregate({ visibility: 'public' }));
        const dal = fakeRecipesDal({
            findById: vi
                .fn()
                .mockResolvedValue(
                    sourceOf({ ownerId: 'someone-else', visibility: 'public', sourceType: 'user_created' }),
                ),
            lockAndCountPrivateSlots,
            create,
        });

        await serviceOver(dal).clone(principal(), 'src', undefined);

        expect(lockAndCountPrivateSlots).not.toHaveBeenCalled();
    });

    it('Premium clones a book recipe with no count', async () => {
        const lockAndCountPrivateSlots = vi.fn(async () => 60);
        const create = vi.fn().mockResolvedValue(aggregate({ visibility: 'private' }));
        const dal = fakeRecipesDal({
            findById: vi.fn().mockResolvedValue(sourceOf({ visibility: 'private', sourceType: 'imported_physical' })),
            lockAndCountPrivateSlots,
            create,
        });

        await serviceOver(dal).clone(premium(), 'src', undefined);

        expect(lockAndCountPrivateSlots).not.toHaveBeenCalled();
        expect(create).toHaveBeenCalledOnce();
    });

    it('a contained test principal (default private) on a free plan with no slot cannot clone at all', async () => {
        const create = vi.fn();
        const dal = fakeRecipesDal({
            findById: vi.fn().mockResolvedValue(sourceOf({ visibility: 'private', sourceType: 'user_created' })),
            lockAndCountPrivateSlots: vi.fn(async () => 50),
            create,
        });

        const error = await refusalOf(
            serviceOver(dal).clone(principal({ principalKind: 'test', containment: 'enforce' }), 'src', undefined),
        );

        expect(error.code).toBe(RecipeErrorCode.PRIVATE_SLOTS_FULL);
        expect(create).not.toHaveBeenCalled();
    });
});

describe('RecipesService.getPrivateSlotUsage - the read the editor shows (ADR-0073)', () => {
    it('reports a free cook as limited, with the live count and the server-stated limit', async () => {
        const countPrivateSlots = vi.fn(async () => 12);
        const service = serviceOver(fakeRecipesDal({ countPrivateSlots }));

        await expect(service.getPrivateSlotUsage(principal())).resolves.toEqual({
            kind: 'limited',
            used: 12,
            limit: 50,
        });
        expect(countPrivateSlots).toHaveBeenCalledWith(OWNER);
    });

    it('reports a downgraded cook as over the limit, truthfully (used 60 of 50)', async () => {
        const service = serviceOver(fakeRecipesDal({ countPrivateSlots: vi.fn(async () => 60) }));

        await expect(service.getPrivateSlotUsage(principal())).resolves.toEqual({
            kind: 'limited',
            used: 60,
            limit: 50,
        });
    });

    it('reports Premium as unlimited and never counts', async () => {
        const countPrivateSlots = vi.fn(async () => 5_000);
        const service = serviceOver(fakeRecipesDal({ countPrivateSlots }));

        await expect(service.getPrivateSlotUsage(premium())).resolves.toEqual({ kind: 'unlimited' });
        expect(countPrivateSlots).not.toHaveBeenCalled();
    });

    it('takes NO lock: a display read must not serialise the cook', async () => {
        const lockAndCountPrivateSlots = vi.fn(async () => 1);
        const service = serviceOver(fakeRecipesDal({ lockAndCountPrivateSlots }));

        await service.getPrivateSlotUsage(principal());

        expect(lockAndCountPrivateSlots).not.toHaveBeenCalled();
    });
});
