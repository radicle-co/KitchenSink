/**
 * @module SyncNotice.card — the design-system card of the SyncNotice: the offline state and the syncing state, on
 * both platforms.
 */
import { defineCard } from '../../../../src/cards/defineCard.js';

export default defineCard({
    group: 'Feedback',
    height: 270,
    platforms: 'both',
    uses: ['SyncNotice'],
    render: ({ SyncNotice }) => (
        <div className="col" style={{ maxWidth: 340 }}>
            <SyncNotice
                regionLabel="Connection status"
                state={{
                    kind: 'offline',
                    title: 'You are offline',
                    body: 'Your pancake recipe is saved on this device and will send itself when you are back online.',
                }}
            />
            <SyncNotice
                regionLabel="Sync status"
                state={{
                    kind: 'syncing',
                    title: 'Syncing your changes',
                    body: '2 edits are on their way to your cookbook.',
                }}
            />
        </div>
    ),
});
