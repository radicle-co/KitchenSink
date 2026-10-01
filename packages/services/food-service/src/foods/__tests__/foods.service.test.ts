/**
 * Unit tests for {@link FoodsService}'s local-store serve-rate instrumentation (T-199b, SC-004/SC-005).
 *
 * `getFood` is the ONLY path that can answer this question honestly: it is the golden-record read the
 * success criteria are written about, it makes no source call by construction, and it is the branch that
 * knows whether the local store had the answer. `getStatus` and `search` are deliberately NOT instrumented
 * — search never touches a source at all, so counting it would drive the rate to ~100% by construction and
 * destroy the signal; and the k6 SC-004 scenario measures `GET /api/v1/foods/{id}`, so instrumenting
 * anything wider would make the runtime metric and the load-test metric mean different things.
 *
 * The rest of `FoodsService` (dedup/enqueue/resolve/backpressure) is covered end-to-end by
 * `tests/foodsApi.integration.test.ts`; this suite pins the emission contract only.
 *
 * @implements SC-004 SC-005
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MIN_SEARCH_QUERY_LENGTH } from '@kitchensink/recipe-core/resolution/search-minimum';

import { FoodMetrics } from '../../observability/emfMetrics.js';
import { AUTHOR_ID, STRANGER_ID, makeFoodRefFacts, makePrivateFoodRefFacts } from '../__fixtures__/foodRefFacts.js';
import { makeGoldenFoodRecord } from '../__fixtures__/goldenFoodRecord.js';
import type { FoodDao, FoodRefFacts, FoodStatus, GoldenFoodRecord } from '../dao/food.dao.js';
import type { FoodVariantDao } from '../dao/foodVariant.dao.js';
import type { CatalogOwnerReader } from '../catalogOwnerReader.service.js';
import type { CandidateStore } from '../dao/foodCandidates.dao.js';
import type { FoodSourcesDao } from '../dao/foodSources.dao.js';
import type { FoodSearchDao } from '../dao/foodSearch.dao.js';
import { FoodNotFoundError, isFoodNotFoundError } from '../foods.errors.js';
import { FoodsService } from '../foods.service.js';

const FOOD_ID = '01J9ZZZZZZZZZZZZZZZZZZZZZZ';
/** The authenticated caller getFood's authorship gate (plan U10) decides over. */
const CALLER = '01JGETFOODCALLER0000000000';

/** A minimal golden record in `status`; enough for `toFoodResponse` to map it. */
function makeRecord(status: FoodStatus): GoldenFoodRecord {
    return {
        id: FOOD_ID,
        name: 'Broccoli, raw',
        description: null,
        kind: 'ingredient',
        status,
        nutrients: [],
        portions: [],
        sources: [],
        fieldProvenance: [],
        priorFraction: null,
        userId: null,
        visibility: 'public',
    } as unknown as GoldenFoodRecord;
}

/** Build the service with only the collaborators `getFood` touches; the rest would fail loudly if used. */
function makeService(record: GoldenFoodRecord | null): {
    service: FoodsService;
    sink: ReturnType<typeof vi.fn>;
} {
    const foodDao = { readGoldenRecord: vi.fn().mockResolvedValue(record) } as unknown as FoodDao;
    const sink = vi.fn();
    const unused = undefined as unknown as never;
    const service = new FoodsService(
        foodDao,
        unused,
        unused,
        unused,
        unused,
        unused,
        unused,
        new FoodMetrics(sink),
        unused,
        { listLive: vi.fn().mockResolvedValue([]) } as unknown as FoodVariantDao,
        unused,
    );

    return { service, sink };
}

/** The serve-rate observations emitted to `sink`, in order. */
function serveRateValues(sink: ReturnType<typeof vi.fn>): number[] {
    return sink.mock.calls
        .map((call) => JSON.parse(call[0] as string) as Record<string, unknown>)
        .filter((payload) => 'food-local-store-serve-rate' in payload)
        .map((payload) => payload['food-local-store-serve-rate'] as number);
}

