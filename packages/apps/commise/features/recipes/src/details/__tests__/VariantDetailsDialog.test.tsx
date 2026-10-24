/**
 * VariantDetailsDialog (web) — every state of the details dialog (curated U14; `docs/design/ingredientSpecialization.md`
 * §S8.2 to §S8.8, §S9, §S12 rows 17 to 29).
 */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { BEEF_BRISKET, BONELESS_SKINLESS_CHICKEN_THIGHS } from '../__fixtures__/seedVariants.js';
import { editEntry, loadedRead, makeDetailsModel } from '../__fixtures__/detailsModel.js';
import type { DetailsDialogEntry } from '../detailsDialogMachine.js';
import type { VariantDetailsDialogModel } from '../useVariantDetailsDialog.js';
import { VariantDetailsDialog } from '../VariantDetailsDialog.js';

afterEach(cleanup);

const ADD: DetailsDialogEntry = { mode: 'add' };
const THIGH = BONELESS_SKINLESS_CHICKEN_THIGHS[0]!;
const RETIRED = { id: 'V-retired', parts: [{ attribute: 'cut', text: 'gone cut' }] };

/** Render the dialog open over `details`. */
function renderDialog(details: VariantDetailsDialogModel, foodName = 'beef brisket') {
    return render(<VariantDetailsDialog open foodName={foodName} details={details} />);
}

describe('the frame', () => {
    it('is named by the title and the food, in add mode', () => {
        renderDialog(makeDetailsModel({ read: { kind: 'loading' }, entry: ADD }));

        expect(screen.getByRole('dialog', { name: 'Add details beef brisket' })).toBeTruthy();
    });

    it('is titled Edit details in edit mode', () => {
        renderDialog(makeDetailsModel({ read: { kind: 'loading' }, entry: editEntry(THIGH) }));

        expect(screen.getByRole('heading', { name: 'Edit details' })).toBeTruthy();
    });

    it('Close reports a dismissal', () => {
        const details = makeDetailsModel({ read: { kind: 'loading' }, entry: ADD });

        renderDialog(details);
        fireEvent.click(screen.getByRole('button', { name: 'Close details' }));

        expect(details.onClose).toHaveBeenCalledTimes(1);
    });

    it('Escape reports a dismissal', () => {
        const details = makeDetailsModel({ read: { kind: 'loading' }, entry: ADD });

        renderDialog(details);
        fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });

        expect(details.onClose).toHaveBeenCalledTimes(1);
    });
});

describe('read states', () => {
    it('loading: a status, and no search yet', () => {
        renderDialog(makeDetailsModel({ read: { kind: 'loading' }, entry: ADD }));

        expect(screen.getByRole('status').textContent).toBe('Loading details…');
        expect(screen.queryByRole('combobox')).toBeNull();
    });

    // §S12 row 17 asks for the text in the status region, once. The visible line stays for sight, hidden from a screen
    // reader, which would otherwise meet the same words twice (`docs/design/readSurfacesEvaluation.md` D5).
    it('loading: the loading text reaches a screen reader once, through the status', () => {
        renderDialog(makeDetailsModel({ read: { kind: 'loading' }, entry: ADD }));

        const exposed = screen
            .getAllByText('Loading details…')
            .filter((node) => node.closest('[aria-hidden="true"]') === null);

        expect(exposed).toEqual([screen.getByRole('status')]);
        expect(screen.getAllByText('Loading details…')).toHaveLength(2);
    });

    it('error: an alert and Try again, which takes focus and retries', () => {
        const details = makeDetailsModel({ read: { kind: 'failed' }, entry: ADD });

        renderDialog(details);

        expect(screen.getByRole('alert').textContent).toBe(
            'We couldn’t load the details. Your ingredient hasn’t changed.',
        );
        const retry = screen.getByRole('button', { name: 'Try again' });

        expect(document.activeElement).toBe(retry);
        fireEvent.click(retry);
        expect(details.onRetry).toHaveBeenCalledTimes(1);
    });

    it('offline: the shared offline slot, with no retry and no spinner', () => {
        renderDialog(makeDetailsModel({ read: { kind: 'parked' }, entry: ADD }));

        expect(screen.getByText('Waiting for a connection. This loads on its own.')).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
        expect(screen.queryByText('Loading details…')).toBeNull();
    });

    it('noVariants: says so with the food name, and offers no removal', () => {
        renderDialog(makeDetailsModel({ read: loadedRead([]), entry: ADD }), 'ground lamb');

        expect(
            screen.getByText('There are no details to pick for ground lamb right now. Your ingredient hasn’t changed.'),
        ).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'Remove details' })).toBeNull();
    });
});

