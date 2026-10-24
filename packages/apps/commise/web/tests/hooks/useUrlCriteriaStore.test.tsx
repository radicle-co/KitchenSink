// @vitest-environment jsdom
/**
 * The URL-backed criteria store the web discovery screen hands the shared screen. Its contract (the port's): `commit`
 * takes the next criteria OR an update of the criteria current when it runs, and an update reads the address as it is
 * now, so two commits in one event both land even though this render's `useSearchParams()` snapshot cannot see the first.
 */
import { filtersFromQueryString } from '@commise/features-recipes';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
    usePathname: () => '/discover',
    // A render-time snapshot: the address as it was when the hook last rendered.
    useSearchParams: () => new URLSearchParams(window.location.search),
}));

import { useUrlCriteriaStore } from '@/hooks/useUrlCriteriaStore';

const addressNow = () => filtersFromQueryString(window.location.search);

beforeEach(() => {
    window.history.replaceState(null, '', '/discover?query=pie&tags=grill');
});

afterEach(cleanup);

describe('useUrlCriteriaStore', () => {
    it('reads the criteria from the address', () => {
        const { result } = renderHook(() => useUrlCriteriaStore());

        expect(result.current.query).toBe('pie');
        expect(result.current.filters).toEqual({ tags: ['grill'] });
    });

    it('writes the next criteria to the address', () => {
        const { result } = renderHook(() => useUrlCriteriaStore());

        act(() => result.current.commit({ filters: { tags: ['vegan'] }, query: 'soup' }));

        expect(addressNow()).toEqual({ filters: { tags: ['vegan'] }, query: 'soup' });
    });

    it('applies an update over the address as it is NOW, so two commits in one event both land', () => {
        const { result } = renderHook(() => useUrlCriteriaStore());

        act(() => {
            result.current.commit((current) => ({ ...current, filters: { tags: ['vegan'] } }));
            result.current.commit((current) => ({ ...current, query: 'soup' }));
        });

        expect(addressNow()).toEqual({ filters: { tags: ['vegan'] }, query: 'soup' });
    });
});
