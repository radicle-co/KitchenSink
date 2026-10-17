/**
 * Unit tests for where a step's per-index view state goes when the steps move or one is removed: the Steps leaves key
 * a revealed-but-empty timer by index, and that disclosure must follow its step, not stay at the position.
 */
import { describe, expect, it } from 'vitest';

import { focusAfterRemove, indexAfterMove, indexAfterRemove } from '../stepIndex.js';

describe('indexAfterMove', () => {
    it.each<[number, number, number, number]>([
        // index, from, to, expected
        [1, 1, 2, 2],
        [2, 1, 2, 1],
        [0, 1, 2, 0],
        [3, 1, 2, 3],
        [2, 2, 1, 1],
        [1, 2, 1, 2],
        [0, 3, 0, 1],
        [3, 0, 3, 2],
        [0, 0, 3, 3],
        [1, 1, 1, 1],
    ])('index %i, moving %i to %i, becomes %i', (index, from, to, expected) => {
        expect(indexAfterMove(index, from, to)).toBe(expected);
    });
});

describe('indexAfterRemove', () => {
    it.each<[number, number, number | undefined]>([
        [0, 1, 0],
        [1, 1, undefined],
        [2, 1, 1],
    ])('index %i, removing %i, becomes %s', (index, removed, expected) => {
        expect(indexAfterRemove(index, removed)).toBe(expected);
    });
});

describe('focusAfterRemove', () => {
    it.each([
        [0, 1, { kind: 'add' }],
        [0, 3, { kind: 'actions', index: 0 }],
        [1, 3, { kind: 'actions', index: 1 }],
        [2, 3, { kind: 'actions', index: 1 }],
    ] as const)('removing %i of %i focuses %o', (index, count, expected) => {
        expect(focusAfterRemove(index, count)).toEqual(expected);
    });
});
