/**
 * @module components/SuspensionBanner — the mobile account notices (suspension, impersonation block).
 *
 * Both notices are the same shape: an `alert`-role banner with a tone accent, a heading, and a body. They
 * differ only in tone and copy, so the shape lives once in the local {@link AlertBanner} and each notice
 * supplies its accent + its localized strings.
 *
 * Two U8 corrections are baked in here. (1) Every colour is a `palette`/`nativeTokens` value: the banners
 * previously carried six raw Material hex codes belonging to no Commise token. (2) The accent tone — not the
 * text — carries the colour, and the copy stays `charcoal`/`slate`. The accent is the FILL half of each tier
 * (`palette.error`, `palette.warning`), which is correct for a 4px bar under SC 1.4.11 but is not a text
 * colour: `palette.warning` as copy is 1.88:1 on white, and `palette.error` 4.66:1 only because it was
 * darkened for exactly that role. Keeping the words neutral means neither tier's bar has to double as a
 * legible foreground — the tone is communicated by the accent and the heading, not by tinting the sentence.
 */
import { useMessages } from '@commise/i18n/react';
import { palette } from '@commise/ui';
import { nativeTokens } from '@commise/ui/native';
import type { UserStatus } from '@kitchensink/identity-service';
import type { FC, JSX } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { mobileMessages } from '../i18n/messages';

/** Props for the shared {@link AlertBanner} shape. */
interface AlertBannerProps {
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
const AlertBanner: FC<AlertBannerProps> = ({ accent, title, body }) => (
    <View style={[styles.banner, { borderLeftColor: accent }]} accessibilityRole="alert">
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.body}>{body}</Text>
    </View>
);

/** Props for {@link SuspensionBanner}. */
interface SuspensionBannerProps {
    /** The viewer's account status; the banner renders only for `suspended`. */
    readonly status: UserStatus;
}

/**
 * The account-suspended notice.
 *
 * @param props - The viewer's account `status`.
 * @returns The banner for a suspended account, otherwise `null`.
 */
export function SuspensionBanner({ status }: SuspensionBannerProps): JSX.Element | null {
    const { suspension } = useMessages(mobileMessages);

    if (status !== 'suspended') {
        return null;
    }

    return <AlertBanner accent={palette.error} title={suspension.title} body={suspension.message} />;
}

/** Props for {@link ImpersonationWarning}. */
interface ImpersonationWarningProps {
    /** The impersonated session's id, appended for support correlation when known. */
    readonly sessionId?: string;
}

/**
 * The impersonation-unavailable notice. Administrator impersonation is deliberately not supported in the
 * app, so the viewer is told why instead of being left at a dead end.
 *
 * @param props - The optional impersonated `sessionId`.
 * @returns The caution banner.
 */
export function ImpersonationWarning({ sessionId }: ImpersonationWarningProps): JSX.Element {
    const { impersonation } = useMessages(mobileMessages);
    // The session id is appended through the localized template — never concatenated as English.
    const body =
        sessionId === undefined
            ? impersonation.message
            : `${impersonation.message} ${impersonation.sessionLabel.replace('{sessionId}', sessionId)}`;

    return <AlertBanner accent={palette.warning} title={impersonation.title} body={body} />;
}

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
