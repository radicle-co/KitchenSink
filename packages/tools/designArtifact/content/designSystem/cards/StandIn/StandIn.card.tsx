/**
 * @module StandIn.card — the design-system card of the StandIn: a neutral stand-in for a private ingredient and two
 * caution stand-ins for a removed one (short and long copy), each beside its quantity, on both platforms.
 */
import { defineCard } from '../../../../src/cards/defineCard.js';

const line = { display: 'flex', gap: 12, alignItems: 'center', fontSize: 16 } as const;
const quantity = { minWidth: 64, color: 'var(--ink-muted)' } as const;
const slot = { flex: 1, minWidth: 0, display: 'flex' } as const;

export default defineCard({
    group: 'Feedback',
    height: 170,
    platforms: 'both',
    uses: ['StandIn'],
    render: ({ StandIn }) => (
        <div className="col">
            <div style={line}>
                <span style={quantity}>2 cups</span>
                <div style={slot}>
                    <StandIn tone="neutral">Private ingredient</StandIn>
                </div>
            </div>
            <div style={line}>
                <span style={quantity}>1 tbsp</span>
                <div style={slot}>
                    <StandIn tone="caution">Ingredient removed</StandIn>
                </div>
            </div>
            <div style={line}>
                <span style={quantity}>3</span>
                <div style={slot}>
                    <StandIn tone="caution">Ingredient removed by its author, replace it before cooking</StandIn>
                </div>
            </div>
        </div>
    ),
});
