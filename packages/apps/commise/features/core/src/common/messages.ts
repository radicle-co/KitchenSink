/**
 * @module @commise/features-core/common — the copy that more than one feature says, in one dictionary shared by both
 * platforms.
 *
 * A sentence a feature would otherwise write twice lives here, so the two cannot drift. It starts with the one an Undo
 * says when its target is gone; a member joins it only when a second feature needs the same words.
 */
import type { LocalizedMessages } from '@commise/i18n';

/** Copy shared across features. */
export interface CommonMessages {
    /**
     * What an Undo says when what it would undo no longer exists (the thing was deleted since). It names nothing, so it
     * reads the same for a collection, a recipe version or anything else.
     */
    readonly undoGone: string;
    /**
     * What an Undo says when it failed for now, a failure a later try can fix (the server or the network). It says the
     * change is still in place, because that is what the cook needs to know.
     */
    readonly undoFailed: string;
}

/** The shared copy, per locale. */
export const commonMessages: LocalizedMessages<CommonMessages> = {
    en: {
        undoGone: 'Can’t undo. It was deleted.',
        undoFailed: 'Can’t undo right now. The change is still in place.',
    },
};
