// @vitest-environment jsdom
/**
 * Component tests for the web `PasteMatchSummary`: the block above the pasted lines
 * (`docs/design/uiRefreshWorkshop5/redesignCanvas/ingredientMatching.md`): how many lines were added, the non-zero
 * counts, and the rule that matched lines can be changed and nothing else is chosen for the cook.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import { recipeFormMessages } from '../messages.js';
import { pasteMatchSummaryOf } from '../pasteMatchView.js';
import { PasteMatchSummary } from '../PasteMatchSummary.js';

const m = recipeFormMessages.en;

afterEach(cleanup);

describe('PasteMatchSummary (web)', () => {
    it('says what was added, the counts, and the rule', () => {
        render(
            <PasteMatchSummary view={pasteMatchSummaryOf({ added: 8, choose: 4, checking: 1, matched: 3 }, m, 'en')} />,
        );

        expect(screen.getByText('Added 8 lines')).toBeTruthy();
        expect(screen.getByText('4 need your choice · 1 being checked · 3 matched')).toBeTruthy();
        expect(
            screen.getByText('Matched lines are ready, and you can change them. Nothing else is chosen for you.'),
        ).toBeTruthy();
    });

    it('with every line matched, says only that', () => {
        render(
            <PasteMatchSummary view={pasteMatchSummaryOf({ added: 2, choose: 0, checking: 0, matched: 2 }, m, 'en')} />,
        );

        expect(screen.getByText('2 matched')).toBeTruthy();
        expect(screen.queryByText(/need your choice/)).toBeNull();
    });

    it('offers no control', () => {
        render(
            <PasteMatchSummary view={pasteMatchSummaryOf({ added: 8, choose: 4, checking: 1, matched: 3 }, m, 'en')} />,
        );

        expect(screen.queryAllByRole('button')).toEqual([]);
    });
});
