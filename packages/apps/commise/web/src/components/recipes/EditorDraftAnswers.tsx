'use client';

/**
 * Records the outbox's recipe answers in the signed-in cook's device drafts, whether or not an editor is open
 * (`useDraftAnswers`, slice 7): a cook can leave the editor while its write is still queued. Mounted once, inside
 * `SyncProvider`, in `RecipeProviders`. Renders nothing.
 *
 * @pattern Observer — the app's mount point for the draft observer
 */
import { useDraftAnswers } from '@commise/features-recipes';
import { useSyncQueue } from '@commise/query/sync';
import type { FC } from 'react';

import { editorDraftsFor } from '@/components/recipes/editorDrafts';

/** Props for {@link EditorDraftAnswers}. */
export interface EditorDraftAnswersProps {
    /** The signed-in cook (Clerk `userId`), or `undefined` while nobody is signed in. */
    readonly subject: string | undefined;
}

/** The web mount of the draft observer. */
export const EditorDraftAnswers: FC<EditorDraftAnswersProps> = ({ subject }) => {
    useDraftAnswers(useSyncQueue(), editorDraftsFor(subject));

    return null;
};
