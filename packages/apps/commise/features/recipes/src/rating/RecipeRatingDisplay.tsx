/**
 * @module @commise/features-recipes/rating — the READ-ONLY rating variant (FR-013, Sc8), web leaf.
 *
 * Shown on the viewer's OWN recipe: the community aggregate plus a stated reason the input is withheld.
 * Renders NOTHING interactive — the own-recipe gate is structural here, and the orchestrating container never
 * mounts this on a rateable recipe (see `ratingModeFor`). The backend guard is the real enforcement.
 *
 * Controlled + presentational: owns no remote state and fetches nothing. The read-only stars the viewer sees
 * are the COMMUNITY `average` by design, not "your rating".
 */
import { useMessages } from '@commise/i18n/react';
import type { FC } from 'react';

import { recipeRatingMessages } from './messages.js';
import { RatingSection } from './RatingSection.js';
import type { RecipeRatingDisplayProps } from './model.js';

/**
 * The read-only rating variant.
 *
 * @param props - The community aggregate values.
 * @returns The rating section with the own-recipe note.
 */
export const RecipeRatingDisplay: FC<RecipeRatingDisplayProps> = ({ average, ratingCount }) => {
    const { rating } = useMessages(recipeRatingMessages);

    return (
        <RatingSection average={average} ratingCount={ratingCount}>
            <p className="text-body-sm text-slate">{rating.ownRecipeNote}</p>
        </RatingSection>
    );
};
