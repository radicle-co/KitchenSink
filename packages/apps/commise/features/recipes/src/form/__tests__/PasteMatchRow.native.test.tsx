/**
 * Component tests for the native `PasteMatchRow` (through react-native-web): the same states, words and controls as the
 * web leaf (`pasteMatchView.ts`), in the native idiom.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';

import { recipeFormMessages } from '../messages.js';
import type { PastedLineText, SettledLine } from '../pasteMatchLine.js';
// Explicit `.native.js` — tsc and the native config's resolver both map it to the `.native.tsx` leaf.
import { PasteMatchRow } from '../PasteMatchRow.native.js';
import { pasteMatchRowViewOf } from '../pasteMatchView.js';

afterEach(cleanup);

const m = recipeFormMessages.en;
const MILK: PastedLineText = { measure: '2 cups', words: 'milk' };
const CREAM: PastedLineText = { measure: '1/2 cup', words: 'heavy cream' };
const BUTTER: PastedLineText = { measure: '3 tbsp', words: 'butter, melted' };

function renderRow(settled: SettledLine, online = true) {
    const onAction = vi.fn();
    const onSeeWhy = vi.fn();

    render(
        <PasteMatchRow
            line={settled.line}
            view={pasteMatchRowViewOf(settled, online, m)}
            onAction={onAction}
            onSeeWhy={onSeeWhy}
        />,
    );

    return { onAction, onSeeWhy };
}

const buttonNames = (): (string | null)[] =>
    screen.queryAllByRole('button').map((button) => button.getAttribute('aria-label'));

describe('PasteMatchRow (native)', () => {
    it('draws the line as the cook wrote it', () => {
        renderRow({ kind: 'matched', key: 'm', line: MILK, food: 'Whole milk' });

        expect(screen.getByText((_, element) => element?.textContent === '2 cups milk')).toBeTruthy();
        expect(screen.getByText('2 cups')).toBeTruthy();
    });

    it('matched: the food, and Change named for the line is the only control', () => {
        const { onAction } = renderRow({ kind: 'matched', key: 'm', line: MILK, food: 'Whole milk' });

        expect(screen.getByText('Whole milk')).toBeTruthy();
        expect(screen.queryByText('your choice', { exact: false })).toBeNull();
        expect(buttonNames()).toEqual(['Change the food for 2 cups milk']);

        fireEvent.click(screen.getByRole('button', { name: 'Change the food for 2 cups milk' }));
        expect(onAction).toHaveBeenCalledExactlyOnceWith('change');
    });

    it('chosen: says it is the cook’s choice', () => {
        renderRow({ kind: 'chosen', key: 'c', line: MILK, food: 'Whole milk', reviewNote: undefined });

        expect(screen.getByText('your choice', { exact: false })).toBeTruthy();
        expect(screen.queryByText(/Our check suggested/)).toBeNull();
    });

    it('⛔ a late review result keeps the cook’s food and adds one sentence with See why', () => {
        const { onSeeWhy, onAction } = renderRow({
            kind: 'chosen',
            key: 'c',
            line: BUTTER,
            food: 'Butter, unsalted',
            reviewNote: { suggestedFood: 'Butter, salted' },
        });

        expect(screen.getByText('Butter, unsalted')).toBeTruthy();
        expect(screen.getByText('Our check suggested Butter, salted. Your choice stays.')).toBeTruthy();

        fireEvent.click(
            screen.getByRole('button', {
                name: 'See why our check suggested Butter, salted for 3 tbsp butter, melted',
            }),
        );
        expect(onSeeWhy).toHaveBeenCalledTimes(1);
        expect(onAction).not.toHaveBeenCalled();
    });

    it('checking, online: the proposal with its Checking tag; Use this, then Search', () => {
        const { onAction } = renderRow({ kind: 'checking', key: 'k', line: CREAM, proposal: 'Heavy whipping cream' });

        expect(screen.getByText('Heavy whipping cream')).toBeTruthy();
        expect(screen.getByText('Checking')).toBeTruthy();
        expect(buttonNames()).toEqual([
            'Use this: Heavy whipping cream for 1/2 cup heavy cream',
            'Search for a food for 1/2 cup heavy cream',
        ]);

        fireEvent.click(screen.getByRole('button', { name: 'Use this: Heavy whipping cream for 1/2 cup heavy cream' }));
        fireEvent.click(screen.getByRole('button', { name: 'Search for a food for 1/2 cup heavy cream' }));
        expect(onAction.mock.calls).toEqual([['useThis'], ['search']]);
    });

    it('checking, offline: the check is paused, search needs the network, and Keep as written is offered', () => {
        const { onAction } = renderRow(
            { kind: 'checking', key: 'k', line: CREAM, proposal: 'Heavy whipping cream' },
            false,
        );

        expect(screen.getByText('Check paused')).toBeTruthy();
        expect(screen.queryByText('Checking')).toBeNull();
        expect(screen.getByText('Search needs the network')).toBeTruthy();
        expect(buttonNames()).toEqual([
            'Use this: Heavy whipping cream for 1/2 cup heavy cream',
            'Keep “1/2 cup heavy cream” as written',
        ]);

        fireEvent.click(screen.getByRole('button', { name: 'Keep “1/2 cup heavy cream” as written' }));
        expect(onAction).toHaveBeenCalledExactlyOnceWith('keepAsWritten');
    });

    it('options failed: says so, then Try again, Search and Keep as written', () => {
        const { onAction } = renderRow({ kind: 'optionsFailed', key: 'f', line: MILK });

        expect(screen.getByText('We couldn’t load the options for this line.')).toBeTruthy();
        expect(buttonNames()).toEqual([
            'Try again to load the options for 2 cups milk',
            'Search for a food for 2 cups milk',
            'Keep “2 cups milk” as written',
        ]);

        fireEvent.click(screen.getByRole('button', { name: 'Try again to load the options for 2 cups milk' }));
        expect(onAction).toHaveBeenCalledExactlyOnceWith('retry');
    });

    it('kept as written: a quiet sentence and no control', () => {
        renderRow({ kind: 'keptAsWritten', key: 'w', line: MILK });

        expect(screen.getByText('Kept as written · no nutrition yet')).toBeTruthy();
        expect(buttonNames()).toEqual([]);
    });
});
