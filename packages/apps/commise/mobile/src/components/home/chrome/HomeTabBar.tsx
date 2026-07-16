/**
 * @module home/chrome/HomeTabBar — the bottom tab bar (mobile; US-000 / FR-046 / FR-044).
 *
 * The native rendering of the SHARED six-destination nav model (`resolveHomeNav`) — the same model the web
 * sidebar/tab bar render, so the platforms cannot list different destinations. Reachable destinations are
 * real tabs (`accessibilityRole="tab"`, selected state); gated destinations are non-interactive and announced
 * as "…, coming soon" (never a tab that navigates nowhere). The active destination is the selected tab.
 *
 * There is no icon set installed in this app, so tabs are text-labelled — fully accessible, and honest about
 * what ships. The bottom safe-area inset is padded so the bar clears the home indicator.
 */
import { resolveHomeNav, type HomeNavItemId } from '@commise/features-core';
import { palette } from '@commise/ui';
import type { JSX } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { MobileMessages } from '../../../i18n/messages.js';

/** The chrome copy slice this bar renders. */
type ChromeMessages = MobileMessages['home']['chrome'];

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
        paddingTop: 8,
        paddingHorizontal: 4,
        backgroundColor: 'rgba(255, 255, 255, 0.9)',
        borderTopWidth: 1,
        borderTopColor: 'rgba(178, 190, 195, 0.3)',
    },
    tab: { flex: 1, alignItems: 'center', paddingVertical: 6 },
    label: { fontSize: 12, color: palette.slate },
    labelActive: { fontSize: 12, fontWeight: '600', color: palette.seafoam },
    labelDisabled: { fontSize: 12, color: palette.mist },
});
