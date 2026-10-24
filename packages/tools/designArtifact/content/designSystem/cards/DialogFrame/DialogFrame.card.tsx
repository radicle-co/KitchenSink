/**
 * @module DialogFrame.card — the design-system card of DialogFrame: an open native dialog with a title, a line of
 * body copy and two actions.
 */
import { defineCard } from '../../../../src/cards/defineCard.js';

const noop = (): void => undefined;

export default defineCard({
    group: 'Overlays',
    height: 560,
    platforms: 'native',
    reason: "the web dialogs are Radix's; this frame owns the scrim, safe-area padding, keyboard avoidance and first-focus title that RN's Modal lacks.",
    uses: ['DialogFrame', 'Button'],
    render: ({ DialogFrame, Button }) => (
        <DialogFrame open onRequestClose={noop} title="Rename collection" role="dialog">
            <p style={{ margin: 0 }}>Weeknight dinners is shared with 2 people.</p>
            <Button variant="primary" icon="check">
                Save name
            </Button>
            <Button variant="ghost">Cancel</Button>
        </DialogFrame>
    ),
});
