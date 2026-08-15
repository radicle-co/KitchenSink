/**
 * @module @commise/features-recipes — the My Recipes / Community source switcher (L5), native leaf.
 *
 * The React Native rendering of `RecipeSourceTabs`: the same switcher, the same two sources, the same resting
 * affordance, rendered with RN primitives. One strip serves both recipe-source surfaces (`RecipeList`,
 * `RecipeDiscoveryList`) so they cannot drift into the asymmetry the web pair had, where the community
 * surface offered no way back.
 *
 * The tab affordance itself lives in {@link RecipeSourceTab} (its own leaf), because mobile's recipe shell
 * composes a single tab alongside a third destination that has no web peer — see that module's JSDoc.
 * Activation goes through `tab.onChange` (native's only navigation seam); `href` is web's half of the shared
 * control and is deliberately ignored here.
 */
import { useMessages } from '@commise/i18n/react';
import { nativeTokens } from '@commise/ui/native';
import type { FC } from 'react';
import { StyleSheet, View } from 'react-native';

import { recipeMessages } from '../messages.js';
import { RecipeSourceTab } from './RecipeSourceTab.native.js';
import { RECIPE_SOURCE_TABS, sourceTabLabel, type RecipeListTabControl } from './model.js';

/** Props for {@link RecipeSourceTabs}. */
export interface RecipeSourceTabsProps {
    /** Which source is showing, and how to activate the other. */
    readonly tab: RecipeListTabControl;
}

/**
 * The recipe-source switcher.
 *
 * @param props - The active source + its activation callback.
 * @returns A tablist of one tab per source.
 */
export const RecipeSourceTabs: FC<RecipeSourceTabsProps> = ({ tab }) => {
    const { list } = useMessages(recipeMessages);

    return (
        <View accessibilityRole="tablist" accessibilityLabel={list.tabsLabel} style={styles.tabs}>
            {RECIPE_SOURCE_TABS.map((value) => (
                <RecipeSourceTab
                    key={value}
                    label={sourceTabLabel(value, list)}
                    selected={tab.active === value}
                    onPress={() => tab.onChange?.(value)}
                />
            ))}
        </View>
    );
};

const styles = StyleSheet.create({
    tabs: {
        flexDirection: 'row',
        gap: nativeTokens.spacing[2],
        borderBottomWidth: 1,
        borderBottomColor: nativeTokens.borderSubtle,
    },
});
