/**
 * @module @commise/features-recipes/photos/model — props + constants for the recipe photo manager
 * building block (T067, wireframe step 4; w3/e4 per-file queue grid).
 *
 * Platform-neutral contract shared by the web (`.tsx`) and native (`.native.tsx`) leaves. The block is
 * PRESENTATIONAL: it renders the current photos MERGED with any in-flight queue items (the wireframe's
 * 3-column grid — confirmed photos plus queued/uploading/failed files, each with its own status badge), a
 * per-photo remove control, and busy/error affordances, and it renders a caller-supplied `addControl` (the
 * platform's own image-acquisition control — a web file input or a native picker button) so the block itself
 * stays free of DOM/native APIs. The container owns the presign → PUT → confirm upload orchestration (via
 * `useRecipePhotoUpload` + the `useRecipePhotoUploadQueue` layer above it) and passes results down as props.
 */
import { MAX_RECIPE_PHOTO_UPLOAD_BYTES, MAX_RECIPE_PHOTOS } from '@kitchensink/recipe-core';
import type { RecipePhoto } from '@kitchensink/recipe-core';
import type { ReactNode } from 'react';

import type { RecipePhotoQueueItem } from '../hooks/useRecipePhotoUploadQueue.js';

/**
 * Per-recipe photo cap — re-exported from the single recipe-core constant (server enforces
 * `MAX_PHOTOS_EXCEEDED` at the same value); the block hides `addControl` at cap.
 */
export { MAX_RECIPE_PHOTOS };

/**
 * The per-photo upload size bound in whole megabytes, DERIVED from the single recipe-core byte constant
 * (C6 — never a second "5 MB" literal) — rendered in the accepted-formats hint next to `addControl`.
 */
export const MAX_RECIPE_PHOTO_UPLOAD_MB = MAX_RECIPE_PHOTO_UPLOAD_BYTES / (1024 * 1024);

/** Props for the recipe photo manager. Purely presentational — no fetching, no platform APIs. */
export interface RecipePhotoManagerProps {
    /** The recipe's confirmed photos in display order. */
    readonly photos: readonly RecipePhoto[];
    /** Remove the photo with this id (the container runs the delete mutation). */
    readonly onRemovePhoto: (photoId: string) => void;
    /** The id of the photo whose removal is in flight (busies just that row), if any. */
    readonly removingPhotoId?: string | null;
    /** Whether an upload is currently in flight (shows a busy status). */
    readonly uploading?: boolean;
    /** A localized error from the last add/remove, shown as an alert when present. */
    readonly errorMessage?: string;
    /**
     * In-flight per-file items from `useRecipePhotoUploadQueue` — rendered as EXTRA grid cells alongside
     * `photos`, each with its own status badge. Items whose status is `ok` are omitted from rendering: once
     * a file succeeds it is folded into `photos` by the confirmed-photos query refetch (the same
     * `confirm → invalidateRecipeProjections` call the underlying hook already makes), so rendering it here
     * too would show the same photo twice for one render.
     */
    readonly queueItems?: readonly RecipePhotoQueueItem[];
    /** Retry a failed queue item (the container re-drives that file's upload). */
    readonly onRetryQueueItem?: (fileId: number) => void;
    /**
     * Remove a queued/failed queue item from the grid (never a confirmed photo — use `onRemovePhoto`). When absent,
     * queue cells offer no Remove at all.
     */
    readonly onRemoveQueueItem?: (fileId: number) => void;
    /**
     * Make the photo with this id the recipe's cover (U6). The cover is NOT a stored boolean: the server
     * resolves `coverPhotoUrl` as the LOWEST-sort-order photo, so "set as cover" is a reorder that moves the
     * chosen id to index 0 — the container runs `reorderRecipePhotos` and the projection refetch reprojects
     * the new cover into `photos[0]` (and into every `RecipeCard.Cover`). Because index 0 is always the cover,
     * the cover DEFAULTS to the first photo with no explicit selection, and removing the current cover
     * promotes the next photo automatically. Omitted (never passed `undefined`, per the §6 convention)
     * on a surface that does not offer cover selection — the manager then renders neither the badge nor the
     * radios.
     */
    readonly onSetCover?: (photoId: string) => void;
    /**
     * Move the photo with this id one place earlier or later (2026-10-17 owner ruling: the tile's ⋯ menu). Presentational:
     * the manager disables Move earlier on the first photo and Move later on the last, and reports the rest upward; the
     * container runs `reorderRecipePhotos` with the whole new order. Omitted on a surface that does not offer reordering.
     */
    readonly onMovePhoto?: (photoId: string, direction: PhotoMoveDirection) => void;
    /**
     * A reorder is in flight. Set as cover and both moves are unavailable until it lands, because the server takes the
     * whole list and refuses one built from a list that has since changed.
     */
    readonly reordering?: boolean;
    /**
     * Replace the photo with this id (U6). Presentational only: the manager renders a per-photo "Replace"
     * control and reports the id upward; the container owns the platform image-acquisition glue (web: a
     * dedicated hidden single-select file input; native: `expo-image-picker`).
     *
     * The container contract both platforms implement is UPLOAD-FIRST and therefore CANCEL-SAFE: acquire the
     * replacement, upload it, and delete the replaced photo only once the new one is durably confirmed (the
     * queue's per-file `onUploaded` continuation). A cancelled picker, an unreadable asset, a
     * validation-rejected file and a failed upload all leave the original photo untouched — the earlier
     * remove-then-add ordering lost it on a mere picker cancel. Because the replacement still appends and no
     * reorder is issued, the cover (lowest sort order) behaves exactly as before.
     *
     * Omitted on a surface that does not offer replace.
     */
    readonly onReplacePhoto?: (photoId: string) => void;
    /** The platform image-acquisition control (web file input / native picker button); hidden at the cap. */
    readonly addControl?: ReactNode;
    /**
     * The recipe whose cover the empty state previews (buildSpec §7.7): with no photo, the recipe shows the generated
     * cover its cards draw, and this is what that cover is made from. Omitted, the empty state is its copy alone.
     * `title` may be empty (the cover then shows its tint without a letter).
     */
    readonly coverPreview?: RecipeCoverPreview;
}

