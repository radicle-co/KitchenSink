/**
 * @module components/AlertBanner — the shared shape of the mobile account notices.
 *
 * Every account notice (suspension, impersonation block) is the same thing: an `alert`-role banner with a
 * tone accent, a heading, and a body. They differ only in tone and copy, so the shape lives here once and
 * each notice supplies its accent role + its localized strings.
 *
 * Every colour is a ROLE of the scheme the device is in (`docs/design/uiOverhaul/ownerDecisions.md` D15), read from
 * `useTheme()` at render, so the notice reads in the dark theme too. The accent tone — not the text — carries the
 * colour, and the copy stays `ink` / `inkMuted`: the accent is a 4 px bar, which owes 3:1 (SC 1.4.11), and keeping the
 * words neutral means neither tone has to double as a legible foreground.
 */
import { nativeTokens } from '@commise/ui/native';
import { useTheme } from '@commise/ui/theme';
import type { FC } from 'react';
import { StyleSheet, Text, View } from 'react-native';

/** The roles a notice's accent bar may take: a block, or a caution. */
export type AlertAccent = 'danger' | 'attention';

/** Props for {@link AlertBanner}. */
export interface AlertBannerProps {
    /** The role naming the tone — `danger` for a block, `attention` for a caution. */
    readonly accent: AlertAccent;
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
export const AlertBanner: FC<AlertBannerProps> = ({ accent, title, body }) => {
    const { colors } = useTheme();

    return (
        <View
            collapsable={false}
            style={[
                styles.banner,
                {
                    backgroundColor: colors.surfaceMuted,
                    borderLeftColor: colors[accent],
                    borderBottomColor: colors.lineDivider,
                },
            ]}
            accessibilityRole="alert"
        >
            <Text style={[styles.title, { color: colors.ink }]}>{title}</Text>
            <Text style={[styles.body, { color: colors.inkMuted }]}>{body}</Text>
        </View>
    );
};

const styles = StyleSheet.create({
    banner: {
        padding: nativeTokens.spacing[4],
        gap: nativeTokens.spacing[2],
        // The tone accent (colour supplied per notice) plus a hairline separating it from content.
        borderLeftWidth: 4,
        borderBottomWidth: 1,
    },
    title: { ...nativeTokens.type.cardTitle },
    body: { ...nativeTokens.type.meta },
});
