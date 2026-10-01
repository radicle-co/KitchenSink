/**
 * @module @commise/ui/load-more — the native "Load more" control of a server-paged list (no infinite scroll).
 *
 * Three states over one `Pressable`: idle, busy (native `disabled` — a disabled native control keeps the
 * screen-reader cursor — plus `aria-busy`, which react-native-web projects and React Native aliases to
 * `accessibilityState.busy`) and failed ("Try again", with the reason as its hint). The failure is SPOKEN through an
 * assertive `LiveRegion` mounted empty above the button, so it announces when its text appears on both platforms; a
 * retry in flight clears it, so a second failure announces again. The pages already loaded stay on screen.
 *
 * A presentational leaf: the caller derives `loading` and `failed` from its infinite query.
 *
 * @pattern Facade over one `Pressable` and an assertive `LiveRegion` — the same contract as the web leaf
 */
import type { FC } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { LiveRegion } from '../liveRegion/LiveRegion.native.js';
import { palette } from '../tokens/colors.js';
import { nativeTokens } from '../tokens/native.js';
import type { LoadMoreControlProps } from './props.js';

/** The explicit next-page control, with its busy and failed states. */
export const LoadMoreControl: FC<LoadMoreControlProps> = ({ hasMore, loading, failed, onLoadMore, labels }) => {
    if (!hasMore) {
        return null;
    }

    const showFailure = failed && !loading;
    const label = loading ? labels.loadingMore : failed ? labels.retry : labels.loadMore;

    return (
        <View style={styles.footer}>
            <LiveRegion politeness="assertive" style={styles.message}>
                {showFailure ? labels.failed : ''}
            </LiveRegion>
            <Pressable
                accessibilityRole="button"
                accessibilityLabel={label}
                {...(showFailure ? { accessibilityHint: labels.failed } : {})}
                accessibilityState={{ busy: loading, disabled: loading }}
                aria-busy={loading || undefined}
                disabled={loading}
                onPress={onLoadMore}
                style={[styles.button, loading && styles.busy]}
            >
                <Text style={styles.label}>{label}</Text>
            </Pressable>
        </View>
    );
};

const styles = StyleSheet.create({
    footer: { alignItems: 'center', gap: nativeTokens.spacing[2], marginTop: nativeTokens.spacing[2] },
    message: { fontSize: nativeTokens.fontSize.bodySm, color: palette.slate, textAlign: 'center' },
    button: {
        backgroundColor: palette.pearl,
        borderRadius: nativeTokens.radius.full,
        paddingVertical: 10,
        paddingHorizontal: nativeTokens.spacing[5],
        minHeight: 44,
        justifyContent: 'center',
    },
    busy: { opacity: 0.6 },
    label: { fontSize: nativeTokens.fontSize.bodySm, fontWeight: '600', color: palette.charcoal },
});
