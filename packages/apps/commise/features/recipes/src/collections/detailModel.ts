/**
 * @module @commise/features-recipes/collections — the props of the collection detail's pieces and of the add-recipes
 * picker, shared by both platforms' leaves (`docs/design/uiOverhaul/buildSpec.md` §5.2, §5.3).
 *
 * Each piece is presentational: it fetches nothing and sends nothing. The hooks (`useMemberRemoval`,
 * `useCollectionVisibility`, `useMemberToggle`, `useCollectionPull`) run the requests; the containers and screens connect
 * the two.
 */
import type { CardVariant, ListViewMode } from '../card/cardVariant.js';
import type { RemovableMember } from '../hooks/useMemberRemoval.js';
import type { Recipe, RecipeVisibility } from '@kitchensink/recipe-core';

import type { RefreshNoticeControl } from '../refresh/model.js';
import type { PickerSummary } from './pickerModel.js';
import type { RenderRecipeNutrition } from '../nutrition/model.js';
import type { CollectionMemberRecipe } from './model.js';
import type { ReactNode } from 'react';

/** Props for one member of a collection. */
export interface CollectionMemberRowProps {
    readonly member: CollectionMemberRecipe;
    /** The variant the host decided: `row` for the list, `grid` or `compact` for the grid. */
    readonly variant: CardVariant;
    /** Where the card leads, which makes it a real link on web. Native has no URLs and ignores it. */
    readonly href?: string;
    /** Open the recipe. */
    readonly onSelect: (recipeId: string) => void;
    /** Ask to remove the recipe from the collection. The host hides it and offers Undo; nothing is sent yet. */
    readonly onRemove: (member: RemovableMember) => void;
    /** The recipe's per-serving nutrition, as an already-decided node for the card's meta (the host's one batch). */
    readonly nutrition?: ReactNode;
}

/**
 * The member reveal window (W5/C7): the detail embed returns EVERY member in one round trip — there is no member-
 * pagination endpoint — so the list reveals them client-side this many at a time behind "Load more ({n} more)". Pinned to
 * 4 to match the collection-view wireframe.
 */
export const MEMBER_WINDOW_SIZE = 4;

/** Props for a collection's member list: the view switch, the rows or cards, the empty state and the failed-removal alert. */
export interface CollectionMembersProps {
    /** The members to show: the host has already left out any whose removal is pending. */
    readonly members: readonly CollectionMemberRecipe[];
    /** The cook's list/grid choice, shared with My recipes. */
    readonly viewMode: ListViewMode;
    readonly onViewModeChange: (mode: ListViewMode) => void;
    /** The variant the host decided with `cardVariantOf(container, viewMode, 'library')`. */
    readonly variant: CardVariant;
    /** Where a recipe's card leads, which makes it a real link on web. Native has no URLs and ignores it. */
    readonly hrefOf?: (recipeId: string) => string;
    readonly onSelectRecipe: (recipeId: string) => void;
    /** Ask to remove a member. The host hides it and offers Undo. */
    readonly onRemoveRecipe: (member: RemovableMember) => void;
    /** Open the add-recipes picker (the empty state's primary). */
    readonly onAddRecipes: () => void;
    /** The title of a recipe whose committed removal failed, if any: an alert says so and the row is back. */
    readonly removeFailedTitle?: string;
    /** How to render one card's deferred calorie figure — the host closes over the page's ONE batch promise. */
    readonly renderNutrition?: RenderRecipeNutrition;
    /** The DOM id of the page's H1, which takes focus when the last row is removed (web; native uses the host's signal). */
    readonly headingId?: string;
}

/** Where the header's Add recipes and ⋯ pair sits (`docs/design/uiOverhaul/buildSpec.md` §5.2). */
export type CollectionActionsPlacement = 'title' | 'below';

/** What the ⋯ menu's items ask for. */
export interface CollectionMenuActions {
    readonly onRename: () => void;
    /** Make the collection private (shown while it is public) or public (while it is private). */
    readonly onToggleVisibility: () => void;
    readonly onSaveCopy: () => void;
    /** Pull updates from the original; offered for a copy only. */
    readonly onPullUpdates: () => void;
    readonly onDelete: () => void;
}

/**
 * Props for a collection's header: the back control, the name as the page's H1, the meta line (visibility · count ·
 * where a copy came from), the description, and the one primary (Add recipes) with the ⋯ menu.
 *
 * The pair sits at the end of the title row from a 600 container and under the description below it, which the host
 * decides (`actionsPlacement`) from the container class. Presentational: it sends nothing.
 */