describe('focus across a retry (§S8.6, §S12 row 18)', () => {
    it('error → Try again → loaded: the list arrives and takes focus from the dialog Radix left it on', () => {
        const failed = makeDetailsModel({ read: { kind: 'failed' }, entry: ADD });
        const { rerender } = render(<VariantDetailsDialog open foodName="beef brisket" details={failed} />);

        fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
        rerender(
            <VariantDetailsDialog
                open
                foodName="beef brisket"
                details={makeDetailsModel({ read: { kind: 'loading' }, entry: ADD })}
            />,
        );
        // Radix's focus scope moves focus to its container when the focused node unmounts.
        screen.getByRole('dialog').focus();
        rerender(
            <VariantDetailsDialog
                open
                foodName="beef brisket"
                details={makeDetailsModel({ read: loadedRead(BONELESS_SKINLESS_CHICKEN_THIGHS), entry: ADD })}
            />,
        );

        expect(document.activeElement).toBe(screen.getAllByRole('option')[0]);
    });

    it('error → Try again → error: focus reaches Try again again', () => {
        const failed = makeDetailsModel({ read: { kind: 'failed' }, entry: ADD });
        const { rerender } = render(<VariantDetailsDialog open foodName="beef brisket" details={failed} />);

        rerender(
            <VariantDetailsDialog
                open
                foodName="beef brisket"
                details={makeDetailsModel({ read: { kind: 'loading' }, entry: ADD })}
            />,
        );
        screen.getByRole('dialog').focus();
        rerender(<VariantDetailsDialog open foodName="beef brisket" details={failed} />);

        expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Try again' }));
    });
});

