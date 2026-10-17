/**
 * @module CheckBoxGlyph.card — the design-system card of CheckBoxGlyph: unchecked and checked, each beside a list
 * line, on both platforms.
 */
import { defineCard } from '../../../../src/cards/defineCard.js';

const LINES = [
    { checked: false, text: '2 cups arborio rice' },
    { checked: true, text: '1 yellow onion, diced' },
    { checked: false, text: 'Fresh thyme' },
] as const;

export default defineCard({
    group: 'Selection',
    height: 220,
    platforms: 'both',
    uses: ['CheckBoxGlyph'],
    render: ({ CheckBoxGlyph }) => (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 320 }}>
            {LINES.map(({ checked, text }) => (
                <div
                    key={text}
                    style={{
                        display: 'flex',
                        gap: 12,
                        alignItems: 'center',
                        background: 'var(--paper)',
                        padding: 12,
                        borderRadius: 12,
                    }}
                >
                    <CheckBoxGlyph checked={checked} />
                    <span style={{ textDecoration: checked ? 'line-through' : 'none' }}>{text}</span>
                </div>
            ))}
        </div>
    ),
});
