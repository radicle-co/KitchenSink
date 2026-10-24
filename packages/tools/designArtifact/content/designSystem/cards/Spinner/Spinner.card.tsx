/**
 * @module Spinner.card — the design-system card of the Spinner: always spinning in the text colour, spinning only
 * when motion is allowed, still, and inside a filled button. Web only.
 */
import { defineCard } from '../../../../src/cards/defineCard.js';

const caption = { display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 } as const;

export default defineCard({
    group: 'Feedback',
    height: 200,
    platforms: 'web',
    reason: 'native draws its in-flight state with the platform ActivityIndicator.',
    uses: ['Spinner'],
    render: ({ Spinner }) => (
        <div className="col">
            <div style={caption}>
                <span style={{ color: 'var(--ink)' }}>
                    <Spinner className="animate-spin" />
                </span>
                Always spinning, in the text colour: inside a button
            </div>
            <div style={caption}>
                <span style={{ color: 'var(--ink-muted)' }}>
                    <Spinner className="motion-safe:animate-spin" />
                </span>
                Spins only when motion is allowed: beside a caption
            </div>
            <div style={caption}>
                <span style={{ color: 'var(--action)' }}>
                    <Spinner className="" />
                </span>
                Still arc, the caller chose no spin
            </div>
            <div
                style={{
                    ...caption,
                    background: 'var(--action)',
                    color: 'var(--on-action)',
                    padding: '10px 16px',
                    borderRadius: 9999,
                    width: 'fit-content',
                }}
            >
                <Spinner className="animate-spin" />
                Saving
            </div>
        </div>
    ),
});
