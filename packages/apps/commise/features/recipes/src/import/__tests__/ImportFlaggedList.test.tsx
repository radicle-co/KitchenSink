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
    const onRetry = vi.fn();
    render(
        <ImportFlaggedList
            total={23}
            lines={[MILK, SPICE]}
            pending={new Map()}
            failed={new Set()}
            announcement={{ text: '', occurrence: 0 }}
            onUseSuggestion={onUseSuggestion}
            onChooseAnother={onChooseAnother}
            onRetry={onRetry}
            {...overrides}
        />,
    );

    return { onUseSuggestion, onChooseAnother, onRetry };
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

    it('⛔ M6: a Use that did not save says so on its row, in the shared words, with Try again naming the line', async () => {
        const user = userEvent.setup();
        const { onUseSuggestion, onRetry } = renderList({ failed: new Set(['milk']) });

        const row = itemOf('1 1/4 cups milk');
        const retry = within(row).getByRole('button', { name: 'Try again to save the choice for 1 1/4 cups milk' });

        expect(within(row).getByText('We couldn’t save that choice.')).toBeTruthy();
        expect(retry.textContent).toBe('Try again');
        expect(within(itemOf('1 tsp mixed spice')).queryByText('We couldn’t save that choice.')).toBeNull();

        // Try again hands the row's key to the host, which repeats the action that failed (`sendLedger.retryOf`);
        // it is NOT the Use again: the failed action may have been a pick from the options sheet.
        await user.click(retry);

        expect(onRetry).toHaveBeenCalledExactlyOnceWith('milk');
        expect(onUseSuggestion).not.toHaveBeenCalled();

        for (const button of within(row).getAllByRole('button')) {
            expect(button.hasAttribute('disabled')).toBe(false);
        }
    });

    it('⛔ replay: Try again on each failed row reports THAT row, whatever the failed action was', async () => {
        const user = userEvent.setup();
        const { onRetry, onUseSuggestion, onChooseAnother } = renderList({ failed: new Set(['milk', 'spice']) });

        await user.click(
            within(itemOf('1 tsp mixed spice')).getByRole('button', {
                name: 'Try again to save the choice for 1 tsp mixed spice',
            }),
        );
        await user.click(
            within(itemOf('1 1/4 cups milk')).getByRole('button', {
                name: 'Try again to save the choice for 1 1/4 cups milk',
            }),
        );

        expect(onRetry.mock.calls).toEqual([['spice'], ['milk']]);
        expect(onUseSuggestion).not.toHaveBeenCalled();
        expect(onChooseAnother).not.toHaveBeenCalled();
    });

    it('M6: a retry in flight hides the failure; the busy Use says what is happening and keeps focus', () => {
        const pending: ReadonlyMap<string, PendingSend> = new Map([['milk', { kind: 'useProposal' }]]);

        renderList({ failed: new Set(['milk']), pending });

        const use = screen.getByRole('button', { name: 'Use Whole milk for 1 1/4 cups milk' });

        expect(screen.queryByText('We couldn’t save that choice.')).toBeNull();
        expect(use.getAttribute('aria-busy')).toBe('true');
        expect(use.hasAttribute('disabled')).toBe(false);
    });

    it('M6: no failure, no failure line', () => {
        renderList();

        expect(screen.queryByText('We couldn’t save that choice.')).toBeNull();
    });

    it('⛔ U9: the page has ONE polite live region, saying what the host announces, outside every row', () => {
        renderList({ announcement: { text: 'We couldn’t save the choice for 1 1/4 cups milk.', occurrence: 1 } });

        const spoken = screen.getAllByRole('status').filter((region) => region.textContent !== '');

        expect(spoken.map((region) => region.textContent)).toEqual([
            'We couldn’t save the choice for 1 1/4 cups milk.',
        ]);
        expect(spoken.every((region) => region.closest('li') === null)).toBe(true);
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

/**
 * WCAG 2.2 SC 2.4.3 (Focus Order): the flagged list's Try again unmounts while its retry is in flight. Focus lands on
 * the row's Use (busy, refused, never natively disabled), or on Choose another when the row has no Use, and returns to
 * the new Try again if the retry fails again. A first failure moves nothing.
 */
describe('ImportFlaggedList (web): Try again keeps focus (WCAG 2.4.3)', () => {
    const MILK_RETRY = 'Try again to save the choice for 1 1/4 cups milk';
    const SPICE_RETRY = 'Try again to save the choice for 1 tsp mixed spice';
    const USE_MILK = 'Use Whole milk for 1 1/4 cups milk';
    const USING: PendingSend = { kind: 'useProposal' };

    const listWith = (props: Partial<ImportFlaggedListProps>) => (
        <>
            <button type="button">Elsewhere</button>
            <ImportFlaggedList
                total={2}
                lines={[MILK, SPICE]}
                pending={new Map()}
                failed={new Set()}
                announcement={{ text: '', occurrence: 0 }}
                onUseSuggestion={vi.fn()}
                onChooseAnother={vi.fn()}
                onRetry={vi.fn()}
                {...props}
            />
        </>
    );

    it('⛔ pressing Try again lands focus on the Use being retried, busy and not natively disabled', async () => {
        const user = userEvent.setup();
        const failed = new Set(['milk']);
        const { rerender } = render(listWith({ failed }));

        await user.click(screen.getByRole('button', { name: MILK_RETRY }));
        rerender(listWith({ failed, pending: new Map([['milk', USING]]) }));

        const use = screen.getByRole('button', { name: USE_MILK });

        expect(screen.queryByRole('button', { name: MILK_RETRY })).toBeNull();
        expect(document.activeElement).toBe(use);
        expect(use.getAttribute('aria-busy')).toBe('true');
        expect(use.hasAttribute('disabled')).toBe(false);
    });

    it('⛔ a retry that fails again returns focus to the new Try again', async () => {
        const user = userEvent.setup();
        const failed = new Set(['milk']);
        const { rerender } = render(listWith({ failed }));

        await user.click(screen.getByRole('button', { name: MILK_RETRY }));
        rerender(listWith({ failed, pending: new Map([['milk', USING]]) }));
        rerender(listWith({ failed }));

        expect(document.activeElement).toBe(screen.getByRole('button', { name: MILK_RETRY }));
    });

    it('a retry that succeeds leaves focus on the Use, where a successful first Use leaves it', async () => {
        const user = userEvent.setup();
        const failed = new Set(['milk']);
        const { rerender } = render(listWith({ failed }));

        await user.click(screen.getByRole('button', { name: MILK_RETRY }));
        rerender(listWith({ failed, pending: new Map([['milk', USING]]) }));
        rerender(listWith({}));

        expect(screen.queryByRole('button', { name: MILK_RETRY })).toBeNull();
        expect(document.activeElement).toBe(screen.getByRole('button', { name: USE_MILK }));
    });

    it('a row with no Use lands on its Choose another: refused, not natively disabled', async () => {
        const user = userEvent.setup();
        const failed = new Set(['spice']);
        const { rerender } = render(listWith({ failed }));

        await user.click(screen.getByRole('button', { name: SPICE_RETRY }));
        rerender(listWith({ failed, pending: new Map([['spice', USING]]) }));

        const another = screen.getByRole('button', { name: 'Choose another food for 1 tsp mixed spice' });

        expect(document.activeElement).toBe(another);
        expect(another.hasAttribute('disabled')).toBe(false);
    });

    it('a first failure does not pull focus from where the cook has gone', () => {
        const { rerender } = render(listWith({ pending: new Map([['milk', USING]]) }));
        const elsewhere = screen.getByRole('button', { name: 'Elsewhere' });

        elsewhere.focus();
        rerender(listWith({ failed: new Set(['milk']) }));

        expect(document.activeElement).toBe(elsewhere);
    });

    it('a retry on one row leaves another row’s first send alone', async () => {
        const user = userEvent.setup();
        const failed = new Set(['milk']);
        const { rerender } = render(listWith({ failed }));

        await user.click(screen.getByRole('button', { name: MILK_RETRY }));
        rerender(
            listWith({
                failed,
                pending: new Map<string, PendingSend>([
                    ['milk', USING],
                    ['spice', USING],
                ]),
            }),
        );

        expect(document.activeElement).toBe(screen.getByRole('button', { name: USE_MILK }));
    });
});

/**
 * Focus after a Use SAVES (host gap rule 3, WCAG 2.4.3): the saved row leaves the list and the Use that held focus
 * unmounts with it, so the host names where focus goes next (`flaggedFocusAfterSave`): the next row's landing control, or
 * the page heading when no row is left. The list takes the request as props and lowers it once it has landed.
 */
describe('ImportFlaggedList (web): focus after a Use saves (WCAG 2.4.3)', () => {
    it('⛔ lands on the next row’s Use when the host asks, and reports it handled once', () => {
        const onHandled = vi.fn();

        renderList({ rowFocus: { key: 'milk', landing: 'use', onHandled } });

        expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Use Whole milk for 1 1/4 cups milk' }));
        expect(onHandled).toHaveBeenCalledTimes(1);
    });

    it('⛔ lands on Choose another for a row the check offered no food for', () => {
        const onHandled = vi.fn();

        renderList({ rowFocus: { key: 'spice', landing: 'chooseAnother', onHandled } });

        expect(document.activeElement).toBe(
            screen.getByRole('button', { name: 'Choose another food for 1 tsp mixed spice' }),
        );
        expect(onHandled).toHaveBeenCalledTimes(1);
    });

    it('takes no focus when the host asked for nothing', () => {
        renderList();

        expect(document.activeElement).toBe(document.body);
    });

    it('⛔ lands on the heading when no row is left, which is focusable but not a tab stop', () => {
        const { rerender } = render(
            <ImportFlaggedList
                total={0}
                lines={[]}
                pending={new Map()}
                failed={new Set()}
                announcement={{ text: '', occurrence: 0 }}
                onUseSuggestion={vi.fn()}
                onChooseAnother={vi.fn()}
                onRetry={vi.fn()}
                headingFocusSignal={0}
            />,
        );
        const heading = screen.getByRole('heading', { level: 1 });

        expect(heading.getAttribute('tabindex')).toBe('-1');
        expect(document.activeElement).toBe(document.body);

        rerender(
            <ImportFlaggedList
                total={0}
                lines={[]}
                pending={new Map()}
                failed={new Set()}
                announcement={{ text: '', occurrence: 0 }}
                onUseSuggestion={vi.fn()}
                onChooseAnother={vi.fn()}
                onRetry={vi.fn()}
                headingFocusSignal={1}
            />,
        );

        expect(document.activeElement).toBe(heading);
    });
});
