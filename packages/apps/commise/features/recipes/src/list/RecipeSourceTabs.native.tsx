/**
 * @module @commise/features-recipes — the My Recipes / Community source switcher (L5), native leaf.
 *
 * The React Native rendering of {@link import('./RecipeSourceTabs.js').RecipeSourceTabs}: the same switcher,
 * the same two sources, the same resting affordance, rendered with RN primitives. One strip serves both
 * recipe-source surfaces (`RecipeList`, `RecipeDiscoveryList`) so they cannot drift into the asymmetry the web
 * pair had, where the community surface offered no way back.
 *
 * ## Semantics — `accessibilityRole="tab"` here, `<a>` on web, and that IS the same model
 *
 * The web leaf's module JSDoc carries the full argument. In short: web sources are URLs, so web must use
 * links; React Native has no URL, no address bar and no "open in new tab", and the shell swaps screens in
 * place — so the platform's own trait for a top-level destination switcher is the tab trait, which is what
 * mobile's `HomeTabBar` and the recipes shell already announce. Parity is on the model and behaviour, not on
 * the element name. Activation therefore goes through `tab.onChange` (native's only navigation seam); `href`
 * is web's half of the shared control and is deliberately ignored here.
 *
 * ## Why the single {@link RecipeSourceTab} is exported
 *
 * Mobile's recipe shell (`RecipesScreen`'s tab bar) is the switcher a phone user ACTUALLY touches, and it
 * carries a third destination (Collections) that has no web peer, so it cannot render the two-source strip
 * wholesale. It composes this one tab instead — which keeps the affordance (fill, hairline, underline, the
 * 44pt target, the palette rule) defined ONCE for native rather than transcribed into the shell, where it
 * would drift the moment either side is touched.
 */
import { useMessages } from '@commise/i18n/react';
import { palette } from '@commise/ui';
import { nativeTokens } from '@commise/ui/native';
import type { FC } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { recipeMessages } from '../messages.js';
import { RECIPE_SOURCE_TABS, sourceTabLabel, type RecipeListTabControl } from './model.js';

/** Props for {@link RecipeSourceTab}. */
export interface RecipeSourceTabProps {
    /** The visible + accessible label. */
    readonly label: string;
    /** Whether this is the source currently showing. */
    readonly selected: boolean;
    /** Activate this source. */
    readonly onPress: () => void;
}

/**
 * ONE source tab. The native half of the affordance fix: an unselected tab rests as a visible folder — a
 * `pearl` fill under a `slate` hairline — instead of bare text. Touch has no hover, so a hover-only signal (the
 * web defect this mirrors) means no signal at all on a phone; the resting fill + hairline are what a thumb can
 * see. `slate` is the lightest palette token whose boundary clears the 3:1 SC 1.4.11 floor against the fill
 * (`mist` is 1.87:1), and the label clears the 4.5:1 text floor on it at 4.76:1 — both measured in the tests.
 *
 * The selected tab keeps the seafoam UNDERLINE with an `ocean-dark` LABEL: the palette rule (see the palette
 * JSDoc in `@commise/ui`'s `tokens/colors.ts`), mirroring the web leaf exactly.
 *
 * @param props - The label, selected state, and activation callback.
 * @returns One pressable source tab.
 */
export const RecipeSourceTab: FC<RecipeSourceTabProps> = ({ label, selected, onPress }) => (
    <Pressable
        accessibilityRole="tab"
        accessibilityLabel={label}
        // `aria-selected`, not `accessibilityState={{ selected }}` — which is what the previous strips passed.
        // React Native accepts both (the ARIA form takes precedence) but react-native-web only projects the
        // ARIA one to the DOM, so the older form left the selected state UNOBSERVABLE to assistive tech on
        // mobile web and to every test. Mobile's `HomeTabBar` already uses this form.
        aria-selected={selected}
        onPress={onPress}
        style={[styles.tab, selected ? styles.tabSelected : styles.tabUnselected]}
    >
        <Text style={selected ? styles.labelSelected : styles.label}>{label}</Text>
    </Pressable>
);

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
    // A 44pt touch target (RC-3). `marginBottom: -1` laps the strip's own hairline so the tabs sit ON the
    // rule, matching the web leaf's `-mb-px`.
    tab: {
        paddingHorizontal: nativeTokens.spacing[4],
        minHeight: 44,
        justifyContent: 'center',
        marginBottom: -1,
        borderTopLeftRadius: nativeTokens.radius.lg,
        borderTopRightRadius: nativeTokens.radius.lg,
    },
    tabUnselected: { backgroundColor: palette.pearl, borderBottomWidth: 1, borderBottomColor: palette.slate },
    tabSelected: { backgroundColor: palette.white, borderBottomWidth: 2, borderBottomColor: palette.seafoam },
    label: { fontSize: nativeTokens.fontSize.bodySm, fontWeight: '600', color: palette.slate },
    labelSelected: { fontSize: nativeTokens.fontSize.bodySm, fontWeight: '600', color: palette['ocean-dark'] },
});
