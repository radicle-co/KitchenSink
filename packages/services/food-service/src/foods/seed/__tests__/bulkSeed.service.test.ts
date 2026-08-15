/**
 * Unit suite for {@link BulkSeedService} — the source-agnostic bulk-seed orchestrator (Stage 1, F-W2).
 *
 * The whole point of these tests is the two failure modes the design review caught, both of which a
 * happy-path test would sail straight past:
 *
 *   1. **The find-or-create is load-bearing (F-W2).** A blind re-create + `onConflictDoUpdate` keeps the
 *      OLD crosswalk `food_id` while the values write against a NEW one → a same-food provenance FK
 *      violation. Idempotency comes from `findByExternalKey` → reuse, NOT from the raw unique constraint.
 *   2. **`persistResolved` calls `setStatus('RESOLVED')`, and `RESOLVED → RESOLVED` is NOT a legal
 *      transition** (`FoodDao.LEGAL_PRIORS`). So a re-seed of an already-RESOLVED row MUST go through
 *      `mergeChangedSources` (which stays RESOLVED and replaces each source's portions) — routing it to
 *      `resolveAndPersist` would throw `IllegalStatusTransitionError` AND duplicate portions.
 *
 * Plus: `origin='bulk'` must be stamped BEFORE the food reaches RESOLVED, or there is a window in which
 * the change-refresh scan can see it as a live-refreshable RESOLVED row (F-C2).
 */
import { describe, expect, it, vi } from 'vitest';

import type { CanonicalCandidate } from '../../../sources/foodSourceAdapter.js';
import { makeMergeCandidate } from '../../merge/__fixtures__/merge.fixtures.js';
import type { FoodRow, FoodSourceRow } from '../../../db/schema/index.js';
import { isBulkSeedAbortedError } from '../bulkSeed.errors.js';
import {
    BulkSeedService,
    type SeedCrosswalkStore,
    type SeedFoodStore,
    type SeedPersister,
} from '../bulkSeed.service.js';

/** A `food` row shaped for the store fake. */
function foodRow(overrides: Partial<FoodRow> = {}): FoodRow {
    return {
        id: 'food-1',
        name: 'Broccoli, raw',
        normalizedName: 'broccoli, raw',
        description: null,
        kind: 'generic',
        brandOwner: null,
        brandName: null,
        barcode: null,
        status: 'PENDING',
        origin: 'live',
        tombstonedAt: null,
        createdAt: new Date('2026-07-26T00:00:00.000Z'),
        updatedAt: new Date('2026-07-26T00:00:00.000Z'),
        searchVector: '',
        ...overrides,
    };
}

/** A `food_sources` crosswalk row shaped for the store fake. */
function crosswalkRow(overrides: Partial<FoodSourceRow> = {}): FoodSourceRow {
    return {
        id: 'src-1',
        foodId: 'food-1',
        source: 'usda',
        externalKey: '170379',
        fetchState: 'fetched',
        itemVersion: 'bulk:aaa',
        fetchedAt: new Date('2026-07-26T00:00:00.000Z'),
        ...overrides,
    };
}

