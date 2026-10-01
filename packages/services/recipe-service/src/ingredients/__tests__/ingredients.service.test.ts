/**
 * `IngredientsService` under the 0051 grain (plan 002 U4, U5 support, R13, R20, R51) — the picker's business
 * logic over bindings (`food_lookups`) and failure records (`unresolved_foods`).
 *
 * ⚠️ REWRITTEN for plan 002. The previous suite covered a shared, name-bearing `ingredients` catalog that
 * migration 0051 dropped. What it proved moved here in the new model's terms: a pick binds only after food's
 * authorship-checked answer (R51), a failure keeps its reason (R1 to R3), a shared failure is freed only by a
 * food-service fact about it (R13), and a refresh never re-runs one cook's personal cascade (R20). The SQL each
 * collaborator issues is covered against a real Postgres in `tests/e2e/foodLookupsDal.e2e.test.ts`.
 */
import { describe, expect, it, vi, type Mock } from 'vitest';
import { HttpStatus, type HttpException } from '@nestjs/common';
import { RecipeErrorCode } from '@kitchensink/recipe-core';

import {
    foodRefKey,
    type FoodLookupArm,
    type FoodRef,
    type RootArm,
    type UnresolvedArm,
} from '../../database/schema/foodLookupArm.js';
import { isRecipeDomainError } from '../../recipes/recipe.error.js';
import type { FoodLookupsDal } from '../dal/foodLookups.dal.js';
import type { FoodRefAnswer } from '../domain/foodRefAnswer.js';
import type { FoodCatalogGateway } from '../foodCatalog.gateway.js';
import type { FoodRefsGateway } from '../foodRefs.gateway.js';
import { IngredientsService } from '../ingredients.service.js';
import type { ResolutionTier } from '../resolution/resolutionCascade.js';
import {
    CALLER_TOKEN as CALLER,
    makeCanonicalName,
    makeFoodClients,
    type FoodClientMocks,
} from '../__fixtures__/ingredients.fixtures.js';
import {
    makeFakeIngredientResolutionsDal,
    makeFakeResolutionBandsDal,
} from '../__fixtures__/resolutionDals.fixture.js';

const AT = new Date('2026-09-30T00:00:00.000Z');
const COOK = '01JINGSVC000000000000COOKA';
const NAME = makeCanonicalName('nutritional yeast');

function root(foodId: string, foodOwnerId: string | null = null): RootArm {
    return { kind: 'root', lookupId: `lookup-${foodId}`, foodId, foodOwnerId, createdAt: AT };
}

function failure(overrides: Partial<UnresolvedArm['failure']> = {}, lookupId = 'lookup-failure'): UnresolvedArm {
    return {
        kind: 'unresolved',
        lookupId,
        createdAt: AT,
        failure: {
            unresolvedFoodId: 'failure-1',
            name: 'nutritional yeast',
            normalizedKey: 'nutritional yeast',
            reasonCode: 'awaiting_source',
            status: 'PENDING',
            foodHandleId: 'food-pending',
            tiersConsulted: [],
            tiersUnavailable: [],
            attempts: 1,
            settledLookupId: null,
            ...overrides,
        },
    };
}

const found = (name: string, overrides: Partial<Extract<FoodRefAnswer, { outcome: 'found' }>> = {}): FoodRefAnswer => ({
    outcome: 'found',
    name: makeCanonicalName(name),
    status: 'RESOLVED',
    isPrivate: false,
    ...overrides,
});

interface Harness {
    readonly service: IngredientsService;
    readonly lookups: Record<string, Mock>;
    readonly refs: { resolve: Mock; resolveForBind: Mock };
    readonly catalog: { search: Mock; searchLive: Mock };
    readonly food: FoodClientMocks;
    readonly resolutions: ReturnType<typeof makeFakeIngredientResolutionsDal>;
}

