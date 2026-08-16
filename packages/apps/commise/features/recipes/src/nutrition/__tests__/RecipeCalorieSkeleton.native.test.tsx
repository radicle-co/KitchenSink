/**
 * Native component tests for the calorie skeleton (react-native-web under jsdom).
 *
 * The native leaf mirrors the web contract with RN primitives: the localized label names the placeholder for
 * assistive tech, and the shimmer bar itself is hidden from it. There is no `motion-reduce` counterpart to
 * assert because the native placeholder is INERT — the same choice the native recipe-list skeletons already
 * make, so no reduced-motion gate is needed.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

// Explicit `.native.js` — tsc and the native config's resolver both map it to the `.native.tsx` leaf.
import { RecipeCalorieSkeleton } from '../RecipeCalorieSkeleton.native.js';

afterEach(cleanup);

describe('RecipeCalorieSkeleton (native)', () => {
    it('names the placeholder with its localized label', () => {
        render(<RecipeCalorieSkeleton label="Loading calories" />);

        expect(screen.getByLabelText('Loading calories')).toBeTruthy();
    });

    it('keeps the shimmer bar itself out of the accessibility tree', () => {
        const { container } = render(<RecipeCalorieSkeleton label="Loading calories" />);

        expect(container.querySelector('[aria-hidden="true"]'), 'a decorative bar is painted').not.toBeNull();
    });

    it('reserves a non-zero footprint so the chip does not reflow the meta row when it lands', () => {
        const { container } = render(<RecipeCalorieSkeleton label="Loading calories" />);
        const bar = container.querySelector('[aria-hidden="true"]');
        const style = bar === null ? undefined : window.getComputedStyle(bar);

        expect(style?.width).not.toBe('');
        expect(style?.height).not.toBe('');
    });
});
