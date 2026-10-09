/**
 * Combobox (web) — the APG combobox with list autocomplete and manual selection
 * (`docs/design/ingredientStatusExplanation.md` §3: 2.1.1, 2.1.2, 2.4.11, 2.5.8, 3.2.2, 3.3.2, 4.1.2, 4.1.3; §3e), on
 * downshift `useCombobox` and `@floating-ui/react-dom` (`docs/design/rowEditorBlueprint.md` decision 3).
 *
 * Covers the roles and states; the whole keyboard model, including the cases downshift handles differently by default
 * (Home/End, Escape on a closed list, Tab, Enter with nothing active, Enter while an IME is composing, a press in the
 * field); that typing never selects and never moves the caret; that the highlight follows an option's key when the
 * list changes; a press; a busy option; the list's loading and note lines; the order inside the entry
 * (`docs/design/rowEditorOpenDecisions.md` R1); the polite count, spoken only while the list shows, and the alert,
 * never held back (R3); where the list is placed; the field's focus; and a host's focus request.
 *
 * jsdom has no layout, so the placement cases stub the geometry floating-ui reads. Scrolling the active option into
 * view needs real layout too; this suite pins only that the listbox and the card scroll, and what the scroll is asked
 * to do; the scroll itself is proved where a page renders the field (B8's Playwright specs, and for the card,
 * `ingredientListGeometry.spec.ts` case D).
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { compute } from 'compute-scroll-into-view';
import { useState, type FC } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PopupInsetsContext, type PopupInsets } from '../../popupInsets/popupInsetsContext.js';
import { Combobox } from '../Combobox.js';
import type { ComboboxGroup, ComboboxProps, ComboboxStatus } from '../props.js';
import { watchRegion } from './regionSpeech.js';

// A spy that calls through: what the leaf asks its scroll to do is recorded, and jsdom, which has no layout, scrolls
// nothing either way.
vi.mock(import('compute-scroll-into-view'), { spy: true });

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

const FLOUR = { key: 'flour', label: 'Flour' } as const;

const GROUPS: readonly ComboboxGroup[] = [
    { key: 'own', label: 'Your ingredients', options: [FLOUR] },
    {
        key: 'catalog',
        label: 'Food catalog',
        options: [
            { key: 'flax', label: 'Flaxseed' },
            { key: 'flank', label: 'Beef flank' },
        ],
    },
];

type HostProps = Partial<ComboboxProps> & { readonly initial?: string; readonly onSubmit?: () => void };

/** A controlled host inside a form: it keeps the text, and the list has options once anything is typed. */
const Host: FC<HostProps> = ({ initial = '', onSubmit, ...overrides }) => {
    const [value, setValue] = useState(initial);

    return (
        <form
            onSubmit={(event) => {
                event.preventDefault();
                onSubmit?.();
            }}
        >
            <Combobox
                label="Add an ingredient"
                listLabel="Food suggestions"
                value={value}
                onValueChange={setValue}
                groups={value === '' ? [] : GROUPS}
                onSelect={vi.fn()}
                countAnnouncement=""
                {...overrides}
            />
            <button type="button">Elsewhere</button>
        </form>
    );
};

const field = (): HTMLInputElement => screen.getByRole('combobox', { name: 'Add an ingredient' });
const option = (name: string): HTMLElement => screen.getByRole('option', { name });

const activeOptionName = (): string | undefined => {
    const id = field().getAttribute('aria-activedescendant');

    return id === null ? undefined : (document.getElementById(id)?.textContent ?? undefined);
};

/** Opens the list on a field that already holds text, with nothing active (Alt+Down, APG). */
const openWithNothingActive = async (user: ReturnType<typeof userEvent.setup>): Promise<void> => {
    field().focus();
    await user.keyboard('{Alt>}{ArrowDown}{/Alt}');
};

describe('Combobox (web) — roles and states at rest', () => {
    it('is a combobox with list autocomplete, collapsed, controlling nothing yet', () => {
        render(<Host />);

        expect(field().getAttribute('aria-autocomplete')).toBe('list');
        expect(field().getAttribute('aria-expanded')).toBe('false');
        expect(field().getAttribute('aria-controls')).toBeNull();
        expect(field().getAttribute('aria-activedescendant')).toBeNull();
        expect(screen.queryByRole('listbox')).toBeNull();
    });

    it('describes the field by its hint, then by the id it is given, and marks it invalid', () => {
        render(
            <div>
                <p id="row-note">No food chosen</p>
                <Host hint="Type to search foods, then choose one." describedBy="row-note" invalid />
            </div>,
        );
        const ids = (field().getAttribute('aria-describedby') ?? '').split(' ');

        expect(document.getElementById(ids[0] ?? '')?.textContent).toBe('Type to search foods, then choose one.');
        expect(ids[1]).toBe('row-note');
        expect(field().getAttribute('aria-invalid')).toBe('true');
    });
});

describe('Combobox (web) — a leading glyph (`docs/design/rowEditorOpenDecisions.md` item 3)', () => {
    it('draws it before the field, hidden from assistive technology: the field’s name says what it does', () => {
        render(<Host leadingIcon={<svg role="img" aria-label="plus" />} />);
        const glyph = screen.getByLabelText('plus', { selector: 'svg' });
        const wrapper = glyph.parentElement;

        expect(wrapper?.getAttribute('aria-hidden')).toBe('true');
        expect(screen.queryByRole('img', { name: 'plus' })).toBeNull();
        expect(wrapper?.compareDocumentPosition(field()) ?? 0).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    });
});

describe('Combobox (web) — typing shows suggestions and never selects (3.2.2)', () => {
    it('opens a labelled listbox the field controls, with nothing active and nothing chosen', async () => {
        const user = userEvent.setup();
        const onSelect = vi.fn();
        render(<Host onSelect={onSelect} />);

        await user.type(field(), 'fl');

        const listbox = screen.getByRole('listbox', { name: 'Food suggestions' });
        expect(field().getAttribute('aria-expanded')).toBe('true');
        expect(field().getAttribute('aria-controls')).toBe(listbox.id);
        expect(field().getAttribute('aria-activedescendant')).toBeNull();
        expect(onSelect).not.toHaveBeenCalled();
        expect(field().value).toBe('fl');
    });

    it('labels each run of options as a group', async () => {
        const user = userEvent.setup();
        render(<Host />);

        await user.type(field(), 'f');

        expect(within(screen.getByRole('group', { name: 'Food catalog' })).getAllByRole('option')).toHaveLength(2);
        expect(within(screen.getByRole('group', { name: 'Your ingredients' })).getAllByRole('option')).toHaveLength(1);
    });

    it('⛔ typing in the middle of the text keeps the caret where the cook is typing', async () => {
        const user = userEvent.setup();
        render(<Host initial="flour" />);

        await user.type(field(), 'x', { initialSelectionStart: 2, initialSelectionEnd: 2 });

        expect(field().value).toBe('flxour');
        expect(field().selectionStart).toBe(3);
    });

    it('typing releases an active option, so nothing stays chosen for the new text', async () => {
        const user = userEvent.setup();
        render(<Host initial="f" />);
        field().focus();
        await user.keyboard('{ArrowDown}');
        expect(activeOptionName()).toBe('Flour');

        await user.keyboard('l');

        expect(field().getAttribute('aria-activedescendant')).toBeNull();
        expect(screen.getByRole('listbox')).toBeTruthy();
    });
});

