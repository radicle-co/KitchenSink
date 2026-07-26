/**
 * @module home/chrome/HomeTabBar — the bottom tab bar (mobile; US-000 / FR-046 / FR-044).
 *
 * The native rendering of the SHARED six-destination nav model (`resolveHomeNav`) — the same model the web
 * sidebar/tab bar render, so the platforms cannot list different destinations. Reachable destinations are
 * real tabs (`accessibilityRole="tab"`, selected state); gated destinations are non-interactive and announced
 * as "…, coming soon" (never a tab that navigates nowhere). The active destination is the selected tab.
 *
 * Each tab pairs the mockup's glyph (the shared {@link NAV_ICONS} registry, drawn from Feather) with its text
 * label — icon AND label, as the mockup's bottom bar has it. The glyph is decorative: the label alone owns the
 * accessible name. The bottom safe-area inset is padded so the bar clears the home indicator.
 */
import { resolveHomeNav, type HomeNavItemId } from '@commise/features-core';
import { palette } from '@commise/ui';
import { nativeTokens } from '@commise/ui/native';
import type { JSX } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { ChromeIcon, NAV_ICONS } from './icons.js';
import type { MobileMessages } from '../../../i18n/messages.js';

/** The chrome copy slice this bar renders. */
type ChromeMessages = MobileMessages['home']['chrome'];

/**
 * Tab glyph size. Smaller than the 24pt chrome default: a tab stacks a glyph AND its label inside the 44pt
 * touch target, so the icon takes the compact end of the mockup's bottom-bar sizing.
 */
const TAB_ICON_SIZE = 20;

/** Props for {@link HomeTabBar}. */
export interface HomeTabBarProps {
    /** The chrome copy (labels + accessible names), resolved for the active locale. */
    readonly chrome: ChromeMessages;
    /** Capabilities whose backing service is live — decides which tabs are reachable. */
    readonly liveCapabilities: readonly string[];
    /** The currently active (selected) destination. */
    readonly activeId: HomeNavItemId;
    /** Activate a reachable destination. The parent routes the id (home is a no-op — already here). */
    readonly onSelect: (id: HomeNavItemId) => void;
    /** The bottom safe-area inset, so the bar clears the home indicator. */
    readonly bottomInset: number;
}

/**
 * The mobile bottom tab bar.
 *
 * @param props - The chrome copy, live capabilities, active destination, select handler, and bottom inset.
 * @returns The bottom navigation with one tab per shared destination.
 */
export function HomeTabBar({
    chrome,
    liveCapabilities,
    activeId,
    onSelect,
    bottomInset,
}: HomeTabBarProps): JSX.Element {
    const destinations = resolveHomeNav(liveCapabilities);

    return (
        <View
            accessibilityRole="tablist"
            accessibilityLabel={chrome.tabNavLabel}
            style={[styles.bar, { paddingBottom: bottomInset }]}
        >
            {destinations.map((item) => {
                const label = chrome.destinations[item.id];

                if (!item.reachable) {
                    return (
                        <View
                            key={item.id}
                            accessibilityRole="tab"
                            aria-disabled
                            accessibilityLabel={`${label}, ${chrome.comingSoonSuffix}`}
                            style={styles.tab}
                        >
                            <ChromeIcon name={NAV_ICONS[item.id]} color={palette.slate} size={TAB_ICON_SIZE} />
                            <Text style={styles.labelDisabled}>{label}</Text>
                        </View>
                    );
                }

                const selected = item.id === activeId;

                return (
                    <Pressable
                        key={item.id}
                        accessibilityRole="tab"
                        aria-selected={selected}
                        accessibilityLabel={label}
                        onPress={() => onSelect(item.id)}
                        style={styles.tab}
                    >
                        <ChromeIcon
                            name={NAV_ICONS[item.id]}
                            color={selected ? palette.seafoam : palette.slate}
                            size={TAB_ICON_SIZE}
                        />
                        <Text style={selected ? styles.labelActive : styles.label}>{label}</Text>
                    </Pressable>
                );
            })}
        </View>
    );
}

const styles = StyleSheet.create({
    bar: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-around',
        paddingTop: nativeTokens.spacing[2],
        paddingHorizontal: nativeTokens.spacing[1],
        backgroundColor: 'rgba(255, 255, 255, 0.9)',
        borderTopWidth: 1,
        borderTopColor: nativeTokens.borderSubtle,
    },
    // Each tab is a 44pt touch target (RC-3) — reachable Pressables and the non-interactive "coming soon"
    // Views share this style, so every destination clears the minimum. `gap` sets the glyph-to-label rhythm.
    tab: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: 44,
        paddingVertical: 6,
        gap: nativeTokens.spacing[1],
    },
    label: { fontSize: nativeTokens.fontSize.caption, color: palette.slate },
    labelActive: { fontSize: nativeTokens.fontSize.caption, fontWeight: '600', color: palette.seafoam },
    // Contrast (U4 / WCAG AA): the "coming soon" label is real text — mist is 1.9:1, slate is 5:1. The
    // non-interactivity (a View, not a Pressable) and the "…, coming soon" accessible name carry the disabled
    // meaning, not a sub-legible colour.
    labelDisabled: { fontSize: nativeTokens.fontSize.caption, color: palette.slate },
});
