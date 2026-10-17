/**
 * @module UndoSnackbar.card — the design-system card of UndoSnackbar: a message with an Undo action and a message
 * alone, on both platforms.
 */
import { defineCard } from '../../../../src/cards/defineCard.js';

const noop = (): void => undefined;

export default defineCard({
    group: 'Feedback',
    height: 250,
    platforms: 'both',
    uses: ['UndoSnackbar'],
    render: ({ UndoSnackbar }) => (
        <div className="col">
            <UndoSnackbar
                message="Lemon tart moved to the trash"
                action={{ label: 'Undo', onAction: noop }}
                onPause={noop}
                onResume={noop}
            />
            <UndoSnackbar message="Recipe saved to Weeknight dinners" onPause={noop} onResume={noop} />
        </div>
    ),
});
