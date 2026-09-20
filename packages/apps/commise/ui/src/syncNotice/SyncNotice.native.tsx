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

import { palette } from '../tokens/colors.js';
import { nativeTokens } from '../tokens/native.js';
import type { SyncNoticeProps } from './props.js';

/** The app-wide connectivity + unsynced-work notice. */
export const SyncNotice: FC<SyncNoticeProps> = ({ state, regionLabel }) => {
    if (state.kind === 'hidden') {
        return null;
    }

    return (
        <View accessibilityLabel={regionLabel} style={styles.card}>
            <Text style={styles.title}>{state.title}</Text>
            <Text style={styles.body}>{state.body}</Text>
        </View>
    );
};

const styles = StyleSheet.create({
    card: {
        marginHorizontal: nativeTokens.spacing[4],
        borderRadius: nativeTokens.radius.lg,
        backgroundColor: palette.pearl,
        paddingHorizontal: nativeTokens.spacing[4],
        paddingVertical: nativeTokens.spacing[3],
        gap: nativeTokens.spacing[1],
    },
    title: { fontSize: nativeTokens.fontSize.bodySm, fontWeight: '600', color: palette.charcoal },
    body: { fontSize: nativeTokens.fontSize.bodySm, color: palette.slate },
});
