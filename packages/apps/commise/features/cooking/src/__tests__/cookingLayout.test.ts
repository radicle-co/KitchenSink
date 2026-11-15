import { describe, expect, it } from 'vitest';

import { COOKING_COLUMN, NARROW_ROW, NOTICE_COLUMN, SHORT_SCREEN } from '../cookingLayout.js';

/**
 * Tailwind builds only class text it can find in a scanned file, so each width is written once WITH its complete class
 * literal. Each literal must contain its number, or the class and the number drift apart.
 */
describe('the cooking surface widths', () => {
    it('writes the centred column at 680 and the notice column at 480, each class holding its number', () => {
        expect(COOKING_COLUMN).toEqual({ maxPx: 680, webClassName: 'max-w-[680px]' });
        expect(NOTICE_COLUMN).toEqual({ maxPx: 480, webClassName: 'max-w-[480px]' });
        expect(COOKING_COLUMN.webClassName).toContain(String(COOKING_COLUMN.maxPx));
        expect(NOTICE_COLUMN.webClassName).toContain(String(NOTICE_COLUMN.maxPx));
    });

    it('writes the narrow row under 360 px for native and 22.5 rem for web, the same width at 100% text', () => {
        expect(NARROW_ROW.maxPx).toBe(360);
        expect(NARROW_ROW.maxRem).toBe(22.5);
        // A rem is 16 px at 100% text, so the two numbers are one width; at 200% text the web rule fires at 720 px.
        expect(NARROW_ROW.maxRem * 16).toBe(NARROW_ROW.maxPx);
        expect(NARROW_ROW.placeWebClassName).toBe('@max-[22.5rem]:basis-full');
        expect(NARROW_ROW.navWebClassName).toBe('@max-[22.5rem]:[&_svg]:hidden');
        expect(NARROW_ROW.placeWebClassName).toContain(`${String(NARROW_ROW.maxRem)}rem`);
        expect(NARROW_ROW.navWebClassName).toContain(`${String(NARROW_ROW.maxRem)}rem`);
    });

    it('truncates the Next preview to one line under a container height of 43.75 rem, the class holding the number', () => {
        expect(SHORT_SCREEN.maxHeightPx).toBe(700);
        expect(SHORT_SCREEN.maxHeightRem).toBe(43.75);
        // A rem is 16 px at 100% text, so the two numbers are one height; at 200% text the rule fires at 1,400 px.
        expect(SHORT_SCREEN.maxHeightRem * 16).toBe(SHORT_SCREEN.maxHeightPx);
        expect(SHORT_SCREEN.previewWebClassName).toBe('[@container(height<43.75rem)]:line-clamp-1');
        expect(SHORT_SCREEN.previewWebClassName).toContain(`<${String(SHORT_SCREEN.maxHeightRem)}rem`);
    });

    it('keeps the centred column wider than the notice column', () => {
        expect(COOKING_COLUMN.maxPx).toBeGreaterThan(NOTICE_COLUMN.maxPx);
    });
});
