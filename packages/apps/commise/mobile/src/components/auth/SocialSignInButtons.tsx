/**
 * @module components/auth/SocialSignInButtons — the provider group both signed-out screens draw above the email form
 * (plan 012 D9, D10; buildSpec §8's order: brand line → providers → "or" → email form).
 *
 * - Apple then Google on iOS, Google alone on Android; with no provider (prod Android, an unknown Clerk instance) it
 *   draws NOTHING — no group and no divider — so the email form follows the brand line directly.
 * - Apple is the SYSTEM button (`AppleAuthenticationButton`: approved artwork, its own localisation and VoiceOver
 *   label), `CONTINUE`, a capsule at the `lg` height; `WHITE_OUTLINE` on light, `WHITE` on dark, so it never outweighs
 *   the white Google button beside it. The system button has no `disabled` prop: while locked it takes no touches
 *   (`pointerEvents="none"`) and presses are ignored.
 * - One status slot under the group: a polite "Signing you in…" while a provider is busy (SC 4.1.3), or the
 *   provider's failure as an alert.
 *
 * Presentational: props → JSX.
 */
import { BUTTON_DIMMED_OPACITY, BUTTON_VISUAL_HEIGHT } from '@commise/ui/button';
import { nativeTokens } from '@commise/ui/native';
import { useTheme } from '@commise/ui/theme';
import { useMessages } from '@commise/i18n/react';
import {
    AppleAuthenticationButton,
    AppleAuthenticationButtonStyle,
    AppleAuthenticationButtonType,
} from 'expo-apple-authentication';
import type { JSX } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import type { SocialProvider } from '../../auth/socialAuthConfig.js';
import { mobileMessages } from '../../i18n/messages.js';
import { GoogleSignInButton } from './GoogleSignInButton.js';

const HEIGHT = BUTTON_VISUAL_HEIGHT.lg;

/** Props for {@link SocialSignInButtons}. */
export interface SocialSignInButtonsProps {
    /** The providers to draw, in order (`socialProvidersFor`). */
    readonly providers: readonly SocialProvider[];
    /** The provider whose sheet is up, if any. */
    readonly busyProvider: SocialProvider | null;
    /** A provider's failure, shown in the status slot. */
    readonly error: string | null;
    /** Every control on the screen is locked (a provider, or the email form, is in flight). */
    readonly locked: boolean;
    /** Starts the named provider's flow. */
    readonly onPress: (provider: SocialProvider) => void;
}

/**
 * The provider group: the providers in order, the status slot, and the "or" divider.
 *
 * @param props - The providers, the busy / locked state, the error and the press handler.
 * @returns The provider group and the "or" divider, or nothing when there is no provider.
 */
export function SocialSignInButtons({
    providers,
    busyProvider,
    error,
    locked,
    onPress,
}: SocialSignInButtonsProps): JSX.Element | null {
    const { auth: t } = useMessages(mobileMessages);
    const { colors, scheme } = useTheme();

    if (providers.length === 0) {
        return null;
    }

    const press = (provider: SocialProvider) => {
        if (!locked) {
            onPress(provider);
        }
    };

    return (
        <View style={styles.section}>
            <View style={styles.group}>
                {providers.map((provider) =>
                    provider === 'apple' ? (
                        <AppleAuthenticationButton
                            key="apple"
                            buttonType={AppleAuthenticationButtonType.CONTINUE}
                            buttonStyle={
                                scheme === 'dark'
                                    ? AppleAuthenticationButtonStyle.WHITE
                                    : AppleAuthenticationButtonStyle.WHITE_OUTLINE
                            }
                            cornerRadius={HEIGHT / 2}
                            pointerEvents={locked ? 'none' : 'auto'}
                            style={[styles.apple, locked && busyProvider !== 'apple' ? styles.dimmed : null]}
                            onPress={() => press('apple')}
                        />
                    ) : (
                        <GoogleSignInButton
                            key="google"
                            label={t.continueWithGoogle}
                            disabled={locked}
                            busy={busyProvider === 'google'}
                            onPress={() => press('google')}
                        />
                    ),
                )}
            </View>

            {busyProvider !== null ? (
                <Text aria-live="polite" style={[styles.status, { color: colors.inkMuted }]}>
                    {t.socialBusy}
                </Text>
            ) : null}
            {error !== null && busyProvider === null ? (
                <Text role="alert" style={[styles.status, { color: colors.dangerText }]}>
                    {error}
                </Text>
            ) : null}

            <View style={styles.divider}>
                <View style={[styles.rule, { backgroundColor: colors.lineDivider }]} />
                <Text style={[styles.or, { color: colors.inkMuted }]}>{t.orDivider}</Text>
                <View style={[styles.rule, { backgroundColor: colors.lineDivider }]} />
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    section: { gap: nativeTokens.spacing[4] },
    // 12 pt between providers: more than Apple's minimum margin (a tenth of the button's height).
    group: { gap: nativeTokens.spacing[3] },
    apple: { height: HEIGHT, width: '100%' },
    dimmed: { opacity: BUTTON_DIMMED_OPACITY },
    status: { ...nativeTokens.type.meta },
    divider: { flexDirection: 'row', alignItems: 'center', gap: nativeTokens.spacing[3] },
    rule: { flex: 1, height: StyleSheet.hairlineWidth },
    or: { ...nativeTokens.type.meta },
});
