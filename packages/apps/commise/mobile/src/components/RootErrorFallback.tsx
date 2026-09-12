/**
 * @module components/RootErrorFallback — the localized, recoverable fallback rendered by the mobile root
 * `ErrorBoundary` around `AppRoot` (B18). Pure `props → JSX`: react-error-boundary's `FallbackProps`, plus the one
 * navigation the root can offer. Reporting stays in `AppRoot`'s `onError`, mirroring the web split between
 * `RouteErrorState` and `RouteErrorBoundary`.
 *
 * Two ways out, in priority order. **Try again** (`resetErrorBoundary`) re-renders the crashed screen — `AppRoot`
 * resets TanStack's query errors in the same reset, so a failed read refetches rather than re-throwing its cached
 * failure. **Back to Home** leaves a screen whose crash is not transient; it is absent when Home is what crashed,
 * where it would do exactly what Try again does.
 *
 * Both actions sit stacked at full width in the bottom third, within thumb reach, the primary on top.
 */
import { Feather } from '@expo/vector-icons';
import type { FallbackProps } from 'react-error-boundary';
import type { FC } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useMessages } from '@commise/i18n/react';
import { palette } from '@commise/ui';
import { Button } from '@commise/ui/button';
import { LiveRegion } from '@commise/ui/live-region';
import { nativeTokens } from '@commise/ui/native';

import { mobileMessages } from '../i18n/messages.js';

/** Props for {@link RootErrorFallback}. */
export interface RootErrorFallbackProps extends FallbackProps {
    /** Leave the crashed screen for Home. Absent when Home itself crashed. */
    readonly onBackToHome?: () => void;
}

/** Localized "the app hit a snag" state: announced, with Try again and — off Home — Back to Home. */
export const RootErrorFallback: FC<RootErrorFallbackProps> = ({ resetErrorBoundary, onBackToHome }) => {
    const { common } = useMessages(mobileMessages);

    return (
        <View style={styles.screen}>
            <View style={styles.message}>
                {/* The title is ANNOUNCED through `LiveRegion` (iOS has no live region; an `alert` role on a View
                    is silent there) and is also the screen's header. */}
                <LiveRegion politeness="assertive" style={styles.title}>
                    {common.somethingWentWrong}
                </LiveRegion>
                <Text style={styles.body}>
                    {onBackToHome === undefined ? common.rootErrorBodyHome : common.rootErrorBody}
                </Text>
            </View>
            <View style={styles.actions}>
                <Button
                    icon={<Feather name="refresh-cw" size={16} color={palette.white} />}
                    onPress={resetErrorBoundary}
                >
                    {common.retry}
                </Button>
                {onBackToHome === undefined ? null : (
                    <Button
                        variant="secondary"
                        icon={<Feather name="home" size={16} color={palette.charcoal} />}
                        onPress={onBackToHome}
                    >
                        {common.backToHome}
                    </Button>
                )}
            </View>
        </View>
    );
};

const styles = StyleSheet.create({
    screen: { flex: 1, justifyContent: 'space-between', padding: 24 },
    message: { flex: 2, alignItems: 'center', justifyContent: 'center', gap: 8 },
    title: {
        fontSize: nativeTokens.fontSize.headingSm,
        fontWeight: '600',
        color: palette.charcoal,
        textAlign: 'center',
    },
    body: { fontSize: nativeTokens.fontSize.bodySm, textAlign: 'center', color: palette.slate },
    actions: { flex: 1, justifyContent: 'flex-end', gap: 12, alignSelf: 'stretch', maxWidth: 480, width: '100%' },
});