/** Build the three fakes + the service under test, recording call order across all of them. */
function build(options: {
    readonly crosswalk?: FoodSourceRow | undefined;
    readonly food?: FoodRow;
    readonly maxConsecutiveFailures?: number;
}) {
    const calls: string[] = [];

    const record =
        <T>(name: string, result: T) =>
        async (): Promise<T> => {
            calls.push(name);

            return result;
        };

    const foods: SeedFoodStore = {
        getById: vi.fn(async () => options.food ?? foodRow()),
        createByName: vi.fn(async () => {
            calls.push('createByName');

            return { id: 'food-1', created: true, reactivated: false };
        }),
        setStatus: vi.fn(async () => {
            calls.push('setStatus');

            return foodRow({ status: 'PENDING' });
        }),
        markOrigin: vi.fn(async () => {
            calls.push('markOrigin');
        }),
    };
    const sources: SeedCrosswalkStore = {
        findByExternalKey: vi.fn(async () => options.crosswalk),
    };
    const persister: SeedPersister = {
        resolveAndPersist: vi.fn(record('resolveAndPersist', { outcome: 'RESOLVED', status: 'RESOLVED' } as const)),
        resolveFromPicks: vi.fn(record('resolveFromPicks', { outcome: 'RESOLVED', status: 'RESOLVED' } as const)),
        mergeChangedSources: vi.fn(record('mergeChangedSources', { outcome: 'RESOLVED', status: 'RESOLVED' } as const)),
    };

    const service = new BulkSeedService({
        foods,
        sources,
        persist: persister,
        ...(options.maxConsecutiveFailures !== undefined
            ? { maxConsecutiveFailures: options.maxConsecutiveFailures }
            : {}),
    });

    return { service, foods, sources, persist: persister, calls };
}

/** A one-candidate async stream. */
async function* stream(...candidates: readonly CanonicalCandidate[]): AsyncGenerator<CanonicalCandidate> {
    for (const candidate of candidates) {
        yield candidate;
    }
}

const bulkCandidate = (overrides: Partial<CanonicalCandidate> = {}): CanonicalCandidate =>
    makeMergeCandidate('usda', {
        externalKey: '170379',
        name: 'Broccoli, raw',
        itemVersion: 'bulk:aaa',
        ...overrides,
    });

describe('BulkSeedService — find-or-create per external key (F-W2)', () => {
    it('creates a fresh food by NORMALIZED name when the crosswalk has no such external key', async () => {
        const { service, foods, persist } = build({ crosswalk: undefined });

        const result = await service.seed(stream(bulkCandidate({ name: '  Broccoli,   RAW  ' })));

        expect(foods.createByName).toHaveBeenCalledWith({
            normalizedName: 'broccoli, raw',
            displayName: '  Broccoli,   RAW  ',
        });
        expect(persist.resolveAndPersist).toHaveBeenCalledWith({
            foodId: 'food-1',
            candidates: [expect.objectContaining({ externalKey: '170379' })],
        });
        expect(result).toMatchObject({ total: 1, seeded: 1, refreshed: 0, unchanged: 0, failed: 0 });
    });

    it('REUSES the crosswalk food_id instead of re-creating (a blind re-create FK-violates)', async () => {
        const { service, foods, persist } = build({
            crosswalk: crosswalkRow({ foodId: 'food-existing' }),
            food: foodRow({ id: 'food-existing', status: 'PENDING' }),
        });

        await service.seed(stream(bulkCandidate()));

        expect(foods.createByName).not.toHaveBeenCalled();
        expect(persist.resolveAndPersist).toHaveBeenCalledWith(expect.objectContaining({ foodId: 'food-existing' }));
    });
});

describe('BulkSeedService — origin marking (F-C2 ordering)', () => {
    it('stamps origin=bulk BEFORE the food is persisted RESOLVED (no refreshable window)', async () => {
        const { service, foods, calls } = build({ crosswalk: undefined });

        await service.seed(stream(bulkCandidate()));

        expect(foods.markOrigin).toHaveBeenCalledWith({ id: 'food-1', origin: 'bulk' });
        expect(calls.indexOf('markOrigin')).toBeLessThan(calls.indexOf('resolveAndPersist'));
    });

    it('re-stamps a previously LIVE food as bulk even when the item version is unchanged', async () => {
        // A food first admitted through the live API path carries origin='live'. Once bulk data backs it,
        // it MUST be re-classified or it stays in the live change-refresh scan and gets its lab-analyzed
        // nutrition clobbered by API values (F-C2).
        const { service, foods, persist } = build({
            crosswalk: crosswalkRow({ itemVersion: 'bulk:aaa' }),
            food: foodRow({ status: 'RESOLVED', origin: 'live' }),
        });

        const result = await service.seed(stream(bulkCandidate({ itemVersion: 'bulk:aaa' })));

        expect(foods.markOrigin).toHaveBeenCalledWith({ id: 'food-1', origin: 'bulk' });
        expect(persist.mergeChangedSources).toHaveBeenCalledOnce();
        expect(result).toMatchObject({ unchanged: 0, refreshed: 1 });
    });
});

