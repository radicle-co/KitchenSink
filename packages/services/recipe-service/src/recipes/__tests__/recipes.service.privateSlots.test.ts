/**
 * ADR-0073 - the free-tier private slots, as `RecipesService` enforces them on create, update (publish), set-visibility
 * and clone.
 *
 * REWRITTEN for the owner ruling of 2026-10-26 (ADR-0073 section 12, spec 001 FR-003b): a draft holds NO slot. A slot is a
 * private recipe that is PUBLISHED and not deleted, so the check runs when a recipe comes to hold one - a private recipe
 * created published, a published recipe made private, a private draft published - and saving a private DRAFT never checks.
 * The old suite refused a private draft at 50, counted a clone, and had no update (publish) path at all; each of those
 * assertions is replaced below, not edited to pass.
 *
 * Written BEFORE the service change (test-first). It pins what a fake DAL CAN pin: that the per-user lock + count is the
 * first statement of the write's transaction, that the decision is made from the number it returns, that the refusal is
 * the distinct 403 carrying `used` and `limit`, and which requests skip the count. That the lock really excludes a second
 * connection is `tests/e2e/recipes/privateSlots.e2e.test.ts`, against a real database.
 */
import { describe, expect, it, vi } from 'vitest';

import { RecipeErrorCode, RecipeVisibility } from '@kitchensink/recipe-core';

