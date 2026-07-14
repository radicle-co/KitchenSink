/**
 * @module @commise/features-recipes/photos/model — props + constants for the recipe photo manager
 * building block (T067, wireframe step 4).
 *
 * Platform-neutral contract shared by the web (`.tsx`) and native (`.native.tsx`) leaves. The block is
 * PRESENTATIONAL: it renders the current photos, a per-photo remove control, and busy/error affordances,
 * and it renders a caller-supplied `addControl` (the platform's own image-acquisition control — a web file
 * input or a native picker button) so the block itself stays free of DOM/native APIs. The container owns
 * the presign → PUT → confirm upload orchestration and passes results down as props.
 */
import type { RecipePhoto } from '@kitchensink/recipe-core';
import type { ReactNode } from 'react';

/** Per-recipe photo cap (server enforces `MAX_PHOTOS_EXCEEDED` at 10); the block hides `addControl` at cap. */
export const MAX_RECIPE_PHOTOS = 10;

/** Props for the recipe photo manager. Purely presentational — no fetching, no platform APIs. */
export interface RecipePhotoManagerProps {
    /** The recipe's photos in display order. */
    readonly photos: readonly RecipePhoto[];
    /** Remove the photo with this id (the container runs the delete mutation). */
    readonly onRemovePhoto: (photoId: string) => void;
    /** The id of the photo whose removal is in flight (busies just that row), if any. */
    readonly removingPhotoId?: string | null;
    /** Whether an upload is currently in flight (shows a busy status). */
    readonly uploading?: boolean;
    /** A localized error from the last add/remove, shown as an alert when present. */
    readonly errorMessage?: string;
    /** The platform image-acquisition control (web file input / native picker button); hidden at the cap. */
    readonly addControl?: ReactNode;
}

/** Whether the recipe is at the photo cap (used to hide the add control and show the cap notice). */
export const isAtPhotoCap = (photoCount: number): boolean => photoCount >= MAX_RECIPE_PHOTOS;
