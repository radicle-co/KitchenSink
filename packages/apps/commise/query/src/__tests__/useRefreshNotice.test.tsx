import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useRefreshNotice } from '../useRefreshNotice.js';

afterEach(cleanup);

/**
 * Drives the hook over a REAL TanStack query, so `failed`/`refreshing` are the library's own flags and a retry's
 * success or failure is the real awaited `refetch` result, not a stub of it.
 */
function renderNotice(queryFn: () => Promise<string>, onRecovered?: () => void) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { readonly children: ReactNode }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );

    return renderHook(
        () => {
            const query = useQuery({ queryKey: ['recipes'], queryFn });

            return { query, notice: useRefreshNotice(query, onRecovered === undefined ? undefined : { onRecovered }) };
        },
        { wrapper },
    );
}

describe('useRefreshNotice', () => {
    it('reports nothing for a read that loaded', async () => {
        const { result } = renderNotice(() => Promise.resolve('rows'));

        await waitFor(() => expect(result.current.query.data).toBe('rows'));

        expect(result.current.notice).toMatchObject({ failed: false, refreshing: false, recoveries: 0 });
    });

    it('⛔ a failed REFETCH over loaded data is `failed`; a read that never loaded is not this notice’s', async () => {
        const queryFn = vi.fn<() => Promise<string>>().mockRejectedValue(new Error('down'));
        const { result } = renderNotice(queryFn);

        await waitFor(() => expect(result.current.query.isLoadingError).toBe(true));
        expect(result.current.notice.failed).toBe(false);
    });

    it('is `failed` once a refetch over loaded rows fails, and a retry that fails again leaves `recoveries` alone', async () => {
        const queryFn = vi
            .fn<() => Promise<string>>()
            .mockResolvedValueOnce('rows')
            .mockRejectedValue(new Error('down'));
        const { result } = renderNotice(queryFn);
        await waitFor(() => expect(result.current.query.data).toBe('rows'));

        await act(async () => {
            await result.current.query.refetch();
        });
        await waitFor(() => expect(result.current.notice.failed).toBe(true));

        await act(async () => {
            result.current.notice.onRetry();
        });
        await waitFor(() => expect(queryFn).toHaveBeenCalledTimes(3));
        await waitFor(() => expect(result.current.notice.refreshing).toBe(false));

        expect(result.current.notice.failed).toBe(true);
        expect(result.current.notice.recoveries).toBe(0);
    });

    it('⛔ a retry started from the notice that SUCCEEDS clears `failed` and advances `recoveries` once', async () => {
        const queryFn = vi
            .fn<() => Promise<string>>()
            .mockResolvedValueOnce('rows')
            .mockRejectedValueOnce(new Error('down'))
            .mockResolvedValueOnce('fresh rows');
        const { result } = renderNotice(queryFn);
        await waitFor(() => expect(result.current.query.data).toBe('rows'));
        await act(async () => {
            await result.current.query.refetch();
        });

        await act(async () => {
            result.current.notice.onRetry();
        });

        await waitFor(() => expect(result.current.notice.recoveries).toBe(1));
        expect(result.current.notice.failed).toBe(false);
        expect(result.current.query.data).toBe('fresh rows');
    });

    it('⛔ recovery by ANY other refetch (a pull, a focus refetch) clears `failed` without advancing `recoveries`', async () => {
        const queryFn = vi
            .fn<() => Promise<string>>()
            .mockResolvedValueOnce('rows')
            .mockRejectedValueOnce(new Error('down'))
            .mockResolvedValueOnce('fresh rows');
        const { result } = renderNotice(queryFn);
        await waitFor(() => expect(result.current.query.data).toBe('rows'));
        await act(async () => {
            await result.current.query.refetch();
        });

        await waitFor(() => expect(result.current.notice.failed).toBe(true));
        await act(async () => {
            await result.current.query.refetch();
        });

        await waitFor(() => expect(result.current.notice.failed).toBe(false));
        expect(result.current.notice.recoveries).toBe(0);
    });

    it('is `refreshing` while a refetch over loaded data is in flight', async () => {
        let settle: (rows: string) => void = () => undefined;
        const queryFn = vi
            .fn<() => Promise<string>>()
            .mockResolvedValueOnce('rows')
            .mockReturnValueOnce(new Promise((resolve) => (settle = resolve)));
        const { result } = renderNotice(queryFn);
        await waitFor(() => expect(result.current.query.data).toBe('rows'));

        act(() => {
            void result.current.query.refetch();
        });

        await waitFor(() => expect(result.current.notice.refreshing).toBe(true));
        await act(async () => {
            settle('fresh rows');
        });
        await waitFor(() => expect(result.current.notice.refreshing).toBe(false));
    });
});

/**
 * The recovery LIFTED out of the read: a surface whose focus target (the heading, in a frame outside the suspense
 * boundary) and whose notice (inside it) sit on opposite sides of the boundary cannot share a `recoveries` counter, so
 * the notice reports each recovery through `onRecovered` and the frame's owner counts them with `useRecoverySignal`.
 */
describe('useRefreshNotice — onRecovered', () => {
    it('⛔ fires ONCE when a retry started from the notice succeeds', async () => {
        const onRecovered = vi.fn();
        const queryFn = vi
            .fn<() => Promise<string>>()
            .mockResolvedValueOnce('rows')
            .mockRejectedValueOnce(new Error('down'))
            .mockResolvedValueOnce('fresh rows');
        const { result } = renderNotice(queryFn, onRecovered);
        await waitFor(() => expect(result.current.query.data).toBe('rows'));
        await act(async () => {
            await result.current.query.refetch();
        });

        await act(async () => {
            result.current.notice.onRetry();
        });

        await waitFor(() => expect(result.current.notice.recoveries).toBe(1));
        expect(onRecovered).toHaveBeenCalledTimes(1);
    });

    it('does not fire for a retry that fails again, nor for a recovery by any other refetch', async () => {
        const onRecovered = vi.fn();
        const queryFn = vi
            .fn<() => Promise<string>>()
            .mockResolvedValueOnce('rows')
            .mockRejectedValueOnce(new Error('down'))
            .mockRejectedValueOnce(new Error('still down'))
            .mockResolvedValueOnce('fresh rows');
        const { result } = renderNotice(queryFn, onRecovered);
        await waitFor(() => expect(result.current.query.data).toBe('rows'));
        await act(async () => {
            await result.current.query.refetch();
        });

        await act(async () => {
            result.current.notice.onRetry();
        });
        await waitFor(() => expect(queryFn).toHaveBeenCalledTimes(3));
        await act(async () => {
            await result.current.query.refetch();
        });

        await waitFor(() => expect(result.current.notice.failed).toBe(false));
        expect(onRecovered).not.toHaveBeenCalled();
    });
});
