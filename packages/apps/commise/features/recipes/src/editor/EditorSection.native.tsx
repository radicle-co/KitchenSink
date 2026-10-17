/**
 * @module @commise/features-recipes/editor — one native editor section (build spec §7.1, §7.10, §7.12): the heading
 * row (the section's heading, then its own controls), then the body.
 *
 * ⛔ The screen renders each section as a DIRECT child of the scroller's content (blueprint A7), where it reports its
 * layout to the `ScrollHost`; this leaf is that section's content. A jump moves the screen-reader cursor to the heading
 * when `focusSignal` advances — the host holds no heading refs, so the heading takes the cursor itself.
 *
 * Presentational: props → JSX; the focus move is the design system's `useScreenReaderFocusOnSignal`.
 *
 * @pattern Adapter over the screen-reader focus move — its ref is the hook's, attached to the heading it moves to
 */
import { nativeTokens } from '@commise/ui/native';
import { useScreenReaderFocusOnSignal } from '@commise/ui/screen-reader-focus';
import { useTheme } from '@commise/ui/theme';
import type { FC } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import type { EditorSectionProps } from './frameProps.js';
import { SectionPresenceContext } from './sectionPresence.js';

/** One section of the native editor. */
export const EditorSection: FC<EditorSectionProps> = ({ title, action, focusSignal = 0, current, children }) => {
    const { colors } = useTheme();
    const heading = useScreenReaderFocusOnSignal<Text>(focusSignal);

    return (
        <View style={styles.section}>
            <View style={styles.headingRow}>
                <Text ref={heading} role="heading" style={[styles.heading, { color: colors.ink }]}>
                    {title}
                </Text>
                {action}
            </View>
            <SectionPresenceContext value={current}>{children}</SectionPresenceContext>
        </View>
    );
};

const styles = StyleSheet.create({
    section: { gap: nativeTokens.spacing[4] },
    headingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 44 },
    heading: { ...nativeTokens.type.sectionTitle, flexShrink: 1 },
});
