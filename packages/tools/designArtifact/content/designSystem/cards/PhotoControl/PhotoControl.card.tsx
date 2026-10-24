/**
 * @module PhotoControl.card — the design-system card of PhotoControl: a back control and a more-actions control
 * over the corners of a photo, on both platforms.
 */
import { defineCard } from '../../../../src/cards/defineCard.js';

const noop = (): void => undefined;

export default defineCard({
    group: 'Media',
    height: 200,
    platforms: 'both',
    uses: ['PhotoControl'],
    render: ({ PhotoControl }) => (
        <div
            style={{
                position: 'relative',
                height: 140,
                borderRadius: 12,
                overflow: 'hidden',
                background: 'linear-gradient(135deg,#c2410c,#f5c26b 60%,#6b8e4e)',
            }}
        >
            <div style={{ position: 'absolute', top: 12, left: 12 }}>
                <PhotoControl icon="chevronLeft" label="Back" onPress={noop} />
            </div>
            <div style={{ position: 'absolute', top: 12, right: 12 }}>
                <PhotoControl icon="ellipsis" label="More actions" onPress={noop} />
            </div>
        </div>
    ),
});
