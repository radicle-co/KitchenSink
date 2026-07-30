/**
 * Collection create/rename screen (mobile, T073). Owns the editable name and drives the shared native
 * `CollectionForm` building block, wiring submit to `useCreateCollection` (create) or `useUpdateCollection`
 * (rename). A successful submit navigates away via `onDone`; a failed submit is surfaced through the form's
 * error slot. The screen holds only the transient name input — the mutation + query cache own remote state.
 */
import { CollectionForm, type CollectionFormMode } from '@commise/features-recipes';
import { useMessages } from '@commise/i18n/react';
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
    /** Invoked when the user cancels the form. */
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
    const { collections: t } = useMessages(mobileMessages);
    const [name, setName] = useState(initialName);
    const create = useCreateCollection();
    const update = useUpdateCollection();

    const submitting = create.isPending || update.isPending;
    const failed = create.isError || update.isError;

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
        <CollectionForm
            mode={mode}
            name={name}
            submitting={submitting}
            error={failed ? t.saveError : undefined}
            onChange={setName}
            onSubmit={handleSubmit}
            onCancel={onCancel}
        />
    );
}
