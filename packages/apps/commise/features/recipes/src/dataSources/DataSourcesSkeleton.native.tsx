/**
 * @module @commise/features-recipes/dataSources — native Data sources LOADING state (presentational; design §S16).
 *
 * The React Native twin of `DataSourcesSkeleton.tsx`: the caption, shown and spoken politely through `LiveRegion`
 * (React Native has no live region of its own on iOS), and three inert placeholder cards kept out of the accessibility
 * tree. Inert, not pulsing, as the native list skeletons are, so no reduced-motion gate is needed.
 */
import { useMessages } from '@commise/i18n/react';
import { LiveRegion } from '@commise/ui/live-region';
import { nativeTokens } from '@commise/ui/native';
import { useTheme } from '@commise/ui/theme';
import type { FC } from 'react';
import { StyleSheet, View } from 'react-native';

import { dataSourcesMessages } from './messages.js';

/** How many placeholder cards stand in for the list. */
const PLACEHOLDER_CARDS = [0, 1, 2] as const;

/**
 * The read's pending state (native): the caption, spoken politely, and three inert placeholder cards.
 *
 * @returns The loading state.
 */
export const DataSourcesSkeleton: FC = () => {
    const messages = useMessages(dataSourcesMessages);
    const { colors } = useTheme();

    return (
        <View style={styles.column}>
            <LiveRegion politeness="polite" style={[styles.caption, { color: colors.inkMuted }]}>
                {messages.loading}
            </LiveRegion>
            <View aria-hidden style={styles.column}>
                {PLACEHOLDER_CARDS.map((card) => (
                    <View key={card} style={[styles.placeholder, { backgroundColor: colors.surfaceMuted }]} />
                ))}
            </View>
        </View>
    );
};

const styles = StyleSheet.create({
    column: { gap: nativeTokens.spacing[3] },
    caption: { fontSize: nativeTokens.fontSize.caption },
    // About as tall as a five-line card, so the sheet does not jump when the list lands.
    placeholder: { height: 160, borderRadius: nativeTokens.radius.lg },
});
