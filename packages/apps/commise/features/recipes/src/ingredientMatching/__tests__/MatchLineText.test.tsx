// @vitest-environment jsdom
/**
 * Component tests for the web `MatchLineText`: an ingredient line as the cook wrote it, its measure drawn heavier than
 * its words (`docs/design/uiRefreshWorkshop5/redesignCanvas/ingredientMatching.md` boards), read as one line of text.
 * Renamed from the editor builder's `PastedLine` when both flows came to draw it.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import { MatchLineText } from '../MatchLineText.js';

afterEach(cleanup);

describe('MatchLineText (web)', () => {
    it('reads as the whole line, measure first', () => {
        const { container } = render(<MatchLineText line={{ measure: '2 cups', words: 'milk' }} />);

        expect(container.textContent).toBe('2 cups milk');
    });

    it('draws the measure apart from the words, so it can be set heavier', () => {
        render(<MatchLineText line={{ measure: '2 cups', words: 'milk' }} />);

        expect(screen.getByText('2 cups').className).toContain('font-semibold');
    });

    // REWRITTEN for the owner's type-scale ruling (2026-10-25): the cook's line is 16 px body, the same class the
    // reading phase's `PastedReadingRow` sets it in, and everything under it is 14; it was the 13 px list role.
    it('is set in the 16 px body role, as the reading phase sets the same line', () => {
        const { container } = render(<MatchLineText line={{ measure: '2 cups', words: 'milk' }} />);

        expect(container.firstElementChild?.className.split(' ')).toContain('text-body');
    });

    it('a line with no measure is its words alone, with no leading space', () => {
        const { container } = render(<MatchLineText line={{ measure: '', words: 'eggs' }} />);

        expect(container.textContent).toBe('eggs');
    });
});
