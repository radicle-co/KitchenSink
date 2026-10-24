/**
 * @module AvatarDisc.card — the design-system card of AvatarDisc: the ready disc with initials, the ready disc
 * without them, and the loading and failed states, on both platforms.
 */
import { defineCard } from '../../../../src/cards/defineCard.js';

export default defineCard({
    group: 'Media',
    height: 100,
    platforms: 'both',
    uses: ['AvatarDisc'],
    render: ({ AvatarDisc }) => (
        <div className="row">
            <AvatarDisc status="ready" initials="JT" />
            <AvatarDisc status="ready" initials="" />
            <AvatarDisc status="loading" initials="" />
            <AvatarDisc status="failed" initials="" />
        </div>
    ),
});
