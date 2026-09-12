/**
 * Collection create/rename screen (mobile, T073). Owns the editable name and drives the shared native
 * `CollectionForm` building block, wiring submit to `useCreateCollection` (create) or `useUpdateCollection`
 * (rename). A successful submit navigates away via `onDone`; a failed submit is surfaced through the form's
 * error slot. The screen holds only the transient name input — the mutation + query cache own remote state.
 */
import { CollectionForm, type CollectionFormMode } from '@commise/features-recipes';
import { useMessages } from '@commise/i18n/react';
import { useBackIntercept } from '@commise/ui/back-intercept';
import { ConfirmDialog } from '@commise/ui/confirm-dialog';
import { useCreateCollection, useUpdateCollection } from '@kitchensink/recipe-service-client/hooks';
import type { JSX } from 'react';
import { useState } from 'react';

import { mobileMessages } from '../i18n/messages.js';

/** Props for {@link CollectionFormScreen}. */
export interface CollectionFormScreenProps {
    /** Create a new collection, or rename an existing one. */
    readonly mode: CollectionFormMode;
    /** The collection id to rename (required in `rename` mode; ignored in `create`). */
    readonly collectionId?: string;
    /** The seed name (the current name in `rename` mode; blank in `create`). */
    readonly initialName?: string;
    /** Invoked after a successful create/rename. */
    readonly onDone: () => void;
    /**
     * Invoked when the user leaves the form without saving.
     *
     * ⚠️ It is the ANSWER to a leave, never the leave itself: an edited name is confirmed first.
     */
    readonly onCancel: () => void;
}

/**
 * The collection create/rename screen.
 *
 * @param props - The mode, seed values, and the done/cancel callbacks the navigator wires.
 * @returns The collection form wired to the create or update mutation.
 */
export function CollectionFormScreen({
    mode,
    collectionId,
    initialName = '',
    onDone,
    onCancel,
}: CollectionFormScreenProps): JSX.Element {
    const { collections: t, common } = useMessages(mobileMessages);
    const [name, setName] = useState(initialName);
    const [confirmingExit, setConfirmingExit] = useState(false);
    const create = useCreateCollection();
    const update = useUpdateCollection();

    const submitting = create.isPending || update.isPending;
    const failed = create.isError || update.isError;

    /**
     * Leave, or ask first.
     *
     * ⛔ MEASURED AGAINST THE SEED, not against emptiness: a rename opens holding the current name, so
     * "there is text in the box" would nag on every untouched rename and train the cook to dismiss the one
     * dialog that matters. Trimmed on both sides — trailing whitespace the submit would drop is not a loss.
     *
     * @sideEffect Either navigates away or opens the confirmation.
     */
    const requestCancel = (): void => {
        if (name.trim() === initialName.trim()) {
            onCancel();

            return;
        }

        setConfirmingExit(true);
    };

    // ⛔ THE SYSTEM BACK BUTTON IS THE SECOND ENTRY POINT TO THIS GUARD. The host pops a pushed surface for
    // a press nothing claims, and the edited name lives only in the state above — so an unguarded press
    // destroys it silently, exactly as it did for the recipe wizard before `@commise/ui/back-intercept`.
    //
    // ⛔ `true` IN BOTH BRANCHES: the clean branch navigates ITSELF, and answering `false` after navigating
    // lets the host's own default run as well and pops two surfaces for one press.
    useBackIntercept(() => {
        requestCancel();

        return true;
    });

    const handleSubmit = (): void => {
        if (mode === 'create') {
            create.mutate({ name }, { onSuccess: onDone });

            return;
        }

        if (collectionId !== undefined) {
            update.mutate({ id: collectionId, request: { name } }, { onSuccess: onDone });
        }
    };

    return (
        <>
            <CollectionForm
                mode={mode}
                name={name}
                submitting={submitting}
                error={failed ? t.saveError : undefined}
                onChange={setName}
                onSubmit={handleSubmit}
                onCancel={requestCancel}
            />
            <ConfirmDialog
                open={confirmingExit}
                title={common.discard.title}
                description={common.discard.body}
                confirmLabel={common.discard.confirm}
                cancelLabel={common.discard.cancel}
                destructive
                onConfirm={() => {
                    setConfirmingExit(false);
                    onCancel();
                }}
                onCancel={() => setConfirmingExit(false)}
            />
        </>
    );
}
