/**
 * @module @commise/query — what a recipe write's answer tells the code that queued it.
 *
 * The outbox (`@kitchensink/sync`) carries a sender's answer opaquely, in memory only, from the drain to whoever
 * subscribed (`SyncQueue.subscribe`). This is the vocabulary `recipeSender` answers in and the editor reads: the recipe
 * a create or update returned (its `currentVersion` is the next update's `expectedVersion`), or a 409's two sides.
 */
import type { RecipeDetail, VersionConflictError } from '@kitchensink/recipe-service-client';

/** One side of a version conflict, as the client's error carries it. */
type VersionConflictSide = NonNullable<VersionConflictError['server']>;

/** A recipe write's answer. */
export type SyncAnswer =
    /** The recipe the server holds after the write. */
    | { readonly kind: 'recipeWritten'; readonly detail: RecipeDetail }
    /** A version conflict: the winning side, and the base the edit started from when the server still has it. */
    | { readonly kind: 'recipeConflict'; readonly server: VersionConflictSide; readonly base?: VersionConflictSide };
