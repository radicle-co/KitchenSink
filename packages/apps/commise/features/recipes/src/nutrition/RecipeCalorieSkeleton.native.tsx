/**
 * @module @commise/features-recipes/nutrition — native calorie skeleton (the RN leaf).
 *
 * The native half of the Suspense fallback (see `RecipeCalorieSkeleton.tsx` for the contract). React Native
 * has no live regions, so the localized copy is the placeholder's accessibility NAME rather than an
 * announcement; the bar itself stays out of the accessibility tree.
 *
 * The placeholder is INERT — no pulse, so no reduced-motion gate is needed. That is the same choice the
 * native recipe-list and discovery skeletons already make, and it is deliberate: an animated placeholder per
 * card in a virtualized list is a per-frame cost on the exact surface that must scroll smoothly.
 */
import { palette } from '@commise/ui';
import { nativeTokens } from '@commise/ui/native';
import type { FC } from 'react';
import { StyleSheet, View } from 'react-native';

/** Props for the native calorie skeleton. */
export interface RecipeCalorieSkeletonProps {
    /** The localized "loading calories" copy — the placeholder's accessible name. */
    readonly label: string;
}

/**
 * The in-flight placeholder for one recipe's calorie figure (native).
 *
 * @param props - The localized loading label.
 * @returns A named, inert placeholder shaped like the chip it stands in for.
 */
export const RecipeCalorieSkeleton: FC<RecipeCalorieSkeletonProps> = ({ label }) => (
    <View accessible accessibilityLabel={label} style={styles.container}>
        <View aria-hidden style={styles.bar} />
    </View>
);

const styles = StyleSheet.create({
    container: { justifyContent: 'center' },
    // Sized to the chip it replaces (13pt "420 cal"), so the meta row holds its shape when the figure lands.
    bar: {
        width: 52,
        height: 12,
        borderRadius: nativeTokens.radius.sm,
        backgroundColor: palette.pearl,
    },
});