describe('the short list (combined)', () => {
    it('add: a listbox of every row, none selected, the first focused, and no footer', () => {
        renderDialog(makeDetailsModel({ read: loadedRead(BONELESS_SKINLESS_CHICKEN_THIGHS), entry: ADD }));

        const options = within(screen.getByRole('listbox')).getAllByRole('option');

        expect(options).toHaveLength(7);
        expect(options.filter((option) => option.getAttribute('aria-selected') === 'true')).toEqual([]);
        expect(document.activeElement).toBe(options[0]);
        expect(screen.queryByRole('button', { name: 'Remove details' })).toBeNull();
        expect(screen.queryByRole('combobox')).toBeNull();
    });

    it('names each option by its visible parts, then its calories', () => {
        renderDialog(makeDetailsModel({ read: loadedRead(BONELESS_SKINLESS_CHICKEN_THIGHS), entry: ADD }));

        expect(screen.getByRole('option', { name: 'with added solution, 110 cal' })).toBeTruthy();
        expect(screen.getByText('110 cal')).toBeTruthy();
    });

    it('arrows move focus and never commit; Enter and Space commit the focused row', () => {
        const details = makeDetailsModel({ read: loadedRead(BONELESS_SKINLESS_CHICKEN_THIGHS), entry: ADD });

        renderDialog(details);
        const options = screen.getAllByRole('option');

        fireEvent.keyDown(options[0]!, { key: 'ArrowDown' });
        expect(document.activeElement).toBe(options[1]);
        fireEvent.keyDown(options[1]!, { key: 'End' });
        expect(document.activeElement).toBe(options[6]);
        fireEvent.keyDown(options[6]!, { key: 'Home' });
        expect(document.activeElement).toBe(options[0]);
        fireEvent.keyDown(options[0]!, { key: 'ArrowUp' });
        expect(document.activeElement).toBe(options[0]);
        expect(details.onPick).not.toHaveBeenCalled();

        fireEvent.keyDown(options[0]!, { key: 'Enter' });
        fireEvent.keyDown(options[0]!, { key: ' ' });
        expect(details.onPick).toHaveBeenCalledTimes(2);
    });

    it('the tab stop follows the last focused row (roving tabindex)', () => {
        renderDialog(makeDetailsModel({ read: loadedRead(BONELESS_SKINLESS_CHICKEN_THIGHS), entry: ADD }));
        const options = screen.getAllByRole('option');

        fireEvent.keyDown(options[0]!, { key: 'ArrowDown' });
        fireEvent.keyDown(options[1]!, { key: 'ArrowDown' });

        expect(options.map((option) => option.tabIndex)).toEqual([-1, -1, 0, -1, -1, -1, -1]);
    });

    it('a click commits the row', () => {
        const details = makeDetailsModel({ read: loadedRead(BONELESS_SKINLESS_CHICKEN_THIGHS), entry: ADD });

        renderDialog(details);
        fireEvent.click(screen.getByRole('option', { name: 'braised, 176 cal' }));

        expect(details.onPick).toHaveBeenCalledWith(expect.objectContaining({ shownParts: ['braised'] }));
    });

    it('edit: the current line, the Current row selected and focused, and Remove details', () => {
        const details = makeDetailsModel({
            read: loadedRead(BONELESS_SKINLESS_CHICKEN_THIGHS),
            entry: editEntry(THIGH),
        });

        renderDialog(details);
        const current = screen.getByRole('option', { selected: true });

        expect(current.getAttribute('aria-label')).toMatch(/, Current, /u);
        expect(within(current).getByText('Current')).toBeTruthy();
        expect(document.activeElement).toBe(current);
        expect(screen.getByText(/^Current:/u)).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: 'Remove details' }));
        expect(details.onRemove).toHaveBeenCalledTimes(1);
    });

    it('edit, current variant retired: the cost of a change, and no row marked', () => {
        renderDialog(
            makeDetailsModel({ read: loadedRead(BONELESS_SKINLESS_CHICKEN_THIGHS), entry: editEntry(RETIRED) }),
        );

        expect(screen.getByText(/It’s no longer listed, so if you change it, you can’t pick it again\./u)).toBeTruthy();
        expect(screen.queryByRole('option', { selected: true })).toBeNull();
        expect(screen.getByText('gone cut')).toBeTruthy();
    });

    it('a row with no calorie figure says so, and never 0', () => {
        renderDialog(
            makeDetailsModel({
                read: loadedRead([{ id: 'V1', parts: [{ attribute: 'grade', text: 'select' }] }]),
                entry: ADD,
            }),
        );

        expect(screen.getByText('no figure')).toBeTruthy();
        expect(screen.getByRole('option', { name: 'select, no calorie figure' })).toBeTruthy();
    });
});

