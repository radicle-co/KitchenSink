/**
 * @module @commise/ui/state-notice — the native `StateNotice`: the thumb-reach stack the root crash fallback drew. The
 * message sits in the upper two thirds, centred; the actions sit stacked at full width in the bottom third, within reach
 * of the thumb, the primary on top.
 *
 * The title is ANNOUNCED through `LiveRegion` (iOS has no live region, so an `alert` role on a View is silent there) and
 * is also the screen's header.
 *
 * Presentational: props → JSX.
 */
import type { FC } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Button } from '../button/Button.native.js';
import { LiveRegion } from '../liveRegion/LiveRegion.native.js';
import { useTheme } from '../theme/useTheme.native.js';
import { nativeTokens } from '../tokens/native.js';
import type { StateNoticeProps } from './props.js';

/** The native state notice: presentational, props → JSX. */
export const StateNotice: FC<StateNoticeProps> = ({ title, body, primary, secondary }) => {
    const { colors } = useTheme();

    return (
        <View style={styles.screen}>
            <View style={styles.message}>
                <LiveRegion politeness="assertive" style={[styles.title, { color: colors.ink }]}>
                    {title}
                </LiveRegion>
                {body === undefined ? null : <Text style={[styles.body, { color: colors.inkMuted }]}>{body}</Text>}
            </View>
            <View style={styles.actions}>
                {primary === undefined ? null : (
                    <Button icon={primary.icon} onPress={primary.onPress}>
                        {primary.label}
                    </Button>
                )}
                {secondary === undefined ? null : (
                    <Button variant="secondary" icon={secondary.icon} onPress={secondary.onPress}>
                        {secondary.label}
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
        textAlign: 'center',
    },
    body: { fontSize: nativeTokens.fontSize.bodySm, textAlign: 'center' },
    actions: { flex: 1, justifyContent: 'flex-end', gap: 12, alignSelf: 'stretch', maxWidth: 480, width: '100%' },
});
