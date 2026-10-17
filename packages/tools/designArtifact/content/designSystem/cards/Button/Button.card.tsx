/**
 * @module Button.card — the design-system card of the Button: one of each tier, plus the busy state, on both
 * platforms. The web column lays them in a row, the native column in a stack (`context.stack`).
 */
import { defineCard } from '../../../../src/cards/defineCard.js';

export default defineCard({
    group: 'Actions',
    height: 340,
    platforms: 'both',
    uses: ['Button'],
    render: ({ Button }, { stack }) => (
        <div className={stack}>
            <Button variant="primary" size="lg" icon="plus">
                Save recipe
            </Button>
            <Button variant="secondary" icon="plus">
                Add to collection
            </Button>
            <Button variant="ghost">Skip for now</Button>
            <Button variant="destructive" icon="trash">
                Delete recipe
            </Button>
            <Button variant="primary" busy icon="plus">
                Saving
            </Button>
        </div>
    ),
});
