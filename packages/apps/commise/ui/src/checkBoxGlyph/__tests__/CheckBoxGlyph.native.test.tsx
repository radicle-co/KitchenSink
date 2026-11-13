import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import { AccessibilityInfo } from 'react-native';

// Explicit `.native.js` — tsc and the native config's resolver both map it to the `.native` leaf.
import { CheckBoxGlyph } from '../CheckBoxGlyph.native.js';
import { GLYPH_CORNER, checkMarkMotion } from '../props.js';

// The real policy, watched: the leaf must hand it the OS preference it read, not a constant.
vi.mock('../props.js', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../props.js')>();

    return { ...actual, checkMarkMotion: vi.fn(actual.checkMarkMotion) };
});
import { scaledTypeSize } from '../../text/scaledType.js';
import { ARIA_HIDDEN_CONTENT, render, renderWithTamagui, resolvedStyle } from '../../testing/tamaguiTesting.native.js';

/**
 * The native `CheckBoxGlyph` (build spec §1.9): checked, the check springs in from 0.9 with the signature overshoot
 * (stiffness 600, damping 28); under reduced motion it appears with no animation at all.
 *
 * REWRITTEN for the box that grows with its row's text: 18 pt beside body sizes, 22 beside a 28 pt role, and times the
 * role's own growth under the system text scale, never past the role's cap. The box sits in a slot one scaled line of
 * its role tall, so it stays on the row's FIRST line when the text wraps.
 */

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

/** Let the reduce-motion read settle. */
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/** The drawn box: the element hidden from assistive technology. */
const boxIn = (container: Element): Element => {
    const box = container.querySelector(ARIA_HIDDEN_CONTENT);

    if (box === null) {
        throw new Error('The glyph draws no box.');
    }

    return box;
};

/** The slot the box is centred in. */
const slotIn = (container: Element): Element => boxIn(container).parentElement as Element;

describe('CheckBoxGlyph (native)', () => {
    it('is hidden from assistive technology', () => {
        const { container } = render(<CheckBoxGlyph checked={false} />);

        expect(boxIn(container)).not.toBeNull();
    });

    // C6 (redesign): a thin outline, 1 dp (it was a 2 dp frame).
    it('draws a 1 dp outline', () => {
        const { container } = render(<CheckBoxGlyph checked={false} />);

        expect(resolvedStyle(boxIn(container), 'borderTopWidth')).toBe('1px');
    });

    it('is an 18 dp box with a 4 dp corner beside body text at 1x', () => {
        const { container } = render(<CheckBoxGlyph checked={false} />);
        const box = boxIn(container);

        expect(resolvedStyle(box, 'width')).toBe('18px');
        expect(resolvedStyle(box, 'height')).toBe('18px');
        expect(resolvedStyle(box, 'borderTopLeftRadius')).toBe(`${String(GLYPH_CORNER)}px`);
        expect(GLYPH_CORNER).toBe(4);
    });

    it('keeps 18 at 1x beside the smaller roles, and grows to 22 beside a 28 pt role', () => {
        for (const [textRole, side] of [
            ['meta', '18px'],
            ['readingBody', '18px'],
            ['largeTitle', '22px'],
        ] as const) {
            const { container, unmount } = render(<CheckBoxGlyph checked={false} textRole={textRole} />);

            expect(resolvedStyle(boxIn(container), 'width'), textRole).toBe(side);
            unmount();
        }
    });

    it('grows by its role’s factor under enlarged text, up to that role’s cap', () => {
        for (const [textRole, scale, side] of [
            ['body', 1.5, '27px'],
            ['body', 2, '36px'],
            // body's cap is 2: a larger system scale draws no larger.
            ['body', 3, '36px'],
            // largeTitle stops at 1.5.
            ['largeTitle', 2, '33px'],
        ] as const) {
            const { container, unmount } = renderWithTamagui(
                <CheckBoxGlyph checked={false} textRole={textRole} />,
                'light',
                scale,
            );

            expect(resolvedStyle(boxIn(container), 'width'), `${textRole} at ${String(scale)}`).toBe(side);
            unmount();
        }
    });

    it('keeps the corner in proportion: 4/18 of the side', () => {
        const { container } = renderWithTamagui(<CheckBoxGlyph checked={false} />, 'light', 2);

        expect(resolvedStyle(boxIn(container), 'borderTopLeftRadius')).toBe(`${String(GLYPH_CORNER * 2)}px`);
    });

    it('centres the box in a slot one scaled line of its role tall, so it stays on the first line', () => {
        for (const [textRole, scale] of [
            ['body', 1],
            ['body', 2],
            ['meta', 1],
        ] as const) {
            const { container, unmount } = renderWithTamagui(
                <CheckBoxGlyph checked={false} textRole={textRole} />,
                'light',
                scale,
            );
            const slot = slotIn(container);

            expect(resolvedStyle(slot, 'height'), `${textRole} at ${String(scale)}`).toBe(
                `${String(scaledTypeSize(textRole, scale).lineHeight)}px`,
            );
            expect(resolvedStyle(slot, 'alignItems')).toBe('center');
            unmount();
        }
    });

    it('draws the check at 16/18 of the box, so it grows with it', () => {
        const { container } = renderWithTamagui(<CheckBoxGlyph checked />, 'light', 2);
        const check = container.querySelector('[data-icon-name]');
        // The mark's Tamagui frame carries its scale as `_s-compose` and the `--t-scale-*` variables.
        const mark = check?.closest('._s-compose') ?? null;
        const scaleOn = (axis: 'x' | 'y'): string =>
            mark === null ? '' : getComputedStyle(mark).getPropertyValue(`--t-scale-${axis}`).trim();

        // Drawn at 16 and scaled with the box: 16 × 36/18 = 32.
        expect(check?.getAttribute('data-icon-size')).toBe('16');
        expect(mark).not.toBeNull();
        expect(scaleOn('x')).toBe('2');
        expect(scaleOn('y')).toBe('2');
    });

    it('shows the check only when checked', () => {
        const { container, rerender } = render(<CheckBoxGlyph checked={false} />);
        expect(container.querySelector('[data-icon-name]')).toBeNull();

        rerender(<CheckBoxGlyph checked />);
        expect(container.querySelector('[data-icon-name]')).not.toBeNull();
    });

    // REWRITTEN: the spring moved from an RN `Animated.spring` in this leaf to the named `check` spring in the Tamagui
    // config, which the test lanes alias to a CSS shim that shows no motion. The leaf's choice is pinned here through
    // the props it passes (`checkMarkMotion`, tested in `checkBoxSide.test.ts`); the motion itself is proven on a device,
    // with reduced motion on and off (ADR-0080 §6).
    it('draws the check when motion is allowed', async () => {
        vi.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false);
        const { container } = render(<CheckBoxGlyph checked />);
        await settle();

        expect(container.querySelector('[data-icon-name]')).not.toBeNull();
        expect(vi.mocked(checkMarkMotion)).toHaveBeenLastCalledWith(false, 1);
    });

    it('draws the check at once under reduced motion', async () => {
        vi.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
        const { container } = render(<CheckBoxGlyph checked />);
        await settle();

        expect(container.querySelector('[data-icon-name]')).not.toBeNull();
        expect(vi.mocked(checkMarkMotion)).toHaveBeenLastCalledWith(true, 1);
    });
});
