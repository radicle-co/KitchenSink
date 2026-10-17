/**
 * @module StatusBadge.card — the design-system card of StatusBadge: every status, on both platforms.
 */
import { defineCard } from '../../../../src/cards/defineCard.js';

const STATUSES = [
    ['draft', 'Draft'],
    ['private', 'Private'],
    ['public', 'Public'],
    ['pro', 'Pro'],
    ['soon', 'Coming soon'],
    ['note', 'Custom'],
    ['attention', 'Needs review'],
] as const;

export default defineCard({
    group: 'Feedback',
    height: 140,
    platforms: 'both',
    uses: ['StatusBadge'],
    render: ({ StatusBadge }) => (
        <div className="row">
            {STATUSES.map(([status, text]) => (
                <StatusBadge key={status} status={status}>
                    {text}
                </StatusBadge>
            ))}
        </div>
    ),
});
