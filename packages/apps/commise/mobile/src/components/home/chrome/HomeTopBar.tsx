/**
 * @module home/chrome/HomeTopBar — the Home top bar (mobile; US-000 / FR-046).
 *
 * The native mirror of the web top bar: the page title, the mockup's search and notification affordances, and
 * the account avatar. The avatar shows the viewer's REAL initials via the shared `initialsFor`; a name-less
 * account (email sign-up, no name yet) is a real state that falls back to a neutral glyph and a "your account"
 * accessible name — never invented initials.
 *
 * ## Two deliberate honesty rules on the affordances
 *
 * **The bell carries NO count.** The mockup shows a red "3"; there is no notifications service in v1, so a
 * number here would be fabricated data (the web bar refuses it for the same reason).
 *
 * **Neither affordance pretends to work.** Search and notifications have no backing feature yet, so each is a
 * non-interactive, `aria-disabled` control announced as "…, coming soon" — the SAME vocabulary the gated tabs
 * use — rather than a button that navigates nowhere. The mockup's chrome is intact and the promise is honest;
 * both become real controls when their features ship.
 */
import { initialsFor } from '@commise/features-core';
import { palette } from '@commise/ui';
import { nativeTokens } from '@commise/ui/native';
import type { JSX } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { ChromeIcon, CONTROL_ICONS } from './icons.js';
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

            <View style={styles.affordances}>
                {/* Present, labelled, and honestly gated — see the module docblock. */}
                <View
                    aria-disabled
                    accessibilityLabel={`${chrome.search}, ${chrome.comingSoonSuffix}`}
                    style={styles.affordance}
                >
                    <ChromeIcon name={CONTROL_ICONS.search} color={palette.charcoal} />
                </View>

                <View
                    aria-disabled
                    accessibilityLabel={`${chrome.notifications}, ${chrome.comingSoonSuffix}`}
                    style={styles.affordance}
                >
                    <ChromeIcon name={CONTROL_ICONS.notifications} color={palette.charcoal} />
                </View>

                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={initials === '' ? chrome.accountNoName : chrome.account}
                    onPress={onOpenAccount}
                    style={styles.avatarTouch}
                >
                    {/* 44pt tap target (RC-3) around the compact 32px avatar circle. The initials are
                        decorative — the accessible name is on the Pressable — so they carry no separate
                        label; a name-less viewer shows a neutral dot instead of guessed letters. */}
                    <View style={styles.avatar}>
                        <Text style={styles.avatarText}>{initials === '' ? '·' : initials}</Text>
                    </View>
                </Pressable>
            </View>
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
    // The trailing affordance cluster (search, notifications, avatar) — the mockup's top-right group.
    affordances: { flexDirection: 'row', alignItems: 'center', gap: nativeTokens.spacing[1] },
    // Each glyph affordance clears the 44pt touch floor (RC-3) even though its glyph is 24pt.
    affordance: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
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
