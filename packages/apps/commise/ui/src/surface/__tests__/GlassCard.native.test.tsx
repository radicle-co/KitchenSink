/**
 * Native component test for the {@link GlassCard} brand primitive. Under Vitest, `react-native` is
 * `react-native-web` and `expo-blur` is a stub (real blur is emulator-only). The stub marks the blur path
 * `[data-commise-stub="blur-view"]`, so we can assert the frosted path when blur is supported and the
 * solid-fallback (no blur view) path when it is not.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { GlassCard } from '../GlassCard.native.js';

describe('GlassCard (native)', () => {
    it('renders its children', () => {
        render(<GlassCard>stat</GlassCard>);

        expect(screen.getByText('stat')).toBeDefined();
    });

    it('uses expo-blur (the frosted path) when blur is supported (default)', () => {
        const { container } = render(<GlassCard>x</GlassCard>);

        expect(container.querySelector('[data-commise-stub="blur-view"]')).not.toBeNull();
    });

    it('renders a solid fallback (NO blur view) when blur is unsupported', () => {
        const { container } = render(<GlassCard blurSupported={false}>x</GlassCard>);

        expect(container.querySelector('[data-commise-stub="blur-view"]')).toBeNull();
        expect(screen.getByText('x')).toBeDefined();
    });
});
