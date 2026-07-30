/**
 * @module components/RootErrorFallback — the localized, recoverable fallback rendered by the mobile root
 * `ErrorBoundary` around {@link import('../screens/AppRoot.js').AppRoot} (B18). Pure `props → JSX`
 * (react-error-boundary's `FallbackProps`): the retry affordance is `resetErrorBoundary`, the boundary's own
 * recovery mechanism — this component does not know about DA9 reporting, which stays in `AppRoot`'s
 * `onError` wiring (mirroring the web root boundary's `RouteErrorState`/`RouteErrorBoundary` split).
 */
import type { FallbackProps } from 'react-error-boundary';
import type { FC } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useMessages } from '@commise/i18n/react';

import { mobileMessages } from '../i18n/messages.js';

/** Localized "the app hit a snag" state with a retry affordance — the mobile root safety net's UI. */
export const RootErrorFallback: FC<FallbackProps> = ({ resetErrorBoundary }) => {
    const { common } = useMessages(mobileMessages);

    return (
        <View style={styles.center} accessibilityRole="alert">
            <Text style={styles.title}>{common.somethingWentWrong}</Text>
            <Text style={styles.body}>{common.rootErrorBody}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel={common.retry} onPress={resetErrorBoundary}>
                <Text style={styles.retry}>{common.retry}</Text>
            </Pressable>
        </View>
    );
};

const styles = StyleSheet.create({
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
    title: { fontSize: 18, fontWeight: '600', marginBottom: 8 },
    body: { fontSize: 14, textAlign: 'center', color: '#555', marginBottom: 16 },
    retry: { fontSize: 16, fontWeight: '600' },
});
