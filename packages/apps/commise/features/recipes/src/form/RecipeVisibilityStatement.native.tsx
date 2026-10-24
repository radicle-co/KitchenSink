/**
 * @module @commise/features-recipes/form — `RecipeVisibilityStatement` (native), the React Native leaf of
 * `./RecipeVisibilityStatement.tsx`: "Who can see it: Public", shown in place of the visibility field when Private is
 * not offered (plan 2026-10-14-009 D14).
 *
 * ONE accessible element, named by the whole sentence, so a screen reader reads it once rather than three fragments —
 * the note for a kept draft's refused Private included. When it replaces the field the cook just used to confirm Public
 * (`focusOnMount`, UX SPECIFY 2026-10-15), the screen-reader cursor moves onto it, where the unmounted radio was.
 * Colours come from the theme at render, so both colour schemes paint (owner D15).
 *
 * @pattern Adapter over `@commise/ui/screen-reader-focus` — its mount-time ref is attached only when the statement
 *     replaces the field, because the accessibility event takes a host node and has no declarative form
 */
import { useMessages } from '@commise/i18n/react';
import { nativeTokens } from '@commise/ui/native';
import { useScreenReaderFocusOnMount } from '@commise/ui/screen-reader-focus';
import { useTheme } from '@commise/ui/theme';
import type { FC } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { editorMessages } from '../editor/messages.js';
import type { RecipeVisibilityStatementProps } from './props.js';

/** "Who can see it: Public". */
export const RecipeVisibilityStatement: FC<RecipeVisibilityStatementProps> = ({ privateUnavailable, focusOnMount }) => {
    const { visibility: v } = useMessages(editorMessages);
    const { colors } = useTheme();
    const focusRef = useScreenReaderFocusOnMount<View>();
    const sentence = `${v.legend}: ${v.public}. ${v.publicHint}.`;

    return (
        <View
            accessible
            aria-label={privateUnavailable ? `${sentence} ${v.privateUnavailable}` : sentence}
            style={styles.statement}
            {...(focusOnMount ? { ref: focusRef } : {})}
        >
            <Text style={[styles.legend, { color: colors.inkMuted }]}>{v.legend}</Text>
            <Text style={[styles.value, { color: colors.ink }]}>{v.public}</Text>
            <Text style={[styles.hint, { color: colors.inkMuted }]}>{v.publicHint}</Text>
            {privateUnavailable ? (
                <Text style={[styles.hint, { color: colors.inkMuted }]}>{v.privateUnavailable}</Text>
            ) : null}
        </View>
    );
};

const styles = StyleSheet.create({
    statement: { gap: nativeTokens.spacing[1] },
    legend: nativeTokens.type.label,
    value: nativeTokens.type.cardTitle,
    hint: nativeTokens.type.meta,
});
