/**
 * @module @commise/features-recipes/card — the recipe card's props, the two contexts its Root gives its parts, and the one
 * reader of the card's view, shared by the web and native `RecipeCard` leaves (W9-f P7).
 *
 * The view's context and its reader are kept together because the reader is the only correct way to touch it: it turns
 * a part rendered outside a card into a stated error instead of a silent `null`.
 *
 * @pattern Provider — the Root carries the card's view and its nutrition slot to the parts, so each surface composes its
 *     own arrangement without threading props through it
 */
import { createContext, useContext, type ReactNode } from 'react';

import type { RecipeCardModel } from './model.js';
import type { RecipeCardView } from './recipeCardView.js';

/** What every recipe card takes, whatever its arrangement. */
interface RecipeCardBaseProps {
    readonly recipe: RecipeCardModel;
    /**
     * When provided, the card is actionable and reports the recipe id. On web with an `href`, a plain click is handed
     * here and a modified click (new tab) follows the link.
     */
    readonly onSelect?: (id: string) => void;
    /**
     * Where the card leads, which makes it a real link on web (open in a new tab, copy the address). Native has no URLs
     * and ignores it, the same web-only convention the list's source switcher follows.
     */
    readonly href?: string;
    /**
     * The recipe's per-serving nutrition, as an already-decided NODE rendered in the meta line.
     *
     * A SLOT rather than a field, because the figure is a DEFERRED lookup that lands after the card does:
     * the list holds the promise and decides what belongs here (`RecipeNutritionBoundary`, a settled
     * `RecipeCalorieChip`, or nothing at all), and the card stays pure and knows nothing about loading. An
     * ABSENT slot renders no item at all — the same absent-value rule as difficulty, cuisine and tags, and
     * never a placeholder or a fabricated 0.
     *
     * ⚠️ It is `RecipeCard.Meta` (and the row's meta line) that renders this. A custom arrangement (`children`) that
     * omits `.Meta` DROPS the slot silently — unlike a misplaced part, which throws — because an unrendered optional
     * node is indistinguishable from an absent one. `RecipeDiscoveryCard` and `CollectionMemberRow` are exactly such
     * arrangements, so check for `<RecipeCard.Meta />` before concluding the figure never arrived.
     */
    readonly nutrition?: ReactNode;
}

/** The slots a surface may fill, spelled out so a card can never be given one its variant has no place for. */
interface RecipeCardNoSlots {
    readonly footer?: undefined;
    readonly note?: undefined;
    readonly trailing?: undefined;
}

/**
 * The grid and the compact card, which end in a footer (`docs/design/uiOverhaul/buildSpec.md` §4.1).
 *
 * - `footer` — an already-decided node for the card's last line: the Discover author and Save a copy, a collection
 *   member's source label and ⋯ menu. In the grid it REPLACES the own-recipe footer (the version and the timestamp),
 *   so the six rows a grid row aligns on stay six; in the compact card it is added under the title. Its controls are
 *   lifted above the card's one link, never nested inside it.
 */
export interface RecipeCardPanelProps extends RecipeCardBaseProps, Omit<RecipeCardNoSlots, 'footer'> {
    /** The variant the orchestration decided with `cardVariantOf`. */
    readonly variant: 'grid' | 'compact';
    readonly footer?: ReactNode;
    readonly children?: undefined;
}

/**
 * The list row.
 *
 * - `note` — a line of text inside the card's link, under the status line (a collection member's source label).
 * - `trailing` — a control at the row's end, OUTSIDE the link (a member's ⋯ menu).
 */
export interface RecipeCardRowProps extends RecipeCardBaseProps, Omit<RecipeCardNoSlots, 'note' | 'trailing'> {
    readonly variant: 'row';
    readonly note?: ReactNode;
    readonly trailing?: ReactNode;
    readonly children?: undefined;
}

/** The default arrangement of one of the three variants (`docs/design/uiOverhaul/buildSpec.md` §4.1). */
export type RecipeCardVariantProps = RecipeCardPanelProps | RecipeCardRowProps;

/** A surface's own arrangement of the `RecipeCard.*` parts. */
export interface RecipeCardArrangementProps extends RecipeCardBaseProps, RecipeCardNoSlots {
    readonly variant?: undefined;
    /** The arrangement. */
    readonly children: ReactNode;
}

/**
 * Props for the shared recipe card (both leaves): a variant's default arrangement, or a custom one — never both, so a
 * card can never be asked for a variant it then ignores.
 */
export type RecipeCardProps = RecipeCardVariantProps | RecipeCardArrangementProps;

/** The card's view, carried to the parts so no surface has to thread props through the arrangement. */
export const RecipeCardViewContext = createContext<RecipeCardView | null>(null);

/**
 * The nutrition slot's content, carried to `RecipeCard.Meta` the same way the view reaches the other parts. Kept as its
 * OWN context rather than folded into the view: the view is data derived from a recipe, and this is a rendered node the
 * composing surface supplies, so merging them would put a `ReactNode` inside a pure, serializable view.
 */
export const RecipeCardNutritionContext = createContext<ReactNode>(null);

/**
 * Read the card's view from the nearest `RecipeCard`.
 *
 * @returns The view.
 * @throws {Error} when a part is rendered outside a `RecipeCard`.
 */
export function useCardView(): RecipeCardView {
    const view = useContext(RecipeCardViewContext);

    if (view === null) {
        throw new Error('RecipeCard.* parts must be rendered inside a <RecipeCard>.');
    }

    return view;
}
