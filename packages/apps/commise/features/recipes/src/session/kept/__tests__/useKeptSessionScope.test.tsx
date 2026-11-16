import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { KeptSessionStore } from '../keptSessionStore.js';
import { useKeptSessionScope } from '../useKeptSessionScope.js';

function makeStore(scope: KeptSessionStore['scope'] = () => Promise.resolve()) {
    const spy = vi.fn(scope);
    const store: KeptSessionStore = {
        getSnapshot: () => ({ status: 'loading' }),
        subscribe: () => () => undefined,
        scope: spy,
        dispatch: () => Promise.resolve({ kind: 'unchanged' }),
        clear: () => Promise.resolve(),
        reread: () => Promise.resolve(),
    };

    return { store, spy };
}

describe('useKeptSessionScope (KTD4)', () => {
    it.each([undefined, null, 'user_a'])('hands the store the raw value %s', (subject) => {
        const { store, spy } = makeStore();

        renderHook(() => useKeptSessionScope(store, subject));

        expect(spy).toHaveBeenCalledWith(subject);
    });

    it('calls scope again on a change, and once for a rerender with the same value', () => {
        const { store, spy } = makeStore();
        const { rerender } = renderHook(({ subject }) => useKeptSessionScope(store, subject), {
            initialProps: { subject: 'user_a' as string | null | undefined },
        });

        rerender({ subject: 'user_a' });
        expect(spy).toHaveBeenCalledTimes(1);

        rerender({ subject: null });
        expect(spy).toHaveBeenCalledTimes(2);
        expect(spy).toHaveBeenLastCalledWith(null);
    });

    it('swallows a rejection from the store (the store reports its own failures)', async () => {
        const { store } = makeStore(() => Promise.reject(new Error('port failed')));
        const unhandled = vi.fn();

        process.on('unhandledRejection', unhandled);
        renderHook(() => useKeptSessionScope(store, 'user_a'));
        await new Promise((resolve) => setTimeout(resolve, 0));
        process.off('unhandledRejection', unhandled);

        expect(unhandled).not.toHaveBeenCalled();
    });
});
