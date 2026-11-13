/**
 * @module @commise/features-recipes/discovery — the native footer of a Discover card, the twin of the web leaf
 * (`docs/design/uiOverhaul/buildSpec.md` §4.1): a 20 pt avatar disc, "@handle" on one line (or "From {source}"), and a
 * 44 pt Save a copy icon button at the end, whose glyph fills while a copy is being made and stays filled once it exists.
 *
 * A press while saving or saved does nothing; the button stays focusable (`aria-disabled`). A failure unfills the glyph
 * and an inline alert says so. Colour is read from the theme at render (D15).
 */
import { fillTemplate } from '@commise/i18n';
import { useMessages } from '@commise/i18n/react';
import { initialsPxOf } from '@commise/ui/avatar-initials';
import { Icon } from '@commise/ui/icon';
import { Text as DesignText } from '@commise/ui/text';
import { nativeTokens } from '@commise/ui/native';
import { useTheme } from '@commise/ui/theme';
import { touchFloor } from '@commise/ui/layout';
import type { FC } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { recipeActionMessages } from '../actions/messages.js';
import { bylineInitial, bylineOf } from '../byline/bylineOf.js';
import { bylineText } from '../byline/bylineText.js';
import { bylineMessages } from '../byline/messages.js';
import { discoveryMessages } from './messages.js';
import type { DiscoveryFooterProps } from './model.js';

/** The avatar disc's diameter, pt; its initial is 40% of it and does not scale (designer ruling 2026-11-03). */
const FOOTER_AVATAR_PT = 20;

export const DiscoveryFooter: FC<DiscoveryFooterProps> = ({
    title,
    authorUsername,
    authorDisplayName,
    sourceAttribution,
    avatar,
    state,
    onSave,
}) => {
    const copy = useMessages(recipeActionMessages).saveCopy;
    const discovery = useMessages(discoveryMessages);
    const bylineCopy = useMessages(bylineMessages);
    const byline = bylineOf({
        ...(authorUsername === undefined ? {} : { username: authorUsername }),
        ...(authorDisplayName === undefined ? {} : { displayName: authorDisplayName }),
        ...(sourceAttribution === undefined ? {} : { sourceAttribution }),
    });
    const initial = avatar === 'shown' ? bylineInitial(byline) : undefined;
    const { colors } = useTheme();
    const inert = state.kind === 'saving' || state.kind === 'saved';
    const name = fillTemplate(
        state.kind === 'saving' ? copy.saving : state.kind === 'saved' ? copy.done : copy.button,
        { title },
    );
    const by =
        byline.kind === 'source'
            ? fillTemplate(discovery.attribution, { source: byline.attribution })
            : bylineText(byline, bylineCopy, 'standalone');

    return (
        <View style={styles.stack}>
            <View style={styles.row}>
                {initial === undefined ? null : (
                    <View style={[styles.avatar, { backgroundColor: colors.selectedFill }]}>
                        <DesignText
                            accessible={false}
                            typeRole="label"
                            fixedPx={initialsPxOf(FOOTER_AVATAR_PT)}
                            color="$actionText"
                        >
                            {initial}
                        </DesignText>
                    </View>
                )}
                <Text numberOfLines={1} style={[styles.by, { color: colors.inkMuted }]}>
                    {by}
                </Text>
                <Pressable
                    role="button"
                    aria-label={name}
                    // `accessibilityState` is the DEVICE trait (VoiceOver and TalkBack say "dimmed" and "busy"); the literal
                    // `aria-disabled` and `aria-busy` are what react-native-web projects to the DOM. A native control has no
                    // tab order to keep, so the press guard below is what makes it inert.
                    accessibilityState={{ disabled: inert, busy: state.kind === 'saving' }}
                    aria-disabled={inert || undefined}
                    aria-busy={state.kind === 'saving' || undefined}
                    onPress={() => {
                        if (!inert) {
                            onSave();
                        }
                    }}
                    style={styles.button}
                >
                    <Icon name="copyPlus" size={24} filled={inert} tone={inert ? 'actionText' : 'inkMuted'} />
                </Pressable>
            </View>
            {state.kind === 'failed' ? (
                <Text role="alert" style={[styles.meta, { color: colors.dangerText }]}>
                    {copy.failed}
                </Text>
            ) : null}
        </View>
    );
};

const styles = StyleSheet.create({
    stack: { gap: nativeTokens.spacing[1] },
    row: { flexDirection: 'row', alignItems: 'center', gap: nativeTokens.spacing[2] },
    avatar: {
        width: FOOTER_AVATAR_PT,
        height: FOOTER_AVATAR_PT,
        borderRadius: nativeTokens.radius.full,
        alignItems: 'center',
        justifyContent: 'center',
    },
    by: { ...nativeTokens.type.meta, flex: 1, minWidth: 0 },
    button: {
        width: touchFloor(),
        height: touchFloor(),
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: nativeTokens.radius.full,
    },
    meta: { ...nativeTokens.type.meta },
});
