/**
 * @module ConfirmDialog.card — the design-system card of the ConfirmDialog: an open destructive confirmation with
 * its inline error, on both platforms. Each column's overlay lands in its own framed stage.
 */
import { defineCard } from '../../../../src/cards/defineCard.js';

const noop = (): void => undefined;

export default defineCard({
    group: 'Overlays',
    height: 470,
    platforms: 'both',
    staging: { portalIntoColumn: { frameHeight: 400 } },
    uses: ['ConfirmDialog'],
    render: ({ ConfirmDialog }) => (
        <ConfirmDialog
            open
            title="Delete this recipe?"
            body="Grandma's lasagna and its 3 versions will be removed. This cannot be undone."
            confirm={{ label: 'Delete recipe', icon: 'trash' }}
            keep={{ label: 'Keep recipe' }}
            onConfirm={noop}
            onKeep={noop}
            error="Could not delete. Try again."
        />
    ),
});
