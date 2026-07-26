/**
 * @module home/chrome/HomeTopBar — the Home top bar (mobile; US-000 / FR-046).
 *
 * The native mirror of the web top bar's essentials: the page title and the account avatar. The avatar shows
 * the viewer's REAL initials via the shared `initialsFor`; a name-less account (email sign-up, no name yet)
 * is a real state that falls back to a person glyph and a "your account" accessible name — never invented
 * initials.
 *
 * The web bar's search and notification affordances are intentionally NOT mirrored here: there is no search
 * or notifications backend in v1 (the web bell already carries no count for the same reason), and this app
 * has no icon set installed, so an unlabelled or fabricated control would be worse than its absence. They
 * return with their backing features.
 */
import { initialsFor } from '@commise/features-core';
import { palette } from '@commise/ui';
import { nativeTokens } from '@commise/ui/native';
import type { JSX } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { DISPLAY_FONT_SEMIBOLD } from '../../../theme/fonts.js';
import type { MobileMessages } from '../../../i18n/messages.js';

/** The chrome copy slice this bar renders. */
type ChromeMessages = MobileMessages['home']['chrome'];

/** Props for {@link HomeTopBar}. */
export interface HomeTopBarProps {
    /** The chrome copy (title + accessible names), resolved for the active locale. */
    readonly chrome: ChromeMessages;
    /** The viewer's display name, if known — the source of the avatar initials. */
    readonly displayName: string | undefined;
    /** Open the account/profile surface (avatar tap). */
    readonly onOpenAccount: () => void;
}

/**
 * The Home top bar (mobile).
 *
 * @param props - The chrome copy, the viewer display name, and the account-open handler.
 * @returns The top bar with the page title and the account avatar.
 */
export function HomeTopBar({ chrome, displayName, onOpenAccount }: HomeTopBarProps): JSX.Element {
    const initials = initialsFor(displayName);

    return (
        <View style={styles.bar}>
            <Text style={styles.title}>{chrome.pageTitle}</Text>

            <Pressable
                accessibilityRole="button"
                accessibilityLabel={initials === '' ? chrome.accountNoName : chrome.account}
                onPress={onOpenAccount}
                style={styles.avatarTouch}
            >
                {/* 44pt tap target (RC-3) around the compact 32px avatar circle. The initials are decorative —
                    the accessible name is on the Pressable — so they carry no separate label; a name-less
                    viewer shows a neutral dot instead of guessed letters. */}
                <View style={styles.avatar}>
                    <Text style={styles.avatarText}>{initials === '' ? '·' : initials}</Text>
                </View>
            </Pressable>
        </View>
    );
}

const styles = StyleSheet.create({
    bar: {
        height: 56,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: nativeTokens.spacing[4],
        backgroundColor: 'rgba(255, 255, 255, 0.5)',
        borderBottomWidth: 1,
        borderBottomColor: nativeTokens.borderSubtle,
    },
    title: {
        fontFamily: DISPLAY_FONT_SEMIBOLD,
        fontSize: nativeTokens.fontSize.bodyLg,
        fontWeight: '600',
        color: palette.charcoal,
    },
    // 44pt tap target (RC-3); pushed to the row's right edge so the larger hit box does not shift the avatar.
    avatarTouch: { width: 44, height: 44, alignItems: 'flex-end', justifyContent: 'center' },
    avatar: {
        width: 32,
        height: 32,
        borderRadius: nativeTokens.radius.full,
        backgroundColor: palette.seafoam,
        alignItems: 'center',
        justifyContent: 'center',
    },
    avatarText: { fontSize: 13, fontWeight: '600', color: palette.white },
});