describe('Combobox (web) — opening the list from the keyboard (2.1.1)', () => {
    it('Down on a closed list opens it on the FIRST option', async () => {
        const user = userEvent.setup();
        render(<Host initial="f" />);
        field().focus();

        await user.keyboard('{ArrowDown}');

        expect(field().getAttribute('aria-expanded')).toBe('true');
        expect(activeOptionName()).toBe('Flour');
    });

    it('Up on a closed list opens it on the LAST option', async () => {
        const user = userEvent.setup();
        render(<Host initial="f" />);
        field().focus();

        await user.keyboard('{ArrowUp}');

        expect(activeOptionName()).toBe('Beef flank');
    });

    it('Alt+Down opens the list and leaves visual focus in the field', async () => {
        const user = userEvent.setup();
        render(<Host initial="f" />);

        await openWithNothingActive(user);

        expect(screen.getByRole('listbox')).toBeTruthy();
        expect(field().getAttribute('aria-activedescendant')).toBeNull();
    });

    it('Down with no options shows the list’s status line, with no listbox and nothing active', async () => {
        const user = userEvent.setup();
        render(<Host initial="f" groups={[]} status={{ kind: 'note', text: 'No foods match.' }} />);
        field().focus();

        await user.keyboard('{ArrowDown}');

        expect(screen.getByText('No foods match.')).toBeTruthy();
        expect(screen.queryByRole('listbox')).toBeNull();
        expect(field().getAttribute('aria-expanded')).toBe('false');
        expect(field().getAttribute('aria-activedescendant')).toBeNull();
    });
});

describe('Combobox (web) — moving through an open list (2.1.1, 4.1.2)', () => {
    it('Down moves across groups in display order; the active option is selected and is the active descendant', async () => {
        const user = userEvent.setup();
        render(<Host initial="f" />);
        field().focus();

        await user.keyboard('{ArrowDown}');
        expect(field().getAttribute('aria-activedescendant')).toBe(option('Flour').id);
        expect(option('Flour').getAttribute('aria-selected')).toBe('true');

        await user.keyboard('{ArrowDown}');
        expect(field().getAttribute('aria-activedescendant')).toBe(option('Flaxseed').id);
        expect(option('Flour').getAttribute('aria-selected')).toBe('false');
        expect(option('Flaxseed').getAttribute('aria-selected')).toBe('true');
    });

    it('Down wraps from the last option to the first', async () => {
        const user = userEvent.setup();
        render(<Host initial="f" />);
        field().focus();

        await user.keyboard('{ArrowUp}{ArrowDown}');

        expect(activeOptionName()).toBe('Flour');
    });

    it('Up wraps from the first option to the last, then moves back', async () => {
        const user = userEvent.setup();
        render(<Host initial="f" />);
        field().focus();

        await user.keyboard('{ArrowDown}{ArrowUp}');
        expect(activeOptionName()).toBe('Beef flank');

        await user.keyboard('{ArrowUp}');
        expect(activeOptionName()).toBe('Flaxseed');
    });

    it('Down and Up from the field (nothing active) enter at the first and the last option', async () => {
        const user = userEvent.setup();
        render(<Host initial="f" />);
        await openWithNothingActive(user);

        await user.keyboard('{ArrowDown}');
        expect(activeOptionName()).toBe('Flour');

        await user.keyboard('{Escape}');
        await openWithNothingActive(user);
        await user.keyboard('{ArrowUp}');
        expect(activeOptionName()).toBe('Beef flank');
    });

    it('Alt+Up closes the list and chooses nothing', async () => {
        const user = userEvent.setup();
        const onSelect = vi.fn();
        render(<Host initial="f" onSelect={onSelect} />);
        field().focus();
        await user.keyboard('{ArrowDown}{ArrowDown}');

        await user.keyboard('{Alt>}{ArrowUp}{/Alt}');

        expect(screen.queryByRole('listbox')).toBeNull();
        expect(onSelect).not.toHaveBeenCalled();
        expect(field().value).toBe('f');
    });

    it.each([
        ['{Home}', 0],
        ['{End}', 'flax'.length],
    ])(
        '⛔ %s belongs to the text field (§3e): the caret moves and the active option is released',
        async (key, caret) => {
            const user = userEvent.setup();
            render(<Host initial="flax" />);
            field().focus();
            field().setSelectionRange(2, 2);
            await user.keyboard('{ArrowDown}');

            await user.keyboard(key);

            expect(field().selectionStart).toBe(caret);
            expect(field().getAttribute('aria-activedescendant')).toBeNull();
            expect(screen.getByRole('listbox')).toBeTruthy();
        },
    );

    it.each(['{ArrowLeft}', '{ArrowRight}'])(
        '%s moves the caret and releases the active option (visual focus returns to the field)',
        async (key) => {
            const user = userEvent.setup();
            render(<Host initial="flax" />);
            field().focus();
            await user.keyboard('{ArrowDown}');

            await user.keyboard(key);

            expect(field().getAttribute('aria-activedescendant')).toBeNull();
            expect(screen.getByRole('listbox')).toBeTruthy();
        },
    );
});

describe('Combobox (web) — Enter chooses, and only an active option (2.1.1, 3.2.2)', () => {
    it('Enter on the active option chooses it, closes the list, and leaves the text to the host', async () => {
        const user = userEvent.setup();
        const onSelect = vi.fn();
        render(<Host initial="f" onSelect={onSelect} />);
        field().focus();

        await user.keyboard('{ArrowUp}{Enter}');

        expect(onSelect).toHaveBeenCalledExactlyOnceWith('flank');
        expect(screen.queryByRole('listbox')).toBeNull();
        expect(field().value).toBe('f');
    });

    it('⛔ Enter with nothing active chooses nothing, keeps the list open, and never submits the form', async () => {
        const user = userEvent.setup();
        const onSelect = vi.fn();
        const onSubmit = vi.fn();
        render(<Host onSelect={onSelect} onSubmit={onSubmit} />);
        await user.type(field(), 'f');

        await user.keyboard('{Enter}');

        expect(onSelect).not.toHaveBeenCalled();
        expect(onSubmit).not.toHaveBeenCalled();
        expect(screen.getByRole('listbox')).toBeTruthy();
    });

    it('⛔ Enter on a CLOSED list never submits the form around the field', async () => {
        const user = userEvent.setup();
        const onSubmit = vi.fn();
        render(<Host initial="flour" onSubmit={onSubmit} />);
        field().focus();

        await user.keyboard('{Enter}');

        expect(onSubmit).not.toHaveBeenCalled();
        expect(screen.queryByRole('listbox')).toBeNull();
    });

    it('⛔ Enter while an input method is composing chooses nothing (the IME takes it)', async () => {
        const user = userEvent.setup();
        const onSelect = vi.fn();
        render(<Host initial="f" onSelect={onSelect} />);
        field().focus();
        await user.keyboard('{ArrowDown}');

        fireEvent.keyDown(field(), { key: 'Enter', isComposing: true });

        expect(onSelect).not.toHaveBeenCalled();
        expect(activeOptionName()).toBe('Flour');
    });

    it('⛔ Enter that ends a composition (Safari: keyCode 229 after compositionend) chooses nothing', async () => {
        const user = userEvent.setup();
        const onSelect = vi.fn();
        render(<Host initial="f" onSelect={onSelect} />);
        field().focus();
        await user.keyboard('{ArrowDown}');

        fireEvent.keyDown(field(), { key: 'Enter', keyCode: 229 });

        expect(onSelect).not.toHaveBeenCalled();
    });
});

