/**
 * @module @commise/ui/state-notice — the native `StateNotice`: the root crash fallback's stack. The message and its
 * actions are one centred group; the actions sit under the message at their label's width (`componentFixes.md` §1: Try
 * again is a quiet control, not a full-width call to action), the first on top. The first is quiet, with the body as
 * its description; the way out is ghost.
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
                    <Button
                        variant="quiet"
                        icon={primary.icon}
                        onPress={primary.onPress}
                        {...(body === undefined ? {} : { description: body })}
                    >
                        {primary.label}
                    </Button>
                )}
                {secondary === undefined ? null : (
                    <Button variant="ghost" icon={secondary.icon} onPress={secondary.onPress}>
                        {secondary.label}
                    </Button>
                )}
            </View>
        </View>
    );
};

const styles = StyleSheet.create({
    // One centred group: the message, then its actions under it (no longer pinned to the bottom third).
    screen: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24 },
    message: { alignItems: 'center', gap: 8 },
    title: {
        ...nativeTokens.type.sectionTitle,
        textAlign: 'center',
    },
    body: { ...nativeTokens.type.meta, textAlign: 'center' },
    actions: { alignItems: 'center', gap: 12 },
});
