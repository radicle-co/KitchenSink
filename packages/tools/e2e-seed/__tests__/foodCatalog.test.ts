/**
 * The catalog seed's two jobs: get every name to a settled state, and refuse loudly rather than let a
 * suite run against a half-filled catalog.
 */
import { describe, expect, it, vi } from 'vitest';

import { CATALOG_SEED_NAMES, classifyCatalog, seedFoodCatalog, type CatalogItem } from '../src/foodCatalog.js';

const item = (id: string, status: CatalogItem['status']): CatalogItem => ({ id, status });

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
    it('stays inside the endpoint"s 100-name cap', () => {
        expect(CATALOG_SEED_NAMES.length).toBeLessThanOrEqual(100);
    });

    it('contains at least two names sharing a HEAD TERM', () => {
        // The linkage suite re-searches on `name.split(',')[0]` and requires MORE THAN ONE result. A USDA
        // merge-winner name is `Chicken, broilers or fryers, breast…`, so several chicken cuts is not
        // padding — it is the only thing that makes that second assertion satisfiable.
        const heads = CATALOG_SEED_NAMES.map((name) => name.split(' ')[0]);
        const shared = heads.filter((head, index) => heads.indexOf(head) !== index);

        expect(shared.length).toBeGreaterThanOrEqual(1);
    });

    it('names nothing twice', () => {
        expect(new Set(CATALOG_SEED_NAMES).size).toBe(CATALOG_SEED_NAMES.length);
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

    it('counts UNRESOLVED as FAILED, never as pending', () => {
        // It means the source returned candidates nothing could pick between. Waiting for it would burn the
        // whole deadline and then report a timeout instead of the name that was a bad choice.
        expect(classifyCatalog([item('a', 'UNRESOLVED')])).toEqual({ resolved: [], pending: [], failed: ['a'] });
    });
});

describe('seedFoodCatalog', () => {
    it('returns immediately when every name was an inline hit', async () => {
        const d = deps({ batch: vi.fn().mockResolvedValue([item('a', 'RESOLVED'), item('b', 'RESOLVED')]) });

        await expect(seedFoodCatalog(['a', 'b'], d)).resolves.toEqual(['a', 'b']);
        expect(d.status).not.toHaveBeenCalled();
    });

    it('polls a pending name until the worker resolves it', async () => {
        const status = vi.fn().mockResolvedValueOnce(item('b', 'PENDING')).mockResolvedValue(item('b', 'RESOLVED'));
        const d = deps({ batch: vi.fn().mockResolvedValue([item('a', 'RESOLVED'), item('b', 'PENDING')]), status });

        await expect(seedFoodCatalog(['a', 'b'], d)).resolves.toEqual(['a', 'b']);
        expect(status).toHaveBeenCalledTimes(2);
    });

    it('REFUSES a name the source could not settle, naming it', async () => {
        const d = deps({ batch: vi.fn().mockResolvedValue([item('a', 'NOT_FOUND')]) });

        await expect(seedFoodCatalog(['a'], d)).rejects.toThrow(/the source refused 1 of 1 names: a/);
    });

    it('REFUSES a name that settles UNRESOLVED mid-poll', async () => {
        const d = deps({
            batch: vi.fn().mockResolvedValue([item('a', 'PENDING')]),
            status: vi.fn().mockResolvedValue(item('a', 'UNRESOLVED')),
        });

        await expect(seedFoodCatalog(['a'], d)).rejects.toThrow(/settled as UNRESOLVED/);
    });

    it('THROWS at the deadline, naming the causes worth checking first', async () => {
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

        // ⛔ Never resolves partially. A suite run against a half-filled catalog fails about search
        // relevance rather than about the one fact that explains it.
        await expect(seedFoodCatalog(['a'], d)).rejects.toThrow(/still PENDING after 1000ms[\s\S]*USDA_API_KEY/);
    });
});
