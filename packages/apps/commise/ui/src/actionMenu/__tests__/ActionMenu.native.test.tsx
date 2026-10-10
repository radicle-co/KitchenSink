/**
 * ActionMenu (native) — the row-actions menu as a bottom sheet of `menuitem` rows (`ingredientStatusExplanation.md`
 * §3a: "Native uses a bottom sheet, which cannot obscure the row").
 *
 * Covers: the trigger is a named, collapsed button at least 48 dp square; a tap opens the sheet listing the items in
 * order as menu items; activating one runs it and closes the sheet; and Close dismisses it without running anything.
 *
 * And the row editor's needs (`docs/design/rowEditorOpenDecisions.md` system change 6 and item 8,
 * `rowEditorBlueprint.md` decision 5): a chosen item is held and runs only once the sheet is off screen, so two Modals
 * are never up at once, and the reading cursor does not visit the trigger in between; with nothing chosen the cursor
 * returns to the trigger; a tap on the trigger does nothing while a chosen item waits; an open sheet keeps the items it
 * opened with; a host's focus request moves the cursor to the trigger; and an unavailable trigger opens nothing.
 *
 * ⚠️ The Modal's `onDismiss` is held back so a test fires it itself, standing in for iOS, where React Native reports
 * the end of the slide-out that way.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createElement, type ComponentProps } from 'react';
import { AccessibilityInfo, type Modal as ModalType } from 'react-native';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { formatRgb } from 'culori';

import { role } from '../../tokens/colors.js';
import { ActionMenu } from '../ActionMenu.native.js';
import type { ActionMenuItem, ActionMenuProps } from '../props.js';

const state = vi.hoisted(() => ({
    modal: undefined as ComponentProps<typeof ModalType> | undefined,
    os: undefined as 'ios' | undefined,
}));

vi.mock('react-native', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-native')>();

    return {
        ...actual,
        AccessibilityInfo: { ...actual.AccessibilityInfo, sendAccessibilityEvent: vi.fn() },
        Platform: {
            ...actual.Platform,
            get OS() {
                return state.os ?? actual.Platform.OS;
            },
        },
        Modal: (props: ComponentProps<typeof ModalType>) => {
            state.modal = props;

            return createElement(actual.Modal, { ...props, onDismiss: undefined });
        },
    };
});
vi.mock('react-native-safe-area-context', () => ({
    useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
vi.mock('../../layout/useKeyboardShown.native.js', () => ({ useKeyboardShown: () => false }));

beforeEach(() => {
    state.os = undefined;
    vi.mocked(AccessibilityInfo.sendAccessibilityEvent).mockClear();
});

afterEach(cleanup);

const renderMenu = () => {
    const tryAgain = vi.fn();
    const remove = vi.fn();
    render(
        <ActionMenu
            triggerLabel="Actions for Saffron"
            title="Saffron"
            closeLabel="Close actions for Saffron"
            items={[{ id: 'tryAgain', label: 'Try again', onSelect: tryAgain }]}
            destructiveItem={{ id: 'remove', label: 'Remove ingredient', onSelect: remove }}
        />,
    );

    return { tryAgain, remove, trigger: screen.getByRole('button', { name: 'Actions for Saffron' }) };
};

describe('ActionMenu (native)', () => {
    it('is a named, collapsed button at least 48 dp square', () => {
        const { trigger } = renderMenu();
        const style = getComputedStyle(trigger);

        expect(trigger.getAttribute('aria-expanded')).toBe('false');
        expect(Number.parseFloat(style.minWidth)).toBeGreaterThanOrEqual(48);
        expect(Number.parseFloat(style.minHeight)).toBeGreaterThanOrEqual(48);
    });

    it('a tap opens a sheet listing the items, in order, as menu items', () => {
        const { trigger } = renderMenu();

        fireEvent.click(trigger);

        expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
            'Try again',
            'Remove ingredient',
        ]);
        expect(trigger.getAttribute('aria-expanded')).toBe('true');
    });

    it('activating an item runs it and closes the sheet', () => {
        const { trigger, remove } = renderMenu();
        fireEvent.click(trigger);

        fireEvent.click(screen.getByRole('menuitem', { name: 'Remove ingredient' }));

        expect(remove).toHaveBeenCalledTimes(1);
        expect(screen.queryByRole('menuitem')).toBeNull();
    });

    it('Close dismisses it without running anything', () => {
        const { trigger, remove, tryAgain } = renderMenu();
        fireEvent.click(trigger);

        fireEvent.click(screen.getByRole('button', { name: 'Close actions for Saffron' }));

        expect(screen.queryByRole('menuitem')).toBeNull();
        expect(remove).not.toHaveBeenCalled();
        expect(tryAgain).not.toHaveBeenCalled();
    });

    describe('a chosen item', () => {
        const removeMenu = (onSelect: (() => void) | undefined) => (
            <ActionMenu
                triggerLabel="Actions for beef brisket"
                title="beef brisket"
                closeLabel="Close actions for beef brisket"
                items={onSelect === undefined ? [] : [{ id: 'remove', label: 'Remove ingredient', onSelect }]}
            />
        );

        it('runs the handler the host renders now, not the one it rendered when the sheet opened', () => {
            state.os = 'ios';
            const opened = vi.fn();
            const current = vi.fn();
            const { rerender } = render(removeMenu(opened));

            fireEvent.click(screen.getByRole('button', { name: 'Actions for beef brisket' }));
            fireEvent.click(screen.getByRole('menuitem', { name: 'Remove ingredient' }));
            // Another row's commit landed while the sheet slid out: the host's handler closes over the new draft.
            rerender(removeMenu(current));
            act(() => state.modal?.onDismiss?.());

            expect(current).toHaveBeenCalledTimes(1);
            expect(opened).not.toHaveBeenCalled();
        });

        it('runs nothing when the host no longer offers the chosen item', () => {
            state.os = 'ios';
            const opened = vi.fn();
            const { rerender } = render(removeMenu(opened));

            fireEvent.click(screen.getByRole('button', { name: 'Actions for beef brisket' }));
            fireEvent.click(screen.getByRole('menuitem', { name: 'Remove ingredient' }));
            rerender(removeMenu(undefined));
            act(() => state.modal?.onDismiss?.());

            expect(opened).not.toHaveBeenCalled();
        });

        it('runs only once the sheet was told to hide, and the cursor does not visit the trigger in between', () => {
            // The Modal's own `visible` when the item runs: react-native-web keeps the DOM a moment longer than a
            // device, where a hidden Modal renders nothing.
            const seen: (boolean | undefined)[] = [];
            const editDetails = vi.fn(() => {
                seen.push(state.modal?.visible);
            });
            render(
                <ActionMenu
                    triggerLabel="Actions for beef brisket"
                    title="beef brisket"
                    closeLabel="Close actions for beef brisket"
                    items={[{ id: 'editDetails', label: 'Edit details', onSelect: editDetails }]}
                />,
            );
            fireEvent.click(screen.getByRole('button', { name: 'Actions for beef brisket' }));

            fireEvent.click(screen.getByRole('menuitem', { name: 'Edit details' }));

            expect(editDetails).toHaveBeenCalledTimes(1);
            expect(seen).toStrictEqual([false]);
            expect(AccessibilityInfo.sendAccessibilityEvent).not.toHaveBeenCalledWith(
                screen.getByRole('button', { name: 'Actions for beef brisket' }),
                'focus',
            );
        });

        it('waits for the iOS dismissal, and a tap on the trigger does nothing meanwhile', () => {
            state.os = 'ios';
            const { trigger, remove } = renderMenu();
            fireEvent.click(trigger);

            fireEvent.click(screen.getByRole('menuitem', { name: 'Remove ingredient' }));
            expect(remove).not.toHaveBeenCalled();

            fireEvent.click(trigger);
            expect(trigger.getAttribute('aria-expanded')).toBe('false');

            act(() => state.modal?.onDismiss?.());

            expect(remove).toHaveBeenCalledTimes(1);
            expect(screen.queryByRole('menuitem')).toBeNull();

            // Run once: a second report of the same dismissal runs nothing again.
            act(() => state.modal?.onDismiss?.());
            expect(remove).toHaveBeenCalledTimes(1);
        });
    });

    it('with nothing chosen, returns the cursor to the trigger once the sheet is gone', () => {
        state.os = 'ios';
        const { trigger } = renderMenu();
        fireEvent.click(trigger);

        fireEvent.click(screen.getByRole('button', { name: 'Close actions for Saffron' }));
        expect(AccessibilityInfo.sendAccessibilityEvent).not.toHaveBeenCalledWith(trigger, 'focus');

        act(() => state.modal?.onDismiss?.());

        expect(AccessibilityInfo.sendAccessibilityEvent).toHaveBeenLastCalledWith(trigger, 'focus');
    });

    it('keeps the items it opened with while open, and shows the new ones at the next opening', () => {
        const items = (labels: readonly string[]): readonly ActionMenuItem[] =>
            labels.map((label) => ({ id: label, label, onSelect: vi.fn() }));
        const menu = (props: Pick<ActionMenuProps, 'items'>) => (
            <ActionMenu
                triggerLabel="Actions for beef brisket"
                title="beef brisket"
                closeLabel="Close actions for beef brisket"
                {...props}
            />
        );
        const { rerender } = render(menu({ items: items(['Change food', 'Remove ingredient']) }));
        const shown = (): readonly string[] => screen.getAllByRole('menuitem').map((item) => item.textContent ?? '');

        fireEvent.click(screen.getByRole('button', { name: 'Actions for beef brisket' }));
        rerender(menu({ items: items(['Change food', 'Add details', 'Remove ingredient']) }));

        expect(shown()).toStrictEqual(['Change food', 'Remove ingredient']);

        fireEvent.click(screen.getByRole('button', { name: 'Close actions for beef brisket' }));
        fireEvent.click(screen.getByRole('button', { name: 'Actions for beef brisket' }));

        expect(shown()).toStrictEqual(['Change food', 'Add details', 'Remove ingredient']);
    });

    it("takes a host's focus request on the trigger, and acknowledges it once", () => {
        const onFocusRequestHandled = vi.fn();
        render(
            <ActionMenu
                triggerLabel="Actions for Saffron"
                title="Saffron"
                closeLabel="Close actions for Saffron"
                items={[{ id: 'remove', label: 'Remove ingredient', onSelect: vi.fn() }]}
                focusRequested
                onFocusRequestHandled={onFocusRequestHandled}
            />,
        );

        expect(AccessibilityInfo.sendAccessibilityEvent).toHaveBeenCalledWith(
            screen.getByRole('button', { name: 'Actions for Saffron' }),
            'focus',
        );
        expect(onFocusRequestHandled).toHaveBeenCalledTimes(1);
    });

    it('reads disabled and opens nothing while unavailable', () => {
        render(
            <ActionMenu
                triggerLabel="Actions for Saffron"
                title="Saffron"
                closeLabel="Close actions for Saffron"
                items={[{ id: 'remove', label: 'Remove ingredient', onSelect: vi.fn() }]}
                unavailable
            />,
        );
        const trigger = screen.getByRole('button', { name: 'Actions for Saffron' });

        fireEvent.click(trigger);

        expect(trigger.getAttribute('aria-disabled')).toBe('true');
        expect(screen.queryByRole('menuitem')).toBeNull();
    });
});

/**
 * Slice 2 of the UI overhaul (blueprint Part B, ActionMenu): the trigger is the `ellipsis` glyph, and the destructive
 * item is a separate field drawn last, after a divider, in the danger label.
 */