describe('FoodsService.getFood — local-store serve rate (SC-004/SC-005)', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    it('records a SERVED read (100) when the local store returns a RESOLVED golden record', async () => {
        const { service, sink } = makeService(makeRecord('RESOLVED'));

        await service.getFood(FOOD_ID, CALLER);

        expect(serveRateValues(sink)).toEqual([100]);
    });

    it.each<FoodStatus>(['PENDING', 'UNRESOLVED'])(
        'records an UNSERVED read (0) for a %s food — the answer still needs a source fetch',
        async (status) => {
            const { service, sink } = makeService(makeRecord(status));

            await expect(service.getFood(FOOD_ID, CALLER)).rejects.toThrow();
            expect(serveRateValues(sink)).toEqual([0]);
        },
    );

    it.each<FoodStatus>(['NOT_FOUND', 'FAILED'])('records an UNSERVED read (0) for a %s food', async (status) => {
        const { service, sink } = makeService(makeRecord(status));

        await expect(service.getFood(FOOD_ID, CALLER)).rejects.toThrow();
        expect(serveRateValues(sink)).toEqual([0]);
    });

    it('records an UNSERVED read (0) when no row exists at all', async () => {
        const { service, sink } = makeService(null);

        await expect(service.getFood(FOOD_ID, CALLER)).rejects.toThrow();
        expect(serveRateValues(sink)).toEqual([0]);
    });

    it('emits exactly ONE observation per read (CloudWatch aggregates; the service must not double-count)', async () => {
        const { service, sink } = makeService(makeRecord('RESOLVED'));

        await service.getFood(FOOD_ID, CALLER);
        await service.getFood(FOOD_ID, CALLER);

        expect(serveRateValues(sink)).toEqual([100, 100]);
    });
});

/**
 * The FR-010a minimum, asserted at the SERVICE rather than only at the DAO (plan U37).
 *
 * ⛔ THE DAO GUARD IS NOT ENOUGH, and that is the whole point of this suite. `FoodsService.search` issues
 * THREE reads per call — the ranked statement plus two crosswalk lookups (`findFoodIdByBarcode`, then
 * the owner reader's `ownersOfKeys`) — and the crosswalks do not go through `FoodSearchDao` at all. A gate that
 * lived only in the DAO would still put two round trips on every keystroke of a query the product has ruled
 * unanswerable. FR-010a says the system returns no results; the cheapest way to return no results is to make
 * no query.
 *
 * Nothing is lost by skipping the crosswalks below the minimum: a GTIN is 8–14 digits and a USDA `fdcId` is
 * 4–7, so no identifier this branch can resolve is shorter than three characters.
 *
 * Mutation lens: every case fails if the gate is removed, if it is weakened back to "non-empty", if it is
 * moved below the crosswalk reads, or if the minimum stops being the shared one.
 */
