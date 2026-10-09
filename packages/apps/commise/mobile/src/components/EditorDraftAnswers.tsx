/**
 * Records the outbox's recipe answers in the signed-in cook's device drafts, whether or not an editor is open
 * (`useDraftAnswers`, slice 7): the cook can leave the editor while its write is still queued, and the outbox drains
 * later. Mounted once, inside `SyncProvider`, in `RecipeServiceGate`. Renders nothing.
 *
 * @pattern Observer — the app's mount point for the draft observer
 */
import { useDraftAnswers } from '@commise/features-recipes';
import { useSyncQueue } from '@commise/query/sync';
import type { JSX } from 'react';

import { editorDraftsFor } from '../storage/editorDrafts.js';

/** Props for {@link EditorDraftAnswers}. */
export interface EditorDraftAnswersProps {
    /** The signed-in cook (Clerk `userId`), or `undefined` while nobody is signed in. */
    readonly subject: string | undefined;
}

/** The native mount of the draft observer. */
export function EditorDraftAnswers({ subject }: EditorDraftAnswersProps): JSX.Element | null {
    useDraftAnswers(useSyncQueue(), editorDraftsFor(subject));

    return null;
}
