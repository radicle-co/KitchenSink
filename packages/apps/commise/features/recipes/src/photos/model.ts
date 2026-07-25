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
import { MAX_RECIPE_PHOTOS } from '@kitchensink/recipe-core';
import type { RecipePhoto } from '@kitchensink/recipe-core';
import type { ReactNode } from 'react';

import type { RecipePhotoQueueItem } from '../hooks/useRecipePhotoUploadQueue.js';

/**
 * Per-recipe photo cap — re-exported from the single recipe-core constant (server enforces
 * `MAX_PHOTOS_EXCEEDED` at the same value); the block hides `addControl` at cap.
 */
export { MAX_RECIPE_PHOTOS };

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
    /** Remove a queued/failed queue item from the grid (never a confirmed photo — use `onRemovePhoto`). */
    readonly onRemoveQueueItem?: (fileId: number) => void;
    /** The platform image-acquisition control (web file input / native picker button); hidden at the cap. */
    readonly addControl?: ReactNode;
}

/** Whether the recipe is at the photo cap (used to hide the add control and show the cap notice). */
export const isAtPhotoCap = (photoCount: number): boolean => photoCount >= MAX_RECIPE_PHOTOS;

/** The in-flight queue items actually worth a grid cell — `ok` items are folded into `photos` (see above). */
export const visibleQueueItems = (items: readonly RecipePhotoQueueItem[]): readonly RecipePhotoQueueItem[] =>
    items.filter((item) => item.status !== 'ok');