describe('FoodsService.search — the FR-010a minimum (plan U37)', () => {
    /** Build the service with only the collaborators `search` touches, each recording its calls. */
    function makeSearchService(): {
        service: FoodsService;
        searchDao: { search: ReturnType<typeof vi.fn> };
        foodDao: { nutrientRowsFor: ReturnType<typeof vi.fn> };
        sources: { findFoodIdByBarcode: ReturnType<typeof vi.fn> };
        owners: { ownersOfKeys: ReturnType<typeof vi.fn> };
    } {
        const searchDao = { search: vi.fn().mockResolvedValue([]) };
        const foodDao = { nutrientRowsFor: vi.fn().mockResolvedValue([]) };
        const sources = { findFoodIdByBarcode: vi.fn().mockResolvedValue(undefined) };
        // Curated U8 S4: the source-key crosswalk reads through the owner reader.
        const owners = { ownersOfKeys: vi.fn().mockResolvedValue(new Map()) };
        const unused = undefined as unknown as never;
        const service = new FoodsService(
            foodDao as unknown as FoodDao,
            unused,
            sources as unknown as FoodSourcesDao,
            searchDao as unknown as FoodSearchDao,
            unused,
            unused,
            unused,
            new FoodMetrics(vi.fn()),
            unused,
            unused,
            owners as unknown as CatalogOwnerReader,
        );

        return { service, searchDao, foodDao, sources, owners };
    }

    describe('below the minimum, NOTHING is read', () => {
        it.each(['', ' ', 'e', 'eg', ' eg ', '  '])(
            'answers %j with an empty result set and no read',
            async (query) => {
                const { service, searchDao, sources, owners } = makeSearchService();

                await expect(service.search(query, CALLER)).resolves.toEqual({ results: [] });

                expect(searchDao.search).not.toHaveBeenCalled();
                // ⛔ The two reads a DAO-only gate would leave running on every keystroke.
                expect(sources.findFoodIdByBarcode).not.toHaveBeenCalled();
                expect(owners.ownersOfKeys).not.toHaveBeenCalled();
            },
        );

        it('refuses everything shorter than the shared minimum, whatever that minimum is', async () => {
            const { service, searchDao } = makeSearchService();

            await service.search('a'.repeat(MIN_SEARCH_QUERY_LENGTH - 1), CALLER);

            expect(searchDao.search).not.toHaveBeenCalled();
        });
    });

    describe('U11/R20 — the wire visibility flag on search results', () => {
        /** A raw DAO hit; overrides pick the ownership axis under test. */
        function hit(overrides: { userId?: string | null; visibility?: string } = {}): {
            id: string;
            name: string;
            aliases: string | null;
            score: number;
            userId: string | null;
            visibility: string;
        } {
            return {
                id: 'f_hit',
                name: 'Quinoa, blend',
                aliases: null,
                score: 0.9,
                userId: overrides.userId ?? null,
                visibility: overrides.visibility ?? 'public',
            };
        }

        it("flags the CALLER's own private food 'private'", async () => {
            const { service, searchDao } = makeSearchService();
            searchDao.search.mockResolvedValue([hit({ userId: CALLER, visibility: 'private' })]);

            const { results } = await service.search('quinoa', CALLER);

            expect(results[0]?.visibility).toBe('private');
        });

        // ⛔ ADR-0036: an authored food is AUTHOR-ONLY, so the only authored row that can reach a caller is
        // their own. The DAO predicate is the boundary; this asserts the projection never re-publishes a flag
        // describing SOMEBODY ELSE's food if a row ever slips past it. Before ADR-0036 this row answered
        // `'promoted'` — the value a stranger could see, and the one the removal of promotion retires.
        it('publishes NO flag for an authored row belonging to someone else', async () => {
            const { service, searchDao } = makeSearchService();
            searchDao.search.mockResolvedValue([hit({ userId: 'someone-else', visibility: 'promoted' })]);

            const { results } = await service.search('quinoa', CALLER);

            expect(results[0]?.visibility).toBeUndefined();
        });

        it('publishes NO flag for a plain catalog row — the common case is byte-identical to pre-U11', async () => {
            const { service, searchDao } = makeSearchService();
            searchDao.search.mockResolvedValue([hit()]);

            const { results } = await service.search('quinoa', CALLER);

            expect(results[0] !== undefined && 'visibility' in results[0]).toBe(false);
        });

        it("NEVER flags another user's private row 'private' — even if the DAO predicate ever leaked one", async () => {
            const { service, searchDao } = makeSearchService();
            searchDao.search.mockResolvedValue([hit({ userId: 'someone-else', visibility: 'private' })]);

            const { results } = await service.search('quinoa', CALLER);

            expect(results[0] !== undefined && 'visibility' in results[0]).toBe(false);
        });
    });

    describe("withNutrition — the lexical tier's enrichment flag (plan U4b)", () => {
        const HITS = [
            { id: 'F-1', name: 'Flour, wheat', score: 0.9 },
            { id: 'F-2', name: 'Carob flour', score: 0.6 },
        ];
        const ROWS = [
            {
                foodId: 'F-1',
                nutrient: 'Energy',
                infoodsTag: 'ENERC_KCAL',
                unit: 'kcal',
                basis: 'per_100g',
                amount: '364',
                trace: false,
            },
            {
                foodId: 'F-1',
                nutrient: 'Protein',
                infoodsTag: 'PROCNT',
                unit: 'g',
                basis: 'per_100g',
                amount: '10',
                trace: false,
            },
        ];

        it('enriches each hit with its per-100g projection through the ONE selection rule', async () => {
            const { service, searchDao, foodDao } = makeSearchService();
            searchDao.search.mockResolvedValue([...HITS]);
            foodDao.nutrientRowsFor.mockResolvedValue([...ROWS]);

            const response = await service.search('flour', CALLER, true);

            expect(foodDao.nutrientRowsFor).toHaveBeenCalledWith(['F-1', 'F-2']);
            expect(response.results[0]).toMatchObject({ id: 'F-1', caloriesPer100g: 364, proteinGPer100g: 10 });
            // A food with no qualifying rows carries NO macro fields — absent, never zero.
            expect(response.results[1]).not.toHaveProperty('caloriesPer100g');
        });

        it('reads the same rules as the batch: Atwater energy, a carbohydrate trace as 0, a protein trace absent', async () => {
            const { service, searchDao, foodDao } = makeSearchService();
            searchDao.search.mockResolvedValue([HITS[0]]);
            foodDao.nutrientRowsFor.mockResolvedValue([
                {
                    foodId: 'F-1',
                    nutrient: 'Energy (atwater general factors)',
                    infoodsTag: null,
                    unit: 'kcal',
                    basis: 'per_100g',
                    amount: '120',
                    trace: false,
                },
                {
                    foodId: 'F-1',
                    nutrient: 'Carbohydrate, by difference',
                    infoodsTag: 'CHOCDF',
                    unit: 'g',
                    basis: 'per_100g',
                    amount: null,
                    trace: true,
                },
                {
                    foodId: 'F-1',
                    nutrient: 'Protein',
                    infoodsTag: 'PROCNT',
                    unit: 'g',
                    basis: 'per_100g',
                    amount: null,
                    trace: true,
                },
            ]);

            const response = await service.search('flour', CALLER, true);

            expect(response.results[0]).toMatchObject({ caloriesPer100g: 120, carbsGPer100g: 0 });
            expect(response.results[0]).not.toHaveProperty('proteinGPer100g');
        });

        it('⛔ reads NOTHING extra on the default keystroke path — enrichment is strictly opt-in', async () => {
            const { service, searchDao, foodDao } = makeSearchService();
            searchDao.search.mockResolvedValue([...HITS]);

            await service.search('flour', CALLER);

            expect(foodDao.nutrientRowsFor).not.toHaveBeenCalled();
        });

        it('an empty hit set never issues the nutrient read', async () => {
            const { service, foodDao } = makeSearchService();

            await service.search('flour', CALLER, true);

            expect(foodDao.nutrientRowsFor).not.toHaveBeenCalled();
        });
    });

    describe('at and above the minimum, the full three-read path runs', () => {
        it.each(['egg', 'ham', 'rye', 'chicken breast'])('searches for %j', async (query) => {
            const { service, searchDao, sources, owners } = makeSearchService();

            await service.search(query, CALLER);

            // Without this the suite above would pass on a `search` that does nothing at all.
            expect(searchDao.search).toHaveBeenCalledWith(query, CALLER);
            expect(sources.findFoodIdByBarcode).toHaveBeenCalledWith(query);
            expect(owners.ownersOfKeys).toHaveBeenCalledWith('usda', [query]);
        });

        it('still trims before measuring, so a padded three-character query is searched', async () => {
            const { service, searchDao } = makeSearchService();

            await service.search('  egg  ', CALLER);

            expect(searchDao.search).toHaveBeenCalledWith('egg', CALLER);
        });
    });
});

