/**
 * The pinned bar's height reaches the web as ONE custom property, `--pinned-bar-height`, emitted from the same number
 * native lays its content out by (`PINNED_BAR_HEIGHT`). The web bar, the page's top padding and `scroll-padding-top` all
 * read the property, so there is no `3.5rem` literal to drift from the constant.
 */
import { describe, expect, it } from 'vitest';

import { PINNED_BAR_HEIGHT } from '../../largeTitleHeader/barGeometry.js';
import { themeCss } from '../themeCss.js';

describe('--pinned-bar-block', () => {
    it('is the bar as rendered: its height plus the notch’s inset, declared once for every web use to read', () => {
        expect(themeCss()).toContain('--pinned-bar-block: calc(var(--pinned-bar-height) + env(safe-area-inset-top));');
    });
});

describe('--pinned-bar-height', () => {
    it('is emitted into the theme, and in rem it is exactly PINNED_BAR_HEIGHT px', () => {
        const declared = /--pinned-bar-height: ([\d.]+)rem;/u.exec(themeCss());

        expect(declared, 'the theme declares --pinned-bar-height in rem').not.toBeNull();
        expect(Number(declared?.[1]) * 16).toBe(PINNED_BAR_HEIGHT);
    });
});
