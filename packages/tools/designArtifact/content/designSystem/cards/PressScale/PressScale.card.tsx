/**
 * @module PressScale.card — the design-system card of the PressScale: a pressable, a disabled one, and one that
 * fills its row. PressScale draws nothing, so each wraps a face: a button on the web, a plain box on native.
 */
import type { CSSProperties, ReactNode } from 'react';

import { defineCard } from '../../../../src/cards/defineCard.js';

const noop = (): void => undefined;
const faceStyle: CSSProperties = {
    font: '600 14px Inter, system-ui',
    padding: '12px 20px',
    borderRadius: 9999,
    border: '1px solid var(--line-control)',
    background: 'var(--paper)',
    color: 'var(--ink)',
    textAlign: 'center',
};

export default defineCard({
    group: 'Actions',
    height: 250,
    platforms: 'both',
    uses: ['PressScale'],
    render: ({ PressScale }, { platform, stack }) => {
        const face = (text: string, extra?: CSSProperties): ReactNode =>
            platform === 'web' ? (
                <button type="button" style={{ ...faceStyle, ...extra }}>
                    {text}
                </button>
            ) : (
                <div style={{ ...faceStyle, ...extra }}>{text}</div>
            );

        return (
            <div className="col">
                <div className={stack}>
                    <PressScale onPress={noop} accessibilityLabel="Add to meal plan">
                        {face('Add to meal plan')}
                    </PressScale>
                    <PressScale disabled accessibilityLabel="Cooked it">
                        {face('Cooked it (disabled)', { opacity: 0.5 })}
                    </PressScale>
                </div>
                <PressScale width="fill" onPress={noop} accessibilityLabel="Save to Sunday dinners">
                    {face('Save to Sunday dinners', { width: '100%', boxSizing: 'border-box' })}
                </PressScale>
            </div>
        );
    },
});