describe('the long list', () => {
    it('a combobox labelled with the count, controlling a listbox of real groups', () => {
        renderDialog(makeDetailsModel({ read: loadedRead(BEEF_BRISKET), entry: ADD }));

        const combobox = screen.getByRole('combobox', { name: 'Search 40 options' });
        const listbox = screen.getByRole('listbox');

        expect(combobox.getAttribute('aria-controls')).toBe(listbox.id);
        expect(combobox.getAttribute('aria-expanded')).toBe('true');
        expect(document.activeElement).toBe(combobox);
        expect(
            within(listbox)
                .getAllByRole('group')
                .map((group) => group.getAttribute('aria-labelledby')),
        ).toHaveLength(5);
        expect(within(listbox).getByRole('group', { name: 'flat half' })).toBeTruthy();
    });

    // A listbox holds groups and options only; the W3C APG grouped listbox gives the header `role="presentation"`, and
    // `aria-labelledby` still names its group (SC 1.3.1, `docs/design/readSurfacesEvaluation.md` D6).
    it('exposes no paragraph inside the listbox: each group header is presentation, and still names its group', () => {
        renderDialog(makeDetailsModel({ read: loadedRead(BEEF_BRISKET), entry: ADD }));

        const listbox = screen.getByRole('listbox');

        expect(within(listbox).queryAllByRole('paragraph')).toEqual([]);
        expect(within(listbox).getByRole('group', { name: 'flat half' })).toBeTruthy();
    });

    it('a grouped row shows its parts without the group part, and its name ends with it', () => {
        renderDialog(makeDetailsModel({ read: loadedRead(BEEF_BRISKET), entry: ADD }));

        const first = within(screen.getByRole('group', { name: 'flat half' })).getAllByRole('option')[0]!;

        expect(first.getAttribute('aria-label')).toBe('lean only, 0-inch trim, select, 124 cal, flat half');
    });

    it('arrows move the active row, Enter commits it, and Space types instead of committing', () => {
        const details = makeDetailsModel({ read: loadedRead(BEEF_BRISKET), entry: ADD });

        renderDialog(details);
        const combobox = screen.getByRole('combobox');

        expect(combobox.getAttribute('aria-activedescendant')).toBeNull();
        fireEvent.keyDown(combobox, { key: 'ArrowDown' });
        const active = document.getElementById(combobox.getAttribute('aria-activedescendant')!)!;

        expect(active.getAttribute('aria-selected')).toBe('true');
        expect(active.getAttribute('aria-label')).toBe('lean only, 0-inch trim, select, 124 cal, flat half');

        fireEvent.keyDown(combobox, { key: ' ' });
        expect(details.onPick).not.toHaveBeenCalled();

        fireEvent.keyDown(combobox, { key: 'Enter' });
        expect(details.onPick).toHaveBeenCalledTimes(1);
    });

    it('edit: the current row starts active', () => {
        const flat = BEEF_BRISKET[0]!;

        renderDialog(makeDetailsModel({ read: loadedRead(BEEF_BRISKET), entry: editEntry(flat) }));
        const combobox = screen.getByRole('combobox');
        const active = document.getElementById(combobox.getAttribute('aria-activedescendant')!)!;

        expect(active.getAttribute('aria-label')).toMatch(/, Current, /u);
    });

    it('typing reports the query, and the count is announced politely once it settles', () => {
        const details = makeDetailsModel(
            { read: loadedRead(BEEF_BRISKET), entry: ADD, query: 'navel' },
            { announcedCount: { kind: 'matches', shown: 4, total: 40 } },
        );

        renderDialog(details);
        fireEvent.change(screen.getByRole('combobox'), { target: { value: 'navel e' } });

        expect(details.onQueryChange).toHaveBeenCalledWith('navel e');
        expect(screen.getByRole('status').textContent).toBe('4 of 40 options');
        expect(screen.getAllByRole('group')).toHaveLength(1);
    });

    it('noMatches: says so through the always-mounted status, collapses the combobox, and Clear keeps focus', () => {
        const details = makeDetailsModel(
            { read: loadedRead(BEEF_BRISKET), entry: ADD, query: 'zzz' },
            { announcedCount: { kind: 'noMatches', query: 'zzz', total: 40 } },
        );

        renderDialog(details);
        const combobox = screen.getByRole('combobox');

        expect(screen.getByRole('status').textContent).toBe('Nothing matches “zzz”. Clear the search to see all 40.');
        expect(combobox.getAttribute('aria-expanded')).toBe('false');
        expect(combobox.getAttribute('aria-controls')).toBeNull();

        fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
        expect(details.onClearQuery).toHaveBeenCalledTimes(1);
        expect(document.activeElement).toBe(combobox);
    });

    // Shown at once, said once typing stops (§S8.5, `docs/design/readSurfacesEvaluation.md` D4).
    it('noMatches, still typing: shows the text, and the status says nothing yet', () => {
        renderDialog(makeDetailsModel({ read: loadedRead(BEEF_BRISKET), entry: ADD, query: 'zzz' }));

        expect(screen.getByText('Nothing matches “zzz”. Clear the search to see all 40.')).toBeTruthy();
        expect(screen.getByRole('status').textContent).toBe('');
    });

    it('edit: the current row starts active AND is scrolled into view', () => {
        // jsdom has no `scrollIntoView` (`vitest.setup.ts` stands in a no-op); record calls for this case only.
        const original = Element.prototype.scrollIntoView;
        const scrolled = vi.fn();

        Element.prototype.scrollIntoView = scrolled;

        try {
            const flat = BEEF_BRISKET[0]!;

            renderDialog(makeDetailsModel({ read: loadedRead(BEEF_BRISKET), entry: editEntry(flat) }));
            const combobox = screen.getByRole('combobox');

            expect(scrolled.mock.contexts).toContain(
                document.getElementById(combobox.getAttribute('aria-activedescendant')!),
            );
        } finally {
            Element.prototype.scrollIntoView = original;
        }
    });

    it('edit: when a cleared search brings the list back, the ACTIVE row is the one scrolled into view (SC 2.4.11)', () => {
        const original = Element.prototype.scrollIntoView;
        const scrolled = vi.fn();

        Element.prototype.scrollIntoView = scrolled;

        try {
            const entry = editEntry(BEEF_BRISKET[0]!);
            const { rerender } = renderDialog(makeDetailsModel({ read: loadedRead(BEEF_BRISKET), entry }));

            fireEvent.keyDown(screen.getByRole('combobox'), { key: 'ArrowDown' });
            fireEvent.keyDown(screen.getByRole('combobox'), { key: 'ArrowDown' });
            const chosenId = screen.getByRole('combobox').getAttribute('aria-activedescendant');

            expect(scrolled.mock.contexts.at(-1), 'each move scrolls the new active row').toBe(
                document.getElementById(chosenId!),
            );

            for (const query of ['zzz', '']) {
                rerender(
                    <VariantDetailsDialog
                        open
                        foodName="beef brisket"
                        details={makeDetailsModel({ read: loadedRead(BEEF_BRISKET), entry, query })}
                    />,
                );
            }

            expect(screen.getByRole('combobox').getAttribute('aria-activedescendant')).toBe(chosenId);
            expect(scrolled.mock.contexts.at(-1)).toBe(document.getElementById(chosenId!));
        } finally {
            Element.prototype.scrollIntoView = original;
        }
    });
});

