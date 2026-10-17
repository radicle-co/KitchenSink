/**
 * @module @commise/features-recipes/photos/messages — user-facing copy for the recipe photo manager
 * (T067, wireframe step 4; w3/e4 per-file queue grid status/retry/remove copy).
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
    /** Body copy of the empty state, under the recipe's own cover preview (buildSpec §7.7): says the generated cover
     *  stands in and that a photo can be added any time. */
    readonly emptyBody: string;
    /** Accessible alt text for a photo thumbnail (contains `{index}`, so each photo is uniquely named). */
    readonly photoAlt: string;
    /** Label of the Remove item in a tile's menu, and the tile's idle remove wording. */
    readonly remove: string;
    /** Shown on a tile while its removal is in flight (its menu is unavailable until it lands). */
    readonly removing: string;
    /** Accessible label for the upload-in-flight busy status. */
    readonly uploadingLabel: string;
    /** Spoken (never shown) when an upload finishes: the polite counterpart of {@link uploadingLabel} (WCAG 4.1.3). */
    readonly uploadedLabel: string;
    /** Notice shown when the recipe is at the photo cap (contains `{max}`). */
    readonly maxReached: string;
    /** Accepted-formats hint shown next to `addControl` (C6, wireframe recipe-edit.md:101-104; contains
     *  `{maxMb}`, derived from the shared `MAX_RECIPE_PHOTO_UPLOAD_BYTES` constant — never a second literal). */
    readonly formatHint: string;
    /** Accessible alt text for a queued/uploading/failed file's thumbnail (contains `{fileName}`). */
    readonly queuePhotoAlt: string;
    /** Visible + accessible status word for a file waiting its turn in the queue. */
    readonly queueStatusQueued: string;
    /** Visible + accessible status word for a file whose upload is in flight. */
    readonly queueStatusUploading: string;
    /** Visible + accessible status word for a file whose upload failed. */
    readonly queueStatusFailed: string;
    /** Visible label of the retry action on a failed queue item. */
    readonly queueRetry: string;
    /** Accessible label of the retry action (contains `{fileName}`, so each failed file's retry is unique). */
    readonly queueRetryLabel: string;
    /** The menu button on a photo tile (2026-10-17; contains `{index}`, so each tile's button is uniquely named). */
    readonly menuTrigger: string;
    /** The same button on the cover tile: its name is what states the cover to a screen reader (SC 4.1.2). */
    readonly menuTriggerCover: string;
    /** The native sheet's title for a photo tile's menu (contains `{index}`). */
    readonly menuTitle: string;
    /** The native sheet's Close control for a photo tile's menu (contains `{index}`). */
    readonly menuClose: string;
    /** The menu button on a queue tile (contains `{fileName}`). */
    readonly queueMenuTrigger: string;
    /** The native sheet's Close control for a queue tile's menu (contains `{fileName}`). */
    readonly queueMenuClose: string;
    /** Menu item: make this photo the cover. */
    readonly setCover: string;
    /** Menu item: move this photo one place earlier. */
    readonly moveEarlier: string;
    /** Menu item: move this photo one place later. */
    readonly moveLater: string;
    /** Visible + accessible badge on the current cover photo (U6). */
    readonly coverBadge: string;
    /** Visible label of the replace action. */
    readonly replace: string;
    /** Visible label and accessible name of the secondary "Add photos" button (A-010, buildSpec §7.7). */
    readonly addPhotos: string;
    /** Title of the native sheet the Add photos button opens. */
    readonly addPhotosSheetTitle: string;
    /** Accessible name of the native sheet's Close control. */
    readonly addPhotosSheetClose: string;
    /** The native sheet's camera choice. */
    readonly takePhoto: string;
    /** The native sheet's library choice. */
    readonly chooseFromLibrary: string;
    /** Shown when the camera could not be opened at all (a device without one, or the system refused): says so and
     *  points at the library. */
    readonly cameraUnavailable: string;
    /** Shown when the cook refuses (or has switched off) the camera permission: says why nothing opened and where
     *  else a photo can come from. */
    readonly cameraDenied: string;
    /** Shown when acquiring, uploading or confirming a photo fails: the ONE sentence for both platforms. */
    readonly uploadError: string;
    /** Shown when deleting a confirmed photo fails. */
    readonly removeError: string;
    /** Shown when moving a photo earlier or later fails (the reorder is refused or does not reach the server). */
    readonly moveError: string;
    /** Shown when making a photo the cover fails (the reorder is refused or does not reach the server). */
    readonly setCoverError: string;
    /** Shown when a picked file is over the size limit (REQ-011); contains `{maxMb}`, derived from the shared
     *  `MAX_RECIPE_PHOTO_UPLOAD_BYTES` constant — never a second literal. */
    readonly tooLargeError: string;
    /** Shown when a picked file's type is outside the allowlist (REQ-012). */
    readonly unsupportedTypeError: string;
    /** Shown when Replace is refused for want of a free slot — a lossless swap needs room (U6). */
    readonly replaceAtCapError: string;
    /** Shown when ONE pick carries more photos than the recipe can still hold (contains `{count}`). The pick is
     *  refused whole, so this sentence is what stops the cook silently losing the files that did not fit. */
    readonly overCapError: string;
}

