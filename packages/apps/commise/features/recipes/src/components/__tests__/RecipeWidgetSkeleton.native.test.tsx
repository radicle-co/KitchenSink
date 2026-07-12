/**
 * Native component tests for the recipe-widget loading skeleton (rendered via react-native-web under jsdom):
 * the caller-driven placeholder count, the MAX_RECENT_RECIPES default, and the empty (zero) count.
 *
 * Note on a11y: the native leaf hides the block from assistive tech via RN's `accessibilityElementsHidden`
 * + `importantForAccessibility="no-hide-descendants"`, the correct props for the on-device RN runtime.
 * react-native-web (0.20) does NOT translate those legacy props to a DOM attribute, so — unlike the web
 * leaf's `aria-hidden` — that facet is not observable here; the observable contract asserted is the
 * placeholder count. (The web spec covers the a11y-hidden branch on its platform.)
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';

import { MAX_RECENT_RECIPES } from '../props.js';
// Explicit `.native.js` — tsc and the native config's resolver both map it to the `.native.tsx` leaf.
import { RecipeWidgetSkeleton } from '../RecipeWidgetSkeleton.native.js';

afterEach(cleanup);

const placeholderRow = (container: HTMLElement): Element => {
    const node = container.firstElementChild;
    expect(node).not.toBeNull();
    return node as Element;
};

describe('RecipeWidgetSkeleton (native)', () => {
    it('renders exactly the requested number of placeholder rows', () => {
        const { container } = render(<RecipeWidgetSkeleton itemCount={3} />);

        expect(placeholderRow(container).children).toHaveLength(3);
    });

    it('defaults to MAX_RECENT_RECIPES placeholders when no count is given', () => {
        const { container } = render(<RecipeWidgetSkeleton />);

        expect(placeholderRow(container).children).toHaveLength(MAX_RECENT_RECIPES);
    });

    it('renders no placeholders when asked for zero', () => {
        const { container } = render(<RecipeWidgetSkeleton itemCount={0} />);

        expect(placeholderRow(container).children).toHaveLength(0);
    });
});
