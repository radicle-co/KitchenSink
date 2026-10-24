/**
 * @module @commise/features-recipes/dataSources — native Data sources PAGE, as a stack pushes it (presentational;
 * A-026, `docs/design/uiOverhaul/buildSpec.md` §9.2, design §S16).
 *
 * The React Native twin of the web `DataSourcesPage.tsx`: one scrolling column under a `LargeTitleHeader`, then the two
 * intro sentences and the read's state, which the host passes as `children`. Back is the pinned bar's, named for where it
 * goes ("Back to Profile") and reachable at every scroll position. It is a screen in a stack, not a modal, so it keeps
 * the tab bar and the navigator moves the reading cursor into it and restores the opener's on pop; the page moves the
 * cursor to the title only when `headingFocusSignal` advances (a retry that took Try again away).
 *
 * Presentational: props → JSX, inside the shared `PushedPageFrame`.
 *
 * @pattern Template — the same frame as Profile: the shared `PushedPageFrame` (host and pinned bar), then the large title
 */
import { useMessages } from '@commise/i18n/react';
import { LargeTitleHeader } from '@commise/ui/large-title-header';
import { nativeTokens } from '@commise/ui/native';
import { PushedPageFrame } from '@commise/ui/pushed-page';
import { useTheme } from '@commise/ui/theme';
import { useId, type FC } from 'react';
import { ScrollView, StyleSheet, Text } from 'react-native';

import { dataSourcesMessages } from './messages.js';
import type { DataSourcesPushedPageProps } from './model.js';

/**
 * The page frame: its large title under the pinned Back, the two intro sentences, then the read's state.
 *
 * @param props - The way back, the read's state and when the heading takes the cursor.
 * @returns The page frame.
 */
export const DataSourcesPushedPage: FC<DataSourcesPushedPageProps> = ({ back, children, headingFocusSignal }) => {
    const messages = useMessages(dataSourcesMessages);
    const { colors } = useTheme();
    const headingId = useId();

    return (
        <PushedPageFrame back={back} headingId={headingId} title={messages.title}>
            {(bind, inset) => (
                <ScrollView
                    {...bind}
                    style={styles.region}
                    contentContainerStyle={[styles.body, inset]}
                    keyboardShouldPersistTaps="handled"
                >
                    <LargeTitleHeader
                        headingId={headingId}
                        title={messages.title}
                        back={back}
                        focusSignal={headingFocusSignal}
                    />
                    <Text style={[styles.intro, { color: colors.ink }]}>{messages.intro}</Text>
                    <Text style={[styles.intro, { color: colors.inkMuted }]}>{messages.closeMatchNote}</Text>
                    {children}
                </ScrollView>
            )}
        </PushedPageFrame>
    );
};

const styles = StyleSheet.create({
    region: { flex: 1 },
    body: {
        paddingHorizontal: nativeTokens.spacing[4],
        paddingBottom: nativeTokens.spacing[6],
        gap: nativeTokens.spacing[3],
    },
    intro: { ...nativeTokens.type.body },
});