function build(tiers: readonly ResolutionTier[] = []): Harness {
    const lookups = {
        findByIds: vi.fn().mockResolvedValue(new Map()),
        findBoundRootsByFoodIds: vi.fn().mockResolvedValue(new Map()),
        findConvergedFailure: vi.fn().mockResolvedValue(undefined),
        findOrCreateBoundRoot: vi.fn(async (admission: { foodId: string; ownerId: string | null }) =>
            root(admission.foodId, admission.ownerId),
        ),
        recordFailure: vi.fn(async (next: { name: string; reasonCode: string; foodHandleId: string | null }) =>
            failure({
                name: next.name,
                reasonCode: next.reasonCode as UnresolvedArm['failure']['reasonCode'],
                status: next.reasonCode === 'author_declared' ? 'UNRESOLVED' : 'PENDING',
                foodHandleId: next.foodHandleId,
            }),
        ),
        recordAttempt: vi.fn(async (arm: UnresolvedArm) => arm),
        settleFailure: vi.fn().mockResolvedValue(1),
        recipesReferencingFood: vi.fn().mockResolvedValue([]),
    };
    const refs = { resolve: vi.fn(), resolveForBind: vi.fn() };
    const catalog = {
        search: vi.fn().mockResolvedValue({ hits: [], availability: 'ok' }),
        searchLive: vi.fn(),
    };
    const { clients, mocks } = makeFoodClients();
    const resolutions = makeFakeIngredientResolutionsDal();

    return {
        service: new IngredientsService(
            lookups as unknown as FoodLookupsDal,
            clients,
            catalog as unknown as FoodCatalogGateway,
            refs as unknown as FoodRefsGateway,
            tiers,
            resolutions,
            makeFakeResolutionBandsDal(),
        ),
        lookups,
        refs,
        catalog,
        food: mocks,
        resolutions,
    };
}

async function refusal(promise: Promise<unknown>): Promise<unknown> {
    return promise.then(
        () => 'resolved',
        (error: unknown) => error,
    );
}

function isCode(error: unknown, code: string): boolean {
    return isRecipeDomainError(error) && error.code === code;
}

describe('addByFoodId — a pick binds only after food’s authorship-checked answer (R51)', () => {
    it('binds a resolved, named, shared food and answers RESOLVED under food’s name', async () => {
        const h = build();
        h.refs.resolveForBind.mockResolvedValue(found('beef brisket'));

        const ingredient = await h.service.addByFoodId(CALLER, ' food-1 ', COOK);

        expect(h.refs.resolveForBind).toHaveBeenCalledWith(CALLER, { kind: 'root', id: 'food-1' });
        expect(h.lookups.findOrCreateBoundRoot).toHaveBeenCalledWith(
            expect.objectContaining({ foodId: 'food-1', ownerId: null }),
        );
        expect(ingredient).toMatchObject({
            id: 'lookup-food-1',
            name: 'beef brisket',
            foodId: 'food-1',
            foodResolutionStatus: 'RESOLVED',
        });
    });

    it('records the caller as the owner of their own private food', async () => {
        const h = build();
        h.refs.resolveForBind.mockResolvedValue(found('my spice mix', { isPrivate: true }));

        await h.service.addByFoodId(CALLER, 'food-2', COOK);

        expect(h.lookups.findOrCreateBoundRoot).toHaveBeenCalledWith(expect.objectContaining({ ownerId: COOK }));
    });

    it('⛔ refuses a food the caller may not see — food answers it absent — and writes nothing', async () => {
        const h = build();
        h.refs.resolveForBind.mockResolvedValue({ outcome: 'absent' });

        const error = await refusal(h.service.addByFoodId(CALLER, 'someone-elses-private', COOK));

        expect(isCode(error, RecipeErrorCode.UNKNOWN_INGREDIENT)).toBe(true);
        expect(h.lookups.findOrCreateBoundRoot).not.toHaveBeenCalled();
    });

    it('refuses a food that is not yet resolved, and writes nothing', async () => {
        const h = build();
        h.refs.resolveForBind.mockResolvedValue(found('pending', { status: 'PENDING' }));

        expect(
            isCode(await refusal(h.service.addByFoodId(CALLER, 'food-3', COOK)), RecipeErrorCode.UNKNOWN_INGREDIENT),
        ).toBe(true);
        expect(h.lookups.findOrCreateBoundRoot).not.toHaveBeenCalled();
    });

    it('⛔ never consults food’s unauthenticated status read to decide who owns a food', async () => {
        const h = build();
        h.refs.resolveForBind.mockResolvedValue(found('beef brisket'));

        await h.service.addByFoodId(CALLER, 'food-1', COOK);

        expect(h.food.getStatus).not.toHaveBeenCalled();
    });
});

