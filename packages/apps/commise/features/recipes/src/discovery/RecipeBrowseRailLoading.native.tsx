/**
 * @module @commise/features-recipes — native browse-rail LOADING body (presentational, U7).
 *
 * The React Native twin of `RecipeBrowseRailLoading`: three inert placeholder cards the size of a rail card while that
 * rail is pending, with its localized label as the visible caption — as on web, a live region announces its CONTENT, not
 * its label. They lay out in a horizontal strip of the loaded rail's own width rule, so the page does not reflow when
 * the cards arrive. Colour is read from the theme at render (D15).
 */
import { useMessages } from '@commise/i18n/react';
import { contentWidthOf } from '@commise/ui/container-class';
import { nativeTokens } from '@commise/ui/native';
import { useTheme } from '@commise/ui/theme';
import type { FC } from 'react';
import { ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { discoveryMessages } from './messages.js';
import { RAIL_GAP_PX, railCardWidthOf } from './railScroll.js';

export const RecipeBrowseRailLoading: FC = () => {
    const discovery = useMessages(discoveryMessages);
    const { colors } = useTheme();
    const { width } = useWindowDimensions();
    const cardWidth = railCardWidthOf(contentWidthOf(width));

    return (
        <View collapsable={false} role="status" style={styles.region}>
            <Text style={[styles.caption, { color: colors.inkMuted }]}>{discovery.loadingLabel}</Text>
            <ScrollView
                horizontal
                scrollEnabled={false}
                scrollsToTop={false}
                aria-hidden
                contentContainerStyle={styles.strip}
            >
                {[0, 1, 2].map((card) => (
                    <View
                        key={card}
                        style={[styles.skeleton, { width: cardWidth, backgroundColor: colors.lineDivider }]}
                    />
                ))}
            </ScrollView>
        </View>
    );
};

const styles = StyleSheet.create({
    region: { gap: nativeTokens.spacing[2] },
    caption: { ...nativeTokens.type.meta },
    strip: { gap: RAIL_GAP_PX },
    skeleton: { height: 224, borderRadius: nativeTokens.radius.md },
});
