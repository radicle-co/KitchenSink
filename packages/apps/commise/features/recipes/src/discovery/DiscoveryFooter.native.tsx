/**
 * @module @commise/features-recipes/discovery — the native footer of a Discover card, the twin of the web leaf
 * (`docs/design/uiOverhaul/buildSpec.md` §4.1): a 20 pt avatar disc, "@handle" on one line (or "From {source}"), and a
 * 44 pt Save a copy icon button at the end, whose glyph fills while a copy is being made and stays filled once it exists.
 *
 * A press while saving or saved does nothing; the button stays focusable (`aria-disabled`). A failure unfills the glyph
 * and an inline alert says so. Colour is read from the theme at render (D15).
 */
import { useMessages } from '@commise/i18n/react';
import { Icon } from '@commise/ui/icon';
import { nativeTokens } from '@commise/ui/native';
import { useTheme } from '@commise/ui/theme';
import type { FC } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { recipeActionMessages } from '../actions/messages.js';
import { fillTemplate } from '../list/model.js';
import { discoveryMessages } from './messages.js';
import type { DiscoveryFooterProps } from './model.js';

export const DiscoveryFooter: FC<DiscoveryFooterProps> = ({
    title,
    authorHandle,
    sourceAttribution,
    state,
    onSave,
}) => {
    const copy = useMessages(recipeActionMessages).saveCopy;
    const discovery = useMessages(discoveryMessages);
    const { colors } = useTheme();
    const inert = state.kind === 'saving' || state.kind === 'saved';
    const name = fillTemplate(
        state.kind === 'saving' ? copy.saving : state.kind === 'saved' ? copy.done : copy.button,
        { title },
    );
    const by =
        authorHandle !== undefined
            ? fillTemplate(discovery.authorHandle, { handle: authorHandle })
            : sourceAttribution === undefined
              ? undefined
              : fillTemplate(discovery.attribution, { source: sourceAttribution });

    return (
        <View style={styles.stack}>
            <View style={styles.row}>
                {authorHandle === undefined ? null : (
                    <View style={[styles.avatar, { backgroundColor: colors.selectedFill }]}>
                        <Text accessible={false} style={[styles.overline, { color: colors.actionText }]}>
                            {authorHandle.slice(0, 1).toUpperCase()}
                        </Text>
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
        width: 20,
        height: 20,
        borderRadius: nativeTokens.radius.full,
        alignItems: 'center',
        justifyContent: 'center',
    },
    overline: { fontSize: 11, fontWeight: '600' },
    by: { ...nativeTokens.type.meta, flex: 1, minWidth: 0 },
    button: {
        width: 44,
        height: 44,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: nativeTokens.radius.full,
    },
    meta: { ...nativeTokens.type.meta },
});
