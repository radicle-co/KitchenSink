/**
 * @module @commise/features-recipes/foodPage — the platform-neutral props of the "Your foods" list and its Profile row
 * (private foods spec section 16, F19).
 */
import type { OwnFoodList } from '@kitchensink/schema-food';

/** One of the cook's foods in the list. */
export type OwnFoodItem = OwnFoodList['items'][number];

/** Props for `YourFoodsRow`, the entry on Profile. */
export interface YourFoodsRowProps {
    /** Decisions the cook has not opened yet; the dot shows when above 0. */
    readonly unseenDecisions: number;
    readonly onPress: () => void;
    /** Web only: where the row goes, so a modified click still works. */
    readonly href?: string;
}

/** Props for `YourFoodsList`. */
export interface YourFoodsListProps {
    readonly phase: 'loading' | 'error' | 'ready';
    readonly items: readonly OwnFoodItem[];
    readonly hasMore: boolean;
    readonly loadingMore: boolean;
    readonly onOpen: (foodId: string) => void;
    /** The href of a food's page, so a row is a real link on web. Native ignores it. */
    readonly hrefOf?: (foodId: string) => string;
    readonly onRetry: () => void;
    readonly onLoadMore: () => void;
}