describe('addByName — the cascade first, then food, and every failure keeps its reason', () => {
    const hit = (foodId: string): ResolutionTier => ({
        id: 'curated',
        resolve: async () => ({ kind: 'resolved', tier: 'curated', foodId, evidence: 'curated mapping' }),
    });
    const miss: ResolutionTier = {
        id: 'curated',
        resolve: async () => ({ kind: 'pass', tier: 'curated', reason: 'no mapping' }),
    };

    it('binds a curated mapping’s food without asking food to add by name, and records the event on the binding', async () => {
        const h = build([hit('food-mapped')]);
        h.refs.resolveForBind.mockResolvedValue(found('nutritional yeast'));

        const ingredient = await h.service.addByName(CALLER, NAME, COOK);

        expect(h.food.addByName).not.toHaveBeenCalled();
        expect(ingredient.id).toBe('lookup-food-mapped');
        expect(h.resolutions.record).toHaveBeenCalledWith(
            expect.objectContaining({ foodLookupId: 'lookup-food-mapped', tier: 'curated' }),
        );
    });

    it('falls through to food when the mapped food is no longer bindable — a stale mapping is never an error', async () => {
        const h = build([hit('food-stale')]);
        h.refs.resolveForBind.mockResolvedValueOnce({ outcome: 'absent' });
        h.food.addByName.mockResolvedValue({ id: 'food-pending', status: 'PENDING' });

        const ingredient = await h.service.addByName(CALLER, NAME, COOK);

        expect(h.food.addByName).toHaveBeenCalledWith(NAME);
        expect(ingredient.foodResolutionStatus).toBe('PENDING');
    });

    it('records a PENDING answer as awaiting the source, carrying food’s handle', async () => {
        const h = build([miss]);
        h.food.addByName.mockResolvedValue({ id: 'food-pending', status: 'PENDING' });

        await h.service.addByName(CALLER, NAME, COOK);

        expect(h.lookups.recordFailure).toHaveBeenCalledWith(
            expect.objectContaining({
                reasonCode: 'awaiting_source',
                foodHandleId: 'food-pending',
                tiersConsulted: ['curated'],
            }),
        );
    });

    it('binds a RESOLVED answer, and frees the failure this phrase converged on', async () => {
        const h = build([miss]);
        const converged = failure({ reasonCode: 'no_source_has_it', status: 'NOT_FOUND', foodHandleId: null });
        h.food.addByName.mockResolvedValue({ id: 'food-found', status: 'RESOLVED' });
        h.refs.resolveForBind.mockResolvedValue(found('nutritional yeast'));
        h.lookups.findConvergedFailure.mockResolvedValue(converged);

        const ingredient = await h.service.addByName(CALLER, NAME, COOK);

        expect(ingredient.id).toBe('lookup-food-found');
        expect(h.lookups.settleFailure).toHaveBeenCalledWith(
            expect.objectContaining({ unresolvedFoodId: 'failure-1' }),
            expect.objectContaining({ lookupId: 'lookup-food-found' }),
        );
        expect(h.lookups.recordFailure).not.toHaveBeenCalled();
    });

    it('⛔ records "we could not look" when food does not answer (R2)', async () => {
        const h = build([miss]);
        h.food.addByName.mockRejectedValue(new Error('socket hang up'));

        await h.service.addByName(CALLER, NAME, COOK);

        expect(h.lookups.recordFailure).toHaveBeenCalledWith(
            expect.objectContaining({ reasonCode: 'sources_errored', foodHandleId: null }),
        );
    });

    it('does not ask food without a caller, and records what the cascade concluded', async () => {
        const h = build([miss]);

        await h.service.addByName(undefined, NAME, undefined);

        expect(h.food.addByName).not.toHaveBeenCalled();
        expect(h.lookups.recordFailure).toHaveBeenCalledWith(
            expect.objectContaining({ reasonCode: 'cascade_exhausted' }),
        );
    });
});

