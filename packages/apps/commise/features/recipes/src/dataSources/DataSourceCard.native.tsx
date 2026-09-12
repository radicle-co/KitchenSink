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
import { palette } from '@commise/ui';
import { nativeTokens } from '@commise/ui/native';
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
}> = ({ link, onOpen, children }) => (
    <Pressable
        accessibilityRole="link"
        accessibilityLabel={link.accessibleName}
        style={styles.linkTouch}
        onPress={() => onOpen(link.href)}
    >
        <Text style={styles.link}>
            {children}
            <Text aria-hidden> ↗</Text>
        </Text>
    </Pressable>
);

/** One term, stacked above its value. */
const Entry: FC<{ readonly term: string; readonly children: ReactNode }> = ({ term, children }) => (
    <View style={styles.entry}>
        <Text style={styles.term}>{term}</Text>
        {children}
    </View>
);

/**
 * One cited source (native): its heading, names, edition, licence, credit, conversion note and website.
 *
 * @param props - The source, and the adapter that opens a verified link.
 * @returns The card.
 */
export const DataSourceCard: FC<DataSourceCardNativeProps> = ({ source, onOpen = openExternalUrl }) => {
    const messages = useMessages(dataSourcesMessages);
    const card = dataSourceCardModel(source, messages);

    return (
        <View style={styles.card}>
            <Text accessibilityRole="header" style={styles.heading}>
                {card.heading}
            </Text>
            {card.fullName !== undefined && <Text style={styles.name}>{card.fullName}</Text>}
            <Text style={styles.publisher}>{source.publisher}</Text>
            <Entry term={messages.editionLabel}>
                <Text style={styles.value}>{source.edition}</Text>
            </Entry>
            <Entry term={messages.licenceLabel}>
                {card.licence === null ? (
                    <Text style={styles.value}>{source.licenceName}</Text>
                ) : (
                    <ExternalLink link={card.licence} onOpen={onOpen}>
                        {source.licenceName}
                    </ExternalLink>
                )}
            </Entry>
            <Entry term={messages.creditLabel}>
                {/* Its own `Text`, so it can carry its language: VoiceOver reads it in that language (WCAG 2.2 SC
                    3.1.2). `accessibilityLanguage` is iOS-only; Android has no equivalent and reads it in the app's. */}
                <Text accessibilityLanguage={source.attributionLanguage} style={styles.value}>
                    {source.attribution}
                </Text>
            </Entry>
            {source.converted && <Text style={styles.note}>{messages.convertedNote}</Text>}
            {card.homepage !== null && (
                <ExternalLink link={card.homepage} onOpen={onOpen}>
                    {messages.homepageLink}
                </ExternalLink>
            )}
        </View>
    );
};

const styles = StyleSheet.create({
    // `pearl`, not white: the sheet's surface is white, and a white card on it is invisible (1.00:1).
    card: {
        backgroundColor: palette.pearl,
        borderRadius: nativeTokens.radius.lg,
        padding: nativeTokens.spacing[4],
        gap: nativeTokens.spacing[2],
    },
    heading: {
        fontFamily: nativeTokens.fontFace.display.semibold,
        fontSize: nativeTokens.fontSize.headingSm,
        color: palette.charcoal,
    },
    name: { fontSize: nativeTokens.fontSize.bodyMd, color: palette.charcoal },
    publisher: { fontSize: nativeTokens.fontSize.bodySm, color: palette.slate },
    entry: { gap: nativeTokens.spacing[1] },
    term: { fontSize: nativeTokens.fontSize.caption, fontWeight: '600', color: palette.slate },
    value: { fontSize: nativeTokens.fontSize.bodySm, color: palette.charcoal },
    note: { fontSize: nativeTokens.fontSize.bodySm, color: palette.slate },
    // 48 dp, the §S16 floor for a link that leaves the app; the text may wrap inside it.
    linkTouch: { minHeight: 48, justifyContent: 'center', alignSelf: 'flex-start', flexShrink: 1 },
    // Contrast (WCAG AA) on the `pearl` card: `ocean-dark` 5.68:1, `slate` 4.81:1. Underlined, so the affordance is not
    // colour alone (SC 1.4.1).
    link: {
        fontSize: nativeTokens.fontSize.bodySm,
        fontWeight: '500',
        color: palette['ocean-dark'],
        textDecorationLine: 'underline',
    },
});
