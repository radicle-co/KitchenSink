import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { AccessibilityInfo, Animated } from 'react-native';

// Explicit `.native.js` — tsc and the native config's resolver both map it to the `.native` leaf.
import { CheckBoxGlyph } from '../CheckBoxGlyph.native.js';
import { GLYPH_CORNER } from '../props.js';

/**
 * The native `CheckBoxGlyph` (build spec §1.9): checked, the check springs in from 0.9 with the signature overshoot
 * (stiffness 600, damping 28); under reduced motion it appears with no animation at all.
 */

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

/** Let the reduce-motion read settle. */
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('CheckBoxGlyph (native)', () => {
    it('is hidden from assistive technology', () => {
        const { container } = render(<CheckBoxGlyph checked={false} />);

        expect(container.querySelector('[aria-hidden="true"]')).not.toBeNull();
    });

    // C6 (redesign): a thin outline, 1 dp (it was a 2 dp frame).
    it('draws a 1 dp outline', () => {
        const { container } = render(<CheckBoxGlyph checked={false} />);

        expect(getComputedStyle(container.querySelector('[aria-hidden="true"]') as Element).borderTopWidth).toBe('1px');
    });

    it('is an 18 dp box with a 4 dp corner', () => {
        const { container } = render(<CheckBoxGlyph checked={false} />);
        const box = getComputedStyle(container.querySelector('[aria-hidden="true"]') as Element);

        expect(box.width).toBe('18px');
        expect(box.height).toBe('18px');
        expect(box.borderTopLeftRadius).toBe(`${String(GLYPH_CORNER)}px`);
        expect(GLYPH_CORNER).toBe(4);
    });

    it('shows the check only when checked', () => {
        const { container, rerender } = render(<CheckBoxGlyph checked={false} />);
        expect(container.querySelector('[data-icon-name]')).toBeNull();

        rerender(<CheckBoxGlyph checked />);
        expect(container.querySelector('[data-icon-name]')).not.toBeNull();
    });

    it('springs the check in with the signature overshoot when motion is allowed', async () => {
        vi.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false);
        const spring = vi.spyOn(Animated, 'spring');
        const { rerender } = render(<CheckBoxGlyph checked={false} />);
        await settle();

        rerender(<CheckBoxGlyph checked />);
        await settle();

        expect(spring).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({ stiffness: 600, damping: 28 }),
        );
    });

    it('does not animate under reduced motion', async () => {
        vi.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
        const spring = vi.spyOn(Animated, 'spring');
        const { rerender } = render(<CheckBoxGlyph checked={false} />);
        await settle();

        rerender(<CheckBoxGlyph checked />);
        await settle();

        expect(spring).not.toHaveBeenCalled();
    });
});
