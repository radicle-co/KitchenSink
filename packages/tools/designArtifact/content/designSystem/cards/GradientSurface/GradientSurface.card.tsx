/**
 * @module GradientSurface.card — the design-system card of the GradientSurface: the default banner and the brand
 * gradient banner, on both platforms. The web surface takes layout only through `className` (and the page has no
 * utility classes for a card to name), so the web column rounds and pads around it; native takes a `style`.
 */
import type { ReactNode } from 'react';

import { defineCard } from '../../../../src/cards/defineCard.js';

function copy(title: string): ReactNode {
    return (
        <>
            <h2 style={{ margin: '0 0 4px', font: '700 24px/1.2 "Playfair Display",Georgia,serif' }}>{title}</h2>
            <p style={{ margin: 0 }}>Seasonal recipes for the week ahead.</p>
        </>
    );
}

export default defineCard({
    group: 'Layout',
    height: 320,
    platforms: 'both',
    uses: ['GradientSurface'],
    render: ({ GradientSurface }, { platform }) => {
        const native = { style: { paddingVertical: 32, paddingHorizontal: 24, borderRadius: 16, overflow: 'hidden' } };
        const web = (content: ReactNode): ReactNode => <div style={{ padding: '32px 24px' }}>{content}</div>;
        const isWeb = platform === 'web';

        return (
            <div className="col">
                <div style={isWeb ? { borderRadius: 16, overflow: 'hidden' } : undefined}>
                    <GradientSurface {...(isWeb ? {} : native)} accessibilityLabel="Welcome banner">
                        {isWeb ? web(copy('Cook something good')) : copy('Cook something good')}
                    </GradientSurface>
                </div>
                <div style={isWeb ? { borderRadius: 16, overflow: 'hidden' } : undefined}>
                    <GradientSurface {...(isWeb ? {} : native)} gradient="brand" accessibilityLabel="Brand banner">
                        <div style={{ color: '#fff' }}>
                            {isWeb ? web(copy('Dinner in thirty minutes')) : copy('Dinner in thirty minutes')}
                        </div>
                    </GradientSurface>
                </div>
            </div>
        );
    },
});
