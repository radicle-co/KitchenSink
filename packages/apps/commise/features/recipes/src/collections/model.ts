/**
 * @module @commise/features-recipes — collections model layer.
 *
 * Pure, platform-agnostic types + props shared by the web (`*.tsx`) and native (`*.native.tsx`) collection
 * building blocks, so the two renders can never drift on shape. No React, no platform APIs. These are
 * controlled, presentational components: they fetch nothing and delegate every interaction upward.
 */
import type { Collection, Recipe } from '@kitchensink/recipe-core';

/**
 * The three top-level states the collection list renders. `ready` further splits into empty vs populated on
 * `collections.length` (a distinction the view derives — an empty successful load is not an error).
 */
export type CollectionListStatus = 'loading' | 'error' | 'ready';

/** The two modes the collection form operates in: creating a new collection, or renaming an existing one. */
export type CollectionFormMode = 'create' | 'rename';

/**
 * A collection plus its member recipes — the shape the detail view (T072) consumes. Structurally mirrors
 * the recipe-service client's `CollectionWithRecipes` response (`Collection` + optional member `recipes`),
 * but is expressed in `@kitchensink/recipe-core` domain types so this presentational feature depends only on
 * the domain layer, not the HTTP client. `recipes` is optional (a list-only projection may omit it) and the
 * view treats an absent list as empty.
 */
export type CollectionWithRecipes = Collection & { readonly recipes?: readonly Recipe[] };

/**
 * Props for the collection-list view — a controlled, presentational component. It renders one of four states
 * (loading, error, empty, populated) from `status` + `collections`, and delegates every interaction upward.
 * It performs NO data fetching: the composing app wires the query layer to these props.
 */
export interface CollectionListViewProps {
    readonly status: CollectionListStatus;
    readonly collections: readonly Collection[];
    /** Invoked with a collection id when a row is activated. */
    readonly onSelect: (id: string) => void;
    /** Invoked when the create-collection action is activated. */
    readonly onCreate: () => void;
    /** Invoked when the retry action is activated in the error state. */
    readonly onRetry: () => void;
}

/**
 * Props for the collection-detail view — a presentational render of a loaded {@link CollectionWithRecipes}
 * (header + member recipe rows). Fetch states (loading/error) belong to the composing app, not here.
 */
export interface CollectionDetailViewProps {
    readonly collection: CollectionWithRecipes;
    /** Invoked with a recipe id when a member row is activated. */
    readonly onSelectRecipe: (id: string) => void;
    /** Invoked with a recipe id when a member's remove control is activated. */
    readonly onRemoveRecipe: (recipeId: string) => void;
    /** Invoked when the rename action is activated. */
    readonly onRename: () => void;
    /** Invoked when the delete action is activated. */
    readonly onDelete: () => void;
}

/**
 * Props for the collection form (create/rename) — a controlled, presentational component. The `name` value
 * is owned by the caller; the form reports edits via `onChange` and delegates submit/cancel upward. While
 * `submitting`, the input and both actions are disabled to prevent duplicate submissions.
 */
export interface CollectionFormProps {
    readonly mode: CollectionFormMode;
    readonly name: string;
    /** Whether a submission is in flight; disables the input and actions. Defaults to `false`. */
    readonly submitting?: boolean;
    /** A validation/submission error to surface, if any. */
    readonly error?: string;
    readonly onChange: (name: string) => void;
    readonly onSubmit: () => void;
    readonly onCancel: () => void;
}
