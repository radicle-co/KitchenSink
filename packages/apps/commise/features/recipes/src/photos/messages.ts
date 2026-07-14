/**
 * @module @commise/features-recipes/photos/messages — user-facing copy for the recipe photo manager
 * (T067, wireframe step 4).
 *
 * Shared, platform-neutral strings as a {@link LocalizedMessages} dictionary, consumed by BOTH the web
 * `.tsx` and native `.native.tsx` leaves via `useMessages`, so the platforms cannot drift on copy. The `en`
 * set is required; adding a locale is just another key.
 */
import type { LocalizedMessages } from '@commise/i18n';

/** Shared copy for the photo manager block, rendered by both the web and native leaves. */
export interface PhotoMessages {
    /** Section heading for the photo manager. */
    readonly heading: string;
    /** Body copy of the empty state (no photos yet). */
    readonly emptyBody: string;
    /** Accessible alt text for a photo thumbnail (contains `{index}`, so each photo is uniquely named). */
    readonly photoAlt: string;
    /** Visible label of the idle remove action. */
    readonly remove: string;
    /** Visible label of the remove action while its removal is in flight. */
    readonly removing: string;
    /** Accessible label of the remove action (contains `{index}`, so each row's remove is uniquely named). */
    readonly removeLabel: string;
    /** Accessible label for the upload-in-flight busy status. */
    readonly uploadingLabel: string;
    /** Notice shown when the recipe is at the photo cap (contains `{max}`). */
    readonly maxReached: string;
}

/** The photo manager copy, per locale. `en` is required; other locales extend the same shape. */
export const photoMessages: LocalizedMessages<PhotoMessages> = {
    en: {
        heading: 'Photos',
        emptyBody: 'No photos yet.',
        photoAlt: 'Recipe photo {index}',
        remove: 'Remove',
        removing: 'Removing…',
        removeLabel: 'Remove photo {index}',
        uploadingLabel: 'Uploading photo',
        maxReached: 'Maximum of {max} photos reached.',
    },
};