describe('BulkSeedService — lifecycle dispatch (persistResolved cannot re-enter RESOLVED)', () => {
    it('routes an already-RESOLVED bulk food to mergeChangedSources, never resolveAndPersist', async () => {
        const { service, persist } = build({
            crosswalk: crosswalkRow({ itemVersion: 'bulk:old' }),
            food: foodRow({ status: 'RESOLVED', origin: 'bulk' }),
        });

        const result = await service.seed(stream(bulkCandidate({ itemVersion: 'bulk:new' })));

        expect(persist.mergeChangedSources).toHaveBeenCalledWith({
            foodId: 'food-1',
            changed: [expect.objectContaining({ itemVersion: 'bulk:new' })],
        });
        expect(persist.resolveAndPersist).not.toHaveBeenCalled();
        expect(result).toMatchObject({ refreshed: 1, seeded: 0 });
    });

    it('routes a normalized-name dedup onto an already-RESOLVED food to mergeChangedSources', async () => {
        // Two different fdcIds can normalize to the SAME name; `createByName` returns the existing
        // RESOLVED row, so dispatching on the fetched status (not on "did I just create it") is required.
        const { service, foods, persist } = build({
            crosswalk: undefined,
            food: foodRow({ status: 'RESOLVED', origin: 'bulk' }),
        });

        await service.seed(stream(bulkCandidate({ externalKey: '999999' })));

        expect(foods.createByName).toHaveBeenCalledOnce();
        expect(persist.mergeChangedSources).toHaveBeenCalledOnce();
        expect(persist.resolveAndPersist).not.toHaveBeenCalled();
    });

    it('routes an UNRESOLVED food through resolveFromPicks so its obsolete candidate set is cleared', async () => {
        const { service, persist } = build({ crosswalk: undefined, food: foodRow({ status: 'UNRESOLVED' }) });

        const result = await service.seed(stream(bulkCandidate()));

        expect(persist.resolveFromPicks).toHaveBeenCalledWith({
            foodId: 'food-1',
            picks: [expect.objectContaining({ externalKey: '170379' })],
        });
        expect(result).toMatchObject({ seeded: 1 });
    });

    it.each(['NOT_FOUND', 'FAILED'] as const)(
        'reactivates a %s tombstone to PENDING before persisting (the only legal path in)',
        async (status) => {
            const { service, foods, persist, calls } = build({ crosswalk: undefined, food: foodRow({ status }) });

            await service.seed(stream(bulkCandidate()));

            expect(foods.setStatus).toHaveBeenCalledWith({ id: 'food-1', status: 'PENDING' });
            expect(calls.indexOf('setStatus')).toBeLessThan(calls.indexOf('resolveAndPersist'));
            expect(persist.resolveAndPersist).toHaveBeenCalledOnce();
        },
    );
});

describe('BulkSeedService — idempotent re-run (resumability)', () => {
    it('skips an unchanged, already-RESOLVED bulk food without touching the database', async () => {
        const { service, foods, persist } = build({
            crosswalk: crosswalkRow({ itemVersion: 'bulk:same' }),
            food: foodRow({ status: 'RESOLVED', origin: 'bulk' }),
        });

        const result = await service.seed(stream(bulkCandidate({ itemVersion: 'bulk:same' })));

        expect(result).toMatchObject({ total: 1, unchanged: 1, seeded: 0, refreshed: 0 });
        expect(foods.markOrigin).not.toHaveBeenCalled();
        expect(persist.mergeChangedSources).not.toHaveBeenCalled();
        expect(persist.resolveAndPersist).not.toHaveBeenCalled();
    });

    it('does NOT skip when the crosswalk has no recorded item version (never fully persisted)', async () => {
        const { service, persist } = build({
            crosswalk: crosswalkRow({ itemVersion: null }),
            food: foodRow({ status: 'RESOLVED', origin: 'bulk' }),
        });

        const result = await service.seed(stream(bulkCandidate({ itemVersion: null })));

        expect(result).toMatchObject({ unchanged: 0, refreshed: 1 });
        expect(persist.mergeChangedSources).toHaveBeenCalledOnce();
    });
});

