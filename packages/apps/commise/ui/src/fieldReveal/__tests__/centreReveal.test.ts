/**
 * The target reveal's Specification (`docs/design/uiOverhaul/specSharedSystem.md` §16.3): where the scroller goes so a
 * field a refused Publish named sits in the middle of the visible area. `top` is the field's top in the visible area,
 * `offset` the scroll offset now, and `keep` the gap held when the field is too tall to centre.
 */
import { describe, expect, it } from 'vitest';

import { TARGET_GAP_DP, centreTarget } from '../centreReveal.js';

const VIEW = { viewport: 400, keep: 16 } as const;

describe('centreTarget', () => {
    it('centres a field that fits', () => {
        // The field is 48 tall at 300: its middle (324) goes to the middle of the area (200), so 124 further down.
        expect(centreTarget({ top: 300, height: 48, offset: 100, ...VIEW })).toBe(100 + 124);
    });

    it('scrolls up to centre a field above the middle', () => {
        expect(centreTarget({ top: 0, height: 48, offset: 500, ...VIEW })).toBe(500 + 24 - 200);
    });

    it('lands a field taller than the area its keep gap below the top', () => {
        expect(centreTarget({ top: 150, height: 390, offset: 100, ...VIEW })).toBe(100 + 150 - 16);
    });

    it('treats a field exactly as tall as the area less both gaps as fitting', () => {
        expect(centreTarget({ top: 100, height: 368, offset: 0, ...VIEW })).toBe(100 + 184 - 200);
    });

    it('never scrolls above the content start', () => {
        expect(centreTarget({ top: 0, height: 48, offset: 10, ...VIEW })).toBe(0);
    });

    it('answers null when nothing moves', () => {
        expect(centreTarget({ top: 176, height: 48, offset: 100, ...VIEW })).toBeNull();
        expect(centreTarget({ top: 0, height: 48, offset: 0, ...VIEW })).toBeNull();
    });

    it('answers null while the visible area is not laid out', () => {
        expect(centreTarget({ top: 300, height: 48, offset: 0, viewport: 0, keep: 16 })).toBeNull();
    });

    it('holds a 16 dp gap', () => {
        expect(TARGET_GAP_DP).toBe(16);
    });
});