describe('createFreeform — a cook’s declared name', () => {
    it('records a declaration and answers it as user-entered, with no status', async () => {
        const h = build();

        const ingredient = await h.service.createFreeform(makeCanonicalName('grandma’s spice mix'));

        expect(h.lookups.recordFailure).toHaveBeenCalledWith(
            expect.objectContaining({ reasonCode: 'author_declared' }),
        );
        expect(ingredient).toMatchObject({ isUserEntered: true, name: 'grandma’s spice mix' });
        expect(ingredient.foodResolutionStatus).toBeUndefined();
    });
});

describe('refreshStatus — the poll', () => {
    /** Serve these bindings from the bindings read, each by its own id. */
    function withArm(h: Harness, ...arms: readonly FoodLookupArm[]): void {
        h.lookups.findByIds.mockImplementation(
            async (ids: readonly string[]) =>
                new Map(arms.filter((arm) => ids.includes(arm.lookupId)).map((arm) => [arm.lookupId, arm] as const)),
        );
    }

    it('answers 404 for an unknown binding', async () => {
        const h = build();

        expect(
            isCode(await refusal(h.service.refreshStatus(CALLER, 'nope', COOK)), RecipeErrorCode.RECIPE_NOT_FOUND),
        ).toBe(true);
    });

    it('asks food nothing about a declared name', async () => {
        const h = build();
        withArm(h, failure({ reasonCode: 'author_declared', status: 'UNRESOLVED', foodHandleId: null }));

        const ingredient = await h.service.refreshStatus(CALLER, 'lookup-failure', COOK);

        expect(h.refs.resolveForBind).not.toHaveBeenCalled();
        expect(ingredient.isUserEntered).toBe(true);
    });

    it('settles every line when food resolved the pending handle, and answers with the BOUND binding’s id', async () => {
        const h = build();
        withArm(h, failure());
        h.refs.resolveForBind.mockResolvedValue(found('nutritional yeast'));

        const ingredient = await h.service.refreshStatus(CALLER, 'lookup-failure', COOK);

        expect(h.refs.resolveForBind).toHaveBeenCalledWith(CALLER, { kind: 'root', id: 'food-pending' });
        expect(h.lookups.settleFailure).toHaveBeenCalledTimes(1);
        expect(ingredient).toMatchObject({ id: 'lookup-food-pending', foodResolutionStatus: 'RESOLVED' });
    });

    it('records the new reason when food still needs a pick', async () => {
        const h = build();
        withArm(h, failure());
        h.refs.resolveForBind.mockResolvedValue(found('nutritional yeast', { status: 'UNRESOLVED' }));

        await h.service.refreshStatus(CALLER, 'lookup-failure', COOK);

        expect(h.lookups.recordAttempt).toHaveBeenCalledWith(
            expect.objectContaining({ lookupId: 'lookup-failure' }),
            expect.objectContaining({
                kind: 'replace',
                failure: expect.objectContaining({ reasonCode: 'several_candidates' }),
            }),
        );
        expect(h.lookups.settleFailure).not.toHaveBeenCalled();
    });

    it('⛔ re-asks food by name for a failure with no handle, and NEVER re-runs the cascade (R20)', async () => {
        const tierSpy = vi.fn(async () => ({ kind: 'pass' as const, tier: 'curated' as const, reason: 'no mapping' }));
        const h = build([{ id: 'curated', resolve: tierSpy }]);
        withArm(h, failure({ reasonCode: 'sources_errored', status: 'FAILED', foodHandleId: null }));
        h.food.addByName.mockResolvedValue({ id: 'food-pending', status: 'PENDING' });

        await h.service.refreshStatus(CALLER, 'lookup-failure', COOK);

        expect(tierSpy).not.toHaveBeenCalled();
        expect(h.food.addByName).toHaveBeenCalledWith('nutritional yeast');
    });

    describe('⛔ a SETTLED failure answers with its target — a settle is final (plan 002 R13)', () => {
        const target = root('food-1');
        const settled = failure({ settledLookupId: target.lookupId });
        /** Food's read, answering every ref it is asked about with `answer`. */
        const answering = (answer: FoodRefAnswer) => async (_caller: unknown, refs: readonly FoodRef[]) => ({
            answers: new Map(refs.map((ref) => [foodRefKey(ref), answer] as const)),
            degraded: false,
        });

        it('names the target through food’s read, and asks nothing about the failure’s own handle', async () => {
            const h = build();
            withArm(h, settled, target);
            h.refs.resolve.mockImplementation(answering(found('beef brisket')));

            const ingredient = await h.service.refreshStatus(CALLER, settled.lookupId, COOK);

            expect(ingredient).toMatchObject({ id: target.lookupId, name: 'beef brisket', foodId: 'food-1' });
            expect(h.refs.resolve).toHaveBeenCalledWith(CALLER, [{ kind: 'root', id: 'food-1' }], 'read');
            expect(h.refs.resolveForBind).not.toHaveBeenCalled();
            expect(h.lookups.recordAttempt).not.toHaveBeenCalled();
            expect(h.lookups.settleFailure).not.toHaveBeenCalled();
        });

        it('answers the target when a settle wins the race against this poll’s attempt', async () => {
            const h = build();
            const unsettled = failure();
            h.lookups.findByIds
                .mockResolvedValueOnce(new Map([[unsettled.lookupId, unsettled]]))
                .mockResolvedValueOnce(new Map([[settled.lookupId, settled]]))
                .mockResolvedValueOnce(new Map([[target.lookupId, target]]));
            h.lookups.recordAttempt.mockResolvedValue(undefined);
            h.refs.resolveForBind.mockResolvedValue(found('nutritional yeast', { status: 'UNRESOLVED' }));
            h.refs.resolve.mockImplementation(answering(found('beef brisket')));

            expect(await h.service.refreshStatus(CALLER, unsettled.lookupId, COOK)).toMatchObject({
                id: target.lookupId,
            });
        });

        it('answers an add whose phrase converged on a settled failure with the target, while food’s add is down', async () => {
            const h = build([]);
            h.food.addByName.mockRejectedValue(new Error('socket hang up'));
            h.lookups.recordFailure.mockResolvedValue(settled);
            withArm(h, target);
            h.refs.resolve.mockImplementation(answering(found('nutritional yeast')));

            expect(await h.service.addByName(CALLER, NAME, COOK)).toMatchObject({
                id: target.lookupId,
                foodResolutionStatus: 'RESOLVED',
            });
        });

        it.each([
            ['no longer shows the target', { outcome: 'absent' }],
            ['cannot be asked', { outcome: 'unreachable' }],
        ] as const)(
            '⛔ answers the failure as it stands when food %s — never an error about an id not asked about',
            async (_label, answer) => {
                const h = build([]);
                withArm(h, settled, target);
                h.lookups.recordFailure.mockResolvedValue(settled);
                h.food.addByName.mockResolvedValue({ id: 'food-pending', status: 'NOT_FOUND' });
                h.refs.resolve.mockImplementation(answering(answer));

                expect(await h.service.refreshStatus(CALLER, settled.lookupId, COOK)).toMatchObject({
                    id: settled.lookupId,
                });
                expect(await h.service.addByName(CALLER, NAME, COOK)).toMatchObject({ id: settled.lookupId });
            },
        );

        it('answers the failure as it stands for a caller food cannot be asked for — the save forwards the line', async () => {
            const h = build([]);
            h.lookups.recordFailure.mockResolvedValue(settled);

            expect(await h.service.addByName(undefined, NAME, undefined)).toMatchObject({ id: settled.lookupId });
            expect(h.refs.resolve).not.toHaveBeenCalled();
        });

        it('⛔ a pick on a settled failure asks food nothing and answers the target', async () => {
            const h = build();
            withArm(h, settled, target);
            h.refs.resolve.mockImplementation(answering(found('beef brisket')));

            expect(await h.service.resolve(CALLER, settled.lookupId, ['cand-1'], COOK)).toMatchObject({
                id: target.lookupId,
            });
            expect(h.food.resolve).not.toHaveBeenCalled();
        });

        it('⛔ lists no candidates for a settled failure, and asks food nothing', async () => {
            const h = build();
            withArm(h, settled);

            expect(await h.service.getCandidates(CALLER, settled.lookupId)).toStrictEqual([]);
            expect(h.food.getCandidates).not.toHaveBeenCalled();
        });
    });

    it('answers a bound binding with food’s current name, and 404 when food no longer shows it', async () => {
        const h = build();
        withArm(h, root('food-1'));
        h.refs.resolveForBind.mockResolvedValueOnce(found('beef brisket')).mockResolvedValueOnce({ outcome: 'absent' });

        expect(await h.service.refreshStatus(CALLER, 'lookup-food-1', COOK)).toMatchObject({ name: 'beef brisket' });
        expect(
            isCode(
                await refusal(h.service.refreshStatus(CALLER, 'lookup-food-1', COOK)),
                RecipeErrorCode.RECIPE_NOT_FOUND,
            ),
        ).toBe(true);
    });
});

