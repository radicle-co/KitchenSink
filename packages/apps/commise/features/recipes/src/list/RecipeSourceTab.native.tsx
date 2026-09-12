/**
 * @module @commise/features-recipes — ONE recipe-source tab (L5), native leaf.
 *
 * The affordance itself, defined ONCE for native and composed by every native surface that offers a source
 * switcher: the two-source strip (`RecipeSourceTabs.native.tsx`) and mobile's recipe shell (`RecipesScreen`'s
 * tab bar), which carries a third destination (Collections) that has no web peer and therefore cannot render
 * the strip wholesale. Transcribing the affordance into the shell instead would drift the moment either side
 * is touched.
 *
 * ## Semantics — `accessibilityRole="tab"` here, `<a>` on web, and that IS the same model
 *
 * The web leaf's module JSDoc carries the full argument. In short: web sources are URLs, so web must use
 * links; React Native has no URL, no address bar and no "open in new tab", and the shell swaps screens in
 * place — so the platform's own trait for a top-level destination switcher is the tab trait, which is what
 * mobile's `HomeTabBar` and the recipes shell already announce. Parity is on the model and behaviour, not on
 * the element name.
 */
import { palette } from '@commise/ui';
import { nativeTokens } from '@commise/ui/native';
import type { FC } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';

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
 * (`mist` is 1.74:1), and the label clears the 4.5:1 text floor on it at 4.81:1 — both measured in the tests.
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

const styles = StyleSheet.create({
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