import type { Principal } from '../../auth/principal.js';
import { makeIngredientLineRow, makeRecipeRow, makeRecipeStepRow } from '../../__fixtures__/index.js';
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
    const recipe = makeRecipeRow({ id: 'r-1', ownerId: OWNER, cuisine: 'Thai', ...overrides });

    return {
        recipe,
        steps: [makeRecipeStepRow({ recipeId: recipe.id, stepNumber: 1, instruction: 'Mix' })],
        // One line and a cuisine, so a patch that only says `status: 'published'` meets the publish requirements and the
        // refusal under test is the SLOT refusal, not PUBLISH_REQUIREMENTS_UNMET.
        ingredients: [makeIngredientLineRow({ recipeId: recipe.id })],
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

    it.each([50, 51, 60])(
        'a private DRAFT is saved at %i: a draft holds no slot, so there is no lock, no count and no refusal',
        async (used) => {
            const { dal, lockAndCountPrivateSlots, create } = dalHolding(used);
            create.mockResolvedValue(aggregate({ visibility: 'private', status: 'draft' }));

            const response = await serviceOver(dal).create(
                principal(),
                { ...CREATE_DTO, visibility: 'private', status: 'draft' },
                undefined,
            );

            expect(lockAndCountPrivateSlots).not.toHaveBeenCalled();
            expect(create).toHaveBeenCalledWith(
                expect.objectContaining({ visibility: 'private', status: 'draft' }),
                FAKE_TX,
            );
            expect(response.status).toBe('draft');
        },
    );

    it('a private recipe created with an EXPLICIT published status is counted like an omitted one', async () => {
        const { dal, create } = dalHolding(50);

        const error = await refusalOf(
            serviceOver(dal).create(
                principal(),
                { ...CREATE_DTO, visibility: 'private', status: 'published' },
                undefined,
            ),
        );

        expect(error.code).toBe(RecipeErrorCode.PRIVATE_SLOTS_FULL);
        expect(create).not.toHaveBeenCalled();
    });

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
    function holding(
        used: number,
        currentVisibility: 'public' | 'private',
        sourceType = 'user_created',
        status: 'draft' | 'published' = 'published',
    ) {
        const found = aggregate({ visibility: currentVisibility, sourceType, status });
        const setVisibility = vi.fn().mockResolvedValue(aggregate({ visibility: 'private', sourceType }));
        const lockAndCountPrivateSlots = vi.fn(async () => used);
        const lockSlotFacts = vi.fn(async () => ({ visibility: currentVisibility as RecipeVisibility, status }));
        const dal = fakeRecipesDal({
            findById: vi.fn().mockResolvedValue(found),
            setVisibility,
            lockAndCountPrivateSlots,
            lockSlotFacts,
        });

        return { dal, setVisibility, lockAndCountPrivateSlots, lockSlotFacts };
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
        const { dal, lockSlotFacts } = holding(60, 'private');
        (dal.findById as ReturnType<typeof vi.fn>).mockResolvedValue(aggregate({ visibility: 'public' }));

        await expect(
            serviceOver(dal).setVisibility(principal(), 'r-1', RecipeVisibility.PRIVATE, undefined),
        ).resolves.toBeDefined();
        expect(lockSlotFacts).toHaveBeenCalledWith(FAKE_TX, 'r-1');
    });

    it('answers 404 when the row vanished under the lock (a concurrent tombstone)', async () => {
        const { dal } = holding(0, 'public');
        (dal.lockSlotFacts as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

        const error = await refusalOf(
            serviceOver(dal).setVisibility(principal(), 'r-1', RecipeVisibility.PRIVATE, undefined),
        );

        expect(error.code).toBe(RecipeErrorCode.RECIPE_NOT_FOUND);
    });

    it.each([50, 60])(
        'a DRAFT made private at %i is allowed: a draft holds no slot, so it is not refused and nothing is counted against it',
        async (used) => {
            const { dal, setVisibility } = holding(used, 'public', 'user_created', 'draft');

            await expect(
                serviceOver(dal).setVisibility(principal(), 'r-1', RecipeVisibility.PRIVATE, undefined),
            ).resolves.toBeDefined();
            expect(setVisibility).toHaveBeenCalledWith('r-1', 'private', FAKE_TX);
        },
    );

    it('decides draft-or-published from the row read UNDER the lock: a draft published meanwhile is counted', async () => {
        // The pre-transaction read says draft; by the time the lock is held an update has published it.
        const { dal } = holding(50, 'public', 'user_created', 'published');
        (dal.findById as ReturnType<typeof vi.fn>).mockResolvedValue(
            aggregate({ visibility: 'public', status: 'draft' }),
        );

        const error = await refusalOf(
            serviceOver(dal).setVisibility(principal(), 'r-1', RecipeVisibility.PRIVATE, undefined),
        );

        expect(error.code).toBe(RecipeErrorCode.PRIVATE_SLOTS_FULL);
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

/**
 * REWRITTEN (owner ruling 2026-10-26, ADR-0073 section 12). `clone` always writes `status: draft` (owner 2026-10-13), and a
 * draft holds no slot, so a clone - private or public, any label - is NEVER counted and never refused for slots. The old
 * suite pinned the opposite (a private clone was counted and refused at 50). Its slot is checked later, when the cook
 * publishes the draft (the update describe below).
 */
describe('RecipesService.clone - a clone is a draft, so it uses no slot (ADR-0073 section 12)', () => {
    function sourceOf(overrides: Partial<Parameters<typeof makeRecipeRow>[0]>): RecipeAggregate {
        return {
            recipe: makeRecipeRow({ id: 'src', ownerId: OWNER, ...overrides }),
            steps: [],
            ingredients: [],
        };
    }

    it.each([
        ['a book recipe (default private)', { visibility: 'private', sourceType: 'imported_physical' }],
        ['a paid-site recipe (default private)', { visibility: 'private', sourceType: 'imported_paid' }],
        ["the owner's own private recipe", { visibility: 'private', sourceType: 'user_created' }],
        ['a public recipe', { ownerId: 'someone-else', visibility: 'public', sourceType: 'user_created' }],
    ])('a free cook holding 50 clones %s as a DRAFT: no lock, no count, no refusal', async (_label, source) => {
        const lockAndCountPrivateSlots = vi.fn(async () => 50);
        const create = vi.fn().mockResolvedValue(aggregate({ status: 'draft' }));
        const dal = fakeRecipesDal({
            findById: vi.fn().mockResolvedValue(sourceOf(source)),
            lockAndCountPrivateSlots,
            create,
        });

        await expect(serviceOver(dal).clone(principal(), 'src', undefined)).resolves.toBeDefined();

        expect(lockAndCountPrivateSlots).not.toHaveBeenCalled();
        expect(create).toHaveBeenCalledWith(expect.objectContaining({ status: 'draft' }), FAKE_TX);
    });

    it('a contained test principal (default private) on a free plan at 50 can clone: the copy is a draft', async () => {
        const create = vi.fn().mockResolvedValue(aggregate({ status: 'draft' }));
        const dal = fakeRecipesDal({
            findById: vi.fn().mockResolvedValue(sourceOf({ visibility: 'private', sourceType: 'user_created' })),
            lockAndCountPrivateSlots: vi.fn(async () => 50),
            create,
        });

        await expect(
            serviceOver(dal).clone(principal({ principalKind: 'test', containment: 'enforce' }), 'src', undefined),
        ).resolves.toBeDefined();
    });
});

/**
 * NEW (owner ruling 2026-10-26): publishing a private draft is where a slot is taken, and `update` had no slot check at
 * all before, because no write there could make a recipe hold one. The decision is made from the row read FOR UPDATE
 * under the per-user lock, because set-visibility does not bump the version and so the pre-transaction read can be stale.
 */
describe('RecipesService.update - publishing a private draft takes a slot (ADR-0073 sections 3 and 12)', () => {
    const PATCH = { expectedVersion: 1, status: 'published' } as const;

    function draftHolding(
        used: number,
        facts: { visibility: 'public' | 'private'; status: 'draft' | 'published' },
        sourceType = 'user_created',
        hasSubstantiveEdit = false,
    ) {
        const found = aggregate({
            visibility: 'private',
            status: 'draft',
            currentVersion: 1,
            sourceType,
            hasSubstantiveEdit,
        });
        const update = vi.fn().mockResolvedValue(aggregate({ visibility: facts.visibility, status: 'published' }));
        const lockAndCountPrivateSlots = vi.fn(async () => used);
        const lockSlotFacts = vi.fn(async () => facts);
        const dal = fakeRecipesDal({
            findById: vi.fn().mockResolvedValue(found),
            update,
            lockAndCountPrivateSlots,
            lockSlotFacts,
        });

        return { dal, update, lockAndCountPrivateSlots, lockSlotFacts };
    }

    it.each([50, 51, 60])(
        'refuses publishing a private draft at %i with PRIVATE_SLOTS_FULL, writing nothing',
        async (used) => {
            const { dal, update } = draftHolding(used, { visibility: 'private', status: 'draft' });

            const error = await refusalOf(serviceOver(dal).update(principal(), 'r-1', PATCH, undefined));

            expect(error.code).toBe(RecipeErrorCode.PRIVATE_SLOTS_FULL);
            expect(error.details).toEqual({ used, limit: 50 });
            expect(update).not.toHaveBeenCalled();
        },
    );

    it.each([0, 48, 49])('publishes a private draft at %i', async (used) => {
        const { dal, update } = draftHolding(used, { visibility: 'private', status: 'draft' });

        await expect(serviceOver(dal).update(principal(), 'r-1', PATCH, undefined)).resolves.toBeDefined();
        expect(update).toHaveBeenCalledOnce();
    });

    it('takes the lock and counts BEFORE the row is written, for this cook, in the write transaction', async () => {
        const { dal, update, lockAndCountPrivateSlots } = draftHolding(0, { visibility: 'private', status: 'draft' });

        await serviceOver(dal).update(principal(), 'r-1', PATCH, undefined);

        expect(lockAndCountPrivateSlots).toHaveBeenCalledWith(FAKE_TX, OWNER);
        expect(lockAndCountPrivateSlots.mock.invocationCallOrder[0]).toBeLessThan(
            update.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
        );
    });

    it('saving a private draft AS a draft (no status, or draft) at 50 is never refused and takes no lock', async () => {
        for (const patch of [
            { expectedVersion: 1, title: 'x' },
            { expectedVersion: 1, status: 'draft' as const },
        ]) {
            const { dal, lockAndCountPrivateSlots, update } = draftHolding(50, {
                visibility: 'private',
                status: 'draft',
            });

            await expect(serviceOver(dal).update(principal(), 'r-1', patch, undefined)).resolves.toBeDefined();
            expect(lockAndCountPrivateSlots).not.toHaveBeenCalled();
            expect(update).toHaveBeenCalledOnce();
        }
    });

    it('publishing a PUBLIC draft at 50 is never counted: the visibility is read under the lock, not before it', async () => {
        // Pre-read says private (stale); under the lock it is public.
        const { dal, update } = draftHolding(50, { visibility: 'public', status: 'draft' });

        await expect(serviceOver(dal).update(principal(), 'r-1', PATCH, undefined)).resolves.toBeDefined();
        expect(update).toHaveBeenCalledOnce();
    });

    it('counts a draft made private AFTER the pre-transaction read: the facts under the lock decide', async () => {
        const found = aggregate({ visibility: 'public', status: 'draft', currentVersion: 1 });
        const update = vi.fn();
        const dal = fakeRecipesDal({
            findById: vi.fn().mockResolvedValue(found),
            update,
            lockAndCountPrivateSlots: vi.fn(async () => 50),
            lockSlotFacts: vi.fn(async () => ({ visibility: 'private' as const, status: 'draft' as const })),
        });

        const error = await refusalOf(serviceOver(dal).update(principal(), 'r-1', PATCH, undefined));

        expect(error.code).toBe(RecipeErrorCode.PRIVATE_SLOTS_FULL);
        expect(update).not.toHaveBeenCalled();
    });

    // ADDED after review: the old clone check counted EVERY label, imported_public included, and publishing a private draft
    // is now where that slot is taken - but `imported_public` goes private only with Premium AND a substantive edit (ADR-0073
    // section 6), a rule the publish path must still run, or a downgraded cook could publish a private web-import for free.
    it('⛔ refuses a free cook publishing a private imported_public draft with INVALID_VISIBILITY, writing nothing', async () => {
        const { dal, update, lockAndCountPrivateSlots } = draftHolding(
            0,
            { visibility: 'private', status: 'draft' },
            'imported_public',
        );

        const error = await refusalOf(serviceOver(dal).update(principal(), 'r-1', PATCH, undefined));

        expect(error.code).toBe(RecipeErrorCode.INVALID_VISIBILITY);
        expect(update).not.toHaveBeenCalled();
        // A slot never makes an imported public-web recipe private: nothing is counted for it.
        expect(lockAndCountPrivateSlots).not.toHaveBeenCalled();
    });

    it('Premium publishes a private imported_public draft that carries a substantive edit', async () => {
        const { dal, update } = draftHolding(0, { visibility: 'private', status: 'draft' }, 'imported_public', true);

        await expect(serviceOver(dal).update(premium(), 'r-1', PATCH, undefined)).resolves.toBeDefined();
        expect(update).toHaveBeenCalledOnce();
    });

    it('Premium is refused a private imported_public draft with NO substantive edit yet (FR-005b)', async () => {
        const { dal, update } = draftHolding(0, { visibility: 'private', status: 'draft' }, 'imported_public', false);

        const error = await refusalOf(serviceOver(dal).update(premium(), 'r-1', PATCH, undefined));

        expect(error.code).toBe(RecipeErrorCode.INVALID_VISIBILITY);
        expect(update).not.toHaveBeenCalled();
    });

    it('Premium publishes a private draft with no lock and no count', async () => {
        const { dal, lockAndCountPrivateSlots } = draftHolding(5_000, { visibility: 'private', status: 'draft' });

        await serviceOver(dal).update(premium(), 'r-1', PATCH, undefined);

        expect(lockAndCountPrivateSlots).not.toHaveBeenCalled();
    });

    it('a PUBLISHED private recipe edited at 60 (a downgraded cook) is never counted: it already holds its slot', async () => {
        const found = aggregate({ visibility: 'private', status: 'published', currentVersion: 1 });
        const lockAndCountPrivateSlots = vi.fn(async () => 60);
        const dal = fakeRecipesDal({
            findById: vi.fn().mockResolvedValue(found),
            update: vi.fn().mockResolvedValue(found),
            lockAndCountPrivateSlots,
        });

        await expect(
            serviceOver(dal).update(principal(), 'r-1', { expectedVersion: 1, title: 'New' }, undefined),
        ).resolves.toBeDefined();
        expect(lockAndCountPrivateSlots).not.toHaveBeenCalled();
    });

    it('answers a vanished row under the lock as the version conflict path (nothing written)', async () => {
        const { dal, update } = draftHolding(0, { visibility: 'private', status: 'draft' });
        (dal.lockSlotFacts as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
        (dal.readConflict as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

        const error = await refusalOf(serviceOver(dal).update(principal(), 'r-1', PATCH, undefined));

        expect(error.code).toBe(RecipeErrorCode.RECIPE_NOT_FOUND);
        expect(update).not.toHaveBeenCalled();
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
