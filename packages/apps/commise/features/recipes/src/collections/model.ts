/**
 * @module @commise/features-recipes — collections model layer.
 *
 * Pure, platform-agnostic types + props shared by the web (`*.tsx`) and native (`*.native.tsx`) collection
 * building blocks, so the two renders can never drift on shape. No React, no platform APIs. These are
 * controlled, presentational components: they fetch nothing and delegate every interaction upward.
 */
import type { Collection, Recipe } from '@kitchensink/recipe-core';

/**
 * The minimal recipe shape the collection picker needs to list and add a candidate. The picker renders a
 * lightweight one-line-per-recipe chooser (title + an add control) — deliberately NOT the full mockup
 * `RecipeCardModel`. Typing candidates as this `Pick` keeps the picker decoupled from the card's growing
 * field set (difficulty, ratings, cover photo, PRO), so a caller need only supply what the picker reads. A
 * caller holding a fuller model (e.g. a `RecipeListItem` from `toRecipeListItem`) is still assignable.
 */
export type RecipePickerCandidate = Pick<Recipe, 'id' | 'title'>;

/**
 * The three top-level states the collection list renders. `ready` further splits into empty vs populated on
 * `collections.length` (a distinction the view derives — an empty successful load is not an error).
 */
export type CollectionListStatus = 'loading' | 'error' | 'ready';

/**
 * The three top-level fetch states the recipe picker renders while loading the caller's candidate recipes.
 * `ready` further splits (a distinction the view derives): no recipes owned at all vs a search that matched
 * none vs a populated candidate list.
 */
export type RecipePickerStatus = 'loading' | 'error' | 'ready';

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
/**
 * Which honest error a failed collection mutation surfaces (localized copy lives in the block, keyed by this
 * discriminant — the B17 code pattern, so the composing container never reaches into the block's dictionary).
 * - `delete` — deleting the collection failed (the action looked frozen before B17).
 * - `remove` — removing a member recipe failed.
 */
export type CollectionDetailError = 'delete' | 'remove';

export interface CollectionDetailViewProps {
    readonly collection: CollectionWithRecipes;
    /** Invoked with a recipe id when a member row is activated. */
    readonly onSelectRecipe: (id: string) => void;
    /** Invoked with a recipe id when a member's remove control is activated. */
    readonly onRemoveRecipe: (recipeId: string) => void;
    /** Invoked when the add-a-recipe action is activated (opens the {@link CollectionRecipePickerProps} view). */
    readonly onAddRecipe: () => void;
    /** Invoked when the rename action is activated. */
    readonly onRename: () => void;
    /** Invoked when the delete action is activated. */
    readonly onDelete: () => void;
    /** An honest error from the last delete/remove attempt to surface, or ABSENT for none (B17). */
    readonly error?: CollectionDetailError;
}

/**
 * Props for the collection recipe-picker — the ADD half of FR-009 (T072), a controlled, presentational
 * component that lists the caller's OWN recipes and adds them, one at a time, to a single named collection.
 * It fetches nothing: the composing app wires the recipe query, the current membership, and the add mutation
 * to these props, filters the candidate list by `query`, and drives the per-row in-flight/success/failure
 * signals below. Multi-membership (FR-009 — a recipe MAY belong to many collections) is expressed per row:
 * membership is scoped to THIS collection, so a recipe already in another collection is still addable here,
 * and a recipe already in THIS collection shows an inert "in this collection" marker rather than a re-add.
 */
export interface CollectionRecipePickerProps {
    /** The name of the collection recipes are added to — surfaced in the heading. */
    readonly collectionName: string;
    /** The candidate-load fetch state. `ready` renders the (already `query`-filtered) `recipes`. */
    readonly status: RecipePickerStatus;
    /** The caller's candidate recipes, already filtered by `query` upstream. */
    readonly recipes: readonly RecipePickerCandidate[];
    /** Ids of the recipes already in THIS collection — their rows show an inert membership marker. */
    readonly memberRecipeIds: readonly string[];
    /** The controlled search value — reflected in the input and used to disambiguate the two empty states. */
    readonly query: string;
    /** The recipe whose add is in flight, if any — its row shows a busy, non-interactive control. */
    readonly pendingRecipeId?: string;
    /** The last recipe successfully added — drives the polite success announcement. */
    readonly lastAddedRecipeId?: string;
    /** Whether the most recent add failed — surfaces an alert without hiding the rows. Defaults to `false`. */
    readonly addFailed?: boolean;
    /** Invoked with the new search value as the caller types. */
    readonly onQueryChange: (query: string) => void;
    /** Invoked with a recipe id when its add control is activated (suppressed for member/in-flight rows). */
    readonly onAdd: (recipeId: string) => void;
    /** Invoked when the retry action is activated in the load-error state. */
    readonly onRetry: () => void;
    /** Invoked when the create-recipe action is activated in the no-recipes empty state. */
    readonly onCreateRecipe: () => void;
    /** Invoked when the done action is activated (dismisses the picker). */
    readonly onDone: () => void;
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
