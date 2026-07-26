/**
 * Web component test for the {@link GlassCard} brand primitive. Proves the frosted treatment (translucent
 * surface + backdrop blur) when blur is supported, the opaque solid fallback when it is not, content
 * rendering, class forwarding, and the accessible label.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { glass, glassBackdropCss } from '../../tokens/gradients.js';
import { GlassCard } from '../GlassCard.js';

describe('GlassCard (web)', () => {
    it('renders its children', () => {
        render(<GlassCard>stat</GlassCard>);

        expect(screen.getByText('stat')).toBeDefined();
    });

    it('applies the frosted treatment (translucent surface + backdrop blur) by default', () => {
        const { container } = render(<GlassCard>x</GlassCard>);
        const card = container.firstElementChild as HTMLElement;

        expect(card.style.backgroundColor).toBe('rgba(255, 255, 255, 0.85)');
        expect(card.style.backdropFilter).toBe(glassBackdropCss(glass.card));
    });

    it('falls back to the opaque solid surface with NO blur when blur is unsupported', () => {
        const { container } = render(<GlassCard blurSupported={false}>x</GlassCard>);
        const card = container.firstElementChild as HTMLElement;

        expect(card.style.backgroundColor).toBe('rgba(255, 255, 255, 0.96)');
        // No blur applied on the fallback path (the property is never set).
        expect(card.style.backdropFilter).toBeFalsy();
    });

    it('renders the subtle tier when requested', () => {
        const { container } = render(<GlassCard tier="subtle">x</GlassCard>);
        const card = container.firstElementChild as HTMLElement;

        expect(card.style.backgroundColor).toBe(glass.subtle.surface);
    });

    it('forwards web layout classes and an accessible label', () => {
        render(
            <GlassCard className="p-4" accessibilityLabel="Weekly stats">
                x
            </GlassCard>,
        );
        const card = screen.getByLabelText('Weekly stats');

        expect(card.className).toContain('p-4');
    });
});
