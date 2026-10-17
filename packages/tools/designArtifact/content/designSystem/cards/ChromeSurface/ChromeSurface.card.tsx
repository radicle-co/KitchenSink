/**
 * @module ChromeSurface.card — the design-system card of ChromeSurface: a top bar and a bottom bar, each backed by
 * the chrome surface, over a striped backdrop that shows the blur and tint, on both platforms.
 */
import type { CSSProperties } from 'react';

import { defineCard } from '../../../../src/cards/defineCard.js';

const stripes =
    'repeating-linear-gradient(90deg,var(--cover-coral),var(--cover-coral) 30px,var(--cover-seafoam) 30px,var(--cover-seafoam) 60px)';

export default defineCard({
    group: 'Layout',
    height: 250,
    platforms: 'both',
    uses: ['ChromeSurface'],
    render: ({ ChromeSurface }) => {
        const bar = (edge: 'top' | 'bottom', text: string, placement: CSSProperties) => (
            <div
                style={{
                    position: 'relative',
                    isolation: 'isolate',
                    padding: '12px 16px',
                    fontWeight: 600,
                    ...placement,
                }}
            >
                <ChromeSurface edge={edge} />
                <span style={{ position: 'relative', zIndex: 1 }}>{text}</span>
            </div>
        );

        return (
            <div
                style={{ position: 'relative', overflow: 'hidden', borderRadius: 12, height: 180, background: stripes }}
            >
                {bar('bottom', 'Weeknight pasta', { position: 'absolute', top: 0, left: 0, right: 0 })}
                {bar('top', 'Home   Search   Plan', { position: 'absolute', bottom: 0, left: 0, right: 0 })}
            </div>
        );
    },
});
