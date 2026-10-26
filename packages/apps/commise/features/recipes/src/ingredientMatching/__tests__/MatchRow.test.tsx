// @vitest-environment jsdom
/**
 * Component tests for the web `MatchRow`: the ONE dispatch from a line's row (`lineRowOf`) to the leaf that draws it, in
 * both flows. It replaces the import builder's `LineRow`, which re-derived the line states inside the leaf behind a
 * `@pattern Visitor` tag while its `if` chain fell through to a default (review finding M1): now every leaf switches on
 * the row's `kind`, so a new kind is a compile error in each.
 *
 * Each row kind draws its own leaf, and every control reports to the host with the line's key — and a late review
 * note's reason, which "See why" needs.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import { recipeMessages } from '../../messages.js';
import {
    cookPicked,
    makeCheckingLine,
    makeConfidentLine,
    makeDefaultLine,
    makeNoMatchLine,
    makeOptionsFailedLine,
    MILKS,
} from '../__fixtures__/matchLines.js';
import type { MatchLine } from '../matchLine.js';
import { lineRowOf, type LinePlace } from '../matchLineView.js';
import { MatchRow } from '../MatchRow.js';
import { matchLineMessages } from '../messages.js';

const copy = { line: matchLineMessages.en, details: recipeMessages.en.ingredientDetails };
const WHOLE = MILKS[1] ?? MILKS[0];

afterEach(cleanup);

function renderRow(line: MatchLine, place: Partial<LinePlace> = {}) {
    const handlers = {
        onOpen: vi.fn(),
        onPick: vi.fn(),
        onSearch: vi.fn(),
        onUseProposal: vi.fn(),
        onRetry: vi.fn(),
        onRetryPick: vi.fn(),
        onSeeWhy: vi.fn(),
    };
    const row = lineRowOf(
        line,
        { expanded: false, current: false, online: true, pending: undefined, failed: false, ...place },
        copy,
        'en',
    );

    render(
        <ul>
            <MatchRow row={row} focus={{ requested: false, onHandled: vi.fn() }} {...handlers} />
        </ul>,
    );

    return handlers;
}

describe('MatchRow (web)', () => {
    it('an open row draws the line’s list, and its controls report the line', () => {
        const { onPick, onSearch } = renderRow(makeDefaultLine(), { expanded: true });

        fireEvent.click(screen.getByRole('button', { name: 'Whole milk, Default' }));
        fireEvent.click(screen.getByRole('button', { name: 'Keep “2 cups milk” as written\u00A0· no nutrition' }));
        fireEvent.click(screen.getByRole('button', { name: 'Search for a food for 2 cups milk' }));

        expect(onPick.mock.calls).toEqual([
            ['milk', { kind: 'food', foodId: 'whole', name: 'Whole milk' }],
            ['milk', { kind: 'asWritten' }],
        ]);
        expect(onSearch).toHaveBeenCalledExactlyOnceWith('milk');
    });

    it('a closed row is one control that opens its line', () => {
        const { onOpen } = renderRow(makeDefaultLine());

        fireEvent.click(screen.getByRole('button'));

        expect(onOpen).toHaveBeenCalledExactlyOnceWith('milk');
    });

    it('Change on a settled row opens its line', () => {
        const { onOpen } = renderRow(makeConfidentLine());

        fireEvent.click(screen.getByRole('button', { name: 'Change the food for eggs' }));

        expect(onOpen).toHaveBeenCalledExactlyOnceWith('eggs');
    });

    it('a checking row: Use this binds the proposal, Search searches, each for its line', () => {
        const { onUseProposal, onSearch } = renderRow(makeCheckingLine());

        fireEvent.click(screen.getByRole('button', { name: 'Use this: Heavy whipping cream for 1/2 cup heavy cream' }));
        fireEvent.click(screen.getByRole('button', { name: 'Search for a food for 1/2 cup heavy cream' }));

        expect(onUseProposal).toHaveBeenCalledExactlyOnceWith('cream');
        expect(onSearch).toHaveBeenCalledExactlyOnceWith('cream');
    });

    it('a checking row offline: Keep as written keeps the line as written', () => {
        const { onPick } = renderRow(makeCheckingLine(), { online: false });

        fireEvent.click(screen.getByRole('button', { name: 'Keep as written: 1/2 cup heavy cream' }));

        expect(onPick).toHaveBeenCalledExactlyOnceWith('cream', { kind: 'asWritten' });
    });

    it('a failed row: Try again retries its line', () => {
        const { onRetry } = renderRow(makeOptionsFailedLine());

        fireEvent.click(screen.getByRole('button', { name: 'Try again to load the options for 2 cups milk' }));

        expect(onRetry).toHaveBeenCalledExactlyOnceWith('milk');
    });

    it('M6: Try again after a failed pick sends it again, for its line: on an open row and a settled row alike', () => {
        const open = renderRow(makeDefaultLine(), { expanded: true, failed: true });

        fireEvent.click(screen.getByRole('button', { name: 'Try again to save the choice for 2 cups milk' }));
        expect(open.onRetryPick).toHaveBeenCalledExactlyOnceWith('milk');
        cleanup();

        const settled = renderRow(makeCheckingLine(), { failed: true });

        fireEvent.click(screen.getByRole('button', { name: 'Try again to save the choice for 1/2 cup heavy cream' }));
        expect(settled.onRetryPick).toHaveBeenCalledExactlyOnceWith('cream');
        expect(settled.onRetry).not.toHaveBeenCalled();
    });

    it('See why reports the line and the review’s reason', () => {
        const { onSeeWhy } = renderRow(
            makeDefaultLine({
                binding: cookPicked(WHOLE, { suggestedFood: 'Skim milk', reason: 'The recipe says low-fat.' }),
            }),
        );

        fireEvent.click(screen.getByRole('button', { name: 'See why our check suggested Skim milk for 2 cups milk' }));

        expect(onSeeWhy).toHaveBeenCalledExactlyOnceWith('milk', 'The recipe says low-fat.');
    });

    it('a kept line draws its quiet sentence', () => {
        renderRow(makeNoMatchLine({ binding: { boundBy: 'server', pick: { kind: 'asWritten' } } }));

        expect(screen.getByRole('button', { name: 'Change the food for 1 tsp spice mix' })).toBeTruthy();
    });
});
