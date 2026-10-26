/**
 * @module @commise/ui/refresh-notice — the native notice for a failed refresh of data that stays on screen.
 *
 * A POLITE `LiveRegion`, mounted empty and visually hidden, speaks the failure; the visible row shows the same
 * message with a Try again button. Polite, unlike `LoadMoreControl`'s assertive region, because the rows on screen
 * are still valid. The button is required, not a convenience: pull-to-refresh is a drag, and a gesture-only action
 * needs a single-tap alternative (WCAG 2.2 SC 2.5.1).
 *
 * A retry in flight keeps the message and the SAME button (`Button`'s native `disabled`, which keeps the screen-reader
 * cursor, plus `aria-busy`); only the announcement clears, so a second failure is spoken again. A successful refresh removes
 * the row, and the surface decides where the screen-reader cursor goes.
 *
 * A presentational leaf: the caller derives `failed` and `refreshing` from its query.
 *
 * @pattern Facade over the design system's quiet `Button` and a polite, visually hidden `LiveRegion` — the same
 *     contract as the web leaf
 */
import type { FC } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Button } from '../button/Button.native.js';
import { LiveRegion } from '../liveRegion/LiveRegion.native.js';
import { useTheme } from '../theme/useTheme.native.js';
import { nativeTokens } from '../tokens/native.js';
import type { RefreshNoticeProps } from './props.js';

/** The failed-refresh notice: a silent region until a refresh fails, then the message and its retry. */
export const RefreshNotice: FC<RefreshNoticeProps> = ({ failed, refreshing, onRetry, labels }) => {
    const { colors } = useTheme();

    return (
        <>
            <LiveRegion politeness="polite" visuallyHidden>
                {failed && !refreshing ? labels.failed : ''}
            </LiveRegion>
            {failed && (
                <View style={[styles.row, { backgroundColor: colors.surfaceMuted }]}>
                    <Text style={[styles.message, { color: colors.inkMuted }]}>{labels.failed}</Text>
                    <Button
                        variant="quiet"
                        icon="refreshCw"
                        busy={refreshing}
                        onPress={onRetry}
                        description={labels.failed}
                    >
                        {labels.retry}
                    </Button>
                </View>
            )}
        </>
    );
};

const styles = StyleSheet.create({
    row: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: nativeTokens.spacing[2],
        borderRadius: nativeTokens.radius.lg,
        paddingHorizontal: nativeTokens.spacing[4],
        paddingVertical: nativeTokens.spacing[2],
    },
    message: { flexShrink: 1, ...nativeTokens.type.meta },
});
