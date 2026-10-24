/**
 * @module HorizontalScroller.card — the design-system card of the HorizontalScroller: a row of chips that overflows (the
 * chevron shows while it rests at its start), a row that fits (no hint), and a named region of snapping cards, each in a
 * 280 px box, on both platforms.
 */
import { defineCard } from '../../../../src/cards/defineCard.js';

const noop = (): void => undefined;

const CUISINES = ['Italian', 'Thai', 'Mexican', 'Japanese', 'Indian', 'Greek', 'Vietnamese'];

const CARDS = ['Weeknight ragu', 'Green curry', 'Birria tacos', 'Miso ramen'];

/** The 280 px box each scroller sits in, so its content is wider than it. */
const BOX = { width: 280 } as const;

const LABEL = { font: '600 12px Inter,system-ui', color: 'var(--ink-muted)', margin: '0 0 6px' } as const;

export default defineCard({
    group: 'Layout',
    height: 420,
    platforms: 'both',
    uses: ['HorizontalScroller', 'Chip'],
    render: ({ HorizontalScroller, Chip }) => (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <div style={BOX}>
                <p style={LABEL}>Overflows, at its start</p>
                <HorizontalScroller snap={{ kind: 'item' }}>
                    <div style={{ display: 'flex', gap: 8, paddingInlineEnd: 16 }}>
                        {CUISINES.map((cuisine) => (
                            <Chip key={cuisine} kind="filter" label={cuisine} selected={false} onPress={noop} />
                        ))}
                    </div>
                </HorizontalScroller>
            </div>
            <div style={BOX}>
                <p style={LABEL}>Fits, so nothing shows</p>
                <HorizontalScroller>
                    <div style={{ display: 'flex', gap: 8 }}>
                        {CUISINES.slice(0, 2).map((cuisine) => (
                            <Chip key={cuisine} kind="filter" label={cuisine} selected={false} onPress={noop} />
                        ))}
                    </div>
                </HorizontalScroller>
            </div>
            <div style={BOX}>
                <p style={LABEL}>Named region of cards, snapping</p>
                <HorizontalScroller regionLabel="Trending recipes" snap={{ kind: 'card', interval: 188 }}>
                    <ul role="list" style={{ display: 'flex', gap: 16, margin: 0, padding: 0, listStyle: 'none' }}>
                        {CARDS.map((title) => (
                            <li
                                key={title}
                                style={{
                                    flex: 'none',
                                    width: 172,
                                    height: 96,
                                    scrollSnapAlign: 'start',
                                    borderRadius: 12,
                                    padding: 12,
                                    background: 'var(--paper)',
                                    border: '1px solid var(--line-control)',
                                    font: '600 14px Inter,system-ui',
                                    color: 'var(--ink)',
                                }}
                            >
                                {title}
                            </li>
                        ))}
                    </ul>
                </HorizontalScroller>
            </div>
        </div>
    ),
});
