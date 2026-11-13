import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';

import { GLYPH_CORNER, GLYPH_CORNER_PERCENT } from '../props.js';
import { CheckBoxGlyph } from '../CheckBoxGlyph.js';

/**
 * The web `CheckBoxGlyph` (build spec §6.3, §1.9): the drawn box of a whole-row checkbox. Decorative — the row carries
 * the role and the name — so it is hidden from assistive technology. Unchecked it is a `lineControl` outline (a 3:1
 * graphic under SC 1.4.11); checked it fills with `action` and its check carries the signature motion, a 120 ms scale
 * from 0.9 with an overshoot, which a reduced-motion preference turns off.
 *
 * REWRITTEN for the box that grows with its row's text: the box sits in a slot one line of its text role tall, so it
 * is centred on the row's FIRST line, and its sizes are `rem` so browser text size moves box and text together. jsdom
 * resolves no `rem`, so these pin the declared sizes; the 1x pixel size is measured by `recipeHomeResponsive.spec.ts`.
 */

afterEach(cleanup);

/** The drawn box: the one element hidden from assistive technology. */
const boxIn = (container: HTMLElement): HTMLElement => {
    const box = container.querySelector<HTMLElement>('[aria-hidden="true"]');

    if (box === null) {
        throw new Error('The glyph draws no box.');
    }

    return box;
};

/** The slot the box is centred in: the glyph's outer element. */
const slotIn = (container: HTMLElement): HTMLElement => container.firstElementChild as HTMLElement;

describe('CheckBoxGlyph (web)', () => {
    it('is hidden from assistive technology', () => {
        const { container } = render(<CheckBoxGlyph checked={false} />);

        expect(boxIn(container).getAttribute('aria-hidden')).toBe('true');
        expect(slotIn(container).textContent).toBe('');
    });

    it('unchecked: an outline with no fill and no visible check', () => {
        const { container } = render(<CheckBoxGlyph checked={false} />);
        const box = boxIn(container);

        expect(box.className).toContain('border-line-control');
        // C6 (redesign): a thin outline, 1 px, not the 2 px frame it was.
        expect(box.className).not.toContain('border-2');
        expect(box.className).toMatch(/(^|\s)border(\s|$)/u);
        expect(box.className).not.toContain('bg-action');
        expect(container.querySelector('[data-check]')?.className).toContain('scale-90');
        expect(container.querySelector('[data-check]')?.className).toContain('opacity-0');
    });

    // Owner C5/T1: the visual box is 18 px with a 4 px corner (a rounded square; the larger radius reads as a radio). The
    // glyph is smaller than the 44 px touch target, which belongs to the row.
    it('is an 18 px box with a 4 px corner beside body text, stated in rem', () => {
        const { container } = render(<CheckBoxGlyph checked={false} />);
        const box = boxIn(container);

        expect(box.style.width).toBe('1.125rem');
        expect(box.style.height).toBe('1.125rem');
        // The corner is 4/18 of the side, as a percentage, so it stays 4 px at 18 and grows in proportion.
        expect(box.style.borderRadius).toBe(GLYPH_CORNER_PERCENT);
        expect(GLYPH_CORNER_PERCENT).toBe(`${String((4 / 18) * 100)}%`);
        expect(GLYPH_CORNER).toBe(4);
        expect(box.className).not.toMatch(/size-|rounded-/u);
    });

    it('keeps the 18 px box beside the smaller roles a caller passes', () => {
        for (const textRole of ['meta', 'readingBody'] as const) {
            const { container, unmount } = render(<CheckBoxGlyph checked={false} textRole={textRole} />);

            expect(boxIn(container).style.width, textRole).toBe('1.125rem');
            unmount();
        }
    });

    it('grows to 22 px with a corner in proportion beside a 28 px role', () => {
        const { container } = render(<CheckBoxGlyph checked={false} textRole="largeTitle" />);
        const box = boxIn(container);

        expect(box.style.width).toBe('1.375rem');
        expect(box.style.height).toBe('1.375rem');
        expect(box.style.borderRadius).toBe(GLYPH_CORNER_PERCENT);
    });

    // The percentage corner is a circle arc only while the box is square: CSS reads a percentage radius from the width
    // on one axis and the height on the other. Both sides come from one `rem` value, so they stay equal at every text
    // size; this pins that for each box size.
    it('stays square, so its percentage corner stays round', () => {
        for (const textRole of ['body', 'largeTitle'] as const) {
            const { container, unmount } = render(<CheckBoxGlyph checked={false} textRole={textRole} />);
            const box = boxIn(container);

            expect(box.style.width, textRole).toBe(box.style.height);
            expect(box.style.width, textRole).not.toBe('');
            unmount();
        }
    });

    it('is centred in a slot one line of its text role tall, so it sits on the first line of a wrapped row', () => {
        const { container, rerender } = render(<CheckBoxGlyph checked={false} />);

        // body: a 24 px line.
        expect(slotIn(container).style.height).toBe('1.5rem');
        expect(slotIn(container).className).toEqual(expect.stringContaining('items-center'));
        expect(slotIn(container).className).toEqual(expect.stringContaining('shrink-0'));

        // largeTitle: a 32 px line.
        rerender(<CheckBoxGlyph checked={false} textRole="largeTitle" />);
        expect(slotIn(container).style.height).toBe('2rem');
    });

    it('checked: the action fill and the check at full scale, drawn to fill its share of the box', () => {
        const { container } = render(<CheckBoxGlyph checked />);
        const box = boxIn(container);
        const check = container.querySelector<HTMLElement>('[data-check]');

        expect(box.className).toContain('bg-action');
        expect(check?.className).toContain('scale-100');
        expect(container.querySelector('svg')).not.toBeNull();
        // The check is 16/18 of the box at every size, so it grows with it.
        expect(check?.style.width).toBe(`${String(16 / 16)}rem`);
        expect(check?.className).toContain('[&>svg]:size-full');
    });

    it('the check moves with an overshoot over 120 ms, and not at all under reduced motion', () => {
        const { container } = render(<CheckBoxGlyph checked />);
        const check = container.querySelector('[data-check]')?.className ?? '';

        expect(check).toContain('duration-[120ms]');
        expect(check).toContain('ease-[cubic-bezier(0.34,1.56,0.64,1)]');
        expect(check).toContain('motion-reduce:transition-none');
    });
});
