// @vitest-environment jsdom
/**
 * Component tests for the web `ImportFlaggedList` (board FlaggedLine; `ingredientMatching.md` "Bulk import"): "N to
 * check", each doubted line with its recipe and the doubted match, ONE action per row ("Use Whole milk") and "Choose
 * another", whose accessible name is "Choose another food for {line}", with a 44 px target; the open line's options
 * beside the list at the wide class only.
 *
 * REWRITTEN for the UI fix pass (2026-10-25), seen red first: the second control is "Choose another" (design session,
 * `import.flagged.chooseAnother`; staff-ux U7), it was "Search" named by the matched line's `searchName`; and "Use
 * {food}" carries a pending send, so a double press cannot send twice (M5).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { ImportFlaggedList } from '../ImportFlaggedList.js';
import { importMessages } from '../messages.js';
import type { PendingSend } from '../../ingredientMatching/matchLine.js';
import type { ImportFlaggedLineItem, ImportFlaggedListProps } from '../props.js';

const f = importMessages.en.flagged;

afterEach(cleanup);

const MILK: ImportFlaggedLineItem = {
    key: 'milk',
    text: '1 1/4 cups milk',
    recipeTitle: 'Pancakes',
    matchedFood: 'milk crackers',
    suggestion: { foodId: 'f-whole', name: 'Whole milk' },
};
const SPICE: ImportFlaggedLineItem = {
    key: 'spice',
    text: '1 tsp mixed spice',
    recipeTitle: 'Hot cross buns',
    matchedFood: 'Spice cake',
};

function renderList(overrides: Partial<ImportFlaggedListProps> = {}) {
    const onUseSuggestion = vi.fn();
    const onChooseAnother = vi.fn();
    render(
        <ImportFlaggedList
            total={23}
            lines={[MILK, SPICE]}
            pending={new Map()}
            onUseSuggestion={onUseSuggestion}
            onChooseAnother={onChooseAnother}
            {...overrides}
        />,
    );

    return { onUseSuggestion, onChooseAnother };
}

const itemOf = (text: string) =>
    screen.getAllByRole('listitem').find((item) => item.textContent?.includes(text)) as HTMLElement;

describe('ImportFlaggedList (web)', () => {
    it('heads the page “23 to check” and says nothing changes until the cook chooses', () => {
        renderList();

        expect(screen.getByRole('heading', { level: 1, name: '23 to check' })).toBeTruthy();
        expect(
            screen.getByText(
                'Our check doubted 23 of the matches it picked for you. Nothing changes until you choose.',
            ),
        ).toBeTruthy();
    });

    it('each row: the line and its recipe, the doubted match, one Use action and Choose another', async () => {
        const user = userEvent.setup();
        const { onUseSuggestion, onChooseAnother } = renderList();

        const row = itemOf('1 1/4 cups milk');

        expect(within(row).getByText('1 1/4 cups milk · Pancakes')).toBeTruthy();
        expect(within(row).getByText('Matched to milk crackers. Our check doubts it.')).toBeTruthy();

        const use = within(row).getByRole('button', { name: 'Use Whole milk for 1 1/4 cups milk' });
        const another = within(row).getByRole('button', { name: 'Choose another food for 1 1/4 cups milk' });

        expect(use.textContent).toContain('Use Whole milk');
        expect(another.textContent).toBe(f.chooseAnother);
        expect(f.chooseAnother).toBe('Choose another');
        expect(another.getAttribute('aria-label')?.startsWith(f.chooseAnother)).toBe(true);
        expect(within(row).getAllByRole('button')).toHaveLength(2);

        await user.click(use);
        await user.click(another);

        expect(onUseSuggestion).toHaveBeenCalledWith('milk');
        expect(onChooseAnother).toHaveBeenCalledWith('milk');
    });

    it('gives Choose another a 44 px target at every pointer: the 36 px small button with its hit overlay', () => {
        renderList();

        // `sm` is the one size whose hit area stays 44 px under a fine pointer (`@commise/ui` `surfaceClass.ts`): a
        // transparent `::before` 4 px above and below its 36 px box. `md` drops its floor to 0 for a mouse.
        const classes = screen
            .getByRole('button', { name: 'Choose another food for 1 1/4 cups milk' })
            .className.split(' ');

        expect(classes).toEqual(expect.arrayContaining(['min-h-9', 'before:-inset-y-1']));
        expect(classes.some((token) => token.includes('min-h-0'))).toBe(false);
    });

    it('a row with no suggestion offers Choose another alone', () => {
        renderList();

        expect(within(itemOf('1 tsp mixed spice')).getAllByRole('button')).toEqual([
            screen.getByRole('button', { name: 'Choose another food for 1 tsp mixed spice' }),
        ]);
    });

    it('⛔ M5: Use in flight reads busy and keeps focus; neither it nor Choose another sends again', async () => {
        const user = userEvent.setup();
        const pending: ReadonlyMap<string, PendingSend> = new Map([['milk', { kind: 'useProposal' }]]);
        const { onUseSuggestion, onChooseAnother } = renderList({ pending });

        const use = screen.getByRole('button', { name: 'Use Whole milk for 1 1/4 cups milk' });
        const another = screen.getByRole('button', { name: 'Choose another food for 1 1/4 cups milk' });

        expect(use.getAttribute('aria-busy')).toBe('true');
        expect(another.getAttribute('aria-disabled')).toBe('true');
        expect(another.hasAttribute('disabled')).toBe(false);

        await user.click(use);
        await user.click(another);

        expect(onUseSuggestion).not.toHaveBeenCalled();
        expect(onChooseAnother).not.toHaveBeenCalled();
    });

    it('M5: a send for ANOTHER line leaves this line’s controls free', async () => {
        const user = userEvent.setup();
        const pending: ReadonlyMap<string, PendingSend> = new Map([['spice', { kind: 'searchPick' }]]);
        const { onUseSuggestion } = renderList({ pending });

        await user.click(screen.getByRole('button', { name: 'Use Whole milk for 1 1/4 cups milk' }));

        expect(onUseSuggestion).toHaveBeenCalledWith('milk');
        expect(
            screen
                .getByRole('button', { name: 'Choose another food for 1 tsp mixed spice' })
                .getAttribute('aria-disabled'),
        ).toBe('true');
    });

    it('a pick from the line’s options in flight refuses Use too, without reading busy on it', () => {
        const pending: ReadonlyMap<string, PendingSend> = new Map([['milk', { kind: 'searchPick' }]]);

        renderList({ pending });

        const use = screen.getByRole('button', { name: 'Use Whole milk for 1 1/4 cups milk' });

        expect(use.getAttribute('aria-disabled')).toBe('true');
        expect(use.hasAttribute('aria-busy')).toBe(false);
    });

    it('says the lines also carry a mark in their recipes', () => {
        renderList();

        expect(
            screen.getByText(
                'Each line also has a mark in its recipe. “23 to check” stays at the top of My recipes until you are done.',
            ),
        ).toBeTruthy();
    });

    it('the footer says the title’s own words, so one line reads “1 to check”', () => {
        renderList({ total: 1 });

        expect(screen.getByRole('heading', { level: 1, name: '1 to check' })).toBeTruthy();
        expect(
            screen.getByText('Our check doubted 1 of the matches it picked for you. Nothing changes until you choose.'),
        ).toBeTruthy();
        expect(
            screen.getByText(
                'Each line also has a mark in its recipe. “1 to check” stays at the top of My recipes until you are done.',
            ),
        ).toBeTruthy();
    });

    it('draws the open line’s options beside the list at the wide class only, and nothing without them', () => {
        renderList({ detail: <section aria-label="options pane" /> });

        expect(screen.getByRole('region', { name: 'options pane' }).parentElement?.className.split(' ')).toEqual(
            expect.arrayContaining(['hidden', '@wide/main:block']),
        );
        cleanup();

        renderList();
        expect(screen.queryByRole('region')).toBeNull();
    });
});
