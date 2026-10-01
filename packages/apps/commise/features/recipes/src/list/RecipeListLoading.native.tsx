/**
 * @module @commise/features-recipes — native recipe-list LOADING fallback (presentational): what the list's `Suspense`
 * renders while the library is pending.
 *
 * Skeleton cards (NOT a blank view — U4): inert, motion-free placeholders shaped like a recipe card, so the surface has
 * structure while the library loads. Motion-free ⇒ no reduce-motion gate. ⛔ No create dial and no chips — see the web
 * leaf and `shouldShowCreateDial` for why a dial must not mount over an unanswered library.
 */
import { useMessages } from '@commise/i18n/react';
import { nativeTokens } from '@commise/ui/native';
import type { FC } from 'react';
import { StyleSheet, View } from 'react-native';

import { recipeMessages } from '../messages.js';

/** How many inert skeleton cards the loading state renders. */
const SKELETON_COUNT = 3;

export const RecipeListLoading: FC = () => {
    const { list } = useMessages(recipeMessages);

    return (
        <View accessibilityLabel={list.loadingLabel} style={styles.cards}>
            {Array.from({ length: SKELETON_COUNT }, (_value, index) => (
                <View key={index} aria-hidden style={styles.skeletonCard} />
            ))}
        </View>
    );
};

const styles = StyleSheet.create({
    cards: { paddingBottom: nativeTokens.spacing[5] },
    // Its bottom margin is the results' inter-card gap, so the skeleton and the cards it gives way to share one rhythm.
    skeletonCard: {
        height: 300,
        borderRadius: nativeTokens.radius.lg,
        backgroundColor: nativeTokens.borderSubtle,
        marginBottom: nativeTokens.spacing[3],
    },
});