describe('Combobox (web) — Escape, Tab, and leaving the field (2.1.1, 2.1.2)', () => {
    it('⛔ Escape closes the list and keeps the text; a second Escape still keeps it', async () => {
        const user = userEvent.setup();
        render(<Host />);
        await user.type(field(), 'fla');

        await user.keyboard('{Escape}');

        expect(screen.queryByRole('listbox')).toBeNull();
        expect(field().value).toBe('fla');
        await user.keyboard('{Escape}');
        expect(field().value).toBe('fla');
    });

    it('⛔ Escape on a closed list is not the field’s: it is not consumed, so a page or dialog still gets it', () => {
        render(<Host initial="fla" />);
        field().focus();

        const notPrevented = fireEvent.keyDown(field(), { key: 'Escape' });

        expect(notPrevented).toBe(true);
        expect(field().value).toBe('fla');
    });

    it('Escape on an open list is the field’s: it is consumed', async () => {
        const user = userEvent.setup();
        render(<Host />);
        await user.type(field(), 'f');

        const notPrevented = fireEvent.keyDown(field(), { key: 'Escape' });

        expect(notPrevented).toBe(false);
    });

    it('⛔ Tab with an option active closes the list, chooses nothing, and leaves the field', async () => {
        const user = userEvent.setup();
        const onSelect = vi.fn();
        render(<Host initial="f" onSelect={onSelect} />);
        field().focus();
        await user.keyboard('{ArrowDown}');

        await user.tab();

        expect(onSelect).not.toHaveBeenCalled();
        expect(screen.queryByRole('listbox')).toBeNull();
        expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Elsewhere' }));
    });

    it('leaving the field by pointer with an option active closes the list and chooses nothing', async () => {
        const user = userEvent.setup();
        const onSelect = vi.fn();
        render(<Host initial="f" onSelect={onSelect} />);
        field().focus();
        await user.keyboard('{ArrowDown}');

        await user.click(screen.getByRole('button', { name: 'Elsewhere' }));

        expect(screen.queryByRole('listbox')).toBeNull();
        expect(onSelect).not.toHaveBeenCalled();
    });

    it('a press in the field moves the caret and leaves the list as it is, open or closed', async () => {
        const user = userEvent.setup();
        render(<Host initial="f" />);

        await user.click(field());
        expect(screen.queryByRole('listbox')).toBeNull();

        await user.keyboard('{ArrowDown}');
        await user.click(field());
        expect(screen.getByRole('listbox')).toBeTruthy();
    });
});

describe('Combobox (web) — the highlight follows the option, not its position', () => {
    /** Flaxseed moves from the second place to the first, and Beef flank takes its old place. */
    const reordered: readonly ComboboxGroup[] = [
        {
            key: 'catalog',
            label: 'Food catalog',
            options: [{ key: 'flax', label: 'Flaxseed' }, { key: 'flank', label: 'Beef flank' }, FLOUR],
        },
    ];

    it('⛔ a list that re-orders under the active option keeps it active, and Enter chooses THAT option', async () => {
        const user = userEvent.setup();
        const onSelect = vi.fn();
        const { rerender } = render(<Host initial="f" onSelect={onSelect} />);
        field().focus();
        await user.keyboard('{ArrowDown}{ArrowDown}');
        expect(activeOptionName()).toBe('Flaxseed');

        rerender(<Host initial="f" onSelect={onSelect} groups={reordered} />);

        expect(activeOptionName()).toBe('Flaxseed');
        await user.keyboard('{Enter}');
        expect(onSelect).toHaveBeenCalledExactlyOnceWith('flax');
    });

    it('⛔ a list that drops the active option leaves nothing active, and Enter chooses nothing', async () => {
        const user = userEvent.setup();
        const onSelect = vi.fn();
        const { rerender } = render(<Host initial="f" onSelect={onSelect} />);
        field().focus();
        await user.keyboard('{ArrowDown}{ArrowDown}');

        rerender(<Host initial="f" onSelect={onSelect} groups={[{ key: 'c', options: [FLOUR] }]} />);

        expect(field().getAttribute('aria-activedescendant')).toBeNull();
        await user.keyboard('{Enter}');
        expect(onSelect).not.toHaveBeenCalled();
    });

    it('closing the list forgets an active option the list had dropped, so it does not come back on its own', async () => {
        const user = userEvent.setup();
        const { rerender } = render(<Host initial="f" />);
        field().focus();
        await user.keyboard('{ArrowDown}{ArrowDown}');
        rerender(<Host initial="f" groups={[{ key: 'c', options: [FLOUR] }]} />);
        await user.keyboard('{Escape}');
        await openWithNothingActive(user);

        rerender(<Host initial="f" />);

        expect(field().getAttribute('aria-activedescendant')).toBeNull();
    });

    it('typing forgets an active option the list had dropped, so it does not come back on its own', async () => {
        const user = userEvent.setup();
        const { rerender } = render(<Host initial="f" />);
        field().focus();
        await user.keyboard('{ArrowDown}{ArrowDown}');
        const withoutFlax = [{ key: 'c', options: [FLOUR] }];
        rerender(<Host initial="f" groups={withoutFlax} />);
        await user.keyboard('l');

        rerender(<Host initial="f" />);

        expect(field().getAttribute('aria-activedescendant')).toBeNull();
    });

    it('Down from an option the list dropped moves as if nothing were active', async () => {
        const user = userEvent.setup();
        const { rerender } = render(<Host initial="f" />);
        field().focus();
        await user.keyboard('{ArrowDown}{ArrowDown}');
        rerender(<Host initial="f" groups={[{ key: 'c', options: [{ key: 'flank', label: 'Beef flank' }] }]} />);

        await user.keyboard('{ArrowDown}');

        expect(activeOptionName()).toBe('Beef flank');
    });
});

describe('Combobox (web) — a press', () => {
    it('chooses the option and keeps focus in the field', async () => {
        const user = userEvent.setup();
        const onSelect = vi.fn();
        render(<Host onSelect={onSelect} />);
        await user.type(field(), 'f');

        await user.click(option('Flaxseed'));

        expect(onSelect).toHaveBeenCalledExactlyOnceWith('flax');
        expect(document.activeElement).toBe(field());
        expect(screen.queryByRole('listbox')).toBeNull();
    });

    it('⛔ choosing the same option a second time reports it a second time', async () => {
        const user = userEvent.setup();
        const onSelect = vi.fn();
        render(<Host initial="f" onSelect={onSelect} />);
        field().focus();

        await user.keyboard('{ArrowDown}{Enter}');
        await user.keyboard('{ArrowDown}{Enter}');

        expect(onSelect.mock.calls).toEqual([['flour'], ['flour']]);
    });

    it('every option is a 44 px target (2.5.8)', async () => {
        const user = userEvent.setup();
        render(<Host />);
        await user.type(field(), 'f');

        expect(option('Flour').className.split(/\s+/)).toContain('min-h-11');
    });
});