/** What the empty state needs to draw a recipe's generated cover. */
export interface RecipeCoverPreview {
    /** The recipe's id, which picks the cover's tint. */
    readonly recipeId: string;
    /** The recipe's title, whose first letter the cover shows. */
    readonly title: string;
    /** The cuisine, shown under the letter on a cover tall enough. */
    readonly cuisine?: string;
}

/**
 * How many queued files have finished uploading: the event count the manager's "Photo uploaded" announcement keys on
 * (`LiveRegion`'s `occurrence`), so each finished file is spoken even when the text is the same. A failed or queued
 * file is not counted. Pure.
 *
 * @param queueItems - The upload queue's items, `ok` ones included (they stay in the queue until it is cleared).
 * @returns The number of items whose upload completed.
 */
export const uploadedCount = (queueItems: readonly RecipePhotoQueueItem[] | undefined): number =>
    (queueItems ?? []).filter((item) => item.status === 'ok').length;

/** The container width from which the photo grid goes from three columns to four (buildSpec §7.7), in px. */
export const PHOTO_GRID_WIDE_FROM = 600;

/**
 * How many columns the photo grid has at a measured width (buildSpec §7.7: "3 columns below 600, 4 above").
 *
 * @param width - The grid's own laid-out width, or `undefined` before it has been measured.
 * @returns Four from {@link PHOTO_GRID_WIDE_FROM}, else three. An unmeasured grid takes the narrow reading, which is
 *   the safe one at every width: a too-wide tile never overflows. Pure.
 */
export const photoGridColumns = (width: number | undefined): 3 | 4 =>
    width !== undefined && width >= PHOTO_GRID_WIDE_FROM ? 4 : 3;

/**
 * Whether `photoId` is the recipe's cover photo. The cover is the LOWEST-sort-order photo — the same rule the
 * server uses to resolve `coverPhotoUrl` — which, in the already-sorted `photos` array, is simply index 0. So
 * the cover defaults to the first photo for free, and once the current cover is removed the next photo (the
 * new index 0) becomes the cover with no extra client work.
 *
 * @param photos - The recipe's confirmed photos, in display (sort) order.
 * @param photoId - The candidate photo id.
 * @returns `true` when `photoId` is the first photo, `false` otherwise (including an empty list).
 */
export const isCoverPhoto = (photos: readonly RecipePhoto[], photoId: string): boolean => photos[0]?.id === photoId;

/** Which way a photo moves in the display order. */
export type PhotoMoveDirection = 'earlier' | 'later';

