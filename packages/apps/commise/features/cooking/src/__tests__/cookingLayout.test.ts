import { describe, expect, it } from 'vitest';

import {
    COOKING_COLUMN,
    INGREDIENTS_COLUMN,
    isTwoColumn,
    NARROW_ROW,
    NOTICE_COLUMN,
    PREVIEW_IN_BODY,
    SHORT_SCREEN,
    TWO_COLUMN,
} from '../cookingLayout.js';

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

    it('writes the ingredients column at 300, its class holding the number, narrower than the step column', () => {
        expect(INGREDIENTS_COLUMN).toEqual({ px: 300, webClassName: 'w-[300px]' });
        expect(INGREDIENTS_COLUMN.webClassName).toContain(String(INGREDIENTS_COLUMN.px));
        expect(INGREDIENTS_COLUMN.px).toBeLessThan(COOKING_COLUMN.maxPx);
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
        // Ingredients: wide, after the place (the order class); narrow, at the end of its row (the auto start margin).
        expect(NARROW_ROW.ingredientsWebClassName).toBe('@min-[22.5rem]:order-1 @max-[22.5rem]:ms-auto');
        expect(NARROW_ROW.ingredientsWebClassName).toContain(`${String(NARROW_ROW.maxRem)}rem`);
    });

    it('truncates the Next preview to one line under a container height of 43.75 rem, the class holding the number', () => {
        expect(SHORT_SCREEN.maxHeightPx).toBe(700);
        expect(SHORT_SCREEN.maxHeightRem).toBe(43.75);
        // A rem is 16 px at 100% text, so the two numbers are one height; at 200% text the rule fires at 1,400 px.
        expect(SHORT_SCREEN.maxHeightRem * 16).toBe(SHORT_SCREEN.maxHeightPx);
        expect(SHORT_SCREEN.previewWebClassName).toBe('[@container(height<43.75rem)]:line-clamp-1');
        expect(SHORT_SCREEN.previewWebClassName).toContain(`<${String(SHORT_SCREEN.maxHeightRem)}rem`);
    });

    it('moves the Next preview into the scrolling step under 40 rem tall, a container height in rem for web and text units for native', () => {
        expect(PREVIEW_IN_BODY.maxHeightRem).toBe(40);
        expect(PREVIEW_IN_BODY.maxHeightPx).toBe(640);
        // A rem is 16 px at 100% text, so the two numbers are one height; at 200% text the web rule fires at 1,280 px.
        expect(PREVIEW_IN_BODY.maxHeightRem * 16).toBe(PREVIEW_IN_BODY.maxHeightPx);
        expect(PREVIEW_IN_BODY.footWebClassName).toBe('[@container(height<40rem)]:hidden');
        expect(PREVIEW_IN_BODY.bodyWebClassName).toBe('hidden [@container(height<40rem)]:flex');
        expect(PREVIEW_IN_BODY.footWebClassName).toContain(`<${String(PREVIEW_IN_BODY.maxHeightRem)}rem`);
        expect(PREVIEW_IN_BODY.bodyWebClassName).toContain(`<${String(PREVIEW_IN_BODY.maxHeightRem)}rem`);
    });

    it('shows the two columns from 800 px for native and 50 em for web, the same width at 100% text', () => {
        expect(TWO_COLUMN).toEqual({ minPx: 800, minEm: 50, webQuery: '(min-width: 50em)' });
        // An em is 16 px at 100% text, so the two numbers are one width; at 200% text the web rule fires at 1,600 px.
        expect(TWO_COLUMN.minEm * 16).toBe(TWO_COLUMN.minPx);
        expect(TWO_COLUMN.webQuery).toContain(`${String(TWO_COLUMN.minEm)}em`);
    });

    it('is two columns at 800 and wider, and one column at 799', () => {
        expect(isTwoColumn(799)).toBe(false);
        expect(isTwoColumn(800)).toBe(true);
        expect(isTwoColumn(1280)).toBe(true);
    });

    it('keeps the centred column wider than the notice column', () => {
        expect(COOKING_COLUMN.maxPx).toBeGreaterThan(NOTICE_COLUMN.maxPx);
    });
});