export interface CollectionHeaderProps extends CollectionMenuActions {
    readonly name: string;
    readonly description?: string;
    readonly visibility: RecipeVisibility;
    readonly recipeCount: number;
    /** The source collection's name, present only for a copy. */
    readonly sourceCollectionName?: string;
    /** The source owner's handle; may be absent even for a copy. */
    readonly sourceOwnerHandle?: string;
    /** The source collection's id, which makes "Copied from …" a way to open the original. */
    readonly sourceCollectionId?: string;
    /** ISO 8601 time of the last pull from the original; absent if never pulled. */
    readonly lastPulledAt?: string;
    readonly actionsPlacement: CollectionActionsPlacement;
    /** The H1's DOM id (web). */
    readonly headingId: string;
    /** Advance it to move focus to the H1 (a recovered refresh; the last row removed). */
    readonly headingFocusSignal: number;
    /** Back to the collections list. */
    readonly onBack: () => void;
    /** The list's URL, so a modified click on Back still works (web). */
    readonly backHref?: string;
    readonly onAddRecipes: () => void;
    /** Open the original collection from "Copied from …". */
    readonly onViewSource?: (collectionId: string) => void;
    /** A failed refresh of the collection on screen: the notice with its retry. */
    readonly refreshNotice?: RefreshNoticeControl;
}

/** Props for the confirmation before a collection is deleted. */
export interface CollectionDeleteDialogProps {
    readonly open: boolean;
    readonly name: string;
    /** How many recipes the collection holds; they stay in the cook's library. */
    readonly recipeCount: number;
    /** The delete request is in flight. */
    readonly busy: boolean;
    /** The last delete failed; the dialog stays open and says so. */
    readonly failed: boolean;
    readonly onConfirm: () => void;
    /** Keep the collection: every dismissal route calls this. */
    readonly onKeep: () => void;
}

/** Props for the Premium sheet a free-tier cook gets for "Make private". */
export interface CollectionUpsellSheetProps {
    readonly open: boolean;
    /** Every close route calls this with `false`. */
    readonly onOpenChange: (open: boolean) => void;
    /** "See Premium". The subscription surface is not built yet, so the host closes the sheet. */
    readonly onSeePremium: () => void;
}

/**
 * Props for the add-recipes picker's frame (`docs/design/uiOverhaul/buildSpec.md` §5.3): a full-height sheet titled "Add to
 * {name}" with a sticky search field, a pinned Done button that says what changed, and whichever body the host's read
 * boundary renders — the rows, a skeleton, or a load error — so the field keeps its focus and Done stays reachable in every
 * state. × does the same as Done, because nothing is unsaved: each toggle saved the moment it was made.
 */
export interface CollectionRecipePickerProps {
    readonly open: boolean;
    /** Done, ×, Escape and the scrim all call this. */
    readonly onClose: () => void;
    readonly collectionName: string;
    /** The controlled search value. */
    readonly query: string;
    readonly onQueryChange: (query: string) => void;
    /** What changed since the picker opened, for Done's label. */
    readonly summary: PickerSummary;
    /** "Added {title}" or "Removed {title}", said politely; absent before the first toggle. `occurrence` re-says the same text. */
    readonly announcement?: { readonly text: string; readonly occurrence: number };
    readonly children: ReactNode;
}

/** Props for one row of the picker: the whole row is one checkbox, named by the recipe. */
export interface CollectionPickerRowProps {
    readonly recipe: Recipe;
    /** Whether the recipe is in the collection (optimistically, once toggled). */
    readonly checked: boolean;
    /** The last toggle of this recipe failed and the row flipped back: which direction was refused. */
    readonly failed?: 'add' | 'remove';
    /** Ask for the recipe to be in the collection (`true`) or not (`false`). */
    readonly onToggle: (next: boolean) => void;
}

/** Props for the picker's settled body: the caller's recipes, or the reason there are none to show. */
export interface CollectionRecipePickerCandidatesProps {
    /** The caller's recipes, already narrowed by the search. */
    readonly recipes: readonly Recipe[];
    /** The search value — separates "you have no recipes" from "none match". */
    readonly query: string;
    readonly onClearSearch: () => void;
    /** Open the editor from the no-recipes state. */
    readonly onCreateRecipe: () => void;
    /** Draw one row; the host closes over the membership and the toggle. */
    readonly renderRow: (recipe: Recipe) => ReactNode;
}
