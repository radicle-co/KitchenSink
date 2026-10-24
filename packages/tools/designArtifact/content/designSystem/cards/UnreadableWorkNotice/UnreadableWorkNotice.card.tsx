/**
 * @module UnreadableWorkNotice.card — the design-system card of UnreadableWorkNotice: shown, then dismissed so the
 * region stays mounted and silent, on both platforms.
 */
import { useState } from 'react';

import type { CardUi } from '../../../../src/cards/cardComponents.js';
import { defineCard } from '../../../../src/cards/defineCard.js';

function Notice({ UnreadableWorkNotice }: CardUi<'UnreadableWorkNotice'>) {
    const [shown, setShown] = useState(true);

    return (
        <div className="col" style={{ maxWidth: 358 }}>
            <UnreadableWorkNotice
                shown={shown}
                title="Some saved work could not be read"
                body="A draft of your lemon tart from an older version was set aside."
                dismissLabel="Dismiss"
                onDismiss={() => setShown(false)}
            />
            {shown ? null : <p className="muted">Dismissed. The region stays mounted and silent.</p>}
        </div>
    );
}

export default defineCard({
    group: 'Feedback',
    height: 200,
    platforms: 'both',
    uses: ['UnreadableWorkNotice'],
    render: ({ UnreadableWorkNotice }) => <Notice UnreadableWorkNotice={UnreadableWorkNotice} />,
});
