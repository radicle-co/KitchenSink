/**
 * The Profile page's read-and-edit assembly, once for both apps: the three-state read, and the display-name editor
 * seeded from what the server holds. Both pages computed `saved` the same way (the saved name once the read is ready, and
 * nothing before then) and fed it to the editor.
 *
 * What would break if it were wrong: an editor seeded from a name the server never confirmed, or one that offers Save
 * before the read has answered.
 */
import { SnackbarHost } from '@commise/ui/snackbar';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { DisplayNameSave } from '../useDisplayNameEditor.js';
import { useProfileScreen } from '../useProfileScreen.js';

const wrapper = ({ children }: { children: ReactNode }) => <SnackbarHost>{children}</SnackbarHost>;

const update = (): DisplayNameSave => ({ mutate: vi.fn(), reset: vi.fn(), isPending: false, isError: false });

const ready = (displayName: string) => ({
    isError: false,
    data: { user: { displayName, email: 'cook@example.com', username: 'braise' } },
});

describe('useProfileScreen', () => {
    it('reads loading, failed and ready from the query', () => {
        const loading = renderHook(
            () => useProfileScreen({ query: { isError: false }, user: null, update: update() }),
            {
                wrapper,
            },
        );
        const failed = renderHook(() => useProfileScreen({ query: { isError: true }, user: null, update: update() }), {
            wrapper,
        });
        const ok = renderHook(() => useProfileScreen({ query: ready(' Ada '), user: null, update: update() }), {
            wrapper,
        });

        expect(loading.result.current.read).toEqual({ status: 'loading' });
        expect(failed.result.current.read).toEqual({ status: 'failed' });
        expect(ok.result.current.read).toEqual({
            status: 'ready',
            displayName: 'Ada',
            email: 'cook@example.com',
            username: 'braise',
        });
    });

    it('seeds the editor from the SAVED name once ready', () => {
        const { result } = renderHook(
            () => useProfileScreen({ query: ready('Ada'), user: { firstName: 'Grace' }, update: update() }),
            { wrapper },
        );

        act(() => result.current.editor.openSheet());

        expect(result.current.editor.draft).toBe('Ada');
    });

    it('treats the saved name as empty before the read answers, so the given name only prefills', () => {
        const { result } = renderHook(
            () => useProfileScreen({ query: { isError: false }, user: { firstName: 'Grace' }, update: update() }),
            { wrapper },
        );

        act(() => result.current.editor.openSheet());

        expect(result.current.editor.draft).toBe('Grace');
    });
});
