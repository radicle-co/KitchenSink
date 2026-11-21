/**
 * The mobile account CLOSE composes the store-review clear (S12 U2, plan 0011 KTD2). The clear sits where a close can be
 * told from a plain sign-out: after the close step is ACCEPTED and before the verified sign-out, while the cook's id is
 * still known. `useSignOutAndVerify` and `endDeviceSession` are the plain sign-out's path and do not change.
 *
 * `useClosureSequence` runs for real; only the identity client, the sign-out command and the record are doubled, each one
 * as a spy that shares one order log, so a mutant that moves the clear shows as a wrong order, not a missing call.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { order, deleteMe, signOutAndVerify, clear, auth } = vi.hoisted(() => {
    const log: string[] = [];
    const auth: { userId: string | null | undefined } = { userId: 'user_cook' };

    return {
        order: log,
        deleteMe: vi.fn(),
        signOutAndVerify: vi.fn(),
        clear: vi.fn(),
        auth,
    };
});

vi.mock('@clerk/expo', () => ({ useAuth: () => ({ userId: auth.userId }) }));
vi.mock('../../src/hooks/useProfileServiceClient.js', () => ({ useProfileServiceClient: () => ({ deleteMe }) }));
vi.mock('../../src/hooks/useSignOutAndVerify.js', () => ({ useSignOutAndVerify: () => ({ signOutAndVerify }) }));
vi.mock('../../src/storage/storeReviewRecord.js', () => ({ nativeStoreReviewRecord: { clear } }));

const { useDeleteAccount } = await import('../../src/hooks/useDeleteAccount.js');

function closeAccount() {
    const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const wrapper = ({ children }: { readonly children: ReactNode }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const view = renderHook(() => useDeleteAccount(), { wrapper });

    return { ...view, run: () => act(async () => view.result.current.mutateAsync().catch(() => undefined)) };
}

beforeEach(() => {
    order.length = 0;
    auth.userId = 'user_cook';
    deleteMe.mockReset().mockImplementation(() => {
        order.push('close');

        return Promise.resolve();
    });
    clear.mockReset().mockImplementation(() => {
        order.push('clear');

        return Promise.resolve();
    });
    signOutAndVerify.mockReset().mockImplementation(() => {
        order.push('leave');

        return Promise.resolve();
    });
});

afterEach(cleanup);

describe('useDeleteAccount (mobile): the store-review clear', () => {
    it('⛔ clears this cook`s record after the close is accepted and before the sign-out', async () => {
        const { run } = closeAccount();

        await run();

        expect(order).toEqual(['close', 'clear', 'leave']);
        expect(clear).toHaveBeenCalledWith('user_cook');
    });

    it('⛔ leaves the record when the close fails, and does not sign out', async () => {
        deleteMe.mockRejectedValue(new Error('503'));
        const { run, result } = closeAccount();

        await run();

        expect(clear).not.toHaveBeenCalled();
        expect(signOutAndVerify).not.toHaveBeenCalled();
        await waitFor(() => {
            expect(result.current.error?.step).toBe('close');
        });
    });

    it('still signs out, and names the exit step, when the sign-out fails after the clear', async () => {
        signOutAndVerify.mockRejectedValue(new Error('not verified'));
        const { run, result } = closeAccount();

        await run();

        expect(clear).toHaveBeenCalledTimes(1);
        await waitFor(() => {
            expect(result.current.error?.step).toBe('exit');
        });
    });

    it('asks to clear nobody when no cook id is known, and still signs out', async () => {
        auth.userId = null;
        const { run } = closeAccount();

        await run();

        expect(clear).toHaveBeenCalledWith(undefined);
        expect(order).toEqual(['close', 'clear', 'leave']);
    });
});