describe('Combobox (web) — a busy option refuses a second choice (V1 sign-off, "Busy and disabled")', () => {
    const busyGroups: readonly ComboboxGroup[] = [
        {
            key: 'c',
            options: [
                { key: 'flax', label: 'Flaxseed', busy: true },
                { key: 'flank', label: 'Beef flank' },
            ],
        },
    ];

    it('stays reachable and reads busy and disabled; an idle option does not', async () => {
        const user = userEvent.setup();
        render(<Host initial="f" groups={busyGroups} />);
        field().focus();

        await user.keyboard('{ArrowDown}');

        expect(activeOptionName()).toBe('Flaxseed');
        expect(option('Flaxseed').getAttribute('aria-disabled')).toBe('true');
        expect(option('Flaxseed').getAttribute('aria-busy')).toBe('true');
        expect(option('Beef flank').getAttribute('aria-disabled')).not.toBe('true');
        expect(option('Beef flank').getAttribute('aria-busy')).toBeNull();
    });

    it('⛔ refuses Enter and a press, and the list stays open', async () => {
        const user = userEvent.setup();
        const onSelect = vi.fn();
        render(<Host initial="f" groups={busyGroups} onSelect={onSelect} />);
        field().focus();
        await user.keyboard('{ArrowDown}');

        await user.keyboard('{Enter}');
        await user.click(option('Flaxseed'));

        expect(onSelect).not.toHaveBeenCalled();
        expect(screen.getByRole('listbox')).toBeTruthy();
    });
});

