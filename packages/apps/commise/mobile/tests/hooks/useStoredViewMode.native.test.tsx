/**
 * The library's list/grid choice on native, kept per device in `AsyncStorage` under the shared key
 * (`docs/design/uiOverhaul/buildSpec.md` §4.3): it starts unknown, takes the stored choice once read, ignores a value
 * that is not a view, and stores a new choice.
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { store } = vi.hoisted(() => ({ store: new Map<string, string>() }));

vi.mock('@react-native-async-storage/async-storage', () => ({
    default: {
        getItem: async (key: string) => store.get(key) ?? null,
        setItem: async (key: string, value: string) => {
            store.set(key, value);
        },
    },
}));

import { useStoredViewMode } from '../../src/hooks/useStoredViewMode.js';

beforeEach(() => store.clear());

describe('useStoredViewMode', () => {
    it('takes the stored choice once read', async () => {
        store.set('recipes.viewMode', 'grid');
        const { result } = renderHook(() => useStoredViewMode());

        expect(result.current[0]).toBeUndefined();
        await waitFor(() => expect(result.current[0]).toBe('grid'));
    });

    it('ignores a stored value that is not a view', async () => {
        store.set('recipes.viewMode', 'tiles');
        const { result } = renderHook(() => useStoredViewMode());

        await act(async () => undefined);

        expect(result.current[0]).toBeUndefined();
    });

    it('stores a new choice and shows it at once', async () => {
        const { result } = renderHook(() => useStoredViewMode());

        await act(async () => {
            result.current[1]('list');
        });

        expect(result.current[0]).toBe('list');
        expect(store.get('recipes.viewMode')).toBe('list');
    });

    it('lets a choice made before the read lands win over the stored one', async () => {
        store.set('recipes.viewMode', 'grid');
        const { result } = renderHook(() => useStoredViewMode());

        act(() => {
            result.current[1]('list');
        });
        await act(async () => undefined);

        expect(result.current[0]).toBe('list');
    });
});