/**
 * `resolveRefs` (curated U8, roots slice): the service's half is ONLY the I/O — read the distinct root ids once,
 * hand the rows to the pure policy. What each caller is told is pinned in `domain/__tests__/foodRefResolution.test.ts`.
 */
describe('FoodsService.resolveRefs', () => {
    // Rewritten for curated U8 S5: the facts come from the owner reader, which reads variants and follows forwards;
    // the pure `resolveFoodRefs` decides. A variant ref is no longer answered without a read.
    function makeResolveService(rows: FoodRefFacts[]): {
        service: FoodsService;
        refFacts: ReturnType<typeof vi.fn>;
    } {
        const refFacts = vi.fn().mockResolvedValue({
            roots: new Map(rows.map((row) => [row.id, row])),
            variants: new Map(),
            forwards: new Map(),
        });
        const unused = undefined as unknown as never;
        const service = new FoodsService(
            unused,
            unused,
            unused,
            unused,
            unused,
            unused,
            unused,
            new FoodMetrics(vi.fn()),
            unused,
            unused,
            { refFacts } as unknown as CatalogOwnerReader,
        );

        return { service, refFacts };
    }

    it('reads the refs’ facts in ONE reader call, and answers every distinct ref in order', async () => {
        const catalog = makeFoodRefFacts({ id: 'food-a', name: 'a' });
        const { service, refFacts } = makeResolveService([catalog]);
        const refs = [
            { kind: 'root' as const, id: 'food-a' },
            { kind: 'variant' as const, id: 'v-1' },
            { kind: 'root' as const, id: 'food-missing' },
            { kind: 'root' as const, id: 'food-a' },
        ];

        const result = await service.resolveRefs(refs, STRANGER_ID);

        expect(refFacts).toHaveBeenCalledTimes(1);
        expect(refFacts).toHaveBeenCalledWith(refs);
        expect(result).toStrictEqual({
            entries: [
                { outcome: 'found', ref: { kind: 'root', id: 'food-a' }, name: 'a', status: 'RESOLVED' },
                { outcome: 'absent', ref: { kind: 'variant', id: 'v-1' } },
                { outcome: 'absent', ref: { kind: 'root', id: 'food-missing' } },
            ],
        });
    });

    it('decides over the CALLER it was given: the author finds a private food a stranger cannot', async () => {
        const privateFood = makePrivateFoodRefFacts();
        const ref = { kind: 'root' as const, id: privateFood.id };

        const asAuthor = await makeResolveService([privateFood]).service.resolveRefs([ref], AUTHOR_ID);
        const asStranger = await makeResolveService([privateFood]).service.resolveRefs([ref], STRANGER_ID);

        expect(asAuthor.entries[0]).toMatchObject({ outcome: 'found', visibility: 'private' });
        expect(asStranger.entries[0]).toStrictEqual({ outcome: 'absent', ref });
    });
});

