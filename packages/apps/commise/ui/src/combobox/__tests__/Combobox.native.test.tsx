/**
 * Combobox (native) — the same contract as the web leaf, on a phone (`docs/design/ingredientStatusExplanation.md` §3,
 * §8e): typing shows suggestions and never selects; a tap chooses; a busy option refuses; the loading and note lines;
 * the order inside the entry (`docs/design/rowEditorOpenDecisions.md` R1); the polite count, spoken only while the list
 * shows, and the alert, never held back (R3), on Android's live region and on iOS's announcement; the hint; and a
 * host's focus request; and a refocus that reopens a list a blur closed (2026-10-07, the Maestro `pinnedActionBar`
 * failure: a field focused again with standing text must not strand its panel shut).
 *
 * ⚠️ The list is laid out BELOW the field rather than floated over the content: on Android a child drawn outside its
 * parent's bounds takes no touches, so an overlay would show options a cook cannot press. That departs from §8e's
 * "overlay below" and is reported for `staff-ux-engineer`.
 *
 * ⚠️ `sendAccessibilityEvent` and `announceForAccessibilityWithOptions` are mocked because react-native-web does not
 * implement them, and `Platform.OS` because react-native-web is `'web'`: a case sets `'ios'` to hear iOS's channel.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState, type FC } from 'react';
import { AccessibilityInfo, Text, View } from 'react-native';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { FieldRevealContext, type FieldRevealer } from '../../fieldReveal/fieldRevealContext.js';
import { ScrollerDragContext } from '../../fieldReveal/scrollerDrag.js';
import { Combobox } from '../Combobox.native.js';
import type { ComboboxGroup, ComboboxProps, ComboboxStatus } from '../props.js';
import { watchRegion } from './regionSpeech.js';

const platform = vi.hoisted(() => ({ os: undefined as 'ios' | undefined }));

vi.mock('react-native', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-native')>();

    return {
        ...actual,
        Platform: {
            ...actual.Platform,
            get OS() {
                return platform.os ?? actual.Platform.OS;
            },
        },
        AccessibilityInfo: {
            ...actual.AccessibilityInfo,
            sendAccessibilityEvent: vi.fn(),
            announceForAccessibilityWithOptions: vi.fn(),
        },
    };
});

afterEach(() => {
    cleanup();
    platform.os = undefined;
    vi.mocked(AccessibilityInfo.sendAccessibilityEvent).mockClear();
    vi.mocked(AccessibilityInfo.announceForAccessibilityWithOptions).mockClear();
});

const GROUPS: readonly ComboboxGroup[] = [
    { key: 'own', label: 'Your ingredients', options: [{ key: 'flour', label: 'Flour' }] },
    { key: 'catalog', label: 'Food catalog', options: [{ key: 'flax', label: 'Flaxseed' }] },
];

const Host: FC<Partial<ComboboxProps> & { readonly initial?: string }> = ({ initial = '', ...overrides }) => {
    const [value, setValue] = useState(initial);

    return (
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
    );
};

const field = (): HTMLInputElement => screen.getByLabelText('Add an ingredient');

const type = (text: string): void => {
    fireEvent.change(field(), { target: { value: text } });
};

describe('Combobox (native) — at rest', () => {
    it('is a combo box, collapsed, with its hint, and shows no list', () => {
        render(<Host hint="Type to search foods, then choose one." />);

        expect(field().getAttribute('role')).toBe('combobox');
        expect(field().getAttribute('aria-expanded')).toBe('false');
        expect(screen.queryByRole('button', { name: 'Flour' })).toBeNull();
    });
});

describe('Combobox (native) — a leading glyph (`docs/design/rowEditorOpenDecisions.md` item 3)', () => {
    it('draws it before the field, hidden from assistive technology', () => {
        render(<Host leadingIcon={<View accessibilityLabel="plus" />} />);
        const glyph = screen.getByLabelText('plus');
        const wrapper = glyph.parentElement;

        expect(wrapper?.getAttribute('aria-hidden')).toBe('true');
        expect(wrapper?.compareDocumentPosition(field()) ?? 0).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    });
});

describe('Combobox (native) — typing and choosing', () => {
    it('typing shows the options under their group headings, expanded, and chooses nothing (3.2.2)', () => {
        const onSelect = vi.fn();
        render(<Host onSelect={onSelect} />);

        type('fl');

        expect(field().getAttribute('aria-expanded')).toBe('true');
        expect(screen.getByRole('heading', { name: 'Food catalog' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Flaxseed' })).toBeTruthy();
        expect(onSelect).not.toHaveBeenCalled();
    });

    it('a tap chooses the option and closes the list', () => {
        const onSelect = vi.fn();
        render(<Host onSelect={onSelect} />);
        type('fl');

        fireEvent.click(screen.getByRole('button', { name: 'Flaxseed' }));

        expect(onSelect).toHaveBeenCalledExactlyOnceWith('flax');
        expect(screen.queryByRole('button', { name: 'Flaxseed' })).toBeNull();
    });

    it('the keyboard’s submit with no option tapped tells the host and chooses nothing (§7.5.3)', () => {
        const onSelect = vi.fn();
        const onSubmitWithoutChoice = vi.fn();
        render(<Host onSelect={onSelect} onSubmitWithoutChoice={onSubmitWithoutChoice} />);
        type('fl');

        fireEvent.keyDown(field(), { key: 'Enter' });

        expect(onSubmitWithoutChoice).toHaveBeenCalledTimes(1);
        expect(onSelect).not.toHaveBeenCalled();
        // That the keyboard and the list stay up (`submitBehavior="submit"`) is the device's: react-native-web, which
        // this suite runs on, reads only the deprecated `blurOnSubmit`. `addIngredientLine.yaml` proves it on Android.
    });

    it('leaving the field closes the list', () => {
        render(<Host />);
        type('fl');

        fireEvent.blur(field());

        expect(screen.queryByRole('button', { name: 'Flaxseed' })).toBeNull();
    });

    it('a refocus on the same text reopens the list a blur closed (no stranded panel)', () => {
        render(<Host />);
        type('fl');
        fireEvent.blur(field());
        expect(field().getAttribute('aria-expanded')).toBe('false');

        fireEvent.focus(field());

        expect(field().getAttribute('aria-expanded')).toBe('true');
        expect(screen.getByRole('button', { name: 'Flaxseed' })).toBeTruthy();
    });

    it('a close the field chose stays closed on the field’s next focus', () => {
        const onSelect = vi.fn();
        render(<Host onSelect={onSelect} />);
        type('fl');
        fireEvent.click(screen.getByRole('button', { name: 'Flaxseed' }));
        expect(field().getAttribute('aria-expanded')).toBe('false');

        fireEvent.blur(field());
        fireEvent.focus(field());

        expect(field().getAttribute('aria-expanded')).toBe('false');
        expect(onSelect).toHaveBeenCalledExactlyOnceWith('flax');
    });

    it('a first focus with standing text opens nothing (the Remove path hands focus back)', () => {
        render(<Host initial="fl" />);

        fireEvent.focus(field());

        expect(field().getAttribute('aria-expanded')).toBe('false');
        expect(screen.queryByRole('button', { name: 'Flaxseed' })).toBeNull();
    });

    it('every option is a 48 dp target (2.5.8)', () => {
        render(<Host />);
        type('fl');

        expect(
            Number.parseFloat(getComputedStyle(screen.getByRole('button', { name: 'Flour' })).minHeight),
        ).toBeGreaterThanOrEqual(48);
    });

    it('a busy option reads busy and refuses a tap', () => {
        const onSelect = vi.fn();
        render(
            <Host
                initial="f"
                groups={[{ key: 'c', options: [{ key: 'flax', label: 'Flaxseed', busy: true }] }]}
                onSelect={onSelect}
            />,
        );
        type('fl');
        const busy = screen.getByRole('button', { name: 'Flaxseed' });

        fireEvent.click(busy);

        expect(busy.getAttribute('aria-busy')).toBe('true');
        expect(busy.getAttribute('aria-disabled')).toBe('true');
        expect(onSelect).not.toHaveBeenCalled();
    });
});

describe('Combobox (native) — the list’s own lines', () => {
    // The lines are SHOWN and never announced by themselves: the host speaks through the polite and the assertive
    // channel, so a status is never spoken twice (`docs/design/rowEditorOpenDecisions.md` system change 2). These
    // cases assert the lines are not live; the leaf once made both of them live regions.
    const isLive = (node: Element): boolean => node.closest('[aria-live], [role="alert"]') !== null;

    // REWRITTEN for system change 11 (S7 list contract P3): ONE still line, a glyph and its label, never placeholder rows.
    it('LOADING is one still line, its glyph hidden from assistive technology, with no placeholder rows, not live', () => {
        render(
            <Host
                groups={[]}
                loadingIcon={<Text>⌕</Text>}
                trailingStatus={[{ kind: 'loading', label: 'Searching ingredients' }]}
            />,
        );

        type('f');

        const line = screen.getByText('Searching ingredients');
        expect(isLive(line)).toBe(false);
        expect(screen.getByText('⌕').closest('[aria-hidden="true"]')).not.toBeNull();
        expect(document.querySelectorAll('[aria-hidden="true"]')).toHaveLength(1);
    });

    it('NOTE shows with the options, and it is not live', () => {
        render(<Host status={{ kind: 'note', text: 'The food catalog is unavailable right now.' }} />);

        type('f');

        expect(isLive(screen.getByText('The food catalog is unavailable right now.'))).toBe(false);
        expect(screen.getByRole('button', { name: 'Flour' })).toBeTruthy();
    });

    // REWRITTEN for system change 11: the trailing lines are an ordered list, drawn after the options in that order.
    it('TRAILING lines show after the options and the note, in the host’s order, and none is live', () => {
        render(
            <Host
                status={{ kind: 'note', text: 'No foods match.' }}
                trailingStatus={[
                    { kind: 'note', text: 'We couldn’t search USDA just now.' },
                    { kind: 'loading', label: 'Still searching other food databases' },
                ]}
            />,
        );

        type('f');

        const first = screen.getByText('We couldn’t search USDA just now.');
        const last = screen.getByText('Still searching other food databases');
        const precedes = (earlier: Node, later: Node): boolean =>
            (earlier.compareDocumentPosition(later) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
        expect(precedes(screen.getByRole('button', { name: 'Flaxseed' }), first)).toBe(true);
        expect(precedes(screen.getByText('No foods match.'), first)).toBe(true);
        expect(precedes(first, last)).toBe(true);
        expect([first, last].some(isLive)).toBe(false);
    });
});

describe('Combobox (native) — the order inside the entry (1.3.2; `docs/design/rowEditorOpenDecisions.md` R1)', () => {
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
        'the field, then the status line (%s), then the options, then the trailing line',
        (_, status, statusText) => {
            render(<Host status={status} trailingStatus={[{ kind: 'note', text: 'USDA has nothing for “f”.' }]} />);

            type('f');

            const statusLine = screen.getByText(statusText);
            const trailing = screen.getByText('USDA has nothing for “f”.');
            expect(precedes(field(), statusLine)).toBe(true);
            expect(precedes(statusLine, screen.getByRole('heading', { name: 'Your ingredients' }))).toBe(true);
            expect(precedes(screen.getByRole('button', { name: 'Flaxseed' }), trailing)).toBe(true);
        },
    );
});

describe('Combobox (native) — the count is spoken only while the list shows (4.1.3; `docs/design/rowEditorOpenDecisions.md` R3)', () => {
    const COUNT = '2 foods found';
    const politeRegion = (): HTMLElement => screen.getByText((_, node) => node?.getAttribute('aria-live') === 'polite');
    // An empty assertive region is not yet an alert (`LiveRegion`), so it is found by its channel.
    const assertiveRegion = (): HTMLElement =>
        screen.getByText((_, node) => node?.getAttribute('aria-live') === 'assertive');

    /**
     * Rewritten for R3: this case once spoke the count with the list closed. The region still speaks politely, and
     * now it is the list opening that fills it.
     */
    it('speaks the count the host gives, politely, once the list shows', () => {
        render(<Host countAnnouncement={COUNT} />);
        const polite = watchRegion(politeRegion());

        type('f');

        expect(polite()).toEqual({ changes: 1, text: COUNT });
        expect(politeRegion().getAttribute('aria-live')).toBe('polite');
    });

    it('is not spoken while the list is closed: the region is empty', () => {
        render(<Host initial="f" countAnnouncement={COUNT} />);

        expect(politeRegion().textContent).toBe('');
    });

    it('is not spoken again by a render that passes the same text', () => {
        const { rerender } = render(<Host countAnnouncement={COUNT} />);
        type('f');
        const polite = watchRegion(politeRegion());

        rerender(<Host countAnnouncement={COUNT} placeholder="Search foods" hint="Type to search foods." />);

        expect(polite()).toEqual({ changes: 0, text: COUNT });
    });

    it('a new text from the host while the list shows is spoken once: each settled read is one change', () => {
        const { rerender } = render(<Host countAnnouncement="Searching ingredients" />);
        type('f');
        const polite = watchRegion(politeRegion());

        rerender(<Host countAnnouncement={COUNT} />);

        expect(polite()).toEqual({ changes: 1, text: COUNT });
    });

    it('a blur empties the polite region, silently; the next opening speaks the count once', () => {
        render(<Host countAnnouncement={COUNT} />);
        type('f');
        const polite = watchRegion(politeRegion());

        fireEvent.blur(field());
        expect(polite()).toEqual({ changes: 1, text: '' });

        // Native opens its list only on a text change (R3), so this reopening is on a new text.
        type('fl');
        expect(polite()).toEqual({ changes: 1, text: COUNT });
    });

    it('is not spoken once a tap chooses and closes the list', () => {
        render(<Host countAnnouncement={COUNT} />);
        type('f');

        fireEvent.click(screen.getByRole('button', { name: 'Flaxseed' }));

        expect(politeRegion().textContent).toBe('');
    });

    it('is spoken while the list shows only its status line', () => {
        const none = 'No foods match “f” yet. Keep typing, or find its nutrition by name.';
        render(<Host groups={[]} status={{ kind: 'note', text: 'No foods match.' }} countAnnouncement={none} />);

        type('f');

        expect(politeRegion().textContent).toBe(none);
    });

    it('is not spoken while the list has nothing to show', () => {
        render(<Host groups={[]} countAnnouncement={COUNT} />);

        type('f');

        expect(politeRegion().textContent).toBe('');
    });

    it('the alert is never held back: a failure after a tap is spoken with the list closed', () => {
        const failed = 'We couldn’t add “Flaxseed”. Try again, or use it as written.';
        const { rerender } = render(<Host countAnnouncement={COUNT} />);
        type('f');
        fireEvent.click(screen.getByRole('button', { name: 'Flaxseed' }));
        const assertive = watchRegion(assertiveRegion());

        rerender(<Host countAnnouncement={COUNT} alertAnnouncement={failed} />);

        expect(screen.queryByRole('button', { name: 'Flaxseed' })).toBeNull();
        expect(assertive()).toEqual({ changes: 1, text: failed });
        expect(screen.getByRole('alert').textContent).toBe(failed);
        expect(politeRegion().textContent).toBe('');
    });

    it('the alert speaks assertively with the list never opened', () => {
        const failed = 'We couldn’t add “fl”. Try again, or use it as written.';
        const { rerender } = render(<Host />);
        const assertive = watchRegion(assertiveRegion());

        rerender(<Host alertAnnouncement={failed} />);

        expect(assertive()).toEqual({ changes: 1, text: failed });
        expect(screen.getByRole('alert').textContent).toBe(failed);
    });

    it('iOS: announced once per opening on the count, never while the list is closed, never on a re-render', () => {
        platform.os = 'ios';
        const announce = vi.mocked(AccessibilityInfo.announceForAccessibilityWithOptions);
        const { rerender } = render(<Host countAnnouncement={COUNT} />);
        expect(announce).not.toHaveBeenCalled();

        type('f');
        expect(announce).toHaveBeenCalledExactlyOnceWith(COUNT, { queue: true });

        rerender(<Host countAnnouncement={COUNT} placeholder="Search foods" />);
        fireEvent.blur(field());
        expect(announce).toHaveBeenCalledTimes(1);

        type('fl');
        expect(announce).toHaveBeenCalledTimes(2);
        expect(announce).toHaveBeenLastCalledWith(COUNT, { queue: true });
    });
});

