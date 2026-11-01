/**
 * Component tests for the native `PasteMatchSummary`: the block above the pasted lines
 * (`docs/design/uiRefreshWorkshop5/redesignCanvas/ingredientMatching.md`): how many lines were added, then ONE paragraph
 * of the non-zero counts and the rule.
 *
 * REWRITTEN for U4 (2026-10-25): the owner's order and words in one paragraph with the rule, and no muted fill card.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, screen } from '@testing-library/react';

import { recipeFormMessages } from '../messages.js';
import { pasteMatchSummaryOf } from '../pasteMatchView.js';
// Explicit `.native.js` — tsc and the native config's resolver both map it to the `.native.tsx` leaf.
import { PasteMatchSummary } from '../PasteMatchSummary.native.js';
import { render } from '@commise/ui/testing/tamagui';

const m = recipeFormMessages.en;
const PARAGRAPH =
    '3 matched · 4 to choose · 1 being checked. Matched lines are ready, and you can change them. Nothing else is chosen for you.';

afterEach(cleanup);

function renderSummary(counts = { added: 8, choose: 4, checking: 1, matched: 3 }) {
    return render(<PasteMatchSummary view={pasteMatchSummaryOf(counts, m, 'en')} />);
}

describe('PasteMatchSummary (native)', () => {
    it('says what was added, then the counts and the rule as ONE paragraph, at 16 and 14 pt', () => {
        renderSummary();

        expect(getComputedStyle(screen.getByText('Added 8 lines')).fontSize).toBe('16px');
        expect(getComputedStyle(screen.getByText(PARAGRAPH, { normalizer: (text) => text })).fontSize).toBe('14px');
    });

    it('is no fill card: no muted surface behind it', () => {
        const { container } = renderSummary();
        const block = container.firstElementChild;

        expect(['', 'rgba(0, 0, 0, 0)']).toContain(block === null ? '' : getComputedStyle(block).backgroundColor);
    });

    it('offers no control', () => {
        renderSummary();

        expect(screen.queryAllByRole('button')).toEqual([]);
    });
});