describe('Combobox (web) — the list’s own lines', () => {
    // The lines are SHOWN and never announced by themselves: the host speaks through the polite and the assertive
    // channel, so nothing is spoken twice (`docs/design/rowEditorOpenDecisions.md` system change 2). These cases
    // assert the lines are not live; they once asserted the opposite.
    const isLive = (node: Element): boolean => node.closest('[role="status"], [role="alert"], [aria-live]') !== null;

    /**
     * REWRITTEN for system change 11 (`docs/design/rowEditorOpenDecisions.md`, S7 list contract P3): a search in flight
     * is ONE still line, a glyph and its label, never placeholder rows. Results now arrive above it, so there is no
     * height to reserve, and a still line beside usable options needs no pause control (2.2.2).
     */
    it('LOADING: one still line, its glyph hidden from assistive technology, no placeholder rows, and not live', async () => {
        const user = userEvent.setup();
        render(
            <Host
                groups={[]}
                loadingIcon={<svg data-glyph="loading" />}
                trailingStatus={[{ kind: 'loading', label: 'Searching ingredients' }]}
            />,
        );

        await user.type(field(), 'f');

        const line = screen.getByText('Searching ingredients');
        const glyph = document.querySelector('[data-glyph="loading"]');
        expect(isLive(line)).toBe(false);
        expect(glyph?.closest('[aria-hidden="true"]')).not.toBeNull();
        expect(line.parentElement?.contains(glyph ?? null)).toBe(true);
        expect(document.querySelectorAll('.h-11[aria-hidden="true"]')).toHaveLength(0);
        expect(screen.queryByRole('status')).toBeNull();
        expect(screen.queryAllByRole('option')).toHaveLength(0);
    });

    it('NOTE: shown with the options, and not live', async () => {
        const user = userEvent.setup();
        render(<Host status={{ kind: 'note', text: 'The food catalog is unavailable right now.' }} />);

        await user.type(field(), 'f');

        expect(isLive(screen.getByText('The food catalog is unavailable right now.'))).toBe(false);
        expect(screen.getAllByRole('option')).toHaveLength(3);
    });

    // REWRITTEN for system change 11: the trailing lines are an ordered list, drawn after the listbox in that order.
    it('TRAILING: each line after the listbox and after the note, in the host’s order, and none live', async () => {
        const user = userEvent.setup();
        render(
            <Host
                status={{ kind: 'note', text: 'No foods match.' }}
                trailingStatus={[
                    { kind: 'note', text: 'We couldn’t search USDA just now.' },
                    { kind: 'loading', label: 'Still searching other food databases' },
                ]}
            />,
        );

        await user.type(field(), 'f');

        const first = screen.getByText('We couldn’t search USDA just now.');
        const last = screen.getByText('Still searching other food databases');
        const precedes = (earlier: Node, later: Node): boolean =>
            (earlier.compareDocumentPosition(later) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
        expect(precedes(screen.getByRole('listbox'), first)).toBe(true);
        expect(precedes(screen.getByText('No foods match.'), first)).toBe(true);
        expect(precedes(first, last)).toBe(true);
        expect(screen.getByRole('listbox').contains(first)).toBe(false);
        expect([first, last].some(isLive)).toBe(false);
    });

    it('TRAILING alone keeps the list open with no options', async () => {
        const user = userEvent.setup();
        render(<Host groups={[]} trailingStatus={[{ kind: 'note', text: 'Waiting for a connection.' }]} />);

        await user.type(field(), 'f');

        expect(screen.getByText('Waiting for a connection.')).toBeTruthy();
        expect(screen.queryByRole('listbox')).toBeNull();
    });

    // P2, 4.1.2: WAI-ARIA 1.2 lets assistive technology ignore changes inside a busy element, which would hide arriving
    // foods from a cook moving through them.
    it('never marks the listbox busy, even while a search line shows', async () => {
        const user = userEvent.setup();
        render(<Host trailingStatus={[{ kind: 'loading', label: 'Still searching other food databases' }]} />);

        await user.type(field(), 'f');

        expect(screen.getByRole('listbox').hasAttribute('aria-busy')).toBe(false);
    });

    it('shows no list when there is nothing to show', async () => {
        const user = userEvent.setup();
        render(<Host groups={[]} />);

        await user.type(field(), 'f');

        expect(screen.queryByRole('listbox')).toBeNull();
        expect(field().getAttribute('aria-expanded')).toBe('false');
        expect(field().getAttribute('aria-controls')).toBeNull();
    });

    it('the listbox itself scrolls, so the active option can be scrolled into view inside it', async () => {
        const user = userEvent.setup();
        render(<Host />);

        await user.type(field(), 'f');

        // REWRITTEN for V3-M2a's residual: the listbox is the first of the two scrollers the active option is scrolled
        // into view in; the card around it is the second (the V3-3 cases below).
        expect(screen.getByRole('listbox').className.split(/\s+/)).toContain('overflow-y-auto');
    });
});

describe('Combobox (web) — the order inside the entry (1.3.2; `docs/design/rowEditorOpenDecisions.md` R1)', () => {
    const precedes = (earlier: Node, later: Node): boolean =>
        (earlier.compareDocumentPosition(later) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;

    const statuses: ReadonlyArray<readonly [string, ComboboxStatus, string]> = [
        [
            'a note',
            { kind: 'note', text: 'The food catalog is unavailable right now.' },
            'The food catalog is unavailable right now.',
        ],
        ['a search in flight', { kind: 'loading', label: 'Searching ingredients' }, 'Searching ingredients'],
    ];

    it.each(statuses)(
        'the field, then the status line (%s), then the listbox, then the trailing line, none inside the listbox',
        async (_, status, statusText) => {
            const user = userEvent.setup();
            render(<Host status={status} trailingStatus={[{ kind: 'note', text: 'USDA has nothing for “f”.' }]} />);

            await user.type(field(), 'f');

            const statusLine = screen.getByText(statusText);
            const listbox = screen.getByRole('listbox');
            const trailing = screen.getByText('USDA has nothing for “f”.');
            expect(precedes(field(), statusLine)).toBe(true);
            expect(precedes(statusLine, listbox)).toBe(true);
            expect(precedes(listbox, trailing)).toBe(true);
            expect(listbox.contains(statusLine)).toBe(false);
        },
    );
});

/** A way the list closes, from an open list of results. */
type Closing = readonly [string, (user: ReturnType<typeof userEvent.setup>) => Promise<void>];

describe('Combobox (web) — the count is spoken only while the list shows (4.1.3; `docs/design/rowEditorOpenDecisions.md` R3)', () => {
    const COUNT = '3 foods found';
    const politeRegion = (): HTMLElement => screen.getByText((_, node) => node?.getAttribute('aria-live') === 'polite');

    /**
     * Rewritten for R3: this case once filled the region while the list was closed. The region still exists before
     * its text changes, and now it is the list opening that fills it.
     */
    it('speaks the host’s polite text once the list shows, in a region that exists before it changes', async () => {
        const user = userEvent.setup();
        render(<Host countAnnouncement={COUNT} />);
        const polite = watchRegion(politeRegion());

        await user.type(field(), 'f');

        expect(polite()).toEqual({ changes: 1, text: COUNT });
    });

    it('is not spoken while the list is closed: the region is empty', () => {
        render(<Host initial="f" countAnnouncement={COUNT} />);

        expect(politeRegion().textContent).toBe('');
    });

    it('is not spoken again by a render that passes the same text', async () => {
        const user = userEvent.setup();
        const { rerender } = render(<Host countAnnouncement={COUNT} />);
        await user.type(field(), 'f');
        const polite = watchRegion(politeRegion());

        rerender(<Host countAnnouncement={COUNT} placeholder="Search foods" hint="Type to search foods." />);

        expect(polite()).toEqual({ changes: 0, text: COUNT });
    });

    it('a new text from the host while the list shows is spoken once: each settled read is one change', async () => {
        const user = userEvent.setup();
        const { rerender } = render(<Host countAnnouncement="Searching ingredients" />);
        await user.type(field(), 'f');
        const polite = watchRegion(politeRegion());

        rerender(<Host countAnnouncement={COUNT} />);

        expect(polite()).toEqual({ changes: 1, text: COUNT });
    });

    it('Escape, then ArrowDown, on the same results: the close is silent, and the reopening speaks the count once', async () => {
        const user = userEvent.setup();
        render(<Host countAnnouncement={COUNT} />);
        await user.type(field(), 'f');
        const polite = watchRegion(politeRegion());

        await user.keyboard('{Escape}');
        expect(polite()).toEqual({ changes: 1, text: '' });

        await user.keyboard('{ArrowDown}');
        expect(polite()).toEqual({ changes: 1, text: COUNT });
    });

    const closings: readonly Closing[] = [
        [
            'Escape',
            async (user) => {
                await user.keyboard('{Escape}');
            },
        ],
        [
            'a pick',
            async (user) => {
                await user.click(option('Flaxseed'));
            },
        ],
        [
            'Tab',
            async (user) => {
                await user.tab();
            },
        ],
        [
            'a press outside',
            async (user) => {
                await user.click(screen.getByRole('button', { name: 'Elsewhere' }));
            },
        ],
    ];

    it.each(closings)('is not spoken once %s closes the list', async (_, close) => {
        const user = userEvent.setup();
        render(<Host countAnnouncement={COUNT} />);
        await user.type(field(), 'f');

        await close(user);

        expect(screen.queryByRole('listbox')).toBeNull();
        expect(politeRegion().textContent).toBe('');
    });

    it('is spoken while the list shows only its status line', async () => {
        const user = userEvent.setup();
        const none = 'No foods match “f” yet. Keep typing, or find its nutrition by name.';
        render(<Host groups={[]} status={{ kind: 'note', text: 'No foods match.' }} countAnnouncement={none} />);

        await user.type(field(), 'f');

        expect(politeRegion().textContent).toBe(none);
    });

    it('is not spoken while the list has nothing to show', async () => {
        const user = userEvent.setup();
        render(<Host groups={[]} countAnnouncement={COUNT} />);

        await user.type(field(), 'f');

        expect(politeRegion().textContent).toBe('');
    });

    it('the alert is never held back: a failure after a pick is spoken with the list closed', async () => {
        const user = userEvent.setup();
        const failed = 'We couldn’t add “Flaxseed”. Try again, or use it as written.';
        const { rerender } = render(<Host countAnnouncement={COUNT} />);
        await user.type(field(), 'f');
        await user.click(option('Flaxseed'));
        const assertive = watchRegion(screen.getByRole('alert'));

        rerender(<Host countAnnouncement={COUNT} alertAnnouncement={failed} />);

        expect(screen.queryByRole('listbox')).toBeNull();
        expect(assertive()).toEqual({ changes: 1, text: failed });
        expect(politeRegion().textContent).toBe('');
    });

    it('the alert speaks in an assertive region that exists before it changes, with the list never opened', () => {
        const { rerender } = render(<Host />);
        const assertive = watchRegion(screen.getByRole('alert'));
        expect(screen.getByRole('alert').textContent).toBe('');

        rerender(<Host alertAnnouncement="We couldn’t add “fl”. Try again, or use it as written." />);

        expect(assertive()).toEqual({ changes: 1, text: 'We couldn’t add “fl”. Try again, or use it as written.' });
    });
});

describe('Combobox (web) — an option’s detail line and own name (system change 1)', () => {
    const decorated: readonly ComboboxGroup[] = [
        {
            key: 'found',
            options: [
                {
                    key: 'brisket-flat',
                    label: 'Beef brisket',
                    detailParts: ['flat half', 'select'],
                    accessibleName: 'Beef brisket, flat half, select',
                },
            ],
        },
        {
            key: 'usda',
            label: 'From USDA',
            options: [{ key: 'remote', label: 'Garlic, black', accessibleName: 'Garlic, black, from USDA' }],
        },
    ];

    // V3-5: an option shows no tag. What its own name adds is heard, never shown (S7 list contract P5, L4).
    it('an option with its own name is named by it, and shows its label alone', async () => {
        const user = userEvent.setup();
        render(<Host groups={decorated} />);

        await user.type(field(), 'f');

        expect(option('Garlic, black, from USDA').textContent).toBe('Garlic, black');
    });

    it('an option shows its variant’s parts under its name', async () => {
        const user = userEvent.setup();
        render(<Host groups={decorated} />);

        await user.type(field(), 'f');

        const brisket = option('Beef brisket, flat half, select');
        expect(within(brisket).getByText('flat half')).toBeTruthy();
        expect(within(brisket).getByText('select')).toBeTruthy();
    });

    it('an option without its own name is named by what it shows', async () => {
        const user = userEvent.setup();
        render(<Host />);

        await user.type(field(), 'f');

        expect(option('Flour').getAttribute('aria-label')).toBeNull();
    });

    it('a decorated option is still chosen by its key', async () => {
        const user = userEvent.setup();
        const onSelect = vi.fn();
        render(<Host groups={decorated} onSelect={onSelect} />);
        await user.type(field(), 'f');

        await user.click(option('Beef brisket, flat half, select'));

        expect(onSelect).toHaveBeenCalledExactlyOnceWith('brisket-flat');
    });
});

describe('Combobox (web) — leaving the entry (system change 8, item 4)', () => {
    it('⛔ Escape on a CLOSED list asks the host to abandon the entry, and is consumed', () => {
        const onAbandon = vi.fn();
        render(<Host initial="fla" onAbandon={onAbandon} />);
        field().focus();

        const notPrevented = fireEvent.keyDown(field(), { key: 'Escape' });

        expect(onAbandon).toHaveBeenCalledTimes(1);
        expect(notPrevented).toBe(false);
    });

    it('⛔ Escape on an OPEN list only closes the list; the next Escape abandons', async () => {
        const user = userEvent.setup();
        const onAbandon = vi.fn();
        render(<Host onAbandon={onAbandon} />);
        await user.type(field(), 'fla');

        await user.keyboard('{Escape}');
        expect(screen.queryByRole('listbox')).toBeNull();
        expect(onAbandon).not.toHaveBeenCalled();

        await user.keyboard('{Escape}');
        expect(onAbandon).toHaveBeenCalledTimes(1);
    });

    it('Cancel: a visible text button after the field, named by the host, that abandons the entry', async () => {
        const user = userEvent.setup();
        const onPress = vi.fn();
        render(<Host initial="Flour" cancel={{ text: 'Cancel', name: 'Cancel, keep Flour', onPress }} />);
        const cancel = screen.getByRole('button', { name: 'Cancel, keep Flour' });

        expect(cancel.textContent).toBe('Cancel');
        expect(cancel.className.split(/\s+/)).toContain('min-h-11');
        field().focus();
        await user.tab();
        expect(document.activeElement).toBe(cancel);

        await user.click(cancel);

        expect(onPress).toHaveBeenCalledTimes(1);
    });

    it('shows no Cancel unless the host asks for one', () => {
        render(<Host initial="Flour" />);

        expect(field().value).toBe('Flour');
        expect(screen.queryByRole('button', { name: /Cancel/ })).toBeNull();
    });

    it('shows no clear button on web: Escape on a closed list is how the web field clears', () => {
        render(<Host initial="Flour" clear={{ label: 'Clear text', icon: <span /> }} />);

        expect(field().value).toBe('Flour');
        expect(screen.queryByRole('button', { name: 'Clear text' })).toBeNull();
    });
});

describe('Combobox (web) — where the list is placed (2.4.11, §8e; `docs/design/rowEditorOpenDecisions.md` V3-1, V3-2)', () => {
    const VIEWPORT_HEIGHT = 768;
    const FIELD = { left: 16, width: 300, height: 44 } as const;
    /** 20rem at the jsdom root's 16 px: the probe's height, and the cap on the popup's height and width floor. */
    const REM_20 = 320;

    /** A length the popup's own CSS custom property holds, or `undefined` while nothing has set it. */
    const pxProperty = (node: HTMLElement, name: string): number | undefined => {
        const value = Number.parseFloat(node.style.getPropertyValue(name));

        return Number.isNaN(value) ? undefined : value;
    };

    /**
     * jsdom has no CSS engine, so this plays the browser for the popup's box, reading only its classes and the custom
     * properties the leaf sets: the probe class is a fixed 20rem; a height class is the room the leaf gave it, up to
     * 20rem; otherwise the content's own height, up to that room. The width is the class's `max(field, min(20rem,
     * room))`, from the two width properties.
     */
    const popupHeight = (node: HTMLElement, content: number): number => {
        const classes = node.className.split(/\s+/);
        const room = Math.min(REM_20, pxProperty(node, '--combobox-available-height') ?? REM_20);

        if (classes.includes('h-[min(20rem,calc(100dvh-1rem))]')) {
            return REM_20;
        }

        return classes.some((name) => name.startsWith('h-[')) ? room : Math.min(content, room);
    };

    const popupWidth = (node: HTMLElement, fieldWidth: number): number => {
        const reference = pxProperty(node, '--combobox-reference-width');
        const available = pxProperty(node, '--combobox-available-width');

        return reference === undefined || available === undefined
            ? fieldWidth
            : Math.max(reference, Math.min(REM_20, available));
    };

    /** Lays the page out as floating-ui reads it: a viewport, the field at `fieldTop`, and a popup of `content` px. */
    const layOut = (
        fieldTop: number,
        field: {
            readonly width?: number;
            readonly left?: number;
            readonly viewportWidth?: number;
            readonly content?: number;
        } = {},
    ): void => {
        const fieldWidth = field.width ?? FIELD.width;
        const content = field.content ?? 200;

        vi.spyOn(document.documentElement, 'clientHeight', 'get').mockReturnValue(VIEWPORT_HEIGHT);
        vi.spyOn(document.documentElement, 'clientWidth', 'get').mockReturnValue(field.viewportWidth ?? 1024);
        vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
            return this.getAttribute('role') === 'combobox'
                ? new DOMRect(field.left ?? FIELD.left, fieldTop, fieldWidth, FIELD.height)
                : new DOMRect(0, 0, 0, 0);
        });
        const isPopup = (node: HTMLElement): boolean => node.querySelector('[role="listbox"]') !== null;
        vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) {
            return isPopup(this) ? popupHeight(this, content) : 0;
        });
        vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function (this: HTMLElement) {
            return isPopup(this) ? popupWidth(this, fieldWidth) : 0;
        });
    };

    /** The popup: the box floating-ui places, around the listbox and the lines. */
    const popup = (): HTMLElement => {
        const box = screen.getByRole('listbox').parentElement;

        if (box === null) {
            throw new Error('The listbox has no popup around it.');
        }

        return box;
    };

    /** The popup's box in the viewport, from the position floating-ui gave it and the size the browser would. */
    const popupBox = (content = 200, fieldWidth: number = FIELD.width) => {
        const box = popup();
        const match = /translate\(([-\d.]+)px, ([-\d.]+)px\)/.exec(box.style.transform);
        const top = match === null ? Number.NaN : Number(match[2]);
        const height = popupHeight(box, content);

        return {
            top,
            bottom: top + height,
            left: match === null ? Number.NaN : Number(match[1]),
            width: popupWidth(box, fieldWidth),
        };
    };

    /** The page's own chrome, as a host reports it through `PopupInsetsContext`. */
    const InsetsHost: FC<HostProps & { readonly insets: PopupInsets }> = ({ insets, ...props }) => (
        <PopupInsetsContext value={() => insets}>
            <Host {...props} />
        </PopupInsetsContext>
    );

    // V3-1: the side is the probe's, measured at the full height, never at what the list holds yet. Both sides
    // fitting keeps the list under its field (P10: the first food sits right under it); neither fitting takes the
    // side with more room. `room` is what each side leaves after the field, the 4 px gap, the 8 px margin and the chrome.
    it.each([
        { name: 'both sides fit: below', fieldTop: 360, insets: { top: 0, bottom: 0 }, side: 'below' },
        { name: 'only above fits: above', fieldTop: 500, insets: { top: 0, bottom: 0 }, side: 'above' },
        {
            name: 'neither fits, more room above: above',
            fieldTop: 380,
            insets: { top: 150, bottom: 150 },
            side: 'above',
        },
        {
            name: 'neither fits, more room below: below',
            fieldTop: 340,
            insets: { top: 150, bottom: 150 },
            side: 'below',
        },
    ] as const)('chooses its side at the full height — $name', async ({ fieldTop, insets, side }) => {
        const user = userEvent.setup();
        layOut(fieldTop);
        render(<InsetsHost insets={insets} />);

        await user.type(field(), 'f');

        await waitFor(() => {
            expect(popup().className.split(/\s+/)).not.toContain('invisible');
        });
        expect(side === 'below' ? popupBox().top >= fieldTop + FIELD.height : popupBox().bottom <= fieldTop).toBe(true);
    });

    // V3-M1, case C: a list holding only its first line fits below almost anywhere (here 45 px against 152 px of room).
    // A side chosen at that height is the side a list that then grows reaches the bar from.
    it('⛔ a short list still opens where its full height fits, not where its first line does', async () => {
        const user = userEvent.setup();
        const fieldTop = 560;
        layOut(fieldTop, { content: 45 });
        render(<Host />);

        await user.type(field(), 'f');

        await waitFor(() => {
            expect(popupBox(45).bottom).toBeLessThanOrEqual(fieldTop);
        });
    });

    it('never covers the page’s own chrome: above, its top clears the band; below, its foot clears the bar', async () => {
        const user = userEvent.setup();
        layOut(380, { content: 600 });
        render(<InsetsHost insets={{ top: 150, bottom: 150 }} />);

        await user.type(field(), 'f');

        await waitFor(() => {
            expect(popupBox(600).bottom).toBeLessThanOrEqual(380);
        });
        expect(popupBox(600).top).toBeGreaterThanOrEqual(150 + 8);

        cleanup();
        layOut(200, { content: 600 });
        render(<InsetsHost insets={{ top: 0, bottom: 300 }} />);
        await user.type(field(), 'f');

        await waitFor(() => {
            expect(popupBox(600).top).toBeGreaterThanOrEqual(200 + FIELD.height);
        });
        expect(popupBox(600).bottom).toBeLessThanOrEqual(VIEWPORT_HEIGHT - 300 - 8);
    });

    // floating-ui keeps an option's derivable closure from the render that first passed it, so a reader captured there
    // would go stale. The chrome is read at every placement from the host's current reader.
    it('⛔ reads the host’s CURRENT chrome at each placement, with no new text to refresh it', async () => {
        const user = userEvent.setup();
        layOut(340, { content: 600 });
        const { rerender } = render(<InsetsHost insets={{ top: 0, bottom: 0 }} />);

        await user.type(field(), 'f');
        await waitFor(() => {
            expect(popupBox(600).top).toBeGreaterThanOrEqual(340 + FIELD.height);
        });
        await user.keyboard('{Escape}');

        rerender(<InsetsHost insets={{ top: 0, bottom: 100 }} />);
        await user.keyboard('{Alt>}{ArrowDown}{/Alt}');

        await waitFor(() => {
            expect(popupBox(600).bottom).toBeLessThanOrEqual(VIEWPORT_HEIGHT - 100 - 8);
        });
    });

    // A field squeezed by its row gave a popup as narrow, whose first line wrapped to 352 px and left the listbox no
    // height. The floor is `@commise/ui/popover`'s 20rem, in rem through the class, so it grows with the text size.
    it('takes the field’s width, or 20rem when the field is narrower, through its width properties', async () => {
        const user = userEvent.setup();
        layOut(300, { width: 86 });
        render(<Host />);

        await user.type(field(), 'f');
        await waitFor(() => {
            expect(popupBox(200, 86).width).toBe(REM_20);
        });
        expect(popupBox(200, 86).left).toBe(FIELD.left);
        expect(popup().className.split(/\s+/)).toContain(
            'w-[max(var(--combobox-reference-width),min(20rem,var(--combobox-available-width)))]',
        );

        cleanup();
        layOut(300, { width: 400 });
        render(<Host />);
        await user.type(field(), 'f');

        await waitFor(() => {
            expect(popupBox(200, 400).width).toBe(400);
        });
    });

    // V3-2, case E: at 320 px the floor shrank to the room at the field's right (248 px measured). It slides instead, and
    // it slides rather than taking the field's other alignment, which would leave it the field's end and not the edge.
    it.each([
        { name: 'a phone', viewportWidth: 320, left: 40, width: 240, expected: { left: 8, width: 320 - 2 * 8 } },
        {
            name: 'a desktop field near the edge',
            viewportWidth: 1024,
            left: 900,
            width: 86,
            expected: { left: 696, width: 320 },
        },
    ] as const)(
        '⛔ near the right edge it slides to the margin and keeps its width, at first and after the list grows — $name',
        async ({ viewportWidth, left, width, expected }) => {
            const user = userEvent.setup();
            layOut(300, { width, left, viewportWidth });
            const { rerender } = render(<Host />);

            await user.type(field(), 'f');

            await waitFor(() => {
                expect(popupBox(200, width)).toMatchObject(expected);
            });

            rerender(
                <Host
                    groups={[...GROUPS, { key: 'more', label: 'From USDA', options: [{ key: 'u', label: 'Egg' }] }]}
                />,
            );
            await user.keyboard('{Escape}');
            await user.keyboard('{Alt>}{ArrowDown}{/Alt}');

            await waitFor(() => {
                expect(popupBox(200, width)).toMatchObject(expected);
            });
        },
    );

    // S7 list contract P2 and P9: frames add content, and a popup that flipped when it grew would move every option.
    it('keeps the side it chose for a text while that text’s list grows, and chooses again for a new text', async () => {
        const user = userEvent.setup();
        const fieldTop = 300;
        layOut(fieldTop);
        const { rerender } = render(<Host />);

        await user.type(field(), 'f');
        await waitFor(() => {
            expect(popupBox().top).toBeGreaterThanOrEqual(fieldTop + FIELD.height);
        });

        rerender(
            <Host groups={[...GROUPS, { key: 'more', label: 'From USDA', options: [{ key: 'u', label: 'Egg' }] }]} />,
        );
        // Closing and opening it again places it afresh: for the same text, it keeps its side.
        await user.keyboard('{Escape}');
        await user.keyboard('{Alt>}{ArrowDown}{/Alt}');
        await waitFor(() => {
            expect(popupBox().top).toBeGreaterThanOrEqual(fieldTop + FIELD.height);
        });

        // A new text chooses its side afresh: the field has moved down, and 20rem now fits only above.
        cleanup();
        layOut(560);
        render(<Host initial="f" />);
        field().focus();
        await user.type(field(), 'l');
        await waitFor(() => {
            expect(popupBox().bottom).toBeLessThanOrEqual(560);
        });
    });

    // P9: "A popup above its field takes its full height at once", so content that arrives fills it from the top down
    // and its top edge never moves.
    it('takes its full height at once when it opens above its field, and only grows to fit when below', async () => {
        const user = userEvent.setup();
        layOut(640);
        render(<Host />);

        await user.type(field(), 'f');
        await waitFor(() => {
            expect(popup().className.split(/\s+/)).toContain('h-[min(20rem,var(--combobox-available-height,20rem))]');
        });

        cleanup();
        layOut(300);
        render(<Host />);
        await user.type(field(), 'f');

        await waitFor(() => {
            expect(popup().className.split(/\s+/)).toContain(
                'max-h-[min(20rem,var(--combobox-available-height,20rem))]',
            );
        });
    });
});