describe('Combobox (native) — an option’s detail line and own name (system change 1)', () => {
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
    it('an option with its own name is named by it, and shows its label alone and its parts', () => {
        const onSelect = vi.fn();
        render(<Host groups={decorated} onSelect={onSelect} />);
        type('f');

        const remote = screen.getByRole('button', { name: 'Garlic, black, from USDA' });
        const brisket = screen.getByRole('button', { name: 'Beef brisket, flat half, select' });

        expect(remote.textContent).toBe('Garlic, black');
        expect(brisket.textContent).toContain('Beef brisket');
        expect(brisket.textContent).toContain('flat half');
        fireEvent.click(brisket);
        expect(onSelect).toHaveBeenCalledExactlyOnceWith('brisket-flat');
    });
});

describe('Combobox (native) — leaving the entry (item 4)', () => {
    it('Cancel: a button after the field, named by the host, that abandons the entry', () => {
        const onPress = vi.fn();
        render(<Host initial="Flour" cancel={{ text: 'Cancel', name: 'Cancel, keep Flour', onPress }} />);
        const cancel = screen.getByRole('button', { name: 'Cancel, keep Flour' });

        expect(cancel.textContent).toBe('Cancel');
        fireEvent.click(cancel);

        expect(onPress).toHaveBeenCalledTimes(1);
    });

    it('the clear button empties the field, and shows only while there is text to clear', () => {
        render(<Host initial="Flour" clear={{ label: 'Clear text', icon: null }} />);

        fireEvent.click(screen.getByRole('button', { name: 'Clear text' }));

        expect(field().value).toBe('');
        expect(screen.queryByRole('button', { name: 'Clear text' })).toBeNull();
    });

    it('a clear button is 48 dp (2.5.8)', () => {
        render(<Host initial="Flour" clear={{ label: 'Clear text', icon: null }} />);

        const clear = screen.getByRole('button', { name: 'Clear text' });
        expect(Number.parseFloat(getComputedStyle(clear).minWidth)).toBeGreaterThanOrEqual(48);
        expect(Number.parseFloat(getComputedStyle(clear).minHeight)).toBeGreaterThanOrEqual(48);
    });

    it('shows neither Cancel nor a clear button unless the host asks', () => {
        render(<Host initial="Flour" />);

        expect(field().value).toBe('Flour');
        expect(screen.queryByRole('button', { name: /Cancel|Clear/ })).toBeNull();
    });
});

