/**
 * The pure classifier behind the floating create button (`docs/design/uiOverhaul/buildSpec.md` §3.4): which of four
 * library states the query cache is in. Each test is built so that breaking one branch of the classifier fails it.
 */
import { describe, expect, it } from 'vitest';

import { createEntryYields, libraryStateOf, type ReadSnapshot } from '../libraryState.js';

const chunk = (total: number) => ({ pages: [{ total }] });
const page = (total: number) => ({ total });

const read = (over: Partial<ReadSnapshot> = {}): ReadSnapshot => ({
    data: undefined,
    dataUpdatedAt: 0,
    status: 'pending',
    fetchStatus: 'fetching',
    ...over,
});
const settled = (data: ReadSnapshot['data'], dataUpdatedAt = 1, over: Partial<ReadSnapshot> = {}): ReadSnapshot =>
    read({ data, dataUpdatedAt, status: 'success', fetchStatus: 'idle', ...over });

describe('libraryStateOf', () => {
    it('populated: a settled read with recipes (chunked or one page)', () => {
        expect(libraryStateOf([settled(chunk(3))], undefined)).toBe('populated');
        expect(libraryStateOf([settled(page(2))], undefined)).toBe('populated');
    });

    it('empty: a settled read of nothing (chunked or one page)', () => {
        expect(libraryStateOf([settled(chunk(0))], undefined)).toBe('empty');
        expect(libraryStateOf([settled(page(0))], undefined)).toBe('empty');
    });

    it('loading: nothing settled and the own read is fetching, or has no entry yet', () => {
        expect(libraryStateOf([], read())).toBe('loading');
        expect(libraryStateOf([], undefined)).toBe('loading');
        expect(libraryStateOf([read()], read())).toBe('loading');
    });

    it('unreachable: nothing settled and the own read is paused (offline)', () => {
        expect(libraryStateOf([], read({ fetchStatus: 'paused' }))).toBe('unreachable');
    });

    it('unreachable: nothing settled and the own read errored, even while it retries', () => {
        expect(libraryStateOf([], read({ status: 'error', fetchStatus: 'idle' }))).toBe('unreachable');
        expect(libraryStateOf([], read({ status: 'error', fetchStatus: 'fetching' }))).toBe('unreachable');
    });

    it('warm: cached data wins over a refetch that is in flight, paused or failed', () => {
        expect(libraryStateOf([settled(chunk(2), 1, { fetchStatus: 'fetching' })], undefined)).toBe('populated');
        expect(libraryStateOf([settled(chunk(2), 1, { fetchStatus: 'paused' })], undefined)).toBe('populated');
        expect(libraryStateOf([settled(chunk(0), 1, { status: 'error' })], undefined)).toBe('empty');
    });

    it('is family-wide: another sort`s settled read judges while the own key is still fetching', () => {
        expect(libraryStateOf([settled(chunk(4)), read()], read())).toBe('populated');
        expect(libraryStateOf([settled(chunk(0))], read())).toBe('empty');
    });

    it('takes the LATEST settled read of the family', () => {
        expect(libraryStateOf([settled(chunk(0), 10), settled(page(5), 20)], undefined)).toBe('populated');
        expect(libraryStateOf([settled(chunk(5), 10), settled(page(0), 20)], undefined)).toBe('empty');
    });

    it('on a tie of time, prefers populated (a button that stays is the safe error)', () => {
        expect(libraryStateOf([settled(chunk(0), 10), settled(page(5), 10)], undefined)).toBe('populated');
        expect(libraryStateOf([settled(page(5), 10), settled(chunk(0), 10)], undefined)).toBe('populated');
    });

    it('an own read that settled is used when the family holds no settled read', () => {
        expect(libraryStateOf([], settled(chunk(0)))).toBe('empty');
        expect(libraryStateOf([], settled(chunk(1)))).toBe('populated');
    });
});

describe('createEntryYields', () => {
    it.each([
        ['loading', true],
        ['empty', true],
        ['populated', false],
        ['unreachable', false],
    ] as const)('%s -> %s', (state, expected) => {
        expect(createEntryYields(state)).toBe(expected);
    });
});
