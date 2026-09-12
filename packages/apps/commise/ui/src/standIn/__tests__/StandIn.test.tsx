/**
 * The stand-in chip (web): the text that stands where a missing value would be, drawn so it cannot pass for the
 * value (`docs/design/namelessLineCopy.md` §2).
 *
 * ⛔ The words ARE the content: the chip is plain text, never hidden from assistive technology and never given a
 * role, because on a nameless recipe line it is the line's name.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { StandIn } from '../StandIn.js';

afterEach(cleanup);

describe('StandIn (web)', () => {
    it('renders its words as plain text, exposed to assistive technology', () => {
        render(<StandIn tone="neutral">Private ingredient</StandIn>);

        const chip = screen.getByText('Private ingredient');

        expect(chip.getAttribute('aria-hidden')).toBeNull();
        expect(chip.getAttribute('role')).toBeNull();
        expect(chip.getAttribute('aria-label')).toBeNull();
    });

    it('draws a dashed outline, so it cannot pass for the value it stands in for', () => {
        render(<StandIn tone="neutral">Private ingredient</StandIn>);

        expect(screen.getByText('Private ingredient').className).toContain('border-dashed');
    });

    it('takes the caution tone for something the reader can act on, and the neutral tone otherwise', () => {
        render(
            <>
                <StandIn tone="neutral">Private ingredient</StandIn>
                <StandIn tone="caution">Removed food</StandIn>
            </>,
        );

        const neutral = screen.getByText('Private ingredient').className;
        const caution = screen.getByText('Removed food').className;

        expect(neutral).toContain('text-slate');
        expect(neutral).not.toContain('bg-warning');
        expect(caution).toContain('bg-warning/25');
        // ⛔ `warning` is a fill, never a text colour: the caution label is charcoal.
        expect(caution).toContain('text-charcoal');
        expect(caution).not.toMatch(/\btext-warning\b/);
    });

    it('⛔ wraps at spaces inside itself and is never cut off', () => {
        render(<StandIn tone="neutral">Ingredient not loaded</StandIn>);

        const className = screen.getByText('Ingredient not loaded').className;

        expect(className).toContain('max-w-full');
        expect(className).toContain('break-words');
        expect(className).not.toMatch(/\b(truncate|whitespace-nowrap|text-ellipsis)\b/);
    });
});
