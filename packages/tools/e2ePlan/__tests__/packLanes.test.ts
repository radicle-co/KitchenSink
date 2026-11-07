import { describe, expect, it } from 'vitest';

import { packLanes, staleDurations } from '../src/packLanes.js';

const ids = (count: number): string[] => Array.from({ length: count }, (_, index) => `t${index}`);

describe('packLanes', () => {
    it('puts every test in exactly one lane', () => {
        const all = ids(25);
        const { lanes } = packLanes({ ids: all, durations: {}, laneCount: 4, defaultMs: 1000 });

        expect(lanes.flat().sort()).toEqual([...all].sort());
    });

    it('balances by duration, not by count: one long test fills a lane on its own', () => {
        const durations = { long: 100, a: 10, b: 10, c: 10, d: 10, e: 10, f: 10, g: 10, h: 10, i: 10 };
        const { lanes, estimateMs } = packLanes({
            ids: Object.keys(durations),
            durations,
            laneCount: 2,
            defaultMs: 1,
        });

        expect(lanes.find((lane) => lane.includes('long'))).toEqual(['long']);
        expect(estimateMs).toEqual(expect.arrayContaining([100, 90]));
    });

    it('is no worse than a third above the ideal split (longest-first greedy)', () => {
        const durations = Object.fromEntries(
            Array.from({ length: 60 }, (_, index) => [`t${index}`, 5 + ((index * 37) % 90)]),
        );
        const { estimateMs } = packLanes({ ids: Object.keys(durations), durations, laneCount: 6, defaultMs: 1 });
        const ideal = Object.values(durations).reduce((sum, ms) => sum + ms, 0) / 6;

        expect(Math.max(...estimateMs)).toBeLessThanOrEqual(ideal * (4 / 3));
    });

    it('gives a test with no recorded duration the default, and says which ones', () => {
        const { defaulted, estimateMs } = packLanes({
            ids: ['known', 'new one'],
            durations: { known: 50 },
            laneCount: 1,
            defaultMs: 700,
        });

        expect(defaulted).toEqual(['new one']);
        expect(estimateMs).toEqual([750]);
    });

    it('is deterministic: the same input packs the same way', () => {
        const input = { ids: ids(30), durations: {}, laneCount: 4, defaultMs: 1000 };

        expect(packLanes(input)).toEqual(packLanes({ ...input, ids: [...input.ids].reverse() }));
    });

    it('never returns an empty lane: it uses fewer lanes when there are fewer tests', () => {
        const { lanes } = packLanes({ ids: ['a', 'b'], durations: {}, laneCount: 5, defaultMs: 1 });

        expect(lanes).toHaveLength(2);
        expect(lanes.every((lane) => lane.length > 0)).toBe(true);
    });

    it('returns no lanes for no tests', () => {
        expect(packLanes({ ids: [], durations: {}, laneCount: 3, defaultMs: 1 }).lanes).toEqual([]);
    });

    it('counts a repeated id once: Playwright matches every test of that title, so they travel together', () => {
        const { lanes } = packLanes({ ids: ['x', 'x', 'y'], durations: {}, laneCount: 2, defaultMs: 1 });

        expect(lanes.flat().sort()).toEqual(['x', 'y']);
    });
});

describe('staleDurations', () => {
    it('lists tests with no duration and durations for tests that no longer exist', () => {
        expect(staleDurations(['a', 'b'], { b: 1, c: 2 })).toEqual({ missing: ['a'], unused: ['c'] });
    });

    it('is clean when the table and the listing agree', () => {
        expect(staleDurations(['a'], { a: 1 })).toEqual({ missing: [], unused: [] });
    });
});
