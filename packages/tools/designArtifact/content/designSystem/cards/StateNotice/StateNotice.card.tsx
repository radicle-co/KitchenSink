/**
 * @module StateNotice.card — the design-system card of StateNotice: the full notice with a body, a retry action and
 * a link-style back action, and (web) the bare title-only notice. The native notice fills its screen, so it is
 * shown in a screen-sized frame.
 */
import type { ReactNode } from 'react';

import { defineCard } from '../../../../src/cards/defineCard.js';

const noop = (): void => undefined;

const cardStyle = {
    background: 'var(--paper)',
    border: '1px solid var(--line)',
    borderRadius: 12,
    padding: 12,
} as const;

const screenStyle = {
    height: 480,
    border: '1px solid var(--line)',
    borderRadius: 16,
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
    background: 'var(--canvas)',
} as const;

export default defineCard({
    group: 'Feedback',
    height: 560,
    platforms: 'both',
    uses: ['StateNotice'],
    render: ({ StateNotice }, { platform }) => {
        const web = platform === 'web';
        const box = (notice: ReactNode) =>
            web ? (
                <div style={{ ...cardStyle, marginBottom: 12 }}>{notice}</div>
            ) : (
                <div style={screenStyle}>
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>{notice}</div>
                </div>
            );

        return (
            <div className="col">
                {box(
                    <StateNotice
                        title="We could not load this recipe"
                        body="Check your connection and try again."
                        primary={{ label: 'Try again', icon: 'refreshCw', onPress: noop }}
                        secondary={{ label: 'Back to Home', icon: 'house', onPress: noop, href: '#home' }}
                    />,
                )}
                {web ? (
                    <div style={cardStyle}>
                        <StateNotice title="This recipe is gone" />
                    </div>
                ) : null}
            </div>
        );
    },
});
