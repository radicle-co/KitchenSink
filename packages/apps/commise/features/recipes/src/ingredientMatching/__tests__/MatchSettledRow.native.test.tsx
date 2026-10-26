/**
 * Component tests for the native `MatchSettledRow` (through react-native-web), the React Native leaf of the web one: a matched line that needs nothing from the cook now, in either flow
 * (`docs/design/uiRefreshWorkshop5/redesignCanvas/ingredientMatching.md`). Every settled state draws the line, its
 * status and exactly the controls `matchLineView.ts` gives it, each named for its line; a late review result keeps the
 * cook's food and adds one sentence.
 *
 * REWRITTEN from the editor builder's `PasteMatchRow` test when the two builds were reconciled: lines come from the one
 * line model through `lineRowOf`; "your choice" is one sentence; a server-bound default shows its Default tag; every
 * kept-as-written line offers Change; the short Keep's name is "Keep as written: {line}". The glyph cases are new
 * (review finding m7): a failure carries the warning glyph and a checking line the still clock, so neither state rests
 * on colour or on a turning spinner.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, getDefaultNormalizer, render, screen } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';

import { recipeMessages } from '../../messages.js';
import {
    cookPicked,
    makeCheckingLine,
    makeConfidentLine,
    makeDefaultLine,
    makeFoodChoice,
    makeNoMatchLine,
    makeOptionsFailedLine,
    MILKS,
} from '../__fixtures__/matchLines.js';
import type { MatchLine } from '../matchLine.js';
import { lineRowOf } from '../matchLineView.js';
// Explicit `.native.js` — tsc and the native config's resolver both map it to the `.native.tsx` leaf.
import { MatchSettledRow } from '../MatchSettledRow.native.js';
import { matchLineMessages } from '../messages.js';

afterEach(cleanup);

const copy = { line: matchLineMessages.en, details: recipeMessages.en.ingredientDetails };
const WHOLE = MILKS[1] ?? MILKS[0];

function renderRow(line: MatchLine, online = true) {
    const onAction = vi.fn();
    const onSeeWhy = vi.fn();
    const row = lineRowOf(line, { expanded: false, current: false, online, pending: undefined }, copy, 'en');

    if (row.kind !== 'settled') {
        throw new Error(`expected a settled row, got ${row.kind}`);
    }

    render(<MatchSettledRow line={row.line} view={row.view} onAction={onAction} onSeeWhy={onSeeWhy} />);

    return { onAction, onSeeWhy };
}

/** Matches text exactly, keeping its no-break spaces (the default normalizer folds them into spaces). */
const EXACT = { normalizer: getDefaultNormalizer({ collapseWhitespace: false }) };

const buttonNames = (): (string | null)[] =>
    screen.queryAllByRole('button').map((button) => button.getAttribute('aria-label'));

