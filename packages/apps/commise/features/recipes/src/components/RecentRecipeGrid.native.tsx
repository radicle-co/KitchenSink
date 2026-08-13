/**
 * @module @commise/features-recipes — native "Recent recipes" card list (Home widget building block).
 *
 * The React Native leaf of `RecentRecipeGrid` — same contract, same
 * navigation seam. PLATFORM-FORK: the web leaf paints the mockup's 2-up/4-up CSS grid; on a phone-width
 * native surface the equivalent arrangement is a single column, which is what the mobile Home widget already
 * presents. Keeping the arrangement in a leaf per platform (rather than a shared component with a layout
 * flag) is what lets each platform express its own without the other carrying a dead branch.
 */
import { nativeTokens } from '@commise/ui/native';
import type { FC } from 'react';
import { StyleSheet, View } from 'react-native';

import { RecentRecipeItem } from './RecentRecipeItem.js';
import type { RecentRecipeGridProps } from './props.js';

/** The recent-recipes card list on React Native: a single column of tappable cards. */
export const RecentRecipeGrid: FC<RecentRecipeGridProps> = ({ recipes, onSelectRecipe }) => (
    <View style={styles.list}>
        {recipes.map((recipe) =>
            onSelectRecipe === undefined ? (
                <RecentRecipeItem key={recipe.id} recipe={recipe} />
            ) : (
                <RecentRecipeItem key={recipe.id} recipe={recipe} onSelect={onSelectRecipe} />
            ),
        )}
    </View>
);

const styles = StyleSheet.create({
    // The same 16px rhythm the web grid's `gap-4` applies, from the shared spacing scale.
    list: { gap: nativeTokens.spacing[4] },
});
