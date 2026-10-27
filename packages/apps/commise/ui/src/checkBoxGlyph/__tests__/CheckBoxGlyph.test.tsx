import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';

import { CheckBoxGlyph } from '../CheckBoxGlyph.js';

/**
 * The web `CheckBoxGlyph` (build spec §6.3, §1.9): the drawn box of a whole-row checkbox. Decorative — the row carries
 * the role and the name — so it is hidden from assistive technology. Unchecked it is a `lineControl` outline (a 3:1
 * graphic under SC 1.4.11); checked it fills with `action` and its check carries the signature motion, a 120 ms scale
 * from 0.9 with an overshoot, which a reduced-motion preference turns off.
 */

afterEach(cleanup);

describe('CheckBoxGlyph (web)', () => {
    it('is hidden from assistive technology', () => {
        const { container } = render(<CheckBoxGlyph checked={false} />);

        expect(container.firstElementChild?.getAttribute('aria-hidden')).toBe('true');
    });

    it('unchecked: an outline with no fill and no visible check', () => {
        const { container } = render(<CheckBoxGlyph checked={false} />);
        const box = container.firstElementChild;

        expect(box?.className).toContain('border-line-control');
        // C6 (redesign): a thin outline, 1 px, not the 2 px frame it was.
        expect(box?.className).not.toContain('border-2');
        expect(box?.className).toMatch(/(^|\s)border(\s|$)/u);
        expect(box?.className).not.toContain('bg-action');
        expect(container.querySelector('[data-check]')?.className).toContain('scale-90');
        expect(container.querySelector('[data-check]')?.className).toContain('opacity-0');
    });

    // Owner C5/T1: the visual box is 18 px with a 4 px corner (a rounded square; the larger radius reads as a radio). The
    // glyph is smaller than the 44 px touch target, which belongs to the row.
    it('is an 18 px box with a 4 px corner', () => {
        const { container } = render(<CheckBoxGlyph checked={false} />);
        const box = container.firstElementChild;

        expect(box?.className).toContain('size-[18px]');
        expect(box?.className).toContain('rounded-[4px]');
        expect(box?.className).not.toMatch(/size-6|rounded-sm/u);
    });

    it('checked: the action fill and the check at full scale', () => {
        const { container } = render(<CheckBoxGlyph checked />);
        const box = container.firstElementChild;

        expect(box?.className).toContain('bg-action');
        expect(container.querySelector('[data-check]')?.className).toContain('scale-100');
        expect(container.querySelector('svg')).not.toBeNull();
    });

    it('the check moves with an overshoot over 120 ms, and not at all under reduced motion', () => {
        const { container } = render(<CheckBoxGlyph checked />);
        const check = container.querySelector('[data-check]')?.className ?? '';

        expect(check).toContain('duration-[120ms]');
        expect(check).toContain('ease-[cubic-bezier(0.34,1.56,0.64,1)]');
        expect(check).toContain('motion-reduce:transition-none');
    });
});
