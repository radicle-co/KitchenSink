/**
 * @module DifficultyBadge.card — the design-system card of the DifficultyBadge: the three levels.
 */
import { defineCard } from '../../../../src/cards/defineCard.js';

export default defineCard({
    group: 'Feedback',
    height: 100,
    platforms: 'both',
    uses: ['DifficultyBadge'],
    render: ({ DifficultyBadge }) => (
        <div className="row">
            <DifficultyBadge level="easy">Easy</DifficultyBadge>
            <DifficultyBadge level="medium">Medium</DifficultyBadge>
            <DifficultyBadge level="hard">Hard</DifficultyBadge>
        </div>
    ),
});
