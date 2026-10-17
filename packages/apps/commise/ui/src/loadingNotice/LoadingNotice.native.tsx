/**
 * @module @commise/ui/loading-notice — the native `LoadingNotice`: the system activity indicator above a visible
 * caption, centred in the upper two thirds where `StateNotice.native`'s message sits, so a load that fails swaps in
 * place.
 *
 * ONE accessibility element (`accessible`, `progressbar`, the label as its name, `busy`), as `LoadingState` held. The
 * spinner is hidden from assistive tech (react-native-web exposes an `ActivityIndicator` as its own unnamed
 * `progressbar`), and there is no `LiveRegion`: a loading state is not a must-hear message. It enters after 400 ms
 * through `EnterTransition`, which shows it at once under reduced motion.
 *
 * Presentational: props → JSX.
 *
 * @pattern Decorator — `EnterTransition`'s 400 ms hold over a status region, so a fast load never flashes a spinner
 */
import type { FC } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { EnterTransition } from '../motion/EnterTransition.native.js';
import { useTheme } from '../theme/useTheme.native.js';
import { nativeTokens } from '../tokens/native.js';
import type { LoadingNoticeProps } from './props.js';

/** The hold before the notice shows, so a load that ends inside the Doherty budget never flashes a spinner. */
const LOADING_NOTICE_DELAY_MS = 400;

/** The native loading notice. */
export const LoadingNotice: FC<LoadingNoticeProps> = ({ label }) => {
    const { colors } = useTheme();

    return (
        <View style={styles.screen}>
            <View style={styles.message}>
                <EnterTransition delayMs={LOADING_NOTICE_DELAY_MS}>
                    <View
                        accessible
                        accessibilityRole="progressbar"
                        accessibilityLabel={label}
                        aria-busy
                        style={styles.content}
                    >
                        <View aria-hidden>
                            <ActivityIndicator size="small" color={colors.action} />
                        </View>
                        <Text style={[styles.caption, { color: colors.inkMuted }]}>{label}</Text>
                    </View>
                </EnterTransition>
            </View>
            <View style={styles.spacer} />
        </View>
    );
};

const styles = StyleSheet.create({
    screen: { flex: 1, padding: 24 },
    message: { flex: 2, alignItems: 'center', justifyContent: 'center' },
    spacer: { flex: 1 },
    content: { alignItems: 'center', gap: 8 },
    caption: { fontSize: nativeTokens.fontSize.bodySm, textAlign: 'center' },
});
