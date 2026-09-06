/**
 * The catalog seed's two jobs, and they are DIFFERENT questions asked of different things:
 *
 *   - get every name to a settled state, waiting only on what can still change;
 *   - then decide whether what settled is enough for the suite that will run against it.
 *
 * ⚠️ The first live run collapsed those two. It treated `UNRESOLVED` as fatal, so `egg` — a name USDA
 * offered candidates for and the service could not pick between — failed the whole seed, and the error
 * named an opaque id rather than the fixture. Both are fixed here, and both are asserted.
 */
import { describe, expect, it, vi } from 'vitest';

import {
    CATALOG_PROBE_QUERY,
    CATALOG_SEED_NAMES,
    classifyCatalog,
    findCatalogShortfalls,
    findProbeShortfall,
    MIN_PROBE_RESULTS,
    MIN_RESOLVED_FOODS,
    pickCandidate,
    seedFoodCatalog,
    sharedHeadTermCount,
    type CatalogEntry,
    type CatalogItem,
} from '../src/foodCatalog.js';

const item = (id: string, status: CatalogItem['status']): CatalogItem => ({ id, status });
const entry = (name: string, status: CatalogEntry['status'] = 'RESOLVED'): CatalogEntry => ({
    name,
    id: `id-${name}`,
    status,
});

const deps = (over: Partial<Parameters<typeof seedFoodCatalog>[1]> = {}) => ({
    batch: vi.fn().mockResolvedValue([]),
    status: vi.fn().mockResolvedValue(item('x', 'RESOLVED')),
    now: () => 0,
    sleep: async (): Promise<void> => undefined,
    deadlineMs: 1_000,
    pollMs: 1,
    ...over,
});

describe('CATALOG_SEED_NAMES', () => {
    it('stays inside the endpoint"s 100-name cap and names nothing twice', () => {
        expect(CATALOG_SEED_NAMES.length).toBeLessThanOrEqual(100);
        expect(new Set(CATALOG_SEED_NAMES).size).toBe(CATALOG_SEED_NAMES.length);
    });

    it('carries enough names that the floor is reachable even with a few refusals', () => {
        expect(CATALOG_SEED_NAMES.length).toBeGreaterThan(MIN_RESOLVED_FOODS);
    });

    it('contains at least two names sharing a head term', () => {
        expect(sharedHeadTermCount(CATALOG_SEED_NAMES.map((name) => entry(name)))).toBeGreaterThanOrEqual(2);
    });
});

describe('classifyCatalog', () => {
    it('splits the three outcomes', () => {
        expect(classifyCatalog([item('a', 'RESOLVED'), item('b', 'PENDING'), item('c', 'NOT_FOUND')])).toEqual({
            resolved: ['a'],
            pending: ['b'],
            failed: ['c'],
        });
    });

    it('never waits on UNRESOLVED — no amount of polling changes it', () => {
        expect(classifyCatalog([item('a', 'UNRESOLVED')]).pending).toEqual([]);
    });
});

describe('sharedHeadTermCount', () => {
    it('counts the largest group sharing a first word', () => {
        expect(sharedHeadTermCount([entry('chicken breast'), entry('chicken thigh'), entry('butter')])).toBe(2);
    });

    it('is 0 for an empty catalog and 1 when nothing pairs', () => {
        expect(sharedHeadTermCount([])).toBe(0);
        expect(sharedHeadTermCount([entry('butter'), entry('milk')])).toBe(1);
    });
});

