/**
 * The recipe-photo manager SESSION — everything the web `RecipePhotoUploaderContainer` and the mobile
 * `RecipePhotoUploader` did identically, in one place: read the recipe's photos, compose the single-flight upload
 * hook with its FIFO queue, delete, set a cover, and judge every refusal with ONE rule and ONE set of sentences.
 *
 * What a leaf still owns is only how a file reaches it: web a hidden `<input type="file">` and the object-URL
 * ledger, mobile `expo-image-picker`, its source sheet and the draft destination. A leaf hands the files it
 * acquired to {@link UseRecipePhotoManagerResult.enqueuePicked} and renders the returned session through
 * `RecipePhotoManager`.
 *
 * **One error slot, latest action wins.** A refusal (a pick past the cap, Replace at the cap), a failed delete and a
 * leaf-reported picker failure all land in {@link UseRecipePhotoManagerResult.errorMessage}; an accepted pick and
 * any removal clear it, because removing a photo is exactly the advice a cap refusal gives. A failed FILE is not
 * here — it carries its own badge on its queue item.
 *
 * **One rule for room.** "Is there room?" is `remainingPhotoSlots` — the cap from the shared constant, less the
 * photos held (confirmed, plus `heldElsewhere` for picks a caller keeps outside the server), less every queue item
 * still holding a grid cell. The queue computes it once as `queue.remaining` and `enqueue` judges a batch by it, so
 * Replace's gate reads that same value and cannot disagree with the queue's admission.
 *
 * **Copy.** Every sentence comes from `photoMessages`, the size limit derived from `MAX_RECIPE_PHOTO_UPLOAD_MB` so
 * the number is never a second literal.
 *
 * @pattern Headless hook (view-model) — composes `useRecipePhotoUpload` and `useRecipePhotoUploadQueue` and the three
 *     recipe-service mutations behind one session object; the platform leaves are the View.
 */
import { useMessages } from '@commise/i18n/react';
import type { RecipePhoto } from '@kitchensink/recipe-core';
import {
    useDeleteRecipePhoto,
    useRecipePhotos,
    useReorderRecipePhotos,
} from '@kitchensink/recipe-service-client/hooks';
import { useState } from 'react';

import { fillTemplate } from '../format/fillTemplate.js';
import { photoMessages } from '../photos/messages.js';
import { MAX_RECIPE_PHOTO_UPLOAD_MB, type RecipePhotoAdmission } from '../photos/model.js';
import { useRecipePhotoUpload } from './useRecipePhotoUpload.js';
import {
    useRecipePhotoUploadQueue,
    type RecipePhotoQueueFile,
    type UseRecipePhotoUploadQueueResult,
} from './useRecipePhotoUploadQueue.js';

/** What a pick is FOR: it decides which sentence a refusal says. */
export type RecipePhotoPickIntent = 'add' | 'replace';

/** Options for {@link useRecipePhotoManager}. */
export interface UseRecipePhotoManagerOptions {
    /** The recipe whose photos are managed, or `null` on a create that has not saved yet. */
    readonly recipeId: string | null;
    /**
     * Photos the caller holds outside the server that still take a slot (mobile's draft picks on a create). They
     * count against the room exactly as confirmed photos do. Default 0.
     */
    readonly heldElsewhere?: number;
}