describe('BulkSeedService — failure isolation and fail-fast', () => {
    it('counts a failing row, keeps going, and still seeds the rest', async () => {
        const { service, persist } = build({ crosswalk: undefined });
        vi.mocked(persist.resolveAndPersist)
            .mockRejectedValueOnce(new Error('deadlock detected'))
            .mockResolvedValue({ outcome: 'RESOLVED', status: 'RESOLVED' });

        const result = await service.seed(
            stream(bulkCandidate({ externalKey: '1' }), bulkCandidate({ externalKey: '2' })),
        );

        expect(result).toMatchObject({ total: 2, failed: 1, seeded: 1 });
    });

    it('aborts with a typed error once consecutive failures hit the cap (systemic breakage, not one bad row)', async () => {
        const { service, persist } = build({ crosswalk: undefined, maxConsecutiveFailures: 2 });
        vi.mocked(persist.resolveAndPersist).mockRejectedValue(new Error('relation "food" does not exist'));

        const candidates = Array.from({ length: 50 }, (_value, index) => bulkCandidate({ externalKey: String(index) }));

        await expect(service.seed(stream(...candidates))).rejects.toSatisfy(isBulkSeedAbortedError);
        // It bailed at the cap instead of grinding through all 50.
        expect(persist.resolveAndPersist).toHaveBeenCalledTimes(2);
    });

    it('resets the consecutive-failure counter after a success', async () => {
        const { service, persist } = build({ crosswalk: undefined, maxConsecutiveFailures: 2 });
        vi.mocked(persist.resolveAndPersist)
            .mockRejectedValueOnce(new Error('transient'))
            .mockResolvedValueOnce({ outcome: 'RESOLVED', status: 'RESOLVED' })
            .mockRejectedValueOnce(new Error('transient'))
            .mockResolvedValueOnce({ outcome: 'RESOLVED', status: 'RESOLVED' });

        const result = await service.seed(
            stream(
                bulkCandidate({ externalKey: '1' }),
                bulkCandidate({ externalKey: '2' }),
                bulkCandidate({ externalKey: '3' }),
                bulkCandidate({ externalKey: '4' }),
            ),
        );

        expect(result).toMatchObject({ total: 4, failed: 2, seeded: 2 });
    });
});

describe('BulkSeedService — progress reporting', () => {
    it('logs periodic progress and a final count', async () => {
        const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
        const { foods, sources, persist } = build({ crosswalk: undefined });
        const service = new BulkSeedService({ foods, sources, persist, logger, progressEvery: 2 });

        const result = await service.seed(
            stream(
                bulkCandidate({ externalKey: '1' }),
                bulkCandidate({ externalKey: '2' }),
                bulkCandidate({ externalKey: '3' }),
            ),
        );

        expect(result.total).toBe(3);
        expect(logger.info).toHaveBeenCalledWith('bulk-seed-progress', expect.objectContaining({ total: 2 }));
        expect(logger.info).toHaveBeenCalledWith('bulk-seed-complete', expect.objectContaining({ total: 3 }));
    });

    it('reports an empty stream as a clean zero-count run', async () => {
        const { service } = build({ crosswalk: undefined });

        await expect(service.seed(stream())).resolves.toMatchObject({
            total: 0,
            seeded: 0,
            refreshed: 0,
            unchanged: 0,
            failed: 0,
        });
    });
});
