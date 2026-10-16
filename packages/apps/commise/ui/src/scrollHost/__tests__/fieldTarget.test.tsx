/**
 * The field-target cursor (`docs/design/uiOverhaul/specSharedSystem.md` §16.3): a host counts how many times a field
 * was named by id, and a field reads its own count. A count is a level a field can compare with the one it mounted
 * under, so a field that mounts under a standing count stays still and only a later increase moves it.
 */
import { renderHook } from '@testing-library/react';
import type { FC, ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import { FieldTargetContext, useFieldTarget } from '../fieldTarget.js';

const within =
    (counts: Readonly<Record<string, number>>): FC<{ readonly children: ReactNode }> =>
    ({ children }) => <FieldTargetContext.Provider value={counts}>{children}</FieldTargetContext.Provider>;

describe('useFieldTarget', () => {
    it('is 0 outside any host', () => {
        const { result } = renderHook(() => useFieldTarget('recipe-title'));

        expect(result.current).toBe(0);
    });

    it('is 0 for an id the host was never asked about', () => {
        const { result } = renderHook(() => useFieldTarget('recipe-title'), { wrapper: within({ other: 3 }) });

        expect(result.current).toBe(0);
    });

    it('reads the count of its own id, and no other', () => {
        const wrapper = within({ title: 2, servings: 5 });

        expect(renderHook(() => useFieldTarget('title'), { wrapper }).result.current).toBe(2);
        expect(renderHook(() => useFieldTarget('servings'), { wrapper }).result.current).toBe(5);
    });
});