/** The session {@link useRecipePhotoManager} exposes to a platform leaf. */
export interface UseRecipePhotoManagerResult {
    /** The recipe's confirmed photos, in display order (empty until loaded, and before the recipe has an id). */
    readonly photos: readonly RecipePhoto[];
    /** The upload queue, for the grid's items and its retry/remove. */
    readonly queue: UseRecipePhotoUploadQueueResult;
    /** Whether an upload is in flight. */
    readonly uploading: boolean;
    /** The id of the photo whose deletion is in flight, if any. */
    readonly removingPhotoId: string | null;
    /** The one refusal or failure sentence to show, if any. See the module doc. */
    readonly errorMessage: string | undefined;
    /** Say something went wrong on the leaf's side (a picker or a local read failed), or `undefined` to clear. */
    readonly reportError: (message: string | undefined) => void;
    /**
     * Hand freshly acquired files to the queue, WHOLE or not at all.
     *
     * @returns The queue's verdict. On `overCap` nothing was queued and the right sentence is already showing, so
     *   the leaf only releases whatever it prepared for those files.
     */
    readonly enqueuePicked: (
        files: readonly RecipePhotoQueueFile[],
        intent: RecipePhotoPickIntent,
    ) => RecipePhotoAdmission;
    /**
     * Whether a Replace may begin. At the cap it refuses with `replaceAtCapError` and returns `false`; otherwise it
     * clears any earlier refusal and returns `true`.
     */
    readonly beginReplace: () => boolean;
    /** Delete a confirmed photo. A failure is said in {@link errorMessage}. A no-op before the recipe has an id. */
    readonly removePhoto: (photoId: string) => void;
    /** Make `photoId` the cover: a reorder that moves it to the front (the cover is the lowest sort order). */
    readonly setCover: (photoId: string) => void;
}

/**
 * The recipe-photo manager session.
 *
 * @param options - The recipe id and any photos held outside the server.
 * @returns The session; see {@link UseRecipePhotoManagerResult}.
 * @sideEffect Reads the recipe's photos and drives the delete and reorder mutations and the upload queue.
 */
export function useRecipePhotoManager({
    recipeId,
    heldElsewhere = 0,
}: UseRecipePhotoManagerOptions): UseRecipePhotoManagerResult {
    const copy = useMessages(photoMessages);
    // `''` disables the query (`enabled: id.length > 0`) — a create has no photos to list yet.
    const photosQuery = useRecipePhotos(recipeId ?? '');
    const deletePhoto = useDeleteRecipePhoto();
    const reorderPhotos = useReorderRecipePhotos();
    const uploader = useRecipePhotoUpload(recipeId ?? '', copy.uploadError);
    const photos: readonly RecipePhoto[] = photosQuery.data ?? [];
    const heldCount = photos.length + heldElsewhere;
    const queue = useRecipePhotoUploadQueue(uploader, heldCount, {
        tooLarge: fillTemplate(copy.tooLargeError, { maxMb: MAX_RECIPE_PHOTO_UPLOAD_MB }),
        badType: copy.unsupportedTypeError,
    });
    const [errorMessage, setErrorMessage] = useState<string | undefined>(undefined);

    const enqueuePicked = (
        files: readonly RecipePhotoQueueFile[],
        intent: RecipePhotoPickIntent,
    ): RecipePhotoAdmission => {
        const admission = queue.enqueue(files);

        if (admission.status === 'overCap') {
            setErrorMessage(
                intent === 'replace'
                    ? copy.replaceAtCapError
                    : fillTemplate(copy.overCapError, { count: admission.remaining }),
            );

            return admission;
        }

        setErrorMessage(undefined);

        return admission;
    };

    const beginReplace = (): boolean => {
        if (queue.remaining === 0) {
            setErrorMessage(copy.replaceAtCapError);

            return false;
        }

        setErrorMessage(undefined);

        return true;
    };

    // Unreachable while `recipeId` is null: there are no persisted photos to remove until the recipe exists. Guarded
    // anyway rather than asserted away — a non-null assertion would be a claim about a caller this hook does not own.
    const removePhoto = (photoId: string): void => {
        if (recipeId === null) {
            return;
        }

        setErrorMessage(undefined);
        deletePhoto.mutate({ id: recipeId, photoId }, { onError: () => setErrorMessage(copy.removeError) });
    };

    const setCover = (photoId: string): void => {
        if (recipeId === null) {
            return;
        }

        const photoIds = [photoId, ...photos.filter((photo) => photo.id !== photoId).map((photo) => photo.id)];
        reorderPhotos.mutate({ id: recipeId, photoIds });
    };

    return {
        photos,
        queue,
        uploading: uploader.uploading,
        removingPhotoId: deletePhoto.isPending ? (deletePhoto.variables?.photoId ?? null) : null,
        errorMessage,
        reportError: setErrorMessage,
        enqueuePicked,
        beginReplace,
        removePhoto,
        setCover,
    };
}
