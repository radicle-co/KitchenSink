'use client';

/**
 * @module components/profile/useDisplayNameEditor — the display-name sheet's state machine (web): closed → open with a
 * draft → saving → closed, or → open with a failure.
 *
 * ORCHESTRATION, because it owns the write. Two rules are the point of it: opening seeds the draft from the SAVED name
 * (the Clerk given name only when nothing is saved — `displayNameDraftOf`), so an abandoned edit never survives a
 * reopen; and nothing is written until `save`, so a prefill the cook never confirms is never stored (the name can show
 * publicly as an author handle).
 *
 * @pattern State — the sheet's closed, open and saving phases as one hook, with `save` as its one Command
 * @sideEffect `save` writes through `useUpdateDisplayName` and shows the “Saved.” snackbar.
 */
import { useUser } from '@clerk/nextjs';
import {
    canSaveDisplayName,
    displayNameDraftOf,
    givenNameOf,
    profileMessages,
} from '@commise/features-account/profile';
import { useMessages } from '@commise/i18n/react';
import { useSnackbar } from '@commise/ui/snackbar';
import { useState } from 'react';

import { useUpdateDisplayName } from '@/hooks/useUpdateDisplayName';

/** What the sheet is bound to. */
export interface DisplayNameEditor {
    readonly open: boolean;
    readonly draft: string;
    readonly canSave: boolean;
    readonly saving: boolean;
    readonly failed: boolean;
    readonly setDraft: (text: string) => void;
    readonly openSheet: () => void;
    readonly setOpen: (open: boolean) => void;
    readonly save: () => void;
}

/**
 * @param saved - The display name the server holds ('' when none).
 * @returns The sheet's state and actions.
 */
export function useDisplayNameEditor(saved: string): DisplayNameEditor {
    const t = useMessages(profileMessages);
    const { user } = useUser();
    const snackbar = useSnackbar();
    const update = useUpdateDisplayName();
    const [open, setOpenState] = useState(false);
    const [draft, setDraft] = useState('');
    const canSave = canSaveDisplayName({ draft, saved });

    const setOpen = (next: boolean): void => {
        setOpenState(next);

        if (!next) {
            update.reset();
        }
    };

    return {
        open,
        draft,
        canSave,
        saving: update.isPending,
        failed: update.isError,
        setDraft,
        openSheet: () => {
            setDraft(displayNameDraftOf({ saved, givenName: givenNameOf(user) }));
            update.reset();
            setOpenState(true);
        },
        setOpen,
        save: () => {
            if (!canSave || update.isPending) {
                return;
            }

            update.mutate(draft.trim(), {
                onSuccess: () => {
                    setOpen(false);
                    snackbar.show({ message: t.saved });
                },
            });
        },
    };
}
