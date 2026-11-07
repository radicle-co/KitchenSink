/**
 * @module @commise/features-recipes — the native "Recent recipes" grid: below a 600 container two columns while the
 * content width over the capped text scale is at least 320 pt and one column below (`compactColumnsOf`, the one phone
 * grid rule, designer 2026-11-02), and one row of four from 600 (`HOME_COLUMNS`), of cards in the variant the host
 * decided (owner ruling D8). Pure `props → JSX`.
 *
 * @pattern Layout component over a pure projection — it owns the arrangement and nothing else
 */
import { containerClassOf, contentWidthOf } from '@commise/ui/container-class';
import { cappedFontScale } from '@commise/ui/font-scale-cap';
import { nativeTokens } from '@commise/ui/native';
import type { FC } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';

import { compactColumnsOf, HOME_COLUMNS } from '../card/cardGridLayout.js';
import { RecipeCard } from '../card/RecipeCard.native.js';
import type { RecentRecipeGridProps } from './props.js';

/** A cell's width as a share of the row, leaving each gap its room without a negative margin. */
const CELL_WIDTH: Readonly<Record<number, `${number}%`>> = { 1: '100%', 2: '48%', 4: '23%' };

export const RecentRecipeGrid: FC<RecentRecipeGridProps> = ({ recipes, variant, onSelectRecipe, renderNutrition }) => {
    const { width, fontScale } = useWindowDimensions();
    const contentWidth = contentWidthOf(width);
    const containerClass = containerClassOf(contentWidth);
    // A phone's column count follows the room at the text size drawn; a wider window keeps Home's own four.
    const columns =
        containerClass === 'narrow'
            ? compactColumnsOf(contentWidth, cappedFontScale(fontScale))
            : HOME_COLUMNS[containerClass];

    return (
        <View collapsable={false} role="list" style={styles.grid}>
            {recipes.map((recipe) => (
                <View
                    key={recipe.id}
                    collapsable={false}
                    role="listitem"
                    {...{ dataSet: { homeCell: '' } }}
                    style={{ width: CELL_WIDTH[columns] ?? '100%' }}
                >
                    <RecipeCard
                        variant={variant}
                        headingLevel={3}
                        recipe={recipe}
                        {...(onSelectRecipe === undefined ? {} : { onSelect: onSelectRecipe })}
                        nutrition={renderNutrition?.(recipe.id)}
                    />
                </View>
            ))}
        </View>
    );
};

const styles = StyleSheet.create({
    grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: nativeTokens.spacing[3] },
});