describe('disambiguation — through the failure’s handle', () => {
    it('lists candidates for a failure awaiting a pick, and none for anything else', async () => {
        const h = build();
        const waiting = failure({ reasonCode: 'several_candidates', status: 'UNRESOLVED', foodHandleId: 'food-tied' });
        h.lookups.findByIds.mockResolvedValueOnce(new Map([[waiting.lookupId, waiting]]));
        h.food.getCandidates.mockResolvedValue({
            candidates: [{ candidateId: 'c1', source: 'usda', externalKey: '1', name: 'Yeast', summary: 's' }],
        });

        expect(await h.service.getCandidates(CALLER, 'lookup-failure')).toHaveLength(1);
        expect(h.food.getCandidates).toHaveBeenCalledWith('food-tied');

        h.lookups.findByIds.mockResolvedValueOnce(new Map([['lookup-food-1', root('food-1')]]));
        expect(await h.service.getCandidates(CALLER, 'lookup-food-1')).toStrictEqual([]);
    });

    it('resolves a pick through food, then settles by the poll; a bound binding is never re-pointed', async () => {
        const h = build();
        const waiting = failure({ reasonCode: 'several_candidates', status: 'UNRESOLVED', foodHandleId: 'food-tied' });
        h.lookups.findByIds.mockResolvedValue(new Map([[waiting.lookupId, waiting]]));
        h.refs.resolveForBind.mockResolvedValue(found('nutritional yeast'));

        const settled = await h.service.resolve(CALLER, 'lookup-failure', ['c1'], COOK);

        expect(h.food.resolve).toHaveBeenCalledWith('food-tied', ['c1']);
        expect(settled.foodResolutionStatus).toBe('RESOLVED');

        h.lookups.findByIds.mockResolvedValue(new Map([['lookup-food-1', root('food-1')]]));
        h.food.resolve.mockClear();
        h.refs.resolveForBind.mockResolvedValue(found('beef brisket'));
        await h.service.resolve(CALLER, 'lookup-food-1', ['c1'], COOK);
        expect(h.food.resolve).not.toHaveBeenCalled();
    });
});