/**
 * ⛔ THE AUTHORIZATION DEFECT, pinned RED-first: `GET /{id}/status` and `GET /{id}/candidates` ran NO authorship
 * check while `GET /{id}` did, so the one route that conceals a private food was not the only route that
 * answered for it. Both now apply `evaluateAuthorship` exactly as `getFood` does — a stranger's private food
 * answers the SAME `FoodNotFoundError` a missing id answers, with no status detail.
 */
describe('FoodsService.getStatus / getCandidates — the same authorship policy as getFood', () => {
    const FOOD = '01J9ZZZZZZZZZZZZZZZZZZZZZZ';

    /** A golden record for `getStatus`; the authorship axis comes from the overrides. */
    function golden(overrides: Partial<GoldenFoodRecord>): GoldenFoodRecord {
        return { ...makeRecord('RESOLVED'), id: FOOD, ...overrides };
    }

    function makeGatedService(options: {
        record?: GoldenFoodRecord | null;
        facts?: FoodRefFacts[];
        candidates?: unknown[];
    }): { service: FoodsService; getCandidates: ReturnType<typeof vi.fn> } {
        const foodDao = {
            readGoldenRecord: vi.fn().mockResolvedValue(options.record ?? null),
            readRefFacts: vi.fn().mockResolvedValue(options.facts ?? []),
        };
        const getCandidates = vi.fn().mockResolvedValue(options.candidates ?? []);
        const unused = undefined as unknown as never;
        const service = new FoodsService(
            foodDao as unknown as FoodDao,
            { getCandidates } as unknown as CandidateStore,
            unused,
            unused,
            unused,
            unused,
            unused,
            new FoodMetrics(vi.fn()),
            unused,
            { listLive: vi.fn().mockResolvedValue([]) } as unknown as FoodVariantDao,
            unused,
        );

        return { service, getCandidates };
    }

    /** What `call` threw, asserted to be the not-found a missing id gets — no status detail. */
    async function concealed(call: Promise<unknown>): Promise<FoodNotFoundError> {
        const thrown = await call.then(
            () => expect.unreachable('expected a FoodNotFoundError'),
            (error: unknown) => error,
        );

        expect(isFoodNotFoundError(thrown)).toBe(true);
        expect((thrown as FoodNotFoundError).status).toBeUndefined();

        return thrown as FoodNotFoundError;
    }

    describe('getStatus', () => {
        it('⛔ a stranger polling a PRIVATE food gets exactly what an unknown id gets', async () => {
            const stranger = await concealed(
                makeGatedService({ record: golden({ userId: AUTHOR_ID, visibility: 'private' }) }).service.getStatus(
                    FOOD,
                    STRANGER_ID,
                ),
            );
            const unknown = await concealed(makeGatedService({ record: null }).service.getStatus(FOOD, STRANGER_ID));

            expect(stranger.message).toBe(unknown.message);
            expect(stranger.id).toBe(unknown.id);
        });

        it('⛔ a service principal is a stranger to a private food too', async () => {
            await concealed(
                makeGatedService({ record: golden({ userId: AUTHOR_ID, visibility: 'private' }) }).service.getStatus(
                    FOOD,
                    'svc_recipe',
                ),
            );
        });

        it('the author polls their own private food', async () => {
            const { service } = makeGatedService({ record: golden({ userId: AUTHOR_ID, visibility: 'private' }) });

            await expect(service.getStatus(FOOD, AUTHOR_ID)).resolves.toMatchObject({ id: FOOD, status: 'RESOLVED' });
        });

        it('the author still learns their food was WITHDRAWN — a 200 with the status and NO food body', async () => {
            const { service } = makeGatedService({
                record: golden({ userId: AUTHOR_ID, visibility: 'private', status: 'WITHDRAWN' }),
            });

            await expect(service.getStatus(FOOD, AUTHOR_ID)).resolves.toStrictEqual({ id: FOOD, status: 'WITHDRAWN' });
        });

        it('a stranger still polls a catalog food and a PROMOTED food', async () => {
            const catalog = makeGatedService({ record: golden({}) });
            const promoted = makeGatedService({ record: golden({ userId: AUTHOR_ID, visibility: 'promoted' }) });

            await expect(catalog.service.getStatus(FOOD, STRANGER_ID)).resolves.toMatchObject({ status: 'RESOLVED' });
            await expect(promoted.service.getStatus(FOOD, STRANGER_ID)).resolves.toMatchObject({
                status: 'RESOLVED',
            });
        });
    });

    describe('getCandidates', () => {
        const ROW = { id: 'cand-1', source: 'usda', externalKey: '171688', name: 'Broccoli, raw', summary: null };

        it('⛔ a stranger asking for a PRIVATE food’s candidates gets what an unknown id gets — and nothing is read', async () => {
            const privateUnresolved = makePrivateFoodRefFacts({ id: FOOD, status: 'UNRESOLVED' });
            const gated = makeGatedService({ facts: [privateUnresolved], candidates: [ROW] });

            const stranger = await concealed(gated.service.getCandidates(FOOD, STRANGER_ID));
            const unknown = await concealed(makeGatedService({ facts: [] }).service.getCandidates(FOOD, STRANGER_ID));

            expect(stranger.message).toBe(unknown.message);
            expect(gated.getCandidates).not.toHaveBeenCalled();
        });

        it('a DELETING food is not-found, even to its author', async () => {
            const deleting = makePrivateFoodRefFacts({ id: FOOD, status: 'DELETING' });

            await concealed(makeGatedService({ facts: [deleting] }).service.getCandidates(FOOD, AUTHOR_ID));
        });

        it('anyone reads an UNRESOLVED catalog food’s candidates', async () => {
            const { service } = makeGatedService({
                facts: [makeFoodRefFacts({ id: FOOD, status: 'UNRESOLVED' })],
                candidates: [ROW],
            });

            await expect(service.getCandidates(FOOD, STRANGER_ID)).resolves.toStrictEqual({
                id: FOOD,
                candidates: [
                    {
                        candidateId: 'cand-1',
                        source: 'usda',
                        externalKey: '171688',
                        name: 'Broccoli, raw',
                        summary: null,
                    },
                ],
            });
        });

        it('a food not awaiting disambiguation answers an empty set without reading the store', async () => {
            const { service, getCandidates } = makeGatedService({ facts: [makeFoodRefFacts({ id: FOOD })] });

            await expect(service.getCandidates(FOOD, AUTHOR_ID)).resolves.toStrictEqual({ id: FOOD, candidates: [] });
            expect(getCandidates).not.toHaveBeenCalled();
        });
    });
});

describe('FoodsService.getFood — a portion reports the source the golden read decided (KTD-19)', () => {
    it('reports a cited portion’s source, and an authored one as its author', async () => {
        const record = makeGoldenFoodRecord({
            id: FOOD_ID,
            portions: [
                { id: 'p1', label: 'slice', gramWeight: '30', sourceId: null, source: 'ciqual' },
                { id: 'p2', label: 'scoop', gramWeight: '12', sourceId: null, source: null },
            ],
        });
        const { service } = makeService(record);

        expect((await service.getFood(FOOD_ID, CALLER)).portions).toStrictEqual([
            { label: 'slice', gramWeight: 30, source: 'ciqual' },
            { label: 'scoop', gramWeight: 12, source: 'author' },
        ]);
    });
});