describe('ActionMenu (native) — the overhaul contract', () => {
    it('draws the ellipsis glyph in its trigger', () => {
        const { trigger } = renderMenu();

        expect(trigger.querySelector<HTMLElement>('[data-commise-stub="icon"]')?.dataset['iconName']).toBe('ellipsis');
    });

    it('places the destructive item last, after a divider, in the danger label', () => {
        const { trigger } = renderMenu();
        fireEvent.click(trigger);

        const menu = screen.getByRole('menu');
        const parts = [...menu.children].map((child) => child.getAttribute('role'));

        expect(parts).toStrictEqual(['menuitem', 'separator', 'menuitem']);
        expect(getComputedStyle(screen.getByText('Remove ingredient')).color).toBe(formatRgb(role.dangerText));
        expect(getComputedStyle(screen.getByText('Try again')).color).toBe(formatRgb(role.ink));
    });

    it('runs the destructive item the host renders now, once the sheet is gone', () => {
        const opened = vi.fn();
        const current = vi.fn();
        const menu = (onSelect: () => void) => (
            <ActionMenu
                triggerLabel="Actions for Saffron"
                title="Saffron"
                closeLabel="Close actions for Saffron"
                items={[{ id: 'changeFood', label: 'Change food', onSelect: vi.fn() }]}
                destructiveItem={{ id: 'remove', label: 'Remove ingredient', onSelect }}
            />
        );
        state.os = 'ios';
        const { rerender } = render(menu(opened));

        fireEvent.click(screen.getByRole('button', { name: 'Actions for Saffron' }));
        fireEvent.click(screen.getByRole('menuitem', { name: 'Remove ingredient' }));
        rerender(menu(current));
        act(() => state.modal?.onDismiss?.());

        expect(current).toHaveBeenCalledTimes(1);
        expect(opened).not.toHaveBeenCalled();
    });

    it('draws an item’s glyph before its label', () => {
        render(
            <ActionMenu
                triggerLabel="Actions for Saffron"
                title="Saffron"
                closeLabel="Close actions for Saffron"
                items={[{ id: 'history', label: 'Version history', icon: 'clock', onSelect: vi.fn() }]}
            />,
        );
        fireEvent.click(screen.getByRole('button', { name: 'Actions for Saffron' }));

        expect(
            screen
                .getByRole('menuitem', { name: 'Version history' })
                .querySelector<HTMLElement>('[data-commise-stub="icon"]')?.dataset['iconName'],
        ).toBe('clock');
    });
});
