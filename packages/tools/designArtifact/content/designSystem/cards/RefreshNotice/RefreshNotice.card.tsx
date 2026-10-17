/**
 * @module RefreshNotice.card — the design-system card of the RefreshNotice: the failed state and the retry-in-flight
 * state, on both platforms. (With nothing failed it shows nothing.)
 */
import { defineCard } from '../../../../src/cards/defineCard.js';

const noop = (): void => undefined;

const labels = { failed: 'We couldn’t refresh your recipes.', retry: 'Try again' };

export default defineCard({
    group: 'Feedback',
    height: 260,
    platforms: 'both',
    uses: ['RefreshNotice'],
    render: ({ RefreshNotice }) => (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <RefreshNotice failed refreshing={false} onRetry={noop} labels={labels} />
            <RefreshNotice failed refreshing onRetry={noop} labels={labels} />
            <p className="muted">Top: failed. Bottom: retry in flight. When nothing has failed it shows nothing.</p>
        </div>
    ),
});
