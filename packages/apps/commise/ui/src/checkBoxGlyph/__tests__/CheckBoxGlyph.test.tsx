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
        expect(box?.className).not.toContain('bg-action');
        expect(container.querySelector('[data-check]')?.className).toContain('scale-90');
        expect(container.querySelector('[data-check]')?.className).toContain('opacity-0');
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
