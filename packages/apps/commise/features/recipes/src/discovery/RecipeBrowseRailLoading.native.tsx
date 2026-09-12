/**
 * @module @commise/features-recipes — native browse-rail LOADING body (presentational, U7).
 *
 * The React Native twin of `RecipeBrowseRailLoading`: an inert placeholder the height of a rail while that rail is
 * pending, with its localized label as the visible caption — as on web, a live region announces its CONTENT, not its
 * label.
 */
import { useMessages } from '@commise/i18n/react';
import { palette } from '@commise/ui';
import { nativeTokens } from '@commise/ui/native';
import type { FC } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { discoveryMessages } from './messages.js';

export const RecipeBrowseRailLoading: FC = () => {
    const discovery = useMessages(discoveryMessages);

    return (
        <View role="status" aria-label={discovery.loadingLabel} style={styles.region}>
            <Text style={styles.caption}>{discovery.loadingLabel}</Text>
            <View aria-hidden style={styles.skeleton} />
        </View>
    );
};

const styles = StyleSheet.create({
    region: { gap: nativeTokens.spacing[2] },
    caption: { fontSize: nativeTokens.fontSize.bodySm, color: palette.slate },
    skeleton: { height: 200, borderRadius: nativeTokens.radius.lg, backgroundColor: nativeTokens.borderSubtle },
});
