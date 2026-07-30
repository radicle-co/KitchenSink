/**
 * @module home/chrome/icons — the Home chrome's glyphs (mobile; US-000 / FR-046 / FR-044).
 *
 * The native counterpart of the web chrome's `icons.tsx` registry, and the same shape: a REGISTRY keyed by
 * the SHARED nav model's destination ids (`HomeNavItemId`) plus the top-bar control affordances, so the two
 * platforms draw the same mockup glyph for the same destination while each keeps its own drawing primitive —
 * hand-inlined SVG on web, `@expo/vector-icons` on native.
 *
 * **Feather is the family.** The mockup's chrome glyphs are 24×24 stroked outline icons; Feather is that
 * visual language, ships in the app's existing `@expo/vector-icons` dependency (already used by the auth,
 * profile, and recipe surfaces), and needs no new package. Typing the registry as a total
 * `Record<HomeNavItemId, …>` makes a destination without a glyph a COMPILE error rather than a silently
 * text-only tab.
 *
 * Every glyph is **decorative**: it is always paired with a real label or accessible name owned by the
 * surrounding control, so {@link ChromeIcon} hides it from assistive technology. That is what keeps a screen
 * reader announcing "Recipes" rather than "Recipes, image".
 */
import type { HomeNavItemId } from '@commise/features-core';
import { Feather } from '@expo/vector-icons';
import type { ComponentProps, JSX } from 'react';
import { StyleSheet, View } from 'react-native';

/** A Feather glyph name — the family's own union, so a typo cannot compile. */
export type ChromeIconName = ComponentProps<typeof Feather>['name'];

/**
 * The glyph for each shared nav destination, in the mockup's pairing (house, open book, calendar, cart, bar
 * chart, person). Total over {@link HomeNavItemId} by construction.
 */
export const NAV_ICONS: Readonly<Record<HomeNavItemId, ChromeIconName>> = {
    home: 'home',
    recipes: 'book-open',
    'meal-plan': 'calendar',
    grocery: 'shopping-cart',
    nutrition: 'bar-chart-2',
    profile: 'user',
};

/** The top-bar control affordances of the mockup — the ids that are NOT navigation destinations. */
export const CONTROL_ICONS = {
    search: 'search',
    notifications: 'bell',
} as const satisfies Readonly<Record<string, ChromeIconName>>;

/** Props for {@link ChromeIcon}. */
export interface ChromeIconProps {
    /** The glyph to draw. */
    readonly name: ChromeIconName;
    /** The stroke colour — the caller's state colour (active / inactive / gated). */
    readonly color: string;
    /** Glyph size in points. Defaults to the mockup's 24. */
    readonly size?: number;
}

/**
 * A decorative chrome glyph.
 *
 * @param props - The glyph name, its stroke colour, and an optional size.
 * @returns The glyph wrapped in an accessibility-hidden view, so the surrounding control owns the name.
 */
export function ChromeIcon({ name, color, size = 24 }: ChromeIconProps): JSX.Element {
    return (
        <View aria-hidden style={styles.glyph}>
            <Feather name={name} size={size} color={color} />
        </View>
    );
}

const styles = StyleSheet.create({
    glyph: { alignItems: 'center', justifyContent: 'center' },
});
