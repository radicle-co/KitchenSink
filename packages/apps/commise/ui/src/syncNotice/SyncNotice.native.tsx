/**
 * @module @commise/ui/sync-notice — the native sync notice.
 *
 * A presentational leaf: it renders the caller's strings and nothing else.
 *
 * ⛔ NO LIVE REGION, matching the offline read slot and for the same reason: React Native's only equivalent
 * (`accessibilityLiveRegion="assertive"`) INTERRUPTS, which is wrong for reassurance the cook did not ask
 * for, and the polite variant is Android-only. The text is reachable by the reader; it simply is not shouted.
 *
 * @pattern Adapter over React Native's `View`/`Text`, DELIBERATELY WITHOUT a live region — parity with web's
 *     polite `status` is reached by announcing nothing rather than by announcing rudely.
 */
import type { FC } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { surfaceFill } from '../surfaceTone/surfaceFill.js';
import { ToneScope } from '../surfaceTone/ToneScope.native.js';
import { useTheme } from '../theme/useTheme.native.js';
import { nativeTokens } from '../tokens/native.js';
import type { SyncNoticeProps } from './props.js';

/** The app-wide connectivity + unsynced-work notice. */
export const SyncNotice: FC<SyncNoticeProps> = ({ state, regionLabel }) => {
    const theme = useTheme();
    const { colors } = theme;

    if (state.kind === 'hidden') {
        return null;
    }

    return (
        <ToneScope tone="muted">
            <View
                collapsable={false}
                accessibilityLabel={regionLabel}
                style={[styles.card, { backgroundColor: surfaceFill(theme, 'muted') }]}
            >
                <Text style={[styles.title, { color: colors.ink }]}>{state.title}</Text>
                <Text style={[styles.body, { color: colors.inkMuted }]}>{state.body}</Text>
            </View>
        </ToneScope>
    );
};

const styles = StyleSheet.create({
    card: {
        marginHorizontal: nativeTokens.spacing[4],
        borderRadius: nativeTokens.radius.lg,
        paddingHorizontal: nativeTokens.spacing[4],
        paddingVertical: nativeTokens.spacing[3],
        gap: nativeTokens.spacing[1],
    },
    title: { ...nativeTokens.type.label },
    body: { ...nativeTokens.type.meta },
});