describe('search and suggest — food’s catalog, crossed with the bindings the caller may see', () => {
    it('search returns the bound foods among food’s hits, named from food, private ones for their author only', async () => {
        const h = build();
        h.catalog.search.mockResolvedValue({
            hits: [
                { foodId: 'food-1', name: 'beef brisket', score: 2 },
                { foodId: 'food-unbound', name: 'beef shank', score: 1 },
            ],
            availability: 'ok',
        });
        h.lookups.findBoundRootsByFoodIds.mockResolvedValue(new Map([['food-1', root('food-1')]]));

        const results = await h.service.search(CALLER, '  beef ', COOK);

        expect(h.lookups.findBoundRootsByFoodIds).toHaveBeenCalledWith(['food-1', 'food-unbound'], COOK);
        expect(results).toStrictEqual([
            expect.objectContaining({ id: 'lookup-food-1', name: 'beef brisket', foodId: 'food-1' }),
        ]);
    });

    it('⛔ search answers 502 SOURCE_UNAVAILABLE when food could not be asked — never an empty "no match"', async () => {
        // Every result is a food hit, so with food down an empty list would tell the cook "no recipe uses this".
        const h = build();
        h.catalog.search.mockResolvedValue({ hits: [], availability: 'unavailable' });

        const error = (await h.service
            .search(CALLER, 'beef', COOK)
            .catch((thrown: unknown) => thrown)) as HttpException;

        expect(error.getStatus()).toBe(HttpStatus.BAD_GATEWAY);
        expect(error.getResponse()).toMatchObject({ code: 'SOURCE_UNAVAILABLE' });
        expect(h.lookups.findBoundRootsByFoodIds).not.toHaveBeenCalled();
    });

    it('search answers an empty list when the catalog is switched off — that is configuration, not an outage', async () => {
        const h = build();
        h.catalog.search.mockResolvedValue({ hits: [], availability: 'disabled' });
        h.lookups.findBoundRootsByFoodIds.mockResolvedValue(new Map());

        expect(await h.service.search(CALLER, 'beef', COOK)).toStrictEqual([]);
    });

    it('suggest puts bound foods in the familiar section and unbound hits in the catalog section', async () => {
        const h = build();
        h.catalog.search.mockResolvedValue({
            hits: [
                { foodId: 'food-1', name: 'beef brisket', score: 2 },
                { foodId: 'food-unbound', name: 'beef shank', score: 1 },
            ],
            availability: 'ok',
        });
        h.lookups.findBoundRootsByFoodIds.mockResolvedValue(new Map([['food-1', root('food-1')]]));

        const { suggestions, catalogAvailability } = await h.service.suggest(CALLER, 'beef', COOK);

        expect(catalogAvailability).toBe('ok');
        expect(
            suggestions.map((s) => [s.provenance, s.provenance === 'catalog' ? s.foodId : s.ingredient.id]),
        ).toStrictEqual([
            ['local', 'lookup-food-1'],
            ['catalog', 'food-unbound'],
        ]);
    });

    it('suggest reports an unavailable catalog without failing', async () => {
        const h = build();
        h.catalog.search.mockResolvedValue({ hits: [], availability: 'unavailable' });

        expect(await h.service.suggest(CALLER, 'beef', COOK)).toStrictEqual({
            suggestions: [],
            catalogAvailability: 'unavailable',
        });
    });
});

