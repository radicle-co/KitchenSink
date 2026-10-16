/**
 * Tests for {@link useStateCriteriaStore} — the component-state criteria port mobile hands the shared discovery screen
 * (web hands the URL-backed one). The port's contract: it HOLDS the committed criteria and `commit` replaces them.
 */
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { EMPTY_RECIPE_FILTERS } from '../../filters/model.js';
import { useStateCriteriaStore } from '../useStateCriteriaStore.js';

describe('useStateCriteriaStore', () => {
    it('starts on the empty filters and a blank query', () => {
        const { result } = renderHook(() => useStateCriteriaStore());

        expect(result.current.filters).toEqual(EMPTY_RECIPE_FILTERS);
        expect(result.current.query).toBe('');
    });

    it('starts on the filters it was given (a tag deep-link), and a blank query', () => {
        const { result } = renderHook(() => useStateCriteriaStore({ tags: ['grill'] }));

        expect(result.current.filters).toEqual({ tags: ['grill'] });
        expect(result.current.query).toBe('');
    });

    it('holds whatever was last committed, filters and query together', () => {
        const { result } = renderHook(() => useStateCriteriaStore());

        act(() => result.current.commit({ filters: { tags: ['vegan'] }, query: 'soup' }));

        expect(result.current.filters).toEqual({ tags: ['vegan'] });
        expect(result.current.query).toBe('soup');

        act(() => result.current.commit({ filters: EMPTY_RECIPE_FILTERS, query: '' }));

        expect(result.current.filters).toEqual(EMPTY_RECIPE_FILTERS);
        expect(result.current.query).toBe('');
    });
});
