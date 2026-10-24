/**
 * @module VariantPartsLine.card — the design-system card of the VariantPartsLine: the secondary tone under a food
 * name, and the primary tone alone.
 */
import { defineCard } from '../../../../src/cards/defineCard.js';

export default defineCard({
    group: 'Layout',
    height: 220,
    platforms: 'both',
    uses: ['VariantPartsLine'],
    render: ({ VariantPartsLine }) => (
        <div className="col">
            <div style={{ maxWidth: 300 }}>
                <div style={{ fontWeight: 600, fontSize: 16 }}>Pork belly</div>
                <VariantPartsLine tone="secondary" parts={['flat half', 'select', 'braised']} />
            </div>
            <div style={{ maxWidth: 300 }}>
                <VariantPartsLine tone="primary" parts={['thick cut', '1/8-inch slices', 'skin on']} />
            </div>
        </div>
    ),
});
