/**
 * @module BottomChromeFrame.card — the design-system card of the BottomChromeFrame: with a footer (the tab bar
 * owns the safe-area inset) and without one (the frame pads the inset itself). Native only.
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
const caption = { margin: '0 0 6px', fontSize: 12, color: 'var(--ink-muted)' } as const;
const phone = {
    width: 358,
    height: 340,
    border: '1px solid var(--line)',
    borderRadius: 24,
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
    background: 'var(--canvas)',
} as const;

function content(text: string): ReactNode {
    return (
        <div
            style={{
                flex: 1,
                padding: 16,
                fontSize: 14,
                color: 'var(--ink)',
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
            }}
        >
            <strong>Weeknight lemon pasta</strong>
            <span>25 min · serves 4 · easy</span>
            <div
                style={{
                    marginTop: 'auto',
                    padding: '8px 12px',
                    borderRadius: 12,
                    background: 'var(--selected-fill)',
                    fontSize: 12,
                    color: 'var(--ink)',
                }}
            >
                {text}
            </div>
        </div>
    );
}

export default defineCard({
    group: 'App chrome',
    height: 860,
    platforms: 'native',
    reason: 'it owns the bottom safe-area edge, which only a phone has.',
    uses: ['BottomChromeFrame', 'HomeTabBar'],
    render: ({ BottomChromeFrame, HomeTabBar }) => (
        <div className="col" style={{ gap: 16 }}>
            <div>
                <p style={caption}>With a footer: the tab bar owns the safe-area inset</p>
                <div style={phone}>
                    <BottomChromeFrame
                        footer={
                            <HomeTabBar
                                chrome={chrome}
                                liveCapabilities={[]}
                                activeId="recipes"
                                onPress={noop}
                                bottomInset={34}
                                compact={false}
                                leftInset={0}
                                rightInset={0}
                            />
                        }
                    >
                        {content('Content ends where the bar begins')}
                    </BottomChromeFrame>
                </div>
            </div>
            <div>
                <p style={caption}>No footer: the frame pads the inset itself (34 pt)</p>
                <div style={phone}>
                    <BottomChromeFrame>{content('Content ends 34 pt above the foot')}</BottomChromeFrame>
                </div>
            </div>
        </div>
    ),
});
