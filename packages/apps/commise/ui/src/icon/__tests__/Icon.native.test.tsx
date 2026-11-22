import { cleanup, render, screen } from '@testing-library/react';
import { I18nManager } from 'react-native';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Explicit `.native.js` — tsc and the native config's resolver both map it to the `.native.tsx` leaf.
import { Icon } from '../Icon.native.js';
import { role } from '../../tokens/colors.js';
import type { IconScaleWith } from '../props.js';
import { renderWithTamagui } from '../../testing/tamaguiTesting.native.js';

/**
 * Icon (native) — the Adapter over `lucide-react-native`, rendered through the `lucideNativeStub` stand-in (the real
 * glyph needs `react-native-svg`). The stand-in publishes the glyph's Lucide name and the props it was drawn with, so
 * every assertion here is about what the leaf asked Lucide to draw.
 */

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

/** The stand-in glyph the leaf rendered. */
function glyphOf(container: HTMLElement): HTMLElement {
    const glyph = container.querySelector<HTMLElement>('[data-commise-stub="icon"]');

    if (glyph === null) {
        throw new Error('Icon rendered no glyph.');
    }

    return glyph;
}

/** The transform of the view the glyph sits in, as the browser computes it from react-native-web's atomic CSS. */
function transformOf(glyph: HTMLElement): string {
    const box = glyph.parentElement;

    if (box === null) {
        throw new Error('The glyph has no wrapping view.');
    }

    return getComputedStyle(box).transform;
}

/** Report the layout direction the way React Native does: through `I18nManager.getConstants()`. */
function layoutDirection(isRTL: boolean): void {
    vi.spyOn(I18nManager, 'getConstants').mockReturnValue({ isRTL, doLeftAndRightSwapInRTL: true });
}

describe('Icon (native)', () => {
    it('draws the glyph the Registry holds for the meaning, by its deep import', () => {
        const { container } = render(<Icon name="trash" />);

        expect(glyphOf(container).dataset['iconName']).toBe('trash');
    });

    it('draws the cooking pot for cookingPot', () => {
        const { container } = render(<Icon name="cookingPot" />);

        expect(glyphOf(container).dataset['iconName']).toBe('cooking-pot');
    });

    it('draws the checked list for listChecks', () => {
        const { container } = render(<Icon name="listChecks" />);

        expect(glyphOf(container).dataset['iconName']).toBe('list-checks');
    });

    it('is decorative by default: inside a view hidden from assistive tech', () => {
        const { container } = render(<Icon name="search" />);

        expect(glyphOf(container).closest('[aria-hidden="true"]')).not.toBeNull();
        expect(screen.queryByRole('img')).toBeNull();
    });

    it('is an image named by its label when the caller gives one', () => {
        const { container } = render(<Icon name="globe" label="Public" />);

        const image = screen.getByRole('img', { name: 'Public' });

        expect(image.contains(glyphOf(container))).toBe(true);
        expect(glyphOf(container).closest('[aria-hidden="true"]')).toBeNull();
    });

    it('draws in ink by default, because a native glyph inherits no text colour', () => {
        const { container } = render(<Icon name="check" />);

        expect(glyphOf(container).dataset['iconColor']).toBe(role.ink);
    });

    it('takes its colour from the role named by tone', () => {
        const { container } = render(<Icon name="check" tone="actionText" />);

        expect(glyphOf(container).dataset['iconColor']).toBe(role.actionText);
    });

    it('draws at 24 by default and at 20 inline', () => {
        const { container, rerender } = render(<Icon name="clock" />);

        expect(glyphOf(container).dataset['iconSize']).toBe('24');

        rerender(<Icon name="clock" size={20} />);

        expect(glyphOf(container).dataset['iconSize']).toBe('20');
    });

    it('draws at 48 as an empty-state glyph', () => {
        const { container } = render(<Icon name="clock" size={48} />);

        expect(glyphOf(container).dataset['iconSize']).toBe('48');
    });

    it('is outlined unless filled, and a filled glyph fills with its own colour', () => {
        const { container, rerender } = render(<Icon name="house" tone="ink" />);

        expect(glyphOf(container).dataset['iconFill']).toBe('none');

        rerender(<Icon name="house" tone="ink" filled />);

        expect(glyphOf(container).dataset['iconFill']).toBe(role.ink);
    });

    it('mirrors a directional glyph only when the layout is right-to-left', () => {
        layoutDirection(true);
        const { container, rerender } = render(<Icon name="chevronLeft" />);

        expect(transformOf(glyphOf(container))).toBe('scaleX(-1)');

        rerender(<Icon name="timer" />);

        expect(transformOf(glyphOf(container))).toBe('none');
    });

    it('does not mirror a directional glyph in a left-to-right layout', () => {
        layoutDirection(false);
        const { container } = render(<Icon name="chevronLeft" />);

        expect(transformOf(glyphOf(container))).toBe('none');
    });
});

/**
 * D6 (native): a glyph with `scaleWith` is its 1x size times the label role's own growth under the system text scale
 * (`grownScale`), never past that role's cap; one without it is a fixed size at every text scale (D85: an icon-only
 * control keeps its glyph).
 */
describe('Icon (native) scaleWith', () => {
    const sizeAt = (scale: number, scaleWith?: IconScaleWith): string | undefined => {
        const { container, unmount } = renderWithTamagui(
            <Icon name="x" size={20} {...(scaleWith === undefined ? {} : { scaleWith })} />,
            'light',
            scale,
        );
        const size = glyphOf(container).dataset['iconSize'];

        unmount();

        return size;
    };

    it('is unchanged at 1x', () => {
        expect(sizeAt(1, { role: 'body' })).toBe('20');
    });

    it('without scaleWith stays fixed at the largest text', () => {
        expect(sizeAt(3)).toBe('20');
    });

    it('grows with the label role: 20 at 1.5x text is 30', () => {
        expect(sizeAt(1.5, { role: 'body' })).toBe('30');
    });

    it('stops at the role cap: body stops at 2x, so 40 at 3x', () => {
        expect(sizeAt(3, { role: 'body' })).toBe('40');
    });

    it('stops at a display role cap of 1.5x: 30 at 3x', () => {
        expect(sizeAt(3, { role: 'largeTitle' })).toBe('30');
    });

    it('stops at its label chrome cap, as the label does: body is capped at 2x, a 1.3 chrome cap stops it at 26', () => {
        expect(sizeAt(3, { role: 'body', chromeCap: '1.3' })).toBe('26');
    });

    it('a chrome cap only lowers the role: at 1.2x text it is still 24', () => {
        expect(sizeAt(1.2, { role: 'body', chromeCap: '1.3' })).toBe('24');
    });
});