describe('findCatalogShortfalls', () => {
    const enough = Array.from({ length: MIN_RESOLVED_FOODS }, (_, index) => entry(`chicken cut${index}`));

    it('passes a catalog that clears both bars', () => {
        expect(findCatalogShortfalls({ resolved: enough, rejected: [] })).toEqual([]);
    });

    it('fails a catalog with too few searchable rows', () => {
        expect(
            findCatalogShortfalls({ resolved: enough.slice(1), rejected: [entry('egg', 'UNRESOLVED')] }),
        ).toHaveLength(1);
    });

    it('fails a catalog where nothing shares a head term, however many rows it has', () => {
        // The suite re-searches on a result's own head term and requires more than one hit. A catalog of
        // twenty unrelated staples satisfies the count and still cannot answer that.
        const unrelated = ['butter', 'milk', 'egg', 'flour', 'sugar', 'salt'].map((name) => entry(name));

        expect(findCatalogShortfalls({ resolved: unrelated, rejected: [] })).toEqual([
            expect.stringContaining('no two resolved foods share a head term'),
        ]);
    });
});

describe('seedFoodCatalog', () => {
    it('returns immediately when every name was an inline hit', async () => {
        const d = deps({ batch: vi.fn().mockResolvedValue([item('a', 'RESOLVED'), item('b', 'RESOLVED')]) });
        const outcome = await seedFoodCatalog(['alpha', 'beta'], d);

        expect(outcome.resolved.map((e) => e.name).sort()).toEqual(['alpha', 'beta']);
        expect(d.status).not.toHaveBeenCalled();
    });

    it('polls a pending name until the worker resolves it', async () => {
        const status = vi.fn().mockResolvedValueOnce(item('b', 'PENDING')).mockResolvedValue(item('b', 'RESOLVED'));
        const d = deps({ batch: vi.fn().mockResolvedValue([item('a', 'RESOLVED'), item('b', 'PENDING')]), status });

        await expect(seedFoodCatalog(['alpha', 'beta'], d)).resolves.toMatchObject({ rejected: [] });
        expect(status).toHaveBeenCalledTimes(2);
    });

    it('REPORTS an unresolvable name with its NAME, and does not fail', async () => {
        // ⛔ The regression this file exists for. `egg` came back UNRESOLVED on the first live run, the
        // seed threw, and the message named `food 01M1T9…7` — which said nothing about which of ten names
        // to fix. Whether a name is ambiguous is a fact about USDA, not about this repository.
        const d = deps({
            batch: vi.fn().mockResolvedValue([item('a', 'RESOLVED'), item('b', 'UNRESOLVED')]),
        });
        const outcome = await seedFoodCatalog(['chicken breast', 'egg'], d);

        expect(outcome.rejected).toEqual([{ name: 'egg', id: 'b', status: 'UNRESOLVED' }]);
        expect(outcome.resolved.map((e) => e.name)).toEqual(['chicken breast']);
    });

    it('carries the NAME through a mid-poll rejection too', async () => {
        const d = deps({
            batch: vi.fn().mockResolvedValue([item('b', 'PENDING')]),
            status: vi.fn().mockResolvedValue(item('b', 'NOT_FOUND')),
        });

        await expect(seedFoodCatalog(['unobtainium'], d)).resolves.toMatchObject({
            rejected: [{ name: 'unobtainium', status: 'NOT_FOUND' }],
        });
    });

    it('THROWS at the deadline, naming the STUCK NAMES and the causes worth checking first', async () => {
        let clock = 0;
        const d = deps({
            batch: vi.fn().mockResolvedValue([item('a', 'PENDING')]),
            status: vi.fn().mockResolvedValue(item('a', 'PENDING')),
            now: () => {
                const value = clock;
                clock += 600;

                return value;
            },
        });

        await expect(seedFoodCatalog(['chicken breast'], d)).rejects.toThrow(
            /still PENDING after 1000ms \(chicken breast\)[\s\S]*USDA_API_KEY/,
        );
    });
});

describe('findProbeShortfall', () => {
    it('passes when the probe returns enough rows', () => {
        expect(findProbeShortfall(CATALOG_PROBE_QUERY, MIN_PROBE_RESULTS)).toEqual([]);
    });

    it('fails on exactly one row — the suite asserts strictly MORE than one', () => {
        // The off-by-one that matters: a catalog holding a single `chicken breast` row satisfies every
        // count-based check and still fails the suite on its first assertion.
        expect(findProbeShortfall(CATALOG_PROBE_QUERY, 1)).toHaveLength(1);
        expect(findProbeShortfall(CATALOG_PROBE_QUERY, 0)[0]).toContain('returned 0 row(s)');
    });

    it('names the query, so the fix is obvious from the log alone', () => {
        expect(findProbeShortfall('chicken breast', 1)[0]).toContain('"chicken breast"');
    });
});

