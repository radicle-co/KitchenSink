/**
 * @module HomeTabBar.card — the design-system card of the HomeTabBar: the web bar inside a ScrollHost, and the native
 * bar in its regular and compact forms. The apps show the bar only on a phone, so the page forces it visible.
 */
import type { ReactNode } from 'react';

import { defineCard } from '../../../../src/cards/defineCard.js';

const noop = (): void => undefined;
const chrome = {
    destinations: { home: 'Home', recipes: 'Recipes', discover: 'Discover', 'meal-plan': 'Plan', grocery: 'Shop' },
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
    height: 400,
    platforms: 'both',
    uses: ['HomeTabBar', 'ScrollHost'],
    render: ({ HomeTabBar, ScrollHost }, { platform }) => (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <style>{'nav[data-tab-bar]{display:flex!important}'}</style>
            {platform === 'web' ? (
                <ScrollHost>
                    {screen(<HomeTabBar chrome={chrome} locale="en" liveCapabilities={[]} activeId="recipes" />)}
                </ScrollHost>
            ) : (
                <>
                    {screen(
                        <HomeTabBar
                            chrome={chrome}
                            liveCapabilities={[]}
                            activeId="recipes"
                            onPress={noop}
                            bottomInset={34}
                            compact={false}
                            leftInset={0}
                            rightInset={0}
                        />,
                    )}
                    {screen(
                        <HomeTabBar
                            chrome={chrome}
                            liveCapabilities={[]}
                            activeId="discover"
                            onPress={noop}
                            bottomInset={34}
                            compact
                            leftInset={0}
                            rightInset={0}
                        />,
                    )}
                </>
            )}
        </div>
    ),
});
