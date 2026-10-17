/**
 * @module EnterTransition.card — the design-system card of the EnterTransition: three list items entering with a
 * 120 ms stagger, on both platforms.
 */
import { defineCard } from '../../../../src/cards/defineCard.js';

const items = ['Chopped onions', 'Minced garlic', 'Crushed tomatoes'];

const card = {
    background: 'var(--paper)',
    border: '1px solid var(--line)',
    borderRadius: 12,
    padding: 12,
} as const;

export default defineCard({
    group: 'Layout',
    height: 230,
    platforms: 'both',
    uses: ['EnterTransition'],
    render: ({ EnterTransition }) => (
        <div style={{ display: 'grid', gap: 8 }}>
            {items.map((text, index) => (
                <EnterTransition key={text} delayMs={index * 120}>
                    <div style={card}>{text}</div>
                </EnterTransition>
            ))}
        </div>
    ),
});
