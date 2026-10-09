/**
 * The display-name sheet's state machine, once for both apps (`buildSpec.md` §9.1): closed → open with a draft →
 * saving → closed with “Saved.”, or → open with a failure. Each app injects Clerk's user and the profile mutation.
 *
 * Run over a REAL `useMutation` with a promise the case settles by hand, because the defect these pin lives in
 * TanStack's `reset()`: called while a save is in flight, it detaches the observer, the call's `onSuccess` never runs
 * (no “Saved.”, the sheet's state lost), and `isPending` reads `false` so a second PATCH can start.
 */
import { SnackbarHost } from '@commise/ui/snackbar';
import { QueryClient, QueryClientProvider, useMutation } from '@tanstack/react-query';
import { act, cleanup, renderHook, screen, waitFor } from '@testing-library/react';
import type { UserUpdateInput } from '@kitchensink/schema-identity';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { makeUserProfile } from '../../__fixtures__/index.js';
import type { GivenNameSource } from '../model.js';
import { useDisplayNameEditor } from '../useDisplayNameEditor.js';

afterEach(cleanup);

/** A save the case settles by hand. */
function deferredSave() {
    const pending: { resolve: () => void; reject: (error: Error) => void }[] = [];
    const mutationFn = vi.fn(
        (_body: UserUpdateInput) =>
            new Promise<ReturnType<typeof makeUserProfile>>((resolve, reject) => {
                pending.push({ resolve: () => resolve(makeUserProfile()), reject });
            }),
    );

    return {
        mutationFn,
        settle: async (outcome: 'success' | 'failure') => {
            const next = pending.shift();

            if (next === undefined) {
                throw new Error('no save is in flight');
            }

            await act(async () => {
                if (outcome === 'success') {
                    next.resolve();
                } else {
                    next.reject(new Error('503'));
                }
            });
        },
    };
}

function renderEditor(options: { readonly saved?: string; readonly user?: GivenNameSource | null } = {}) {
    const save = deferredSave();
    const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const wrapper = ({ children }: { readonly children: ReactNode }) => (
        <QueryClientProvider client={queryClient}>
            <SnackbarHost>{children}</SnackbarHost>
        </QueryClientProvider>
    );
    const view = renderHook(
        () =>
            useDisplayNameEditor({
                saved: options.saved ?? '',
                user: options.user ?? null,
                update: useMutation({ mutationFn: save.mutationFn }),
            }),
        { wrapper },
    );

    return { ...view, save };
}

describe('useDisplayNameEditor — opening', () => {
    it('seeds the draft from the SAVED name, never the given name over it', () => {
        const { result } = renderEditor({ saved: 'Eliza', user: { firstName: 'Elizabeth' } });

        act(() => result.current.openSheet());

        expect(result.current.open).toBe(true);
        expect(result.current.draft).toBe('Eliza');
        // Unchanged from the saved name: nothing to save.
        expect(result.current.canSave).toBe(false);
    });

    it('prefills the given name only when nothing is saved, and writes nothing for it', () => {
        const { result, save } = renderEditor({ user: { firstName: 'Elizabeth' } });

        act(() => result.current.openSheet());

        expect(result.current.draft).toBe('Elizabeth');
        expect(save.mutationFn).not.toHaveBeenCalled();
    });

    it('drops an abandoned edit on reopen', () => {
        const { result } = renderEditor({ saved: 'Eliza' });

        act(() => result.current.openSheet());
        act(() => result.current.setDraft('Something else'));
        act(() => result.current.setOpen(false));
        act(() => result.current.openSheet());

        expect(result.current.draft).toBe('Eliza');
    });
});

describe('useDisplayNameEditor — saving', () => {
    it('sends only the trimmed display name, then closes and says “Saved.”', async () => {
        const { result, save } = renderEditor();

        act(() => result.current.openSheet());
        act(() => result.current.setDraft('  Eliza  '));
        await act(async () => result.current.save());

        await waitFor(() => expect(result.current.saving).toBe(true));
        expect(save.mutationFn.mock.calls[0]?.[0]).toEqual({ displayName: 'Eliza' });

        await save.settle('success');

        expect(await screen.findByText('Saved.')).toBeTruthy();
        expect(result.current.open).toBe(false);
    });

    it('does nothing while Save is not allowed', async () => {
        const { result, save } = renderEditor({ saved: 'Eliza' });

        act(() => result.current.openSheet());
        await act(async () => result.current.save());

        expect(save.mutationFn).not.toHaveBeenCalled();
    });

    it('keeps the sheet open with the failure, and clears the failure when the cook closes it', async () => {
        const { result, save } = renderEditor();

        act(() => result.current.openSheet());
        act(() => result.current.setDraft('Eliza'));
        await act(async () => result.current.save());
        await save.settle('failure');

        await waitFor(() => expect(result.current.failed).toBe(true));
        expect(result.current.open).toBe(true);

        act(() => result.current.setOpen(false));

        expect(result.current.failed).toBe(false);
    });
});

describe('useDisplayNameEditor — closing or reopening during a save', () => {
    it('closing mid-save keeps the save: no second PATCH, and “Saved.” still shows', async () => {
        const { result, save } = renderEditor();

        act(() => result.current.openSheet());
        act(() => result.current.setDraft('Eliza'));
        await act(async () => result.current.save());
        await waitFor(() => expect(result.current.saving).toBe(true));
        act(() => result.current.setOpen(false));

        expect(result.current.saving).toBe(true);

        act(() => result.current.openSheet());
        await act(async () => result.current.save());

        expect(save.mutationFn).toHaveBeenCalledTimes(1);

        await save.settle('success');

        await waitFor(() => expect(screen.getByText('Saved.')).toBeTruthy());
        expect(result.current.open).toBe(false);
    });

    it('reopening mid-save shows the name being saved, not the old one', async () => {
        const { result } = renderEditor({ saved: 'Old' });

        act(() => result.current.openSheet());
        act(() => result.current.setDraft('Eliza'));
        await act(async () => result.current.save());
        await waitFor(() => expect(result.current.saving).toBe(true));
        act(() => result.current.setOpen(false));
        act(() => result.current.openSheet());

        expect(result.current.open).toBe(true);
        expect(result.current.draft).toBe('Eliza');
        expect(result.current.saving).toBe(true);
    });
});
