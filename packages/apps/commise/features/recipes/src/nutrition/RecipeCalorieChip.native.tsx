/**
 * @module @commise/features-recipes/nutrition — native calorie chip (the RN leaf of RecipeCalorieChip).
 *
 * Same contract, same union, same two rules as the web leaf (see `RecipeCalorieChip.tsx`): an EXHAUSTIVE
 * switch over the SETTLED states with no `pending` case, `unaccounted` renders nothing for every reason, and
 * a `known` reading of 0 renders "0 cal". Only the primitives differ.
 */
import { useLocale, useMessages } from '@commise/i18n/react';
import { palette } from '@commise/ui';
import type { FC } from 'react';
import { StyleSheet, Text } from 'react-native';

import { recipeNutritionMessages } from './messages.js';
import { toCalorieChipModel, type RecipeCalorieState } from './model.js';

/** Props for the native calorie chip. */
export interface RecipeCalorieChipProps {
    /** The SETTLED reading. Structurally cannot be `pending` — that state is the Suspense fallback's. */
    readonly nutrition: RecipeCalorieState;
}

/**
 * The calorie chip (native): the localized per-serving figure for a settled reading, or nothing at all when
 * the lookup came back with no figure.
 *
 * @param props - The settled reading to render.
 * @returns The chip, or `null` for an `unaccounted` reading.
 */
export const RecipeCalorieChip: FC<RecipeCalorieChipProps> = ({ nutrition }) => {
    const messages = useMessages(recipeNutritionMessages);
    const locale = useLocale();

    switch (nutrition.state) {
        case 'known': {
            const chip = toCalorieChipModel(nutrition, locale, messages);

            return (
                // `accessibilityRole="image"` mirrors the web leaf's `role="img"`: it announces the figure
                // and its caveat as ONE unit, and keeps the two platforms identical in EFFECT and not merely
                // in API — the web leaf needs the role because a bare span cannot carry an accessible name
                // at all, and a native `Text` that announced differently would be the same §14 drift by
                // another route.
                <Text
                    accessibilityRole="image"
                    accessibilityLabel={chip.label}
                    style={chip.isStale ? styles.stale : styles.figure}
                >
                    {chip.text}
                </Text>
            );
        }

        case 'unaccounted':
            return null;
    }
};

const styles = StyleSheet.create({
    // Matches the card meta row's own `metaText` (13pt slate) so the chip sits in the row rather than on it.
    figure: { fontSize: 13, color: palette.slate },
    // The sighted reader's half of "serve stale, MARKED" — the italic is the cue, the accessible name carries
    // the caveat itself. The colour is deliberately UNCHANGED: dimming it further would trade a contrast
    // ratio the meta row was tuned to for a signal the accessible name already delivers.
    stale: { fontSize: 13, color: palette.slate, fontStyle: 'italic' },
});
