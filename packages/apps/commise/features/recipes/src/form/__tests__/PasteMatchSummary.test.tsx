// @vitest-environment jsdom
/**
 * Component tests for the web `PasteMatchSummary`: the block above the pasted lines
 * (`docs/design/uiRefreshWorkshop5/redesignCanvas/ingredientMatching.md`): how many lines were added, then ONE paragraph
 * of the non-zero counts and the rule that matched lines can be changed and nothing else is chosen for the cook.
 *
 * REWRITTEN for U4 (2026-10-25): the counts come in the owner's order and words ("3 matched · 4 to choose · 1 being
 * checked.", commit 7b62777fc) in the same paragraph as the rule, and the block is no longer a muted fill card. It drew
 * the counts and the rule as two lines on a `surfaceMuted` card.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import { recipeFormMessages } from '../messages.js';
import { pasteMatchSummaryOf } from '../pasteMatchView.js';
import { PasteMatchSummary } from '../PasteMatchSummary.js';

const m = recipeFormMessages.en;
const PARAGRAPH =
    '3 matched · 4 to choose · 1 being checked. Matched lines are ready, and you can change them. Nothing else is chosen for you.';

afterEach(cleanup);

function renderSummary(counts = { added: 8, choose: 4, checking: 1, matched: 3 }) {
    return render(<PasteMatchSummary view={pasteMatchSummaryOf(counts, m, 'en')} />);
}

describe('PasteMatchSummary (web)', () => {
    it('says what was added, then the counts and the rule as ONE paragraph', () => {
        const { container } = renderSummary();

        expect(screen.getByText('Added 8 lines')).toBeTruthy();
        expect(screen.getByText(PARAGRAPH, { normalizer: (text) => text }).tagName).toBe('P');
        expect(container.querySelectorAll('p')).toHaveLength(2);
    });

    it('is no fill card: no muted surface behind it', () => {
        const { container } = renderSummary();

        expect(container.querySelector('.bg-surface-muted')).toBeNull();
    });

    it('sets the added line at 16 px and the paragraph at 14 px, muted', () => {
        renderSummary();

        expect(screen.getByText('Added 8 lines').className.split(' ')).toContain('text-body');
        expect(screen.getByText(PARAGRAPH, { normalizer: (text) => text }).className.split(' ')).toEqual(
            expect.arrayContaining(['text-list', 'text-ink-muted']),
        );
    });

    it('with every line matched, says only that before the rule', () => {
        renderSummary({ added: 2, choose: 0, checking: 0, matched: 2 });

        expect(screen.getByText(/^2 matched\. Matched lines are ready/)).toBeTruthy();
        expect(screen.queryByText(/to choose/)).toBeNull();
    });

    it('offers no control', () => {
        renderSummary();

        expect(screen.queryAllByRole('button')).toEqual([]);
    });
});
