/**
 * @module Sheet.card — the design-system card of the Sheet: an open content-sized sheet with a title, a list body
 * and a two-button footer, on both platforms. Each column's overlay lands in its own framed stage.
 */
import { defineCard } from '../../../../src/cards/defineCard.js';

const noop = (): void => undefined;

const row = { margin: 0, font: '16px Inter,system-ui', color: 'var(--ink)' } as const;

export default defineCard({
    group: 'Overlays',
    height: 520,
    platforms: 'both',
    staging: { portalIntoColumn: { frameHeight: 400 } },
    uses: ['Sheet', 'Button'],
    render: ({ Sheet, Button }) => (
        <Sheet
            open
            onOpenChange={noop}
            title="Add to collection"
            closeLabel="Close add to collection"
            size="content"
            footer={
                <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
                    <Button variant="secondary" icon="x">
                        Cancel
                    </Button>
                    <Button variant="primary" icon="plus">
                        Add recipe
                    </Button>
                </div>
            }
        >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <p style={row}>Sunday dinners</p>
                <p style={row}>Weeknight pasta</p>
                <p style={row}>Baking projects</p>
            </div>
        </Sheet>
    ),
});
