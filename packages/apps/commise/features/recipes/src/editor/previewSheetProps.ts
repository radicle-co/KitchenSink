/**
 * @module @commise/features-recipes/editor — the shared contract of the editor's Preview sheet (web and native).
 */
import type { RecipeDetail } from '@kitchensink/recipe-core';

/** Props for the `RecipePreviewSheet` leaves. */
export interface RecipePreviewSheetProps {
    readonly open: boolean;
    /** The draft as the detail page draws it (`previewRecipeOf`). */
    readonly recipe: RecipeDetail;
    readonly onClose: () => void;
}

/** A retry the preview never offers: the draft is drawn from memory, so nothing it shows can fail to load. */
export const NO_RETRY = { refreshing: false, recoveries: 0, onRetry: (): void => undefined } as const;