describe('the probe query is the one the suite issues', () => {
    it('is a name the seed actually asks for', () => {
        // ⛔ If these two drift, the seed proves a query nobody runs and the suite runs a query nobody
        // seeded — which is the shape of the original failure, one layer up.
        expect(CATALOG_SEED_NAMES).toContain(CATALOG_PROBE_QUERY);
    });
});

describe('pickCandidate', () => {
    it('takes the service"s own first entry', () => {
        expect(
            pickCandidate([
                { candidateId: 'c1', name: 'a' },
                { candidateId: 'c2', name: 'b' },
            ]),
        ).toBe('c1');
    });

    it('answers undefined for an empty set rather than throwing', () => {
        expect(pickCandidate([])).toBeUndefined();
    });
});

describe('seedFoodCatalog — the disambiguation half', () => {
    it('walks the flow for an UNRESOLVED food and reports it RESOLVED', async () => {
        // ⛔ The step without which the seed produced 3 of 10 rows on a live preview. `UNRESOLVED` is the
        // food service working as designed, not a failure — it defers to the disambiguation a user sees.
        const resolve = vi.fn().mockResolvedValue(undefined);
        const outcome = await seedFoodCatalog(['butter'], {
            ...deps({ batch: vi.fn().mockResolvedValue([item('b', 'UNRESOLVED')]) }),
            candidates: vi.fn().mockResolvedValue([{ candidateId: 'c1', name: 'Butter, salted' }]),
            resolve,
        });

        expect(resolve).toHaveBeenCalledWith('b', 'c1');
        expect(outcome.resolved).toEqual([{ name: 'butter', id: 'b', status: 'RESOLVED' }]);
    });

    it('never touches a food that is already RESOLVED', async () => {
        const candidates = vi.fn();
        await seedFoodCatalog(['milk'], {
            ...deps({ batch: vi.fn().mockResolvedValue([item('m', 'RESOLVED')]) }),
            candidates,
            resolve: vi.fn(),
        });

        expect(candidates).not.toHaveBeenCalled();
    });

    it('leaves a food with NO candidates unresolved, and says so, rather than failing the run', async () => {
        const outcome = await seedFoodCatalog(['unobtainium'], {
            ...deps({ batch: vi.fn().mockResolvedValue([item('u', 'UNRESOLVED')]) }),
            candidates: vi.fn().mockResolvedValue([]),
            resolve: vi.fn(),
        });

        expect(outcome.rejected).toEqual([{ name: 'unobtainium', id: 'u', status: 'UNRESOLVED' }]);
    });

    it('survives a refused PATCH and keeps going with the rest', async () => {
        const outcome = await seedFoodCatalog(['butter', 'milk'], {
            ...deps({ batch: vi.fn().mockResolvedValue([item('b', 'UNRESOLVED'), item('m', 'UNRESOLVED')]) }),
            candidates: vi.fn().mockResolvedValue([{ candidateId: 'c1', name: 'x' }]),
            resolve: vi.fn().mockRejectedValueOnce(new Error('409 conflict')).mockResolvedValue(undefined),
        });

        expect(outcome.resolved.map((e) => e.name)).toEqual(['milk']);
        expect(outcome.rejected.map((e) => e.name)).toEqual(['butter']);
    });

    it('is a no-op when the caller supplies no disambiguation seam', async () => {
        const outcome = await seedFoodCatalog(
            ['butter'],
            deps({
                batch: vi.fn().mockResolvedValue([item('b', 'UNRESOLVED')]),
            }),
        );

        expect(outcome.rejected.map((e) => e.status)).toEqual(['UNRESOLVED']);
    });
});
