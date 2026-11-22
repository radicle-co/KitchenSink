/**
 * @module IconButton.card — the design-system card of IconButton: one glyph in a 44 target, shown for pause, resume and
 * close, on both platforms.
 */
import { defineCard } from '../../../../src/cards/defineCard.js';

const noop = (): void => undefined;

export default defineCard({
    group: 'Actions',
    height: 120,
    platforms: 'both',
    uses: ['IconButton'],
    render: ({ IconButton }) => (
        <div className="row" style={{ gap: 16 }}>
            <IconButton icon="pause" accessibilityLabel="Pause Roast timer" onPress={noop} />
            <IconButton icon="play" accessibilityLabel="Resume Roast timer" onPress={noop} />
            <IconButton icon="x" accessibilityLabel="Cancel Roast timer" onPress={noop} />
        </div>
    ),
});
