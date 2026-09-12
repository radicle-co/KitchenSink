// @vitest-environment jsdom
/**
 * Component tests for the web recipe-widget loading skeleton — every branch of the leaf: the caller-driven
 * placeholder count, the MAX_RECENT_RECIPES default, the empty (zero) count, and that the whole block is
 * marked presentational and hidden from assistive technology.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';

import { MAX_RECENT_RECIPES } from '../props.js';
import { RecipeWidgetSkeleton } from '../RecipeWidgetSkeleton.js';

afterEach(cleanup);

const presentation = (container: HTMLElement): Element => {
    const node = container.querySelector('[role="presentation"]');
    expect(node).not.toBeNull();

    return node as Element;
};

describe('RecipeWidgetSkeleton (web)', () => {
    it('renders exactly the requested number of placeholder rows', () => {
        const { container } = render(<RecipeWidgetSkeleton itemCount={3} />);

        expect(presentation(container).children).toHaveLength(3);
    });

    it('defaults to MAX_RECENT_RECIPES placeholders when no count is given', () => {
        const { container } = render(<RecipeWidgetSkeleton />);

        expect(presentation(container).children).toHaveLength(MAX_RECENT_RECIPES);
    });

    it('renders no placeholders when asked for zero', () => {
        const { container } = render(<RecipeWidgetSkeleton itemCount={0} />);

        expect(presentation(container).children).toHaveLength(0);
    });

    it('is presentational and hidden from assistive technology', () => {
        const { container } = render(<RecipeWidgetSkeleton />);
        const node = presentation(container);

        expect(node.getAttribute('role')).toBe('presentation');
        expect(node.getAttribute('aria-hidden')).toBe('true');
    });
});