describe('Combobox (native) — focus', () => {
    it('tells the host when the field takes focus, so it can make this field the one it searches for', () => {
        const onFocus = vi.fn();
        render(<Host onFocus={onFocus} />);

        fireEvent.focus(field());

        expect(onFocus).toHaveBeenCalledTimes(1);
    });
});

describe('Combobox (native) — a focus request (§2d)', () => {
    // React Native's `TextInput` has `setSelection`; react-native-web's host node is a DOM input without it, so the
    // test gives the input the native method, implemented over the DOM's own.
    beforeAll(() => {
        Object.defineProperty(HTMLInputElement.prototype, 'setSelection', {
            configurable: true,
            value(this: HTMLInputElement, start: number, end: number) {
                this.setSelectionRange(start, end);
            },
        });
    });
    afterAll(() => {
        Reflect.deleteProperty(HTMLInputElement.prototype, 'setSelection');
    });

    it('focuses the field with the caret at the end, and acknowledges once', () => {
        const handled = vi.fn();
        const { rerender } = render(<Host initial="Kale" focusRequested={false} onFocusRequestHandled={handled} />);
        field().setSelectionRange(0, 0);

        rerender(<Host initial="Kale" focusRequested onFocusRequestHandled={handled} />);

        expect(document.activeElement).toBe(field());
        expect(field().selectionStart).toBe('Kale'.length);
        expect(handled).toHaveBeenCalledTimes(1);
    });

    it('does nothing while no request stands', () => {
        const handled = vi.fn();

        render(<Host initial="Kale" onFocusRequestHandled={handled} />);

        expect(document.activeElement).not.toBe(field());
        expect(handled).not.toHaveBeenCalled();
    });

    it('moves the screen-reader cursor to the field too, which `.focus()` does not (R7)', () => {
        render(<Host initial="Kale" focusRequested onFocusRequestHandled={vi.fn()} />);

        expect(AccessibilityInfo.sendAccessibilityEvent).toHaveBeenCalledWith(field(), 'focus');
    });

    it('a list request opens the list with the focus, and one acknowledgement covers both (R7)', () => {
        const handled = vi.fn();

        render(<Host initial="Kale" focusRequested listRequested onFocusRequestHandled={handled} />);

        expect(screen.getByLabelText('Food suggestions')).toBeTruthy();
        expect(handled).toHaveBeenCalledTimes(1);
    });

    it('a focus request alone leaves the list shut', () => {
        render(<Host initial="Kale" focusRequested onFocusRequestHandled={vi.fn()} />);

        expect(screen.queryByLabelText('Food suggestions')).toBeNull();
    });
});

