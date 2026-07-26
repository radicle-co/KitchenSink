/**
 * Web component test for the {@link GradientSurface} brand primitive. Proves it paints the requested
 * brand gradient (single-sourced via `gradientCss`), renders its content over the gradient, forwards
 * layout classes, and exposes an optional accessible label.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { gradient, gradientCss } from '../../tokens/gradients.js';
import { GradientSurface } from '../GradientSurface.js';

describe('GradientSurface (web)', () => {
    it('renders its children over the surface', () => {
        render(<GradientSurface>hero content</GradientSurface>);

        expect(screen.getByText('hero content')).toBeDefined();
    });

    it('paints the hero gradient by default', () => {
        const { container } = render(<GradientSurface>x</GradientSurface>);
        const surface = container.firstElementChild as HTMLElement;

        expect(surface.style.backgroundImage).toBe(gradientCss(gradient.hero));
    });

    it('paints the brand gradient when requested (the same seafoam→ocean-dark the CTA uses)', () => {
        const { container } = render(<GradientSurface gradient="brand">x</GradientSurface>);
        const surface = container.firstElementChild as HTMLElement;

        expect(surface.style.backgroundImage).toBe(gradientCss(gradient.brand));
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
