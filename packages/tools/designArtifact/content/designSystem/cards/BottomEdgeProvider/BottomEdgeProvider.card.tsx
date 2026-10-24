/**
 * @module BottomEdgeProvider.card — the design-system card of the BottomEdgeProvider: a screen inside a tab, with
 * the navigator's measured bottom edge (the 64 pt bar plus the 34 pt home-indicator inset) handed down. Native only.
 */
import { defineCard } from '../../../../src/cards/defineCard.js';

const noop = (): void => undefined;

const chrome = {
    destinations: { home: 'Home', recipes: 'Recipes', discover: 'Discover', 'meal-plan': 'Plan', grocery: 'Shop' },
    profileButton: 'Profile, {name}',
    profileButtonNoName: 'Profile',
    tabNavLabel: 'Tabs',
};

export default defineCard({
    group: 'Layout',
    height: 330,
    platforms: 'native',
    reason: "it hands the navigator's measured tab bar height down so popups opened in a modal window clear the bar; web has no such window.",
    uses: ['BottomEdgeProvider', 'HomeTabBar'],
    render: ({ BottomEdgeProvider, HomeTabBar }) => (
        <BottomEdgeProvider value={98}>
            <div
                style={{
                    position: 'relative',
                    display: 'flex',
                    flexDirection: 'column',
                    height: 200,
                    transform: 'translateZ(0)',
                    overflow: 'hidden',
                    border: '1px solid var(--line-divider)',
                    borderRadius: 12,
                    justifyContent: 'flex-end',
                }}
            >
                <div style={{ flex: 1, padding: 12, fontSize: 14, color: 'var(--ink-muted)' }}>
                    A screen inside a tab. Everything below reads a bottom edge of 98 pt: the 64 pt bar plus the 34 pt
                    home-indicator inset. BottomEdgeProvider itself draws nothing.
                </div>
                <HomeTabBar
                    chrome={chrome}
                    liveCapabilities={[]}
                    activeId="home"
                    onPress={noop}
                    bottomInset={34}
                    compact={false}
                    leftInset={0}
                    rightInset={0}
                />
            </div>
        </BottomEdgeProvider>
    ),
});
