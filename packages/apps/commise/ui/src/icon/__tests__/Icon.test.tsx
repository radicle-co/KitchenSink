import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { Icon } from '../Icon.js';

/**
 * Icon (web) — the Adapter over `lucide-react`. A screen names a meaning; this leaf draws the Registry's glyph for it,
 * decorative unless the caller gives it a label, in a colour taken from a role.
 */

afterEach(cleanup);

/** The one `<svg>` the leaf rendered. */
function svgOf(container: HTMLElement): SVGSVGElement {
    const svg = container.querySelector('svg');

    if (svg === null) {
        throw new Error('Icon rendered no <svg>.');
    }

    return svg;
}

describe('Icon (web)', () => {
    it('draws the glyph the Registry holds for the meaning', () => {
        const { container } = render(<Icon name="house" />);

        expect(svgOf(container).classList.contains('lucide-house')).toBe(true);
    });

    it('is decorative by default: hidden from assistive tech and not focusable', () => {
        const { container } = render(<Icon name="search" />);

        expect(svgOf(container).getAttribute('aria-hidden')).toBe('true');
        expect(svgOf(container).getAttribute('focusable')).toBe('false');
        expect(screen.queryByRole('img')).toBeNull();
    });

    it('is an image named by its label when the caller gives one', () => {
        const { container } = render(<Icon name="lock" label="Private" />);

        expect(screen.getByRole('img', { name: 'Private' })).toBe(svgOf(container));
        expect(svgOf(container).hasAttribute('aria-hidden')).toBe(false);
    });

    it('draws at 24 px by default and at 20 px inline', () => {
        const { container, rerender } = render(<Icon name="clock" />);

        expect(svgOf(container).getAttribute('width')).toBe('24');

        rerender(<Icon name="clock" size={20} />);

        expect(svgOf(container).getAttribute('width')).toBe('20');
        expect(svgOf(container).getAttribute('height')).toBe('20');
    });

    it('draws at 48 px as an empty-state glyph (spec §8, "a 48 px clock glyph")', () => {
        const { container } = render(<Icon name="clock" size={48} />);

        expect(svgOf(container).getAttribute('width')).toBe('48');
    });

    it('inherits the colour of its text when no tone is given', () => {
        const { container } = render(<Icon name="check" />);

        expect(svgOf(container).style.color).toBe('');
        expect(svgOf(container).getAttribute('stroke')).toBe('currentColor');
    });

    it('takes its colour from the role named by tone, through the emitted custom property', () => {
        const { container } = render(<Icon name="check" tone="inkMuted" />);

        expect(svgOf(container).style.color).toBe('var(--color-ink-muted)');
    });

    it('is outlined unless filled, and a filled glyph fills with its own colour', () => {
        const { container, rerender } = render(<Icon name="house" />);

        expect(svgOf(container).getAttribute('fill')).toBe('none');

        rerender(<Icon name="house" filled />);

        expect(svgOf(container).getAttribute('fill')).toBe('currentColor');
    });

    it('mirrors a directional glyph in right-to-left and leaves every other glyph alone', () => {
        const { container, rerender } = render(<Icon name="chevronLeft" />);

        expect(svgOf(container).classList.contains('rtl:-scale-x-100')).toBe(true);

        rerender(<Icon name="timer" />);

        expect(svgOf(container).classList.contains('rtl:-scale-x-100')).toBe(false);
    });
});