/** The photo manager copy, per locale. `en` is required; other locales extend the same shape. */
export const photoMessages: LocalizedMessages<PhotoMessages> = {
    en: {
        heading: 'Photos',
        emptyBody: 'No photo? This cover is used instead. Add one any time.',
        photoAlt: 'Recipe photo {index}',
        remove: 'Remove',
        removing: 'Removing…',
        uploadingLabel: 'Uploading photo',
        uploadedLabel: 'Photo uploaded',
        maxReached: 'Maximum of {max} photos reached.',
        formatHint: 'JPEG, PNG, or WebP · max {maxMb} MB',
        queuePhotoAlt: 'Photo {fileName}',
        queueStatusQueued: 'Queued',
        queueStatusUploading: 'Uploading…',
        queueStatusFailed: 'Upload failed',
        queueRetry: 'Retry',
        queueRetryLabel: 'Retry upload of {fileName}',
        menuTrigger: 'Actions for photo {index}',
        menuTriggerCover: 'Actions for photo {index}, the cover',
        menuTitle: 'Photo {index}',
        menuClose: 'Close actions for photo {index}',
        queueMenuTrigger: 'Actions for {fileName}',
        queueMenuClose: 'Close actions for {fileName}',
        setCover: 'Set as cover',
        moveEarlier: 'Move earlier',
        moveLater: 'Move later',
        coverBadge: 'Cover',
        replace: 'Replace',
        addPhotos: 'Add photos',
        addPhotosSheetTitle: 'Add photos',
        addPhotosSheetClose: 'Close add photos',
        takePhoto: 'Take photo',
        chooseFromLibrary: 'Choose from library',
        cameraUnavailable: 'The camera did not open. Try again, or choose a photo from your library.',
        cameraDenied: 'Camera access is off. Turn it on in your phone’s settings, or choose a photo from your library.',
        uploadError: 'We couldn’t upload that photo. Please try again.',
        removeError: 'We couldn’t remove this photo. Please try again.',
        moveError: 'We couldn’t move that photo. Please try again.',
        setCoverError: 'We couldn’t make that photo the cover. Please try again.',
        tooLargeError: 'That photo is larger than {maxMb} MB. Choose a smaller file.',
        unsupportedTypeError: 'That file type isn’t supported. Use a JPEG, PNG, or WebP photo.',
        replaceAtCapError: 'Remove a photo first — replacing needs room for the new one.',
        overCapError: 'That’s more photos than this recipe can hold — you can add {count} more.',
    },
};
