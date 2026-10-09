/**
 * @module @commise/ui/refresh-notice — the native notice for a failed refresh of data that stays on screen.
 *
 * A POLITE `LiveRegion`, mounted empty and visually hidden, speaks the failure; the visible row shows the same
 * message with a Try again button. Polite, unlike `LoadMoreControl`'s assertive region, because the rows on screen
 * are still valid. The button is required, not a convenience: pull-to-refresh is a drag, and a gesture-only action
 * needs a single-tap alternative (WCAG 2.2 SC 2.5.1).
 *
 * A retry in flight keeps the message and the SAME button (native `disabled`, which keeps the screen-reader cursor,
 * plus `aria-busy`); only the announcement clears, so a second failure is spoken again. A successful refresh removes
 * the row, and the surface decides where the screen-reader cursor goes.
 *
 * A presentational leaf: the caller derives `failed` and `refreshing` from its query.
 *
 * @pattern Facade over one `Pressable` and a polite, visually hidden `LiveRegion` — the same contract as the web leaf
 */
import type { FC } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

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
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={labels.retry}
                        accessibilityHint={labels.failed}
                        accessibilityState={{ busy: refreshing, disabled: refreshing }}
                        aria-busy={refreshing || undefined}
                        disabled={refreshing}
                        onPress={onRetry}
                        style={[
                            styles.button,
                            { backgroundColor: colors.canvas, borderColor: colors.lineDivider },
                            refreshing && styles.busy,
                        ]}
                    >
                        <Text style={[styles.label, { color: colors.ink }]}>{labels.retry}</Text>
                    </Pressable>
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
    message: { flexShrink: 1, fontSize: nativeTokens.fontSize.bodySm },
    button: {
        // A `lineDivider` hairline, as on web: the `canvas` fill is ~1:1 against the `surfaceMuted` row.
        borderWidth: StyleSheet.hairlineWidth,
        borderRadius: nativeTokens.radius.full,
        paddingVertical: nativeTokens.spacing[2],
        paddingHorizontal: nativeTokens.spacing[4],
        minHeight: 44,
        justifyContent: 'center',
    },
    busy: { opacity: 0.6 },
    label: { fontSize: nativeTokens.fontSize.bodySm, fontWeight: '600' },
});
