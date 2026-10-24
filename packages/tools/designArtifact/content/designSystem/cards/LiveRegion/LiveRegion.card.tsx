/**
 * @module LiveRegion.card — the design-system card of LiveRegion: polite and assertive announcements shown on the
 * page, and a visually hidden one captioned with what it speaks, on both platforms.
 */
import { defineCard } from '../../../../src/cards/defineCard.js';

const CARD = {
    background: 'var(--paper)',
    border: '1px solid var(--line)',
    borderRadius: 12,
    padding: 12,
} as const;

const MUTED = { margin: 0, fontSize: 13, color: 'var(--ink-muted)' } as const;

export default defineCard({
    group: 'Feedback',
    height: 330,
    platforms: 'both',
    uses: ['LiveRegion'],
    render: ({ LiveRegion }, { platform }) => {
        const nativeText = platform === 'native' ? { style: { color: 'var(--ink)', fontSize: 16 } } : {};

        return (
            <div style={{ display: 'grid', gap: 12 }}>
                <div style={CARD}>
                    <div style={MUTED}>Polite, visible</div>
                    <LiveRegion politeness="polite" occurrence={1} {...nativeText}>
                        Added 2 cups flour to your list.
                    </LiveRegion>
                </div>
                <div style={CARD}>
                    <div style={MUTED}>Assertive, visible</div>
                    <LiveRegion politeness="assertive" {...nativeText}>
                        We couldn’t save the recipe.
                    </LiveRegion>
                </div>
                <div style={CARD}>
                    <div style={MUTED}>Visually hidden: spoken "Servings: 4", shown here as a caption</div>
                    <b>4</b>
                    <LiveRegion politeness="polite" visuallyHidden>
                        Servings: 4
                    </LiveRegion>
                </div>
            </div>
        );
    },
});