describe('Combobox (web) — status lines never squeeze the list (1.4.4; `docs/design/rowEditorOpenDecisions.md` V3-3)', () => {
    /** A host whose list holds `count` options and both kinds of line. */
    const optionsOf = (count: number): readonly ComboboxGroup[] => [
        {
            key: 'found',
            options: Array.from({ length: count }, (_unused, index) => ({
                key: `food-${String(index)}`,
                label: `Food ${String(index + 1)}`,
            })),
        },
    ];
    const lines: Partial<ComboboxProps> = {
        status: { kind: 'note', text: 'Your foods and the food catalog are unavailable right now.' },
        trailingStatus: [{ kind: 'note', text: 'You’ve reached your limit for food lookups until 3:00 PM.' }],
    };

    it.each([
        { count: 1, floor: 'min-h-11' },
        { count: 2, floor: 'min-h-22' },
        { count: 3, floor: 'min-h-33' },
        { count: 7, floor: 'min-h-33' },
    ] as const)(
        '$count option(s): the listbox keeps a floor of $floor, one option row each up to three',
        async ({ count, floor }) => {
            const user = userEvent.setup();
            render(<Host groups={optionsOf(count)} {...lines} />);

            await user.type(field(), 'f');

            const classes = screen.getByRole('listbox').className.split(/\s+/);
            expect(classes).toContain(floor);
            expect(classes.filter((name) => /^min-h-\d+$/.test(name))).toEqual([floor]);
        },
    );

    it('the popup’s card scrolls, so a line that does not fit is scrolled to, never painted outside the card', async () => {
        const user = userEvent.setup();
        render(<Host groups={optionsOf(2)} {...lines} />);

        await user.type(field(), 'f');

        expect(screen.getByRole('listbox').parentElement?.className.split(/\s+/)).toContain('overflow-y-auto');
    });

    // The follow-up `docs/design/v3Evaluation.md` V3-M2a's residual owes here: a card shorter than the listbox's floor
    // scrolls too, so the keyboard's active option is scrolled into view in both. `scrollMode` is pinned here because
    // only real layout tells it apart, and the Playwright case that has layout cannot (see the leaf).
    it.each([
        { when: 'in an open list', keys: '{ArrowDown}{ArrowDown}', active: 'Flaxseed' },
        { when: 'on the press that opens the list', keys: '{ArrowUp}', active: 'Beef flank' },
    ] as const)(
        'the active option, $when, is scrolled into view up to the card that holds the listbox, and no further',
        async ({ keys, active }) => {
            const user = userEvent.setup();
            render(<Host initial="f" />);
            field().focus();
            vi.mocked(compute).mockClear();

            await user.keyboard(keys);

            expect(activeOptionName()).toBe(active);
            expect(compute).toHaveBeenLastCalledWith(option(active), {
                boundary: screen.getByRole('listbox').parentElement,
                block: 'nearest',
                scrollMode: 'always',
            });
        },
    );
});

