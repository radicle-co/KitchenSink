/**
 * @module @commise/features-recipes — the native "Recent recipes" grid: Home's 2 × 2 below a 600 container and one row
 * of four from 600 (`HOME_COLUMNS`), of cards in the variant the host decided (owner ruling D8). Pure `props → JSX`.
 *
 * @pattern Layout component over a pure projection — it owns the arrangement and nothing else
 */
import { containerClassOf, contentWidthOf } from '@commise/ui/container-class';
import { nativeTokens } from '@commise/ui/native';
import type { FC } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';

import { HOME_COLUMNS } from '../card/cardGridLayout.js';
import { RecipeCard } from '../card/RecipeCard.native.js';
import type { RecentRecipeGridProps } from './props.js';

/** A cell's width as a share of the row, leaving each gap its room without a negative margin. */
const CELL_WIDTH: Readonly<Record<number, `${number}%`>> = { 2: '48%', 4: '23%' };

export const RecentRecipeGrid: FC<RecentRecipeGridProps> = ({ recipes, variant, onSelectRecipe, renderNutrition }) => {
    const columns = HOME_COLUMNS[containerClassOf(contentWidthOf(useWindowDimensions().width))];

    return (
        <View collapsable={false} role="list" style={styles.grid}>
            {recipes.map((recipe) => (
                <View
                    key={recipe.id}
                    collapsable={false}
                    role="listitem"
                    {...{ dataSet: { homeCell: '' } }}
                    style={{ width: CELL_WIDTH[columns] ?? '48%' }}
                >
                    <RecipeCard
                        variant={variant}
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