describe('createAuthoredFood — the forced fork (R13)', () => {
    it('binds the new food with its author as owner', async () => {
        const h = build();
        h.food.createAuthoredFood.mockResolvedValue({ kind: 'created', food: { id: 'food-new', name: 'my mix' } });

        const outcome = await h.service.createAuthoredFood(CALLER, COOK, { name: 'my mix', macros: {} as never });

        expect(h.lookups.findOrCreateBoundRoot).toHaveBeenCalledWith(
            expect.objectContaining({ foodId: 'food-new', ownerId: COOK }),
        );
        expect(outcome).toMatchObject({ kind: 'created', ingredient: { id: 'lookup-food-new' } });
    });

    it('surfaces food’s duplicate as the duplicate arm, binding nothing', async () => {
        const h = build();
        h.food.createAuthoredFood.mockResolvedValue({ kind: 'duplicate', existingId: 'food-old' });

        expect(await h.service.createAuthoredFood(CALLER, COOK, { name: 'my mix', macros: {} as never })).toStrictEqual(
            {
                kind: 'duplicate',
                existingFoodId: 'food-old',
            },
        );
        expect(h.lookups.findOrCreateBoundRoot).not.toHaveBeenCalled();
    });
});

describe('foodReferences — the erasure protocol’s data half', () => {
    it('counts every referencing recipe and names only the caller’s own', async () => {
        const h = build();
        h.lookups.recipesReferencingFood.mockResolvedValue([
            { recipeId: 'r1', ownerId: COOK },
            { recipeId: 'r2', ownerId: 'someone-else' },
        ]);

        expect(await h.service.foodReferences(COOK, 'food-1')).toStrictEqual({ total: 2, ownRecipeIds: ['r1'] });
    });
});
