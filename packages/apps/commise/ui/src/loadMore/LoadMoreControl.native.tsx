/**
 * @module @commise/ui/load-more — the native "Load more" control of a server-paged list (no infinite scroll).
 *
 * Three states over one quiet `Button`: idle, busy (the button's native `disabled`, which keeps the screen-reader
 * cursor, plus `aria-busy`) and failed ("Try again", with the reason as its hint). The failure is SPOKEN through an
 * assertive `LiveRegion` mounted empty above the button, so it announces when its text appears on both platforms; a
 * retry in flight clears it, so a second failure announces again. The pages already loaded stay on screen.
 *
 * A presentational leaf: the caller derives `loading` and `failed` from its infinite query.
 *
 * @pattern Facade over the design system's quiet `Button` and an assertive `LiveRegion` — the same contract as the web
 *     leaf
 */
import type { FC } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button } from '../button/Button.native.js';
import { LiveRegion } from '../liveRegion/LiveRegion.native.js';
import { useTheme } from '../theme/useTheme.native.js';
import { nativeTokens } from '../tokens/native.js';
import type { LoadMoreControlProps } from './props.js';

/** The explicit next-page control, with its busy and failed states. */
export const LoadMoreControl: FC<LoadMoreControlProps> = ({ hasMore, loading, failed, onLoadMore, labels }) => {
    const { colors } = useTheme();

    if (!hasMore) {
        return null;
    }

    const showFailure = failed && !loading;
    const label = loading ? labels.loadingMore : failed ? labels.retry : labels.loadMore;

    return (
        <View style={styles.footer}>
            <LiveRegion politeness="assertive" style={[styles.message, { color: colors.inkMuted }]}>
                {showFailure ? labels.failed : ''}
            </LiveRegion>
            <Button
                variant="quiet"
                busy={loading}
                onPress={onLoadMore}
                {...(failed ? { icon: 'refreshCw' as const } : {})}
                {...(showFailure ? { description: labels.failed } : {})}
            >
                {label}
            </Button>
        </View>
    );
};

const styles = StyleSheet.create({
    footer: { alignItems: 'center', gap: nativeTokens.spacing[2], marginTop: nativeTokens.spacing[2] },
    message: { ...nativeTokens.type.meta, textAlign: 'center' },
});
