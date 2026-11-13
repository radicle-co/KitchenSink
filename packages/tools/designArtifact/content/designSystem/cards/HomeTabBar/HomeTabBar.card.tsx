/**
 * @module HomeTabBar.card — the design-system card of the HomeTabBar: the web bar inside a ScrollHost, and the native
 * bar in its regular and compact forms. The apps show the bar only on a phone, so the page forces it visible.
 */
import type { ReactNode } from 'react';

import { defineCard } from '../../../../src/cards/defineCard.js';

/** The cook the You tab's disc shows. */
const PROFILE = { status: 'ready', name: 'Ana Ruiz' } as const;

const noop = (): void => undefined;

/** The width the compact bar is drawn at: an iPhone in landscape, less its side insets. */
const LANDSCAPE_WIDTH = 760;

/** The width the regular bar is drawn at: the card's usual native column. */
const PHONE_WIDTH = 358;
const chrome = {
    destinations: {
        home: 'Home',
        recipes: 'Recipes',
        discover: 'Discover',
        'meal-plan': 'Plan',
        grocery: 'Shop',
        you: 'You',
    },
    profileButton: 'Profile, {name}',
    profileButtonNoName: 'Profile',
    tabNavLabel: 'Tabs',
};

function screen(bar: ReactNode): ReactNode {
    return (
        <div
            style={{
                position: 'relative',
                display: 'flex',
                flexDirection: 'column',
                height: 150,
                transform: 'translateZ(0)',
                overflow: 'hidden',
                border: '1px solid var(--line-divider)',
                borderRadius: 12,
                justifyContent: 'flex-end',
            }}
        >
            <div style={{ flex: 1, padding: 12, fontSize: 14, color: 'var(--ink-muted)' }}>
                Screen content scrolls under the bar
            </div>
            {bar}
        </div>
    );
}

export default defineCard({
    group: 'App chrome',
    height: 590,
    platforms: 'both',
    uses: ['HomeTabBar', 'ScrollHost'],
    // The two bars are different components (the web bar is a router-driven `nav` of links, the mobile bar takes
    // `onPress` and the insets), so each column states its own props.
    render: ({ HomeTabBar, ScrollHost }) => (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <style>{'nav[data-tab-bar]{display:flex!important}'}</style>
            <ScrollHost>
                {screen(
                    <HomeTabBar
                        chrome={chrome}
                        locale="en"
                        liveCapabilities={[]}
                        activeId="recipes"
                        profile={PROFILE}
                    />,
                )}
            </ScrollHost>
        </div>
    ),
    renderNative: ({ HomeTabBar }) => (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* The compact bar is an iPhone in landscape, about 800 pt wide; in the phone-width column it would be
                squeezed to a width no device gives it. So this card's native column takes the landscape width, which
                wraps it onto its own row under the web column, and the regular bar keeps the phone width. */}
            <style>{`nav[data-tab-bar]{display:flex!important}.native{width:${String(LANDSCAPE_WIDTH)}px}`}</style>
            <div style={{ width: PHONE_WIDTH }}>
                {screen(
                    <HomeTabBar
                        chrome={chrome}
                        liveCapabilities={[]}
                        activeId="recipes"
                        profile={PROFILE}
                        onPress={noop}
                        bottomInset={34}
                        compact={false}
                        leftInset={0}
                        rightInset={0}
                    />,
                )}
            </div>
            {screen(
                <HomeTabBar
                    chrome={chrome}
                    liveCapabilities={[]}
                    activeId="discover"
                    profile={PROFILE}
                    onPress={noop}
                    bottomInset={34}
                    compact
                    leftInset={0}
                    rightInset={0}
                />,
            )}
        </div>
    ),
});