describe('Combobox (web) — the active option shows a ring (`docs/design/rowEditorOpenDecisions.md` V3-4)', () => {
    it('the active option takes the pearl fill and the inset seafoam ring the details dialog’s active row takes', async () => {
        const user = userEvent.setup();
        render(<Host />);
        await user.type(field(), 'f');

        await user.keyboard('{ArrowDown}');

        const classes = option('Flour').className.split(/\s+/);
        expect(option('Flour').getAttribute('aria-selected')).toBe('true');
        expect(classes).toEqual(
            expect.arrayContaining([
                'aria-selected:bg-surface-muted',
                'aria-selected:ring-2',
                'aria-selected:ring-inset',
                'aria-selected:ring-selected-edge',
            ]),
        );
    });
});

describe('Combobox (web) — focus', () => {
    it('tells the host when the field takes focus, so it can make this field the one it searches for', async () => {
        const user = userEvent.setup();
        const onFocus = vi.fn();
        render(<Host onFocus={onFocus} />);

        await user.click(field());

        expect(onFocus).toHaveBeenCalledTimes(1);
    });

    it('a host’s request focuses the field with the caret at the END, and is acknowledged once (§2d)', () => {
        const handled = vi.fn();
        const { rerender } = render(
            <Host initial="Chicken breast" focusRequested={false} onFocusRequestHandled={handled} />,
        );
        // The caret starts elsewhere, so only the request can put it at the end.
        field().setSelectionRange(0, 0);
        screen.getByRole('button', { name: 'Elsewhere' }).focus();

        rerender(<Host initial="Chicken breast" focusRequested onFocusRequestHandled={handled} />);

        expect(document.activeElement).toBe(field());
        expect(field().selectionStart).toBe('Chicken breast'.length);
        expect(field().selectionEnd).toBe('Chicken breast'.length);
        expect(handled).toHaveBeenCalledTimes(1);
    });

    it('takes a request it MOUNTS with', () => {
        const handled = vi.fn();

        render(<Host initial="Kale" focusRequested onFocusRequestHandled={handled} />);

        expect(document.activeElement).toBe(field());
        expect(handled).toHaveBeenCalledTimes(1);
    });

    it('a list request opens the list with the focus, and one acknowledgement covers both (R7)', () => {
        const handled = vi.fn();
        const { rerender } = render(<Host initial="Kale" onFocusRequestHandled={handled} />);

        expect(field().getAttribute('aria-expanded')).toBe('false');

        rerender(<Host initial="Kale" focusRequested listRequested onFocusRequestHandled={handled} />);

        expect(document.activeElement).toBe(field());
        expect(field().getAttribute('aria-expanded')).toBe('true');
        expect(screen.getByRole('listbox')).toBeTruthy();
        expect(handled).toHaveBeenCalledTimes(1);
    });

    it('a focus request alone leaves the list shut', () => {
        render(<Host initial="Kale" focusRequested onFocusRequestHandled={vi.fn()} />);

        expect(field().getAttribute('aria-expanded')).toBe('false');
    });
});

describe('Combobox (web) — the alert said again at each refused press (R8)', () => {
    it('the same alert at a new occurrence appears in each assertive region in turn', () => {
        const alerts = (): readonly (string | null)[] =>
            screen.getAllByRole('alert').map((region) => region.textContent);
        const { rerender } = render(
            <Host
                alertAnnouncement="You’ve reached your limit for USDA lookups. You can try again at 3:05 PM."
                alertOccurrence={1}
            />,
        );

        expect(alerts()).toEqual(['You’ve reached your limit for USDA lookups. You can try again at 3:05 PM.', '']);

        rerender(
            <Host
                alertAnnouncement="You’ve reached your limit for USDA lookups. You can try again at 3:05 PM."
                alertOccurrence={2}
            />,
        );

        expect(alerts()).toEqual(['', 'You’ve reached your limit for USDA lookups. You can try again at 3:05 PM.']);
    });
});
