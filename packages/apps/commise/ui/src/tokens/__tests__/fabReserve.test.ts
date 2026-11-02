/**
 * The room a page leaves under the floating "new" button reaches the web as ONE custom property, `--fab-reserved-bottom`,
 * computed from the button's own constants: its height, the margin it rests at, and 16 (designer ruling 2026-11-01,
 * `nativeBoards/designAnswers.md`). Native pads by the same `FAB_RESERVED_BOTTOM_PX`. The web had drifted to a `6.5rem`
 * literal (104 px) while its comments said 88; `<main>`'s foot, the document's `scroll-padding-bottom` and "Back to top"
 * now read the property, and the button's own resting margin is `--fab-bottom-margin`.
 */
import { describe, expect, it } from 'vitest';

import { FAB_BOTTOM_MARGIN_PX, FAB_FLOATS_FROM_HEIGHT_PX, FAB_HEIGHT_PX } from '../../createFab/createFabPolicy.js';
import { spacing } from '../scale.js';
import { themeCss } from '../themeCss.js';

/** The px a `--name: Nrem;` declaration in the theme holds, or `undefined` when the theme does not declare it. */
function declaredPx(name: string): number | undefined {
    const declared = new RegExp(`${name}: ([\\d.]+)rem;`, 'u').exec(themeCss());

    return declared === null ? undefined : Number(declared[1]) * 16;
}

describe('--fab-bottom-margin', () => {
    it('is the margin the floating button rests at above the bottom chrome', () => {
        expect(declaredPx('--fab-bottom-margin')).toBe(FAB_BOTTOM_MARGIN_PX);
    });
});

describe('--fab-reserved-bottom', () => {
    it('is the button’s height, its margin and 16, computed from the constants', () => {
        expect(declaredPx('--fab-reserved-bottom')).toBe(FAB_HEIGHT_PX + FAB_BOTTOM_MARGIN_PX + spacing[4]);
        expect(declaredPx('--fab-reserved-bottom')).toBe(88);
    });

    // The button stands on `--bottom-chrome`, the tab bar's height WITH the bottom safe area, so every use adds the
    // reserve to a value that already holds the inset. Adding it here too would count it twice.
    it('carries no safe-area inset of its own', () => {
        expect(themeCss()).not.toMatch(/--fab-[\w-]+:[^;]*env\(/u);
    });
});

// Web only: below FAB_FLOATS_FROM_HEIGHT_PX of viewport height the button sits in the page header, so nothing is left to
// reserve under it. The threshold is generated from the one constant into BOTH the variant the button's classes use and
// the media rule that zeroes the reserve, so the two cannot disagree.
describe('the short-viewport rule', () => {
    const floatsFrom = `${String(FAB_FLOATS_FROM_HEIGHT_PX)}px`;
    const css = themeCss().replace(/\s+/gu, ' ');

    it('names the `fab-floats` variant for viewports at least that tall', () => {
        expect(css).toContain(`@custom-variant fab-floats (@media (height >= ${floatsFrom}));`);
    });

    it('drops the reserved room to nothing below that height, so main’s foot and the scroll padding follow', () => {
        expect(css).toContain(`@media (height < ${floatsFrom}) { :root { --fab-reserved-bottom: 0px; } }`);
    });

    it('spells the threshold only from the constant: every height query in the theme is that number', () => {
        const heights = [...css.matchAll(/\(height [<>]=? ([\d.]+\w+)\)/gu)].map((match) => match[1]);

        expect(heights.length).toBeGreaterThan(0);
        expect(new Set(heights)).toEqual(new Set([floatsFrom]));
    });
});