describe('MatchSettledRow (native)', () => {
    it('draws the line as the cook wrote it', () => {
        renderRow(makeConfidentLine({ line: { measure: '2 cups', words: 'milk' } }));

        expect(screen.getByText((_, element) => element?.textContent === '2 cups milk')).toBeTruthy();
        expect(screen.getByText('2 cups')).toBeTruthy();
    });

    it('confident: the food with a check, and Change named for the line is the only control', () => {
        const { onAction } = renderRow(makeConfidentLine());

        expect(screen.getByText('Egg, whole, raw')).toBeTruthy();
        expect(document.querySelector('[data-icon-name="check"]')).not.toBeNull();
        expect(screen.queryByText(/your choice/)).toBeNull();
        expect(buttonNames()).toEqual(['Change the food for eggs']);

        fireEvent.click(screen.getByRole('button', { name: 'Change the food for eggs' }));
        expect(onAction).toHaveBeenCalledExactlyOnceWith('change');
    });

    it('the cook’s pick says "your choice" in the same sentence as the food', () => {
        renderRow(makeDefaultLine({ binding: cookPicked(WHOLE) }));

        expect(screen.getByText('Whole milk\u00A0· your choice', EXACT)).toBeTruthy();
        expect(screen.queryByText(/Our check suggested/)).toBeNull();
    });

    it('⛔ a default the server bound shows its Default tag, and never "your choice"', () => {
        renderRow(
            makeDefaultLine({
                binding: { boundBy: 'server', pick: { kind: 'food', foodId: 'whole', name: 'Whole milk' } },
            }),
        );

        expect(screen.getByText('Whole milk')).toBeTruthy();
        expect(screen.getByText('Default')).toBeTruthy();
        expect(screen.queryByText(/your choice/)).toBeNull();
    });

    it('⛔ a late review result keeps the cook’s food and adds one sentence with See why', () => {
        const { onSeeWhy, onAction } = renderRow(
            makeDefaultLine({
                line: { measure: '3 tbsp', words: 'butter, melted' },
                binding: cookPicked(makeFoodChoice({ id: 'u', name: 'Butter, unsalted' }), {
                    suggestedFood: 'Butter, salted',
                    reason: 'The recipe adds no other salt.',
                }),
            }),
        );

        expect(screen.getByText('Butter, unsalted\u00A0· your choice', EXACT)).toBeTruthy();
        expect(screen.getByText('Our check suggested Butter, salted. Your choice stays.')).toBeTruthy();

        fireEvent.click(
            screen.getByRole('button', {
                name: 'See why our check suggested Butter, salted for 3 tbsp butter, melted',
            }),
        );
        expect(onSeeWhy).toHaveBeenCalledTimes(1);
        expect(onAction).not.toHaveBeenCalled();
    });

    it('checking, online: the proposal with its Checking tag and the still clock; Use this, then Search', () => {
        const { onAction } = renderRow(makeCheckingLine());

        expect(screen.getByText('Heavy whipping cream')).toBeTruthy();
        expect(screen.getByText('Checking')).toBeTruthy();
        expect(document.querySelector('[data-icon-name="clock"]')).not.toBeNull();
        expect(screen.queryByRole('progressbar')).toBeNull();
        expect(buttonNames()).toEqual([
            'Use this: Heavy whipping cream for 1/2 cup heavy cream',
            'Search for a food for 1/2 cup heavy cream',
        ]);

        fireEvent.click(screen.getByRole('button', { name: 'Use this: Heavy whipping cream for 1/2 cup heavy cream' }));
        fireEvent.click(screen.getByRole('button', { name: 'Search for a food for 1/2 cup heavy cream' }));
        expect(onAction.mock.calls).toEqual([['useThis'], ['search']]);
    });

    it('checking, offline: the check is paused with no clock, search needs the network, Keep as written is offered', () => {
        const { onAction } = renderRow(makeCheckingLine(), false);

        expect(screen.getByText('Check paused')).toBeTruthy();
        expect(screen.queryByText('Checking')).toBeNull();
        expect(document.querySelector('[data-icon-name="clock"]')).toBeNull();
        expect(screen.getByText('Search needs the network')).toBeTruthy();
        expect(buttonNames()).toEqual([
            'Use this: Heavy whipping cream for 1/2 cup heavy cream',
            'Keep as written: 1/2 cup heavy cream',
        ]);

        fireEvent.click(screen.getByRole('button', { name: 'Keep as written: 1/2 cup heavy cream' }));
        expect(onAction).toHaveBeenCalledExactlyOnceWith('keepAsWritten');
    });

    it('options failed: the warning glyph and the sentence, then Try again, Search and Keep as written', () => {
        const { onAction } = renderRow(makeOptionsFailedLine());

        expect(screen.getByText('We couldn’t load the options for this line.')).toBeTruthy();
        expect(document.querySelector('[data-icon-name="triangle-alert"]')).not.toBeNull();
        expect(buttonNames()).toEqual([
            'Try again to load the options for 2 cups milk',
            'Search for a food for 2 cups milk',
            'Keep as written: 2 cups milk',
        ]);

        fireEvent.click(screen.getByRole('button', { name: 'Try again to load the options for 2 cups milk' }));
        expect(onAction).toHaveBeenCalledExactlyOnceWith('retry');
    });

    it('kept as written: a quiet sentence with no warning glyph, and Change to choose a food later', () => {
        const { onAction } = renderRow(
            makeNoMatchLine({ binding: { boundBy: 'server', pick: { kind: 'asWritten' } } }),
        );

        expect(screen.getByText('Kept as written\u00A0· no nutrition yet', EXACT)).toBeTruthy();
        expect(document.querySelector('[data-icon-name="triangle-alert"]')).toBeNull();
        expect(buttonNames()).toEqual(['Change the food for 1 tsp spice mix']);

        fireEvent.click(screen.getByRole('button', { name: 'Change the food for 1 tsp spice mix' }));
        expect(onAction).toHaveBeenCalledExactlyOnceWith('change');
    });
});
