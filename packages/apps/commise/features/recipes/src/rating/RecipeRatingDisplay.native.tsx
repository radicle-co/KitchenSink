/**
 * @module @commise/features-recipes/rating — the READ-ONLY rating variant (FR-013, Sc8), native leaf.
 *
 * The React Native peer of the web `RecipeRatingDisplay` — same contract: shown on the viewer's OWN recipe,
 * the community aggregate plus a stated reason the input is withheld. Renders NOTHING interactive; the
 * backend guard is the real enforcement and the orchestrating container never mounts this on a rateable
 * recipe (see `ratingModeFor`).
 *
 * @pattern Null Object for the rating input — the native peer of the web variant, substituted by the same
 *     orchestrating container so the gate stays structural on both platforms.
 */
import { useMessages } from '@commise/i18n/react';
import { palette } from '@commise/ui';
import type { FC } from 'react';
import { StyleSheet, Text } from 'react-native';

import { recipeRatingMessages } from './messages.js';
import { RatingSection } from './RatingSection.native.js';
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
            <Text style={styles.note}>{rating.ownRecipeNote}</Text>
        </RatingSection>
    );
};

const styles = StyleSheet.create({
    note: { fontSize: 13, color: palette.slate },
});
