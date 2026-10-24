/**
 * @module LoadingNotice.card — the design-system card of the LoadingNotice: two loading labels, each in a box that
 * fills its column (a fixed-height panel on native, a content-height one on web).
 */
import { defineCard } from '../../../../src/cards/defineCard.js';

export default defineCard({
    group: 'Feedback',
    height: 480,
    platforms: 'both',
    uses: ['LoadingNotice'],
    render: ({ LoadingNotice }, { platform }) => {
        const box = {
            border: '1px solid var(--line-divider)',
            borderRadius: 16,
            background: 'var(--canvas)',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            ...(platform === 'web' ? { height: 'auto', padding: '0 16px' } : { height: 200 }),
        } as const;

        return (
            <div className="col">
                <div style={box}>
                    <LoadingNotice label="Loading recipe…" />
                </div>
                <div style={box}>
                    <LoadingNotice label="Loading collection…" />
                </div>
            </div>
        );
    },
});
