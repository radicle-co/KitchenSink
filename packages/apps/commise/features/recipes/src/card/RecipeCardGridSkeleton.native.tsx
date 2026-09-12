/**
 * @module @commise/features-recipes — the ONE authoritative NATIVE recipe-card-grid loading skeleton.
 *
 * **Pattern: Null Object for the loading phase** — the RN counterpart of `RecipeCardGridSkeleton.tsx`, with
 * the identical public API (`label`, optional `count`) so the two leaves are interchangeable per §14.
 *
 * ⛔ WHY IT EXISTS. The web leaf has been the single authoritative recipe-grid skeleton since it was
 * extracted; native had NO counterpart at all, so every native surface that paints a loading recipe grid
 * carried its own placeholder grid in its own `StyleSheet`. One component with a web-only implementation is a
 * breach of the cross-platform rule (`docs/CODING_STANDARDS.md` §14), and the duplication had already drifted:
 * the native grid painted four placeholders where the web grid paints six, so the same product surface
 * reserved different space per platform. Both now take {@link RECIPE_CARD_SKELETON_COUNT}.
 *
 * ⚠️ SCOPE, stated rather than assumed: this is the GRID skeleton, adopted by `RecipeDiscoveryList.native.tsx`
 * (a two-column grid, like both web surfaces). `RecipeList.native.tsx` deliberately keeps its own
 * single-COLUMN placeholder, because its populated layout is a single column of taller cards — a skeleton
 * that does not mirror its own populated layout reintroduces exactly the reflow this component exists to
 * prevent, and "loading 2-col grid" and "loading 1-col list" are two pieces of knowledge, not one repeated.
 *
 * Two deliberate DIFFERENCES from the web leaf, each a platform fact rather than a drift:
 *
 *  1. **The label is an accessibility NAME, not a live region.** React Native has no `role="status"` and no
 *     live-region announcement, so the copy names the placeholder for a screen reader instead of being
 *     announced. It is still supplied by the caller and localized — never a literal.
 *  2. **The placeholders are INERT.** No pulse, therefore no reduced-motion gate: there is no non-essential
 *     animation to suppress. Both native surfaces already made that choice for the same reason (an animated
 *     placeholder per card is per-frame work on the surface that must scroll), and this leaf preserves it.
 */
import { nativeTokens } from '@commise/ui/native';
import type { FC } from 'react';
import { StyleSheet, View } from 'react-native';

import { RECIPE_CARD_SKELETON_COUNT } from './model.js';

/** Props for the native {@link RecipeCardGridSkeleton} — identical to the web leaf's. */
export interface RecipeCardGridSkeletonProps {
    /** The localized "loading…" copy — names the placeholder region for assistive tech. */
    readonly label: string;
    /** How many placeholder cards to paint. Defaults to {@link RECIPE_CARD_SKELETON_COUNT}. */
    readonly count?: number;
}

/**
 * A named loading region over a grid of inert, card-shaped placeholders.
 *
 * @param props - The localized loading label and, optionally, how many placeholder cards to paint.
 * @returns The named region wrapping the decorative placeholder grid.
 */
export const RecipeCardGridSkeleton: FC<RecipeCardGridSkeletonProps> = ({
    label,
    count = RECIPE_CARD_SKELETON_COUNT,
}) => (
    <View accessible accessibilityLabel={label} style={styles.grid}>
        {Array.from({ length: count }, (_unused, index) => index).map((key) => (
            // `aria-hidden` on each CARD, not on the container: the container carries the region's name, and
            // hiding it would hide that name too.
            <View key={key} aria-hidden style={styles.card} />
        ))}
    </View>
);

const styles = StyleSheet.create({
    // The two-column rhythm the populated native grid uses, so the layout does not jump when the page lands.
    // `48%` (not `50%`) leaves the gap its own room without a negative margin.
    grid: { flexDirection: 'row', flexWrap: 'wrap', gap: nativeTokens.spacing[3] },
    // Shaped like a recipe card (cover + body); the subtle border fill, and no motion.
    card: {
        width: '48%',
        height: 220,
        borderRadius: nativeTokens.radius.lg,
        backgroundColor: nativeTokens.borderSubtle,
    },
});
