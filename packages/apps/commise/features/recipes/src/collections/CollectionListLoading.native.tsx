/**
 * @module @commise/features-recipes — native collection-list LOADING fallback (presentational): what the list's `Suspense` renders while
 * the first page is pending.
 *
 * Skeleton cards (NOT a blank view — U4): inert, motion-free placeholders shaped like a collection row, so the surface
 * has structure while the first page loads. Motion-free ⇒ no reduce-motion gate.
 */
import { useMessages } from '@commise/i18n/react';
import { nativeTokens } from '@commise/ui/native';
import { useTheme } from '@commise/ui/theme';
import type { FC } from 'react';
import { StyleSheet, View } from 'react-native';

import { collectionMessages } from './messages.js';

/** How many inert skeleton cards the loading state renders. */
const SKELETON_COUNT = 4;

export const CollectionListLoading: FC = () => {
    const { list } = useMessages(collectionMessages);
    const { colors } = useTheme();

    return (
        <View collapsable={false} accessibilityLabel={list.loadingLabel} style={styles.cards}>
            {Array.from({ length: SKELETON_COUNT }, (_value, index) => (
                <View key={index} aria-hidden style={[styles.skeletonCard, { backgroundColor: colors.surfaceMuted }]} />
            ))}
        </View>
    );
};

const styles = StyleSheet.create({
    cards: { paddingBottom: nativeTokens.spacing[5] },
    // Inert loading placeholder shaped like a collection row; its `surfaceMuted` fill is painted at render (the web
    // twin's `bg-surface-muted`), no motion. Its bottom margin is the
    // results' inter-card gap, so the skeleton and the rows it gives way to share one rhythm.
    skeletonCard: {
        height: 76,
        borderRadius: nativeTokens.radius.lg,
        marginBottom: nativeTokens.spacing[3],
    },
});
