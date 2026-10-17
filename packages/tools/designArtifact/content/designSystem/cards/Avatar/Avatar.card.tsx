/**
 * @module Avatar.card — the design-system card of the Avatar: ready with initials, ready without, loading and
 * failed, on both platforms.
 */
import { defineCard } from '../../../../src/cards/defineCard.js';

const noop = (): void => undefined;

export default defineCard({
    group: 'Navigation',
    height: 120,
    platforms: 'both',
    uses: ['Avatar'],
    render: ({ Avatar }) => (
        <div className="row">
            <Avatar status="ready" initials="AR" label="Profile, Ana Ruiz" onPress={noop} href="#profile" />
            <Avatar status="ready" initials="" label="Profile" onPress={noop} />
            <Avatar status="loading" initials="" label="Profile" onPress={noop} />
            <Avatar status="failed" initials="" label="Profile" onPress={noop} />
        </div>
    ),
});
