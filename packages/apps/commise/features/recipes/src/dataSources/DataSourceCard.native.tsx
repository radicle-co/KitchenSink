/**
 * @module @commise/features-recipes/dataSources — native Data sources CARD (presentational; plan R55, design §S16).
 *
 * The React Native twin of `DataSourceCard.tsx`: the same model, the same order, the term always stacked above its
 * value (a phone is narrower than 24rem at 200% text, §S18). React Native has no declarative link, so opening one is a
 * platform call, injected as `onOpen` and defaulting to `openExternalUrl` — the house adapter every link that leaves
 * the app goes through.
 *
 * ⛔ The credit renders word for word, in a `Text` of its own that carries its language (`accessibilityLanguage`), so
 * VoiceOver reads it in that language. Android has no equivalent and reads it in the app's language; that gap is
 * recorded, not papered over with a translation.
 */
import { useMessages } from '@commise/i18n/react';
import { nativeTokens } from '@commise/ui/native';
import { useTheme } from '@commise/ui/theme';
import type { FC, ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { openExternalUrl } from '../detail/openExternalUrl.native.js';
import { dataSourcesMessages } from './messages.js';
import { dataSourceCardModel, type DataSourceCardNativeProps, type DataSourceLink } from './model.js';

/** A link that leaves the app: 48 dp tall or more, underlined, its glyph silent. */
const ExternalLink: FC<{
    readonly link: DataSourceLink;
    readonly onOpen: (href: string) => void;
    readonly children: string;
}> = ({ link, onOpen, children }) => {
    const { colors } = useTheme();

    return (
        <Pressable
            accessibilityRole="link"
            accessibilityLabel={link.accessibleName}
            style={styles.linkTouch}
            onPress={() => onOpen(link.href)}
        >
            <Text style={[styles.link, { color: colors.actionText }]}>
                {children}
                <Text aria-hidden> ↗</Text>
            </Text>
        </Pressable>
    );
};

/** One term, stacked above its value. */
const Entry: FC<{ readonly term: string; readonly children: ReactNode }> = ({ term, children }) => {
    const { colors } = useTheme();

    return (
        <View style={styles.entry}>
            <Text style={[styles.term, { color: colors.inkMuted }]}>{term}</Text>
            {children}
        </View>
    );
};

/**
 * One cited source (native): its heading, names, edition, licence, credit, conversion note and website.
 *
 * @param props - The source, and the adapter that opens a verified link.
 * @returns The card.
 */
export const DataSourceCard: FC<DataSourceCardNativeProps> = ({ source, onOpen = openExternalUrl }) => {
    const messages = useMessages(dataSourcesMessages);
    const card = dataSourceCardModel(source, messages);
    const { colors } = useTheme();
    const value = [styles.value, { color: colors.ink }];

    return (
        <View style={[styles.card, { backgroundColor: colors.surfaceMuted, borderColor: colors.lineDivider }]}>
            <Text accessibilityRole="header" style={[styles.heading, { color: colors.ink }]}>
                {source.publisher}
            </Text>
            <Text style={[styles.name, { color: colors.ink }]}>{source.name}</Text>
            <Entry term={messages.editionLabel}>
                <Text style={value}>{source.edition}</Text>
            </Entry>
            <Entry term={messages.licenceLabel}>
                {card.licence === null ? (
                    <Text style={value}>{source.licenceName}</Text>
                ) : (
                    <ExternalLink link={card.licence} onOpen={onOpen}>
                        {source.licenceName}
                    </ExternalLink>
                )}
            </Entry>
            <Entry term={messages.creditLabel}>
                {/* Its own `Text`, so it can carry its language: VoiceOver reads it in that language (WCAG 2.2 SC
                    3.1.2). `accessibilityLanguage` is iOS-only; Android has no equivalent and reads it in the app's. */}
                <Text accessibilityLanguage={source.attributionLanguage} style={value}>
                    {source.attribution}
                </Text>
            </Entry>
            {source.converted && (
                <Text style={[styles.note, { color: colors.inkMuted }]}>{messages.convertedNote}</Text>
            )}
            {card.homepage !== null && (
                <ExternalLink link={card.homepage} onOpen={onOpen}>
                    {messages.homepageLink}
                </ExternalLink>
            )}
        </View>
    );
};

const styles = StyleSheet.create({
    // `surfaceMuted` and a hairline, not the sheet's own surface: a card of the same colour as the sheet is invisible.
    card: {
        borderRadius: nativeTokens.radius.lg,
        borderWidth: StyleSheet.hairlineWidth,
        padding: nativeTokens.spacing[4],
        gap: nativeTokens.spacing[2],
    },
    heading: { ...nativeTokens.type.sectionTitle },
    // The dataset's name: `body` 600 (§9.2).
    name: { ...nativeTokens.type.body, fontFamily: nativeTokens.fontFace.body.semibold },
    entry: { gap: nativeTokens.spacing[1] },
    term: { ...nativeTokens.type.caption },
    value: { ...nativeTokens.type.meta },
    note: { ...nativeTokens.type.meta },
    // 48 dp, the §S16 floor for a link that leaves the app; the text may wrap inside it.
    linkTouch: { minHeight: 48, justifyContent: 'center', alignSelf: 'flex-start', flexShrink: 1 },
    // Underlined, so the affordance is not colour alone (SC 1.4.1).
    link: { ...nativeTokens.type.meta, textDecorationLine: 'underline' },
});
