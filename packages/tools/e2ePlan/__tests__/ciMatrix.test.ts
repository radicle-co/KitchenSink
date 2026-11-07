import { describe, expect, it } from 'vitest';

import {
    maestroOutputs,
    maestroSelector,
    webSelectionOutputs,
    webShardCount,
    webShardMatrix,
} from '../src/ciMatrix.js';

describe('webShardCount', () => {
    it('is zero when nothing is listed, so no leg starts', () => {
        expect(webShardCount(0, 14, 8)).toBe(0);
    });

    it('rounds up, so a single extra test still gets a shard', () => {
        expect(webShardCount(1, 14, 8)).toBe(1);
        expect(webShardCount(14, 14, 8)).toBe(1);
        expect(webShardCount(15, 14, 8)).toBe(2);
    });

    it('never passes the roster, because a shard past it would sign in as another shard', () => {
        expect(webShardCount(10_000, 14, 8)).toBe(8);
        expect(webShardCount(10_000, 14, 3)).toBe(3);
    });

    it.each([
        [-1, 14, 8],
        [Number.NaN, 14, 8],
        [10, 0, 8],
        [10, Number.NaN, 8],
        [10, 14, -1],
    ])('refuses nonsense input (%s, %s, %s) rather than guessing a size', (listed, perShard, roster) => {
        expect(() => webShardCount(listed, perShard, roster)).toThrow();
    });
});

describe('webShardMatrix', () => {
    it('lists shards 1 to N as the JSON a matrix reads', () => {
        expect(webShardMatrix(3)).toBe('[1,2,3]');
    });

    it('is an empty list for none', () => {
        expect(webShardMatrix(0)).toBe('[]');
    });
});

describe('maestroSelector', () => {
    it('is empty for the whole suite, which the runner reads as every flow', () => {
        expect(maestroSelector({ kind: 'all', reasons: ['r'] })).toBe('');
    });

    it('names each flow as a flow key', () => {
        expect(maestroSelector({ kind: 'some', ids: ['auth/loginFlow', 'recipes/landscape'] })).toBe(
            'flow:auth/loginFlow=true flow:recipes/landscape=true',
        );
    });

    it('refuses an id that could carry a second argument', () => {
        expect(() => maestroSelector({ kind: 'some', ids: ['a b'] })).toThrow();
        expect(() => maestroSelector({ kind: 'some', ids: ['$(x)'] })).toThrow();
    });
});

describe('webSelectionOutputs', () => {
    it('sizes the shards from the listed tests and carries the spec filters', () => {
        expect(
            webSelectionOutputs({ kind: 'specs', filters: ['^a\\.spec\\.ts$', '^b\\.spec\\.ts$'], tests: 30 }, 14, 8),
        ).toEqual({
            web_tests: '30',
            web_specs: '^a\\.spec\\.ts$ ^b\\.spec\\.ts$',
            web_shards: '[1,2,3]',
        });
    });

    it('runs no shard when the change touches no spec', () => {
        expect(webSelectionOutputs({ kind: 'none' }, 14, 8)).toEqual({
            web_tests: '0',
            web_specs: '',
            web_shards: '[]',
        });
    });

    it('runs the whole suite with no list file when nothing was selected', () => {
        expect(webSelectionOutputs({ kind: 'unselected', tests: 696 }, 14, 8)).toEqual({
            web_tests: '696',
            web_specs: '',
            web_shards: '[1,2,3,4,5,6,7,8]',
        });
    });
});

describe('maestroOutputs', () => {
    it('runs the whole suite with an empty selector', () => {
        expect(maestroOutputs({ kind: 'all', reasons: ['r'] })).toEqual({ maestro_run: 'true', maestro_selector: '' });
    });

    it('runs the named flows', () => {
        expect(maestroOutputs({ kind: 'some', ids: ['home'] })).toEqual({
            maestro_run: 'true',
            maestro_selector: 'flow:home=true',
        });
    });

    it('runs nothing for an empty list, because an empty selector would read as every flow', () => {
        expect(maestroOutputs({ kind: 'some', ids: [] })).toEqual({ maestro_run: 'false', maestro_selector: '' });
    });
});
