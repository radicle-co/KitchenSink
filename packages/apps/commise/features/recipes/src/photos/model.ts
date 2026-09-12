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
}

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
 * past the cap was silently truncated. The manager leaves' "hide the add control" check and mobile's replace gate still
 * ask {@link isAtPhotoCap} of their own counts (mobile's adds pending drafts, which the queue never sees): those are
 * presentation questions over the same constant, not a second admission rule. The server enforces `MAX_PHOTOS_EXCEEDED` independently; this is the client's policy,
 * not the authority.
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
