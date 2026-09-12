'use client';

/**
 * Container for the collection create/rename routes: owns the controlled name field and binds the shared,
 * presentational `CollectionForm` building block to the create/update mutations. In `create` mode it fetches
 * nothing and calls `useCreateCollection`; in `rename` mode it seeds the field from the loaded collection and calls
 * `useUpdateCollection`. On success it navigates to the affected collection; the empty-name guard and mutation
 * failures are surfaced as localized form errors through the web dictionary (`useMessages`).
 *
 * The mode selects the render component rather than branching inside one: `create` renders the editor with an empty
 * seed, and `rename` renders a read boundary around {@link CollectionRenameSeed}, whose suspense read supplies the
 * seed. So a rename form can only ever show a name that loaded — the boundary owns the wait and the failure (a
 * distinct not-found, or the load error with a retry), and a failed seed is never a blank form. The boundary is the
 * hydration-gated one because this route is not server-prefetched.
 */
import { CollectionForm } from '@commise/features-recipes';
import type { CollectionFormMode } from '@commise/features-recipes';
import { useMessages } from '@commise/i18n/react';
import { collectionQueries, isNotFoundError } from '@kitchensink/recipe-service-client';
import {
    useCreateCollection,
    useRecipeServiceClient,
    useUpdateCollection,
} from '@kitchensink/recipe-service-client/hooks';
import { useSuspenseQuery } from '@tanstack/react-query';
import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { FC } from 'react';

import { ClientQueryBoundary } from '@/components/app/ClientQueryBoundary';
import { CollectionLoadError } from '@/components/recipes/CollectionLoadError';
import { CollectionNotFound } from '@/components/recipes/CollectionNotFound';
import { webMessages } from '@/i18n/messages';

/** Props for {@link CollectionFormContainer}: a create needs no collection, and a rename cannot exist without one. */
export type CollectionFormContainerProps =
    | {
          /** Create a new collection. */
          readonly mode: Extract<CollectionFormMode, 'create'>;
          /** The active route locale, used to build locale-prefixed navigation targets. */
          readonly locale: string;
      }
    | {
          /** Rename an existing collection. */
          readonly mode: Extract<CollectionFormMode, 'rename'>;
          /** The active route locale, used to build locale-prefixed navigation targets. */
          readonly locale: string;
          /** The collection to rename. */
          readonly collectionId: string;
      };

/**
 * The live collection create/rename container.
 *
 * @param props - The form mode, active locale, and (for rename) the collection id.
 * @returns The create editor, or the rename editor behind its seed's read boundary.
 */
export const CollectionFormContainer: FC<CollectionFormContainerProps> = (props) => {
    const { collections } = useMessages(webMessages);

    if (props.mode === 'create') {
        return <CollectionFormEditor locale={props.locale} seededName="" />;
    }

    const { collectionId, locale } = props;

    return (
        <ClientQueryBoundary
            loading={
                <p
                    role="status"
                    aria-label={collections.form.loadingLabel}
                    className="px-4 py-8 text-body-md text-slate"
                >
                    {collections.form.loadingLabel}
                </p>
            }
            renderError={({ error, resetErrorBoundary }) =>
                isNotFoundError(error) ? <CollectionNotFound /> : <CollectionLoadError onRetry={resetErrorBoundary} />
            }
            resetKeys={[collectionId]}
        >
            <CollectionRenameSeed collectionId={collectionId} locale={locale} />
        </ClientQueryBoundary>
    );
};

/**
 * Reads the collection being renamed and hands its name to the editor as the seed.
 *
 * @param props - The collection id and the active locale.
 * @returns The rename editor seeded with the collection's current name.
 */
const CollectionRenameSeed: FC<{ readonly collectionId: string; readonly locale: string }> = ({
    collectionId,
    locale,
}) => {
    const client = useRecipeServiceClient();
    const { data } = useSuspenseQuery(collectionQueries(client).detail(collectionId));

    return <CollectionFormEditor locale={locale} seededName={data.name} collectionId={collectionId} />;
};

/**
 * The create/rename editor: the name edit buffer, its validation, and the mutation. A `collectionId` makes it a
 * rename of that collection; without one it creates.
 *
 * @param props - The active locale, the seed name, and (for rename) the collection id.
 * @returns The wired {@link CollectionForm}.
 */
const CollectionFormEditor: FC<{
    readonly locale: string;
    readonly seededName: string;
    readonly collectionId?: string;
}> = ({ locale, seededName, collectionId }) => {
    const router = useRouter();
    const { collections } = useMessages(webMessages);
    const createCollection = useCreateCollection();
    const updateCollection = useUpdateCollection();
    const isRename = collectionId !== undefined;

    // The name field is a local edit buffer. Until the user types (`draftName` stays undefined) it mirrors
    // the seeded name; once edited, the draft takes over — so a background refetch never clobbers an
    // in-progress edit, and no effect is needed to reconcile the two.
    const [draftName, setDraftName] = useState<string | undefined>(undefined);
    const [validationError, setValidationError] = useState<string | undefined>(undefined);

    const name = draftName ?? seededName;

    const mutation = isRename ? updateCollection : createCollection;
    const submitError = mutation.isError ? collections.form.submitError : undefined;
    const error = validationError ?? submitError;

    const handleSubmit = (): void => {
        const trimmed = name.trim();

        if (trimmed.length === 0) {
            setValidationError(collections.form.nameRequired);

            return;
        }

        setValidationError(undefined);

        if (isRename) {
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
        router.push((isRename ? `/${locale}/collections/${collectionId}` : `/${locale}/collections`) as Route);
    };

    return (
        <CollectionForm
            mode={isRename ? 'rename' : 'create'}
            name={name}
            submitting={mutation.isPending}
            error={error}
            onChange={setDraftName}
            onSubmit={handleSubmit}
            onCancel={handleCancel}
        />
    );
};
