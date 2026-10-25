// @vitest-environment jsdom
/**
 * Component tests for the web `PastedLine`: a pasted line as the cook wrote it, its measure drawn heavier than its words
 * (`docs/design/uiRefreshWorkshop5/redesignCanvas/ingredientMatching.md` boards), read as one line of text.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import { PastedLine } from '../PastedLine.js';

afterEach(cleanup);

describe('PastedLine (web)', () => {
    it('reads as the whole line, measure first', () => {
        const { container } = render(<PastedLine line={{ measure: '2 cups', words: 'milk' }} />);

        expect(container.textContent).toBe('2 cups milk');
    });

    it('draws the measure apart from the words, so it can be set heavier', () => {
        render(<PastedLine line={{ measure: '2 cups', words: 'milk' }} />);

        expect(screen.getByText('2 cups').className).toContain('font-semibold');
    });

    it('a line with no measure is its words alone, with no leading space', () => {
        const { container } = render(<PastedLine line={{ measure: '', words: 'eggs' }} />);

        expect(container.textContent).toBe('eggs');
    });
});
