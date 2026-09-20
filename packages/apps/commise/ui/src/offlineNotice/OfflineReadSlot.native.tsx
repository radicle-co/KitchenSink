/**
 * @module @commise/ui/offline-notice — the native offline read slot.
 *
 * ⛔ DROPS THE LIVE REGION, deliberately, and this is parity rather than a gap. React Native's only
 * equivalent (`accessibilityLiveRegion="assertive"`) INTERRUPTS whatever the screen reader is saying, which
 * is wrong for a state the viewer did not trigger and need not act on; the polite variant is Android-only.
 * The predecessor this stands in for carried only an `accessibilityLabel` on a `View`, so nothing is lost.
 *
 * ⛔ ADDS NO SAFE-AREA INSETS and must not import `react-native-safe-area-context`. `useSafeAreaInsets()`
 * returns the DEVICE's insets, not the remaining space — so applying them here double-pads the screen padding
 * this slot already sits inside.
 *
 * A presentational leaf: it renders the message and nothing else — no state, no data, no branching.
 *
 * @pattern Adapter over React Native's `Text`, DELIBERATELY WITHOUT a live region — the platform's only
 *     equivalent interrupts the screen reader, so parity with the web leaf's polite `status` is reached by
 *     announcing nothing rather than by announcing rudely.
 */
import type { FC } from 'react';
import { StyleSheet, Text } from 'react-native';

import { palette } from '../tokens/colors.js';
import { nativeTokens } from '../tokens/native.js';
import type { OfflineReadSlotProps } from './props.js';

/** The offline read slot: one quiet line where the screen's content would be. */
export const OfflineReadSlot: FC<OfflineReadSlotProps> = ({ message }) => <Text style={styles.message}>{message}</Text>;

const styles = StyleSheet.create({
    // No title, icon or border — quieter than the app-wide banner, so the two read as a hierarchy.
    message: {
        paddingHorizontal: nativeTokens.spacing[4],
        paddingVertical: nativeTokens.spacing[8],
        textAlign: 'center',
        fontSize: nativeTokens.fontSize.bodySm,
        color: palette.slate,
    },
});