/**
 * The photo ids in the order that makes `photoId` the cover: it first, the rest as they were. The server's reorder takes
 * the WHOLE list (an exact reordering of the recipe's photos), so "set as cover" is this list. Pure.
 *
 * @param photos - The recipe's confirmed photos, in display order.
 * @param photoId - The photo to put first.
 * @returns Every id, `photoId` first.
 */
export const coverFirstPhotoIds = (photos: readonly RecipePhoto[], photoId: string): readonly string[] => [
    photoId,
    ...photos.filter((photo) => photo.id !== photoId).map((photo) => photo.id),
];

/**
 * The photo ids after `photoId` swaps places with its neighbour (2026-10-17: Move earlier / Move later). Moving a photo
 * to index 0 makes it the cover, by the same rule {@link isCoverPhoto} reads. Pure.
 *
 * @param photos - The recipe's confirmed photos, in display order.
 * @param photoId - The photo to move.
 * @param direction - Which way.
 * @returns Every id in the new order, or `undefined` when the move goes nowhere: the first photo cannot go earlier, the
 *   last cannot go later, and a photo the list does not hold cannot go at all. It answers `undefined` rather than the
 *   unchanged list so a caller cannot send a reorder that changes nothing.
 */
export const movedPhotoIds = (
    photos: readonly RecipePhoto[],
    photoId: string,
    direction: PhotoMoveDirection,
): readonly string[] | undefined => {
    const from = photos.findIndex((photo) => photo.id === photoId);
    const to = direction === 'earlier' ? from - 1 : from + 1;

    if (from === -1 || to < 0 || to >= photos.length) {
        return undefined;
    }

    const ids = photos.map((photo) => photo.id);
    [ids[from], ids[to]] = [ids[to] as string, ids[from] as string];

    return ids;
};

/** Whether the recipe is at the photo cap (used to hide the add control and show the cap notice). */
export const isAtPhotoCap = (photoCount: number): boolean => photoCount >= MAX_RECIPE_PHOTOS;

/** The in-flight queue items actually worth a grid cell — `ok` items are folded into `photos` (see above). */
export const visibleQueueItems = (items: readonly RecipePhotoQueueItem[]): readonly RecipePhotoQueueItem[] =>
    items.filter((item) => item.status !== 'ok');

/**
 * How many more photos a recipe may take: the cap, less the photos it holds, less every queue item still holding
 * a grid cell (queued, uploading or failed — an `ok` item is already counted in `heldCount` once the refetch
 * lands, see {@link visibleQueueItems}).
 *
 * ⛔ The ONE statement of the queue's ADMISSION rule — what `useRecipePhotoUploadQueue.enqueue` judges a batch against,
 * and what the create containers derive their draft capacity from. It used to be written three times (the queue's own
 * slice and inline in both create containers), and the web edit container applied none, which is how a multi-file pick
 * past the cap was silently truncated. The manager leaves' "hide the add control" check still asks
 * {@link isAtPhotoCap} of its own count: a presentation question over the same constant, not a second admission
 * rule. The server enforces `MAX_PHOTOS_EXCEEDED` independently; this is the client's policy, not the authority.
 *
 * @param heldCount - Photos the recipe already has (confirmed, or held in a draft).
 * @param queueItems - The upload queue's current items.
 * @returns The remaining slots, never below zero. Pure.
 */
export const remainingPhotoSlots = (heldCount: number, queueItems: readonly RecipePhotoQueueItem[]): number =>
    Math.max(0, MAX_RECIPE_PHOTOS - heldCount - visibleQueueItems(queueItems).length);

/**
 * The verdict on a batch of photos offered to the upload queue. A batch is admitted WHOLE or refused whole —
 * never truncated — and a refusal carries how many would have fit, so the caller can say so.
 */
export type RecipePhotoAdmission =
    { readonly status: 'accepted' } | { readonly status: 'overCap'; readonly remaining: number };

/**
 * Decide whether a batch of `requested` photos fits in `remaining` slots (Specification — the admission policy).
 *
 * @param remaining - Slots left, from {@link remainingPhotoSlots}.
 * @param requested - How many photos the batch carries.
 * @returns `accepted` when the whole batch fits (an empty batch always does), else `overCap` with `remaining`.
 *   Pure.
 */
export const admitPhotoBatch = (remaining: number, requested: number): RecipePhotoAdmission =>
    requested > remaining ? { status: 'overCap', remaining } : { status: 'accepted' };
