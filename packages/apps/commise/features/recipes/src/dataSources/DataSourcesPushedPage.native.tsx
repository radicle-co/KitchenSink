/**
 * @module @commise/features-recipes/dataSources — native Data sources PAGE, as a stack pushes it (presentational;
 * A-026, `docs/design/uiOverhaul/buildSpec.md` §9.2, design §S16).
 *
 * The React Native twin of the web `DataSourcesPage.tsx`: one scrolling column under a `LargeTitleHeader` whose back
 * control is named for where it goes ("Back to Profile"), then the two intro sentences and the read's state, which the
 * host passes as `children`. It is a screen in a stack, not a modal, so it keeps the tab bar and the navigator moves
 * the reading cursor into it and restores the opener's on pop; the page moves the cursor to the title only when
 * `headingFocusSignal` advances (a retry that took Try again away).
 *
 * @pattern Template — the same frame as Profile: a scroll host, the large title, and the condensed bar once it scrolls
 */
import { useMessages } from '@commise/i18n/react';
import { CondensedTitleBar, LargeTitleHeader } from '@commise/ui/large-title-header';
import { nativeTokens } from '@commise/ui/native';
import { ScrollHost, useScrollHost, type ScrollBind } from '@commise/ui/scroll-host';
import { useTheme } from '@commise/ui/theme';
import { useId, type FC } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { dataSourcesMessages } from './messages.js';
import type { DataSourcesPushedPageProps } from './model.js';

/** Props for the page inside its scroll host. */
interface FrameProps extends DataSourcesPushedPageProps {
    /** The bind for the page's one vertical scroller. */
    readonly scrollBind: ScrollBind;
}

/** The page inside its host. */
const Frame: FC<FrameProps> = ({ back, children, headingFocusSignal, scrollBind }) => {
    const messages = useMessages(dataSourcesMessages);
    const { colors } = useTheme();
    const { condensed } = useScrollHost();
    const headingId = useId();

    return (
        <View style={styles.screen}>
            <ScrollView
                {...scrollBind}
                style={styles.region}
                contentContainerStyle={styles.body}
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
            <CondensedTitleBar title={messages.title} back={back} visible={condensed} />
        </View>
    );
};

/**
 * The page frame: its large title with Back, the two intro sentences, then the read's state.
 *
 * @param props - The way back, the read's state and when the heading takes the cursor.
 * @returns The page frame.
 */
export const DataSourcesPushedPage: FC<DataSourcesPushedPageProps> = (props) => (
    <ScrollHost>{(bind) => <Frame {...props} scrollBind={bind} />}</ScrollHost>
);

const styles = StyleSheet.create({
    // Transparent so the root `AppCanvas` wash shows through, as Profile's does (issue #145).
    screen: { flex: 1, backgroundColor: 'transparent' },
    region: { flex: 1 },
    body: {
        paddingHorizontal: nativeTokens.spacing[4],
        paddingTop: nativeTokens.spacing[2],
        paddingBottom: nativeTokens.spacing[6],
        gap: nativeTokens.spacing[3],
    },
    intro: { ...nativeTokens.type.body },
});
