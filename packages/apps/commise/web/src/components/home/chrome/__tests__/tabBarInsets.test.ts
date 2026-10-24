import { describe, expect, it } from 'vitest';

import { tabBarInsets } from '../tabBarInsets';

/** An element whose box is `rect`, standing in for the laid-out tab bar (jsdom lays nothing out). */
const barAt = (rect: Partial<DOMRect>): HTMLElement => {
    const bar = document.createElement('nav');
    bar.getBoundingClientRect = () => ({
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        width: 0,
        height: 0,
        toJSON: () => ({}),
        ...rect,
    });

    return bar;
};

describe('tabBarInsets', () => {
    it('reports no chrome when the shell has no tab bar (a focused task)', () => {
        expect(tabBarInsets(null)).toStrictEqual({ top: 0, bottom: 0 });
    });

    it('reports the bar’s own height as the strip along the foot', () => {
        expect(tabBarInsets(barAt({ top: 736, height: 64 }))).toStrictEqual({ top: 0, bottom: 64 });
    });

    it('counts the safe-area inset the bar grows by, because it measures the bar itself', () => {
        expect(tabBarInsets(barAt({ top: 702, height: 98 }))).toStrictEqual({ top: 0, bottom: 98 });
    });

    it('reports no chrome while the bar is hidden (the sidebar has taken over)', () => {
        expect(tabBarInsets(barAt({ top: 0, height: 0 }))).toStrictEqual({ top: 0, bottom: 0 });
    });
});
