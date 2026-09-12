/**
 * Web component test for the {@link GradientSurface} brand primitive. Proves it paints the requested
 * brand gradient (single-sourced via `gradientCss`), renders its content over the gradient, forwards
 * layout classes, and exposes an optional accessible label.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { gradient, gradientCss } from '../../tokens/gradients.js';
import { GradientSurface } from '../GradientSurface.js';

/**
 * Compare a gradient by COLOUR, not by spelling.
 *
 * ⚠️ jsdom 30 canonicalises CSS colours through its CSSOM, so a `#31807A` written into `style` reads back
 * as `rgb(49, 128, 122)`. Both name the same colour and the component is writing the right one — asserting
 * the literal string was asserting jsdom's serialiser, which is why the jsdom 24 -> 30 bump broke these two
 * and nothing else.
 *
 * ⛔ Normalises BOTH sides rather than hard-coding the `rgb()` form. Pinning the new spelling would just
 * re-break on the next serialiser change, and would hide a component that had started emitting a genuinely
 * different colour in the same notation.
 */
const asColours = (css: string): string =>
    css.replace(/#([0-9a-f]{6})/giu, (_, hex: string) => {
        const [r, g, b] = [0, 2, 4].map((at) => Number.parseInt(hex.slice(at, at + 2), 16));

        return `rgb(${r}, ${g}, ${b})`;
    });

describe('GradientSurface (web)', () => {
    it('renders its children over the surface', () => {
        render(<GradientSurface>hero content</GradientSurface>);

        expect(screen.getByText('hero content')).toBeDefined();
    });

    it('paints the hero gradient by default', () => {
        const { container } = render(<GradientSurface>x</GradientSurface>);
        const surface = container.firstElementChild as HTMLElement;

        expect(asColours(surface.style.backgroundImage)).toBe(asColours(gradientCss(gradient.hero)));
    });

    it('paints the brand gradient when requested (the same seafoam→ocean-dark the CTA uses)', () => {
        const { container } = render(<GradientSurface gradient="brand">x</GradientSurface>);
        const surface = container.firstElementChild as HTMLElement;

        expect(asColours(surface.style.backgroundImage)).toBe(asColours(gradientCss(gradient.brand)));
    });

    it('forwards web layout classes', () => {
        const { container } = render(<GradientSurface className="rounded-b-xl p-6">x</GradientSurface>);
        const surface = container.firstElementChild as HTMLElement;

        expect(surface.className).toContain('rounded-b-xl');
        expect(surface.className).toContain('p-6');
    });

    it('exposes an accessible label when given one', () => {
        render(<GradientSurface accessibilityLabel="Welcome banner">x</GradientSurface>);

        expect(screen.getByLabelText('Welcome banner')).toBeDefined();
    });
});
