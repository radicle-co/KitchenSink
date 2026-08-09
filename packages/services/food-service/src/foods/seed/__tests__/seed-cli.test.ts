/**
 * Unit suite for the bulk-seed CLI argument handling. An operator invokes this task by hand against a
 * real database, so a mistyped flag must fail LOUDLY at parse time rather than degrade into an import that
 * silently seeds nothing (`Number('1O')` is `NaN`, and `NaN` comparisons are all false).
 */
import { afterEach, describe, expect, it } from 'vitest';

import type { CanonicalCandidate } from '../../../sources/food-source-adapter.js';
import { makeMergeCandidate } from '../../merge/__fixtures__/merge.fixtures.js';
import { parseSeedArgs, take } from '../seed-cli.js';

describe('parseSeedArgs', () => {
    afterEach(() => {
        Reflect.deleteProperty(process.env, 'USDA_BULK_DIR');
    });

    it('reads --dir', () => {
        expect(parseSeedArgs(['--dir', './fdc'])).toEqual({ dir: './fdc', limit: undefined });
    });

    it('falls back to USDA_BULK_DIR when --dir is absent', () => {
        process.env['USDA_BULK_DIR'] = '/mnt/fdc';

        expect(parseSeedArgs([])).toEqual({ dir: '/mnt/fdc', limit: undefined });
    });

    it('prefers an explicit --dir over the environment', () => {
        process.env['USDA_BULK_DIR'] = '/mnt/fdc';

        expect(parseSeedArgs(['--dir', './override']).dir).toBe('./override');
    });

    it('throws when no directory is supplied at all', () => {
        expect(() => parseSeedArgs([])).toThrow(/--dir/);
    });

    it('parses a positive --limit', () => {
        expect(parseSeedArgs(['--dir', './fdc', '--limit', '50'])).toEqual({ dir: './fdc', limit: 50 });
    });

    it.each([['0'], ['-5'], ['1.5'], ['1O'], ['abc'], ['']])('rejects a non-positive-integer --limit (%s)', (limit) => {
        expect(() => parseSeedArgs(['--dir', './fdc', '--limit', limit])).toThrow(/--limit/);
    });

    it('rejects an unknown flag rather than silently ignoring it', () => {
        expect(() => parseSeedArgs(['--dir', './fdc', '--branded'])).toThrow();
    });
});

describe('take', () => {
    /** A stream of `count` distinct candidates. */
    async function* candidates(count: number): AsyncGenerator<CanonicalCandidate> {
        for (let index = 0; index < count; index += 1) {
            yield makeMergeCandidate('usda', { externalKey: String(index) });
        }
    }

    /** Drain an async iterable. */
    async function collect(source: AsyncIterable<CanonicalCandidate>): Promise<string[]> {
        const keys: string[] = [];

        for await (const candidate of source) {
            keys.push(candidate.externalKey);
        }

        return keys;
    }

    it('passes everything through when unbounded', async () => {
        await expect(collect(take(candidates(3), undefined))).resolves.toEqual(['0', '1', '2']);
    });

    it('truncates to the limit', async () => {
        await expect(collect(take(candidates(10), 3))).resolves.toEqual(['0', '1', '2']);
    });

    it('yields everything when the limit exceeds the stream length', async () => {
        await expect(collect(take(candidates(2), 99))).resolves.toEqual(['0', '1']);
    });

    it('stops consuming the SOURCE once the limit is reached (a bounded run must not read 3.4 GB)', async () => {
        let produced = 0;

        const instrumented = async function* (): AsyncGenerator<CanonicalCandidate> {
            for (let index = 0; index < 1_000; index += 1) {
                produced += 1;
                yield makeMergeCandidate('usda', { externalKey: String(index) });
            }
        };

        await collect(take(instrumented(), 2));

        expect(produced).toBe(2);
    });
});
