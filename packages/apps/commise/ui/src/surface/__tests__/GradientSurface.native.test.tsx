/**
 * Native component test for the {@link GradientSurface} brand primitive. Under Vitest, `react-native` is
 * `react-native-web` and `expo-linear-gradient` is a stub (real gradient rendering is emulator-only). The
 * stub marks itself `[data-commise-stub="linear-gradient"]` and forwards the projected colours, so we can
 * assert the native gradient path is taken with the single-sourced colours, and that content renders.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { gradient, heroDark, toNativeGradient } from '../../tokens/gradients.js';

/** The system colour scheme the next render sees. */
const scheme = vi.hoisted(() => ({ current: null as 'light' | 'dark' | null }));

vi.mock('react-native', async (importOriginal) => ({
    ...(await importOriginal<typeof import('react-native')>()),
    useColorScheme: () => scheme.current,
}));
import { GradientSurface } from '../GradientSurface.native.js';

describe('GradientSurface (native)', () => {
    it('renders its children over the gradient', () => {
        render(<GradientSurface>hero content</GradientSurface>);

        expect(screen.getByText('hero content')).toBeDefined();
    });

    it('paints via expo-linear-gradient with the hero gradient colours by default', () => {
        const { container } = render(<GradientSurface>x</GradientSurface>);
        const node = container.querySelector('[data-commise-stub="linear-gradient"]');

        expect(node).not.toBeNull();
        expect(node?.getAttribute('data-colors')).toBe(toNativeGradient(gradient.hero).colors.join('|'));
    });

    it('paints the DARK hero wash when the system is dark (D15)', () => {
        scheme.current = 'dark';
        const { container } = render(<GradientSurface>x</GradientSurface>);

        expect(container.querySelector('[data-commise-stub="linear-gradient"]')?.getAttribute('data-colors')).toBe(
            toNativeGradient(heroDark).colors.join('|'),
        );
        scheme.current = null;
    });

    it('paints the brand gradient colours when requested', () => {
        const { container } = render(<GradientSurface gradient="brand">x</GradientSurface>);
        const node = container.querySelector('[data-commise-stub="linear-gradient"]');

        expect(node?.getAttribute('data-colors')).toBe(toNativeGradient(gradient.brand).colors.join('|'));
    });
});