describe('detailsNoneLeft', () => {
    it('shows the current line and the consequence, with Close then Remove details', () => {
        const details = makeDetailsModel({ read: loadedRead([]), entry: editEntry(RETIRED) });

        renderDialog(details, 'beef brisket');

        expect(screen.getByText(/^Current:/u)).toBeTruthy();
        expect(screen.getByText(/There are no other details for beef brisket now\./u)).toBeTruthy();
        const close = screen.getByRole('button', { name: 'Close' });
        const remove = screen.getByRole('button', { name: 'Remove details' });

        expect(close.compareDocumentPosition(remove) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        fireEvent.click(close);
        expect(details.onClose).toHaveBeenCalledTimes(1);
        fireEvent.click(remove);
        expect(details.onRemove).toHaveBeenCalledTimes(1);
    });
});

/**
 * §S8.2 "Footer": full width below 640 px, content width at the end of a row from 640 px. That is the Button's
 * `width="fill"` (R9): the wrapper stretches across a column and the button takes its width, while a row keeps the
 * content width. jsdom lays nothing out, so this pins the Button's fill classes (its own suite's precedent); the widths
 * are measured in `web/tests/e2e/variantDetailsDialogFooter.spec.ts` (`docs/design/readSurfacesEvaluation.md` D2).
 */
describe('the footer’s buttons fill it below 640 px', () => {
    const expectFills = (button: HTMLElement): void => {
        expect(button.classList.contains('w-full')).toBe(true);
        expect(button.parentElement?.classList.contains('self-stretch')).toBe(true);
    };

    it('edit: Remove details fills', () => {
        renderDialog(makeDetailsModel({ read: loadedRead(BONELESS_SKINLESS_CHICKEN_THIGHS), entry: editEntry(THIGH) }));

        expectFills(screen.getByRole('button', { name: 'Remove details' }));
    });

    it('detailsNoneLeft: Close and Remove details both fill', () => {
        renderDialog(makeDetailsModel({ read: loadedRead([]), entry: editEntry(RETIRED) }));

        expectFills(screen.getByRole('button', { name: 'Close' }));
        expectFills(screen.getByRole('button', { name: 'Remove details' }));
    });
});

describe('the host’s moment to move on', () => {
    it('reports onDismissed once the dialog is gone after a close, and never while it is open', async () => {
        const details = makeDetailsModel({ read: { kind: 'loading' }, entry: ADD });
        const onDismissed = vi.fn();
        const { rerender } = render(
            <VariantDetailsDialog open foodName="beef brisket" details={details} onDismissed={onDismissed} />,
        );

        expect(onDismissed).not.toHaveBeenCalled();
        rerender(
            <VariantDetailsDialog open={false} foodName="beef brisket" details={details} onDismissed={onDismissed} />,
        );
        await new Promise((resolve) => {
            setTimeout(resolve, 0);
        });

        expect(onDismissed).toHaveBeenCalledTimes(1);
    });
});
