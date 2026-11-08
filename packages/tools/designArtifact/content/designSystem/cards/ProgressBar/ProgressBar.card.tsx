/**
 * @module ProgressBar.card — the design-system card of the ProgressBar: the start, a step part way through, the end, and
 * a task with no steps, each with the words the caller sets beside it.
 */
import { defineCard } from '../../../../src/cards/defineCard.js';

const cases = [
    { value: 0, max: 309, words: 'Recipe 0 of 309' },
    { value: 14, max: 309, words: 'Recipe 14 of 309' },
    { value: 309, max: 309, words: 'Recipe 309 of 309' },
    { value: 0, max: 0, words: 'No recipes to review' },
] as const;

export default defineCard({
    group: 'Feedback',
    height: 320,
    platforms: 'both',
    uses: ['ProgressBar'],
    render: ({ ProgressBar }, { stack }) => (
        <div className={stack} style={{ gap: 20 }}>
            {cases.map((spec) => (
                <div key={spec.words} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <span style={{ font: '400 14px/20px var(--font-body)', color: 'var(--ink-muted)' }}>
                        {spec.words}
                    </span>
                    <ProgressBar label="Review progress" value={spec.value} max={spec.max} />
                </div>
            ))}
        </div>
    ),
});
