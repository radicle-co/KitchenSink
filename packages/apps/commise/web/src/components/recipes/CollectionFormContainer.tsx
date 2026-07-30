'use client';

/**
 * Container for the collection create/rename routes: owns the controlled name field and binds the shared,
 * presentational `CollectionForm` building block to the create/update mutations. In `create` mode it fetches
 * nothing and calls `useCreateCollection`; in `rename` mode it seeds the field from the loaded collection
 * (`useCollection`, the source of truth in TanStack Query) and calls `useUpdateCollection`. On success it
 * navigates to the affected collection; the empty-name guard and mutation failures are surfaced as localized
 * form errors through the web dictionary (`useMessages`).
 */
import { CollectionForm } from '@commise/features-recipes';
import type { CollectionFormMode } from '@commise/features-recipes';
import { useMessages } from '@commise/i18n/react';
import { useCollection, useCreateCollection, useUpdateCollection } from '@kitchensink/recipe-service-client/hooks';
import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { FC } from 'react';

import { webMessages } from '@/i18n/messages';

/** Props for {@link CollectionFormContainer}. */
export interface CollectionFormContainerProps {
    /** Which operation the form performs: create a new collection, or rename an existing one. */
    readonly mode: CollectionFormMode;
    /** The active route locale, used to build locale-prefixed navigation targets. */
    readonly locale: string;
    /** The collection id to rename; required in `rename` mode, ignored in `create` mode. */
    readonly collectionId?: string;
}

/**
 * The live collection create/rename container.
 *
 * @param props - The form mode, active locale, and (for rename) the collection id.
 * @returns The wired {@link CollectionForm}, or a localized seed-loading affordance in rename mode.
 */
export const CollectionFormContainer: FC<CollectionFormContainerProps> = ({ mode, locale, collectionId }) => {
    const router = useRouter();
    const { collections } = useMessages(webMessages);
    const isRename = mode === 'rename';

    // Rename seeds its initial value from the loaded collection (source of truth in TanStack Query); create
    // never fetches, so the query is disabled and its result unused.
    const collectionQuery = useCollection(collectionId ?? '', { enabled: isRename });
    const createCollection = useCreateCollection();
    const updateCollection = useUpdateCollection();

    // The name field is a local edit buffer. Until the user types (`draftName` stays undefined) it mirrors
    // the seeded name; once edited, the draft takes over — so a background refetch never clobbers an
    // in-progress edit, and no effect is needed to reconcile the two.
    const [draftName, setDraftName] = useState<string | undefined>(undefined);
    const [validationError, setValidationError] = useState<string | undefined>(undefined);

    const seededName = isRename ? (collectionQuery.data?.name ?? '') : '';
    const name = draftName ?? seededName;

    const mutation = isRename ? updateCollection : createCollection;
    const submitError = mutation.isError ? collections.form.submitError : undefined;
    const error = validationError ?? submitError;

    if (isRename && collectionQuery.isLoading) {
        return (
            <p role="status" aria-label={collections.form.loadingLabel} className="px-4 py-8 text-body-md text-slate">
                {collections.form.loadingLabel}
            </p>
        );
    }

    const handleSubmit = (): void => {
        const trimmed = name.trim();

        if (trimmed.length === 0) {
            setValidationError(collections.form.nameRequired);

            return;
        }

        setValidationError(undefined);

        if (isRename && collectionId !== undefined) {
            updateCollection.mutate(
                { id: collectionId, request: { name: trimmed } },
                { onSuccess: (updated) => router.push(`/${locale}/collections/${updated.id}` as Route) },
            );

            return;
        }

        createCollection.mutate(
            { name: trimmed },
            { onSuccess: (created) => router.push(`/${locale}/collections/${created.id}` as Route) },
        );
    };

    const handleCancel = (): void => {
        if (isRename && collectionId !== undefined) {
            router.push(`/${locale}/collections/${collectionId}` as Route);

            return;
        }

        router.push(`/${locale}/collections` as Route);
    };

    return (
        <CollectionForm
            mode={mode}
            name={name}
            submitting={mutation.isPending}
            error={error}
            onChange={setDraftName}
            onSubmit={handleSubmit}
            onCancel={handleCancel}
        />
    );
};
