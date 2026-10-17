/**
 * @module OfflineReadSlot.card — the design-system card of the OfflineReadSlot: the offline message in a panel.
 */
import { defineCard } from '../../../../src/cards/defineCard.js';

export default defineCard({
    group: 'Feedback',
    height: 250,
    platforms: 'both',
    uses: ['OfflineReadSlot'],
    render: ({ OfflineReadSlot }) => (
        <div
            style={{
                display: 'flex',
                flexDirection: 'column',
                background: 'var(--paper)',
                border: '1px solid var(--line)',
                borderRadius: 12,
                padding: 12,
            }}
        >
            <OfflineReadSlot message="You’re offline, so your recipes can’t load. They’ll appear on their own when you reconnect." />
        </div>
    ),
});