describe('Combobox (native) — the alert said again at each refused press (R8)', () => {
    it('iOS: the same alert at a new occurrence is announced again', () => {
        platform.os = 'ios';
        const announce = vi.mocked(AccessibilityInfo.announceForAccessibilityWithOptions);
        const { rerender } = render(
            <Host
                alertAnnouncement="You’ve reached your limit for USDA lookups. You can try again at 3:05 PM."
                alertOccurrence={1}
            />,
        );

        rerender(
            <Host
                alertAnnouncement="You’ve reached your limit for USDA lookups. You can try again at 3:05 PM."
                alertOccurrence={2}
            />,
        );

        expect(
            announce.mock.calls.filter(
                ([text]) => text === 'You’ve reached your limit for USDA lookups. You can try again at 3:05 PM.',
            ),
        ).toHaveLength(2);
    });
});

/**
 * E1 (`docs/design/rowEditorOpenDecisions.md`): each time the list goes from hidden to shown, the leaf asks its host to
 * show the field and three option rows below it. The leaf holds no geometry; the host decides. Re-renders and new list
 * frames ask nothing more, and closing the list or unmounting releases the request.
 */
describe('Combobox (native) — the field reveal (E1)', () => {
    /** The list's margin and padding above its first row, and three 48 dp rows: the leaf's own budget. */
    const BELOW = 4 + 4 + 3 * 48;

    function hosted(overrides: Partial<ComboboxProps> & { readonly initial?: string } = {}) {
        const release = vi.fn();
        const revealer = vi.fn<FieldRevealer>(() => release);
        const tree = (props: typeof overrides) => (
            <FieldRevealContext.Provider value={revealer}>
                <Host {...props} />
            </FieldRevealContext.Provider>
        );
        const rendered = render(tree(overrides));

        return { revealer, release, rerender: (props: typeof overrides) => rendered.rerender(tree(props)), rendered };
    }

    beforeAll(() => {
        Object.defineProperty(HTMLInputElement.prototype, 'setSelection', {
            configurable: true,
            value(this: HTMLInputElement, start: number, end: number) {
                this.setSelectionRange(start, end);
            },
        });
    });
    afterAll(() => {
        Reflect.deleteProperty(HTMLInputElement.prototype, 'setSelection');
    });

    it('asks the host once, with its field and the room three rows need, when the list first shows', () => {
        const { revealer } = hosted();

        type('Fl');

        expect(revealer).toHaveBeenCalledExactlyOnceWith({ field: field(), below: BELOW });
    });

    it('asks nothing more on a new frame of the list or a re-render', () => {
        const { revealer, rerender } = hosted();
        type('Fl');

        type('Fla');
        rerender({ trailingStatus: [{ kind: 'note', text: 'Only your foods were searched.' }] });

        expect(revealer).toHaveBeenCalledTimes(1);
    });

    it('releases when the list closes, and asks again when it opens again', () => {
        const { revealer, release } = hosted();
        type('Fl');

        fireEvent.blur(field());
        expect(release).toHaveBeenCalledTimes(1);

        type('Flo');
        expect(revealer).toHaveBeenCalledTimes(2);
    });

    it('releases when the field unmounts with its list open', () => {
        const { release, rendered } = hosted();
        type('Fl');

        rendered.unmount();

        expect(release).toHaveBeenCalledTimes(1);
    });

    it('asks once when a refusal’s request opens the list at mount, before any food has arrived (R7)', () => {
        const { revealer, rerender } = hosted({
            focusRequested: true,
            listRequested: true,
            status: { kind: 'loading', label: 'Searching…' },
            onFocusRequestHandled: vi.fn(),
        });

        rerender({ focusRequested: true, listRequested: true, status: { kind: 'loading', label: 'Searching…' } });

        expect(revealer).toHaveBeenCalledExactlyOnceWith({ field: field(), below: BELOW });
    });

    it('asks nothing, and still opens its list, where no host provides a revealer', () => {
        render(<Host />);

        type('Fl');

        expect(screen.getByLabelText('Food suggestions')).toBeTruthy();
    });
});

