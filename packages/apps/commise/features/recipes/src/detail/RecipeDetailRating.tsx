/**
 * @module @commise/features-recipes/detail — the recipe page's rating block, one component for both apps. The owner sees
 * the read-only aggregate (Sc8: a cook cannot rate their own recipe); everyone else gets the interactive input. Both
 * leaves are platform pairs, so this file needs none of its own: the bundler resolves `RecipeRatingDisplay` and
 * `RecipeRatingInput` to the web or native leaf.
 *
 * @pattern Strategy — the rating mode picks the render component (B15); the own-recipe gate lives HERE, not in a mode
 *     prop of either leaf, so inverting it fails a test rather than offering self-rating.
 */
import type { FC } from 'react';

import type { RecipeRatingError, RecipeRatingMode } from '../rating/model.js';
import { RecipeRatingDisplay } from '../rating/RecipeRatingDisplay.js';
import { RecipeRatingInput } from '../rating/RecipeRatingInput.js';

/** Props for {@link RecipeDetailRating}: what `useRecipeDetailController` decided. */
export interface RecipeDetailRatingProps {
    /** `own` for the recipe's owner; `rate` for everyone else (`ratingModeFor`). */
    readonly mode: RecipeRatingMode;
    /** The community average, if anyone has rated. */
    readonly average: number | undefined;
    readonly ratingCount: number;
    /** The viewer's own prior rating, pre-selected in the input. */
    readonly selectedStars: number | undefined;
    /** A rating write (set or remove) is in flight. */
    readonly pending: boolean;
    /** What the last failed write is called. */
    readonly error: RecipeRatingError | undefined;
    readonly onRate: (stars: number) => void;
    readonly onRemove: () => void;
}

/** The recipe page's rating block. */
export const RecipeDetailRating: FC<RecipeDetailRatingProps> = ({
    mode,
    average,
    ratingCount,
    selectedStars,
    pending,
    error,
    onRate,
    onRemove,
}) => {
    const aggregate = { ...(average === undefined ? {} : { average }), ratingCount };

    if (mode === 'own') {
        return <RecipeRatingDisplay {...aggregate} />;
    }

    return (
        <RecipeRatingInput
            {...aggregate}
            {...(selectedStars === undefined ? {} : { selectedStars })}
            pending={pending}
            {...(error === undefined ? {} : { error })}
            onRate={onRate}
            onRemove={onRemove}
        />
    );
};
