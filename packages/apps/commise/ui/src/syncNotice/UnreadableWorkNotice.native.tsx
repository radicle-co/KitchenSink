/**
 * @module @commise/ui/sync-notice — the native unreadable-work notice (`docs/design/uiOverhaul/specSharedSystem.md` §17).
 *
 * ⛔ UNLIKE `SyncNotice.native` THIS ONE SPEAKS. That leaf's "no live region" rule is about reassurance; this reports a
 * loss. A POLITE `LiveRegion`, mounted empty and visually hidden, says it (Android live region, iOS announcement);
 * nothing here is assertive, because the cook did not just act and nothing needs a decision.
 *
 * ⚠️ NO FOCUS MOVE ON DISMISS. React Native cannot read where the screen-reader cursor is, and VoiceOver and TalkBack
 * re-anchor when a focused node goes. A device check is owed (specSharedSystem §17).
 *
 * A presentational leaf: the caller owns whether the card shows.
 *
 * @pattern Facade over a polite, visually hidden `LiveRegion` and one card with a Dismiss `Button` — the same contract
 *     as the web leaf
 */
import type { FC } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Button } from '../button/Button.native.js';
import { Icon } from '../icon/Icon.native.js';
import { LiveRegion } from '../liveRegion/LiveRegion.native.js';
import { useTheme } from '../theme/useTheme.native.js';
import { nativeTokens } from '../tokens/native.js';
import type { UnreadableWorkNoticeProps } from './props.js';

/** The notice: a silent region until work was set aside, then the card with its Dismiss. */
export const UnreadableWorkNotice: FC<UnreadableWorkNoticeProps> = ({
    shown,
    title,
    body,
    dismissLabel,
    onDismiss,
}) => {
    const { colors } = useTheme();

    return (
        <>
            <LiveRegion politeness="polite" visuallyHidden>
                {shown ? `${title}. ${body}` : ''}
            </LiveRegion>
            {shown && (
                <View collapsable={false} style={[styles.card, { backgroundColor: colors.attentionTint }]}>
                    <Icon name="triangleAlert" size={20} tone="attention" />
                    <View style={styles.text}>
                        <Text style={[styles.title, { color: colors.ink }]}>{title}</Text>
                        <Text style={[styles.body, { color: colors.ink }]}>{body}</Text>
                    </View>
                    <Button variant="ghost" size="sm" onPress={onDismiss}>
                        {dismissLabel}
                    </Button>
                </View>
            )}
        </>
    );
};

const styles = StyleSheet.create({
    // `flexWrap`, never `nowrap`: at 320 or large text Dismiss wraps under the text, start-aligned.
    card: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        alignItems: 'flex-start',
        marginHorizontal: nativeTokens.spacing[4],
        borderRadius: nativeTokens.radius.lg,
        paddingHorizontal: nativeTokens.spacing[4],
        paddingVertical: nativeTokens.spacing[3],
        columnGap: nativeTokens.spacing[3],
        rowGap: nativeTokens.spacing[1],
    },
    text: { flexGrow: 1, flexShrink: 1, flexBasis: 200, gap: nativeTokens.spacing[1] },
    title: { fontSize: nativeTokens.fontSize.bodySm, fontWeight: '600' },
    body: { fontSize: nativeTokens.fontSize.bodySm },
});