/**
 * The page's drag and the open list (`docs/design/rowEditorOpenDecisions.md` item 7: the native list is in the page's
 * flow, with no scroller of its own). A drag that begins inside the list scrolls the page under the cook's finger and
 * the list stays open; a drag that begins anywhere else on the page closes it.
 */
describe('Combobox (native) — a drag on the page', () => {
    function renderInScroller(): { readonly beginDrag: () => void } {
        const listeners = new Set<() => void>();

        render(
            <ScrollerDragContext.Provider
                value={(listener) => {
                    listeners.add(listener);

                    return () => listeners.delete(listener);
                }}
            >
                <Host />
            </ScrollerDragContext.Provider>,
        );

        return {
            beginDrag: () => {
                for (const listener of listeners) {
                    listener();
                }
            },
        };
    }

    const list = (): HTMLElement => screen.getByLabelText('Food suggestions');
    /** A one-finger touch, shaped as react-native-web's responder system reads it. */
    const finger = { identifier: 0, clientX: 10, clientY: 10, pageX: 10, pageY: 10, force: 1 };
    const touch = { touches: [finger], changedTouches: [finger], targetTouches: [finger] };
    const lifted = { touches: [], changedTouches: [finger], targetTouches: [] };

    it('that begins outside the open list closes it', () => {
        const { beginDrag } = renderInScroller();
        type('fl');

        act(() => beginDrag());

        expect(field().getAttribute('aria-expanded')).toBe('false');
        expect(screen.queryByRole('button', { name: 'Flaxseed' })).toBeNull();
    });

    it('that begins inside the list keeps it open: the page scrolls the list under the finger', () => {
        const { beginDrag } = renderInScroller();
        type('fl');

        fireEvent.touchStart(list(), touch);
        act(() => beginDrag());

        expect(field().getAttribute('aria-expanded')).toBe('true');
    });

    it('a touch that ended inside the list does not shield a later drag outside it', () => {
        const { beginDrag } = renderInScroller();
        type('fl');

        fireEvent.touchStart(list(), touch);
        fireEvent.touchEnd(list(), lifted);
        act(() => beginDrag());

        expect(field().getAttribute('aria-expanded')).toBe('false');
    });

    it('with no scroller around it, nothing closes the list', () => {
        render(<Host />);
        type('fl');

        expect(field().getAttribute('aria-expanded')).toBe('true');
    });
});

describe('Combobox (native) — a line under the field', () => {
    it('draws the host’s line directly under the field, before the list in the page’s flow', () => {
        render(<Host belowField={<Text>2 tbsp · olive oil</Text>} />);
        type('fl');

        const note = screen.getByText('2 tbsp · olive oil');
        const option = screen.getByRole('button', { name: 'Flaxseed' });

        expect(note.compareDocumentPosition(option) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(field().compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });
});
