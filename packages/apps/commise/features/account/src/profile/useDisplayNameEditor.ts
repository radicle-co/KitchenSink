/**
 * @module @commise/features-account/profile/useDisplayNameEditor — the display-name sheet's state machine, once for
 * both apps (`buildSpec.md` §9.1): closed → open with a draft → saving → closed with “Saved.”, or → open with a
 * failure. Each app injects what is platform-bound: Clerk's user (its own SDK) and the profile mutation (its own
 * client, over the shared `profileMutations(client).update()`).
 *
 * Three rules are the point of it:
 * - opening seeds the draft from the SAVED name (the Clerk given name only when nothing is saved —
 *   `displayNameDraftOf`), so an abandoned edit never survives a reopen;
 * - nothing is written until `save`, so a prefill the cook never confirms is never stored (the name can show publicly
 *   as an author handle);
 * - a save in flight is never reset. TanStack's `reset()` detaches the mutation's observer, so closing or reopening
 *   the sheet mid-save used to drop the call's `onSuccess` (no “Saved.”) and read `isPending` as `false`, which let a
 *   second PATCH start. While saving, closing only hides the sheet and reopening shows the name being saved.
 *
 * @pattern State — the sheet's closed, open and saving phases as one headless hook, with `save` as its one Command
 */
import { useMessages } from '@commise/i18n/react';
import { useSnackbar } from '@commise/ui/snackbar';
import type { UserProfile, UserUpdateInput } from '@kitchensink/schema-identity';
import type { UseMutationResult } from '@tanstack/react-query';
import { useState } from 'react';

import { profileMessages } from './messages.js';
import { canSaveDisplayName, displayNameDraftOf, givenNameOf, type GivenNameSource } from './model.js';

/** The part of the profile mutation the editor drives. */
export type DisplayNameSave = Pick<
    UseMutationResult<UserProfile, Error, UserUpdateInput>,
    'mutate' | 'reset' | 'isPending' | 'isError'
>;

/** What the editor is given. */
export interface DisplayNameEditorInput {
    /** The display name the server holds ('' when none). */
    readonly saved: string;
    /** Clerk's user, or nothing while it loads — the source of the given-name prefill. */
    readonly user: GivenNameSource | null | undefined;
    /** The profile mutation (`profileMutations(client).update()`). */
    readonly update: DisplayNameSave;
}

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
 * @param input - The saved name, Clerk's user and the profile mutation.
 * @returns The sheet's state and actions.
 * @sideEffect `save` writes through the injected mutation and shows the “Saved.” snackbar.
 */
export function useDisplayNameEditor({ saved, user, update }: DisplayNameEditorInput): DisplayNameEditor {
    const t = useMessages(profileMessages);
    const snackbar = useSnackbar();
    const [open, setOpenState] = useState(false);
    const [draft, setDraft] = useState('');
    const canSave = canSaveDisplayName({ draft, saved });

    const setOpen = (next: boolean): void => {
        setOpenState(next);

        if (!next && !update.isPending) {
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
            if (!update.isPending) {
                setDraft(displayNameDraftOf({ saved, givenName: givenNameOf(user) }));
                update.reset();
            }

            setOpenState(true);
        },
        setOpen,
        save: () => {
            if (!canSave || update.isPending) {
                return;
            }

            update.mutate(
                { displayName: draft.trim() },
                {
                    onSuccess: () => {
                        setOpenState(false);
                        update.reset();
                        snackbar.show({ message: t.saved });
                    },
                },
            );
        },
    };
}
