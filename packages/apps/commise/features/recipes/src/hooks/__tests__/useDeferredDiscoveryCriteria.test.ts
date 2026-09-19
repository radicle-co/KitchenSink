/**
 * Tests for {@link useDeferredDiscoveryCriteria} — the deferral both discovery containers put between the criteria a
 * viewer sets and the criteria the results read.
 *
 * The trap it exists to hold is identity: `useDeferredValue` compares with `Object.is`, and both containers build a
 * fresh criteria object on every render (web re-parses its filters from the URL each time). Criteria that are equal
 * must therefore come back as the SAME settled object, or the deferral restarts on every render and the results are
 * never anything but stale.
 */
import { RecipeSearchSortBy } from '@kitchensink/recipe-core';
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { RecipeDiscoveryCriteria } from '../../discovery/model.js';
import { useDeferredDiscoveryCriteria } from '../useDeferredDiscoveryCriteria.js';

/** A fresh criteria object on every call — what a container builds on every render. */
function criteria(overrides: Partial<RecipeDiscoveryCriteria> = {}): RecipeDiscoveryCriteria {
    return {
        filters: { tags: ['quick'], ingredients: [{ id: 'food_1', name: 'Basil' }] },
        query: 'pesto',
        sortBy: RecipeSearchSortBy.RELEVANCE,
        browseDismissed: false,
        ...overrides,
    };
}

describe('useDeferredDiscoveryCriteria', () => {
    it('settles on the first criteria at once, with nothing stale', () => {
        const { result } = renderHook(() => useDeferredDiscoveryCriteria(criteria()));

        expect(result.current.settled).toEqual(criteria());
        expect(result.current.stale).toBe(false);
    });

    it('⛔ keeps the SAME settled object across renders whose criteria are equal but freshly built', () => {
        const { result, rerender } = renderHook(({ value }) => useDeferredDiscoveryCriteria(value), {
            initialProps: { value: criteria() },
        });
        const first = result.current.settled;

        rerender({ value: criteria() });

        expect(result.current.settled).toBe(first);
        expect(result.current.stale).toBe(false);
    });

    it('reports stale while the previous criteria are still what renders, then settles on the new ones', () => {
        const renders: { readonly query: string; readonly stale: boolean }[] = [];
        const { result, rerender } = renderHook(
            ({ value }) => {
                const deferred = useDeferredDiscoveryCriteria(value);
                renders.push({ query: deferred.settled.query, stale: deferred.stale });

                return deferred;
            },
            { initialProps: { value: criteria() } },
        );
        renders.length = 0;

        act(() => rerender({ value: criteria({ query: 'pesto pasta' }) }));

        expect(renders[0]).toEqual({ query: 'pesto', stale: true });
        expect(result.current.settled.query).toBe('pesto pasta');
        expect(result.current.stale).toBe(false);
    });

    it('⛔ hands back EXACTLY the filters it was given — an off-ladder time bound and a repeated ingredient survive', () => {
        // The key must be lossless: re-reading filters through the URL parser dropped both, silently changing the search.
        const odd = criteria({
            filters: {
                maxPrepTime: 17,
                ingredients: [
                    { id: 'food_1', name: 'Basil' },
                    { id: 'food_1', name: 'Basil' },
                ],
            },
        });
        const { result } = renderHook(() => useDeferredDiscoveryCriteria(odd));

        expect(result.current.settled).toEqual(odd);
    });

    it.each([
        ['a filter', { filters: { tags: ['quick', 'vegan'] } }],
        ['the sort', { sortBy: RecipeSearchSortBy.QUICKEST }],
        ['leaving browse', { browseDismissed: true }],
    ] as const)('treats a change to %s as new criteria', (_, change) => {
        const { result, rerender } = renderHook(({ value }) => useDeferredDiscoveryCriteria(value), {
            initialProps: { value: criteria() },
        });
        const first = result.current.settled;

        act(() => rerender({ value: criteria(change) }));

        expect(result.current.settled).not.toBe(first);
        expect(result.current.settled).toEqual(criteria(change));
    });
});
