/**
 * @module Surface.card — the design-system card of the Surface: five tones side by side, each holding a secondary
 * button and a filter chip, so the card shows the controls taking their press fill and chip fill from the surface.
 */
import { defineCard } from '../../../../src/cards/defineCard.js';

const noop = (): void => undefined;

const TONES = [
    ['canvas', 'Canvas'],
    ['paper', 'Paper'],
    ['paperRaised', 'Paper raised'],
    ['paperOverlay', 'Paper overlay'],
    ['muted', 'Muted'],
] as const;

export default defineCard({
    group: 'Layout',
    height: 520,
    platforms: 'both',
    uses: ['Surface', 'Button', 'Chip'],
    render: ({ Surface, Button, Chip }) => (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
            {TONES.map(([tone, name]) => (
                // The frame clips the fill to the card's corners: a Surface paints its own box and has no radius.
                <div
                    key={tone}
                    style={{ borderRadius: 18, border: '1px solid var(--line-divider)', overflow: 'hidden' }}
                >
                    <Surface tone={tone} aria-label={name}>
                        <div
                            style={{
                                display: 'flex',
                                flexDirection: 'column',
                                alignItems: 'flex-start',
                                gap: 12,
                                padding: 16,
                            }}
                        >
                            <span style={{ font: '500 14px/20px var(--font-body)' }}>{name}</span>
                            <Button variant="secondary" icon="plus">
                                Add
                            </Button>
                            <Chip kind="filter" label="Vegan" selected={false} onPress={noop} />
                        </div>
                    </Surface>
                </div>
            ))}
        </div>
    ),
});
