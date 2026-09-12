/**
 * @module components/AlertBanner — the shared shape of the mobile account notices.
 *
 * Every account notice (suspension, impersonation block) is the same thing: an `alert`-role banner with a
 * tone accent, a heading, and a body. They differ only in tone and copy, so the shape lives here once and
 * each notice supplies its accent + its localized strings.
 *
 * Two U8 corrections are baked in here. (1) Every colour is a `palette`/`nativeTokens` value: the banners
 * previously carried six raw Material hex codes belonging to no Commise token. (2) The accent tone — not the
 * text — carries the colour, and the copy stays `charcoal`/`slate`. The accent is the FILL half of each tier
 * (`palette.error`, `palette.warning`), which is correct for a 4px bar under SC 1.4.11 but is not a text
 * colour: `palette.warning` as copy is 1.88:1 on white, and `palette.error` 4.66:1 only because it was
 * darkened for exactly that role. Keeping the words neutral means neither tier's bar has to double as a
 * legible foreground — the tone is communicated by the accent and the heading, not by tinting the sentence.
 */
import { palette } from '@commise/ui';
import { nativeTokens } from '@commise/ui/native';
import type { FC } from 'react';
import { StyleSheet, Text, View } from 'react-native';

/** Props for {@link AlertBanner}. */
export interface AlertBannerProps {
    /** The accent colour naming the tone — `palette.error` for a block, `palette.warning` for a caution. */
    readonly accent: string;
    /** Localized heading. */
    readonly title: string;
    /** Localized body copy. */
    readonly body: string;
}

/**
 * The shared notice shape: a tone-accented `alert` banner. Pure render component.
 *
 * @param props - The tone `accent` plus the localized `title` and `body`.
 * @returns The banner.
 */
export const AlertBanner: FC<AlertBannerProps> = ({ accent, title, body }) => (
    <View style={[styles.banner, { borderLeftColor: accent }]} accessibilityRole="alert">
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.body}>{body}</Text>
    </View>
);

const styles = StyleSheet.create({
    banner: {
        backgroundColor: palette.pearl,
        padding: nativeTokens.spacing[4],
        gap: nativeTokens.spacing[2],
        // The tone accent (colour supplied per notice) plus a tokenized hairline separating it from content.
        borderLeftWidth: 4,
        borderBottomWidth: 1,
        borderBottomColor: nativeTokens.borderSubtle,
    },
    title: { fontSize: nativeTokens.fontSize.bodyMd, fontWeight: '600', color: palette.charcoal },
    body: {
        fontSize: nativeTokens.fontSize.bodySm,
        lineHeight: nativeTokens.fontSize.bodySm * nativeTokens.lineHeight.body,
        color: palette.slate,
    },
});
