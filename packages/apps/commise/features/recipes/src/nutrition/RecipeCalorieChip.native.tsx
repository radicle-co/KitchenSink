/**
 * @module @commise/features-recipes/nutrition — native calorie chip (the RN leaf of RecipeCalorieChip).
 *
 * Same contract, same union, same two rules as the web leaf (see `RecipeCalorieChip.tsx`): an EXHAUSTIVE
 * switch over the SETTLED states with no `pending` case, `unaccounted` renders nothing for every reason, and
 * a `known` reading of 0 renders "0 cal". Only the primitives differ.
 */
import { useLocale, useMessages } from '@commise/i18n/react';
import { nativeTokens } from '@commise/ui/native';
import { useTheme } from '@commise/ui/theme';
import { useContext, type FC } from 'react';
import { StyleSheet, Text } from 'react-native';

import { MetaLeadContext, unbreakable } from '../card/metaRun.js';
import { recipeNutritionMessages } from './messages.js';
import { toCalorieChipModel, type RecipeCalorieState } from './model.js';

/** Props for the native calorie chip. */
export interface RecipeCalorieChipProps {
    /** The SETTLED reading. Structurally cannot be `pending` — the slot renders that reading as the skeleton. */
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
    const { colors } = useTheme();
    const lead = useContext(MetaLeadContext);

    switch (nutrition.state) {
        case 'known': {
            const chip = toCalorieChipModel(nutrition, locale, messages);

            return (
                <>
                    {/* The lead is text of the run, outside the figure's own span: a span that starts with a space or a dot
                        lets iOS break at its boundary (qa-ios on 087051a43). Empty outside a meta line, where a bare string
                        would not be allowed. */}
                    {lead === '' ? null : lead}
                    {/* `accessibilityRole="image"` mirrors the web leaf's `role="img"`: it announces the figure and its
                        caveat as ONE unit, so the two platforms are identical in EFFECT and not merely in API. */}
                    <Text
                        accessibilityRole="image"
                        accessibilityLabel={chip.label}
                        style={[chip.isStale ? styles.stale : styles.figure, { color: colors.inkMuted }]}
                    >
                        {unbreakable(chip.text)}
                    </Text>
                </>
            );
        }

        case 'unaccounted':
            return null;
    }
};

const styles = StyleSheet.create({
    // Matches the card meta row's own `metaText` (13pt `inkMuted`) so the chip sits in the row rather than on it.
    figure: { ...nativeTokens.type.meta },
    // The sighted reader's half of "serve stale, MARKED" — the italic is the cue, the accessible name carries
    // the caveat itself. The colour is deliberately UNCHANGED: dimming it further would trade a contrast
    // ratio the meta row was tuned to for a signal the accessible name already delivers.
    stale: { ...nativeTokens.type.meta, fontStyle: 'italic' },
});
