/**
 * @module Button.card — the design-system card of the Button: one of each tier, plus the busy state, on both
 * platforms, and the secondary's steel glyph (`glyphTone="action"`) at rest, disabled and busy beside the default
 * secondary. The web column lays them in a row, the native column in a stack (`context.stack`).
 */
import { defineCard } from '../../../../src/cards/defineCard.js';

export default defineCard({
    group: 'Actions',
    height: 580,
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
            <Button variant="secondary" icon="chevronRight">
                Next step
            </Button>
            <Button variant="secondary" icon="chevronRight" glyphTone="action">
                Next step
            </Button>
            <Button variant="secondary" icon="chevronRight" glyphTone="action" disabled>
                Next step
            </Button>
            <Button variant="secondary" icon="chevronRight" glyphTone="action" busy>
                Next step
            </Button>
        </div>
    ),
});
