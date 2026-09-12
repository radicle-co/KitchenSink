/**
 * ActionMenu (web) — the design-system row-actions menu over `@radix-ui/react-dropdown-menu`
 * (`docs/design/ingredientStatusExplanation.md` §3a: the full APG Menu Button keyboard model).
 *
 * Covers: the trigger is a menu button named for its row, collapsed at rest; Enter / Space / Down open it with focus
 * on the FIRST item and Up opens it on the LAST; Down/Up/Home/End move between items; activating an item runs it and
 * closes the menu; Escape closes it and returns focus to the trigger; and the trigger meets the 44 px target.
 *
 * And the row editor's three needs (`docs/design/rowEditorOpenDecisions.md` system change 6, `rowEditorBlueprint.md`
 * decision 5): a chosen item is held and runs once the menu has gone, with focus back on the trigger first, so a dialog
 * it opens records the trigger as the place to return to (`ingredientSpecialization.md` §S7, web); a press on the
 * trigger does nothing while a chosen item waits; an open menu keeps the items it opened with; a host's focus request
 * moves focus to the trigger; and an unavailable trigger opens nothing.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState, type JSX } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Sheet } from '../../sheet/Sheet.js';
import { ActionMenu } from '../ActionMenu.js';
import type { ActionMenuItem, ActionMenuProps } from '../props.js';

afterEach(cleanup);

if (typeof Element !== 'undefined') {
    // jsdom implements neither pointer capture nor scrollIntoView, which Radix's menu calls on open.
    Element.prototype.hasPointerCapture ??= (): boolean => false;
    Element.prototype.releasePointerCapture ??= (): void => undefined;
    Element.prototype.scrollIntoView ??= (): void => undefined;
}

const renderMenu = () => {
    const tryAgain = vi.fn();
    const remove = vi.fn();
    render(
        <ActionMenu
            triggerLabel="Actions for Saffron"
            title="Saffron"
            closeLabel="Close actions for Saffron"
            items={[
                { key: 'tryAgain', label: 'Try again', onSelect: tryAgain },
                { key: 'remove', label: 'Remove ingredient', onSelect: remove, tone: 'destructive' },
            ]}
        />,
    );

    return { tryAgain, remove, trigger: screen.getByRole('button', { name: 'Actions for Saffron' }) };
};

describe('ActionMenu (web)', () => {
    it('is a collapsed menu button named for its row', () => {
        const { trigger } = renderMenu();

        expect(trigger.getAttribute('aria-haspopup')).toBe('menu');
        expect(trigger.getAttribute('aria-expanded')).toBe('false');
        expect(trigger.className).toContain('h-11');
    });

    it.each(['{Enter}', ' ', '{ArrowDown}'])(
        'opens from the keyboard (%s) with focus on the FIRST item',
        async (key) => {
            const user = userEvent.setup();
            const { trigger } = renderMenu();
            trigger.focus();

            await user.keyboard(key);

            expect(screen.getByRole('menu')).toBeTruthy();
            expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Try again' }));
        },
    );

    it('Down / End / Home move between items', async () => {
        const user = userEvent.setup();
        const { trigger } = renderMenu();
        trigger.focus();
        await user.keyboard('{Enter}');

        await user.keyboard('{ArrowDown}');
        expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Remove ingredient' }));
        await user.keyboard('{Home}');
        expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Try again' }));
        await user.keyboard('{End}');
        expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Remove ingredient' }));
    });

    it('activating an item runs it and closes the menu', async () => {
        const user = userEvent.setup();
        const { trigger, remove, tryAgain } = renderMenu();
        await user.click(trigger);

        await user.click(screen.getByRole('menuitem', { name: 'Remove ingredient' }));

        expect(remove).toHaveBeenCalledTimes(1);
        expect(tryAgain).not.toHaveBeenCalled();
        expect(screen.queryByRole('menu')).toBeNull();
    });

    it('Escape closes it and returns focus to the trigger (APG)', async () => {
        const user = userEvent.setup();
        const { trigger } = renderMenu();
        trigger.focus();
        await user.keyboard('{Enter}');

        await user.keyboard('{Escape}');

        expect(screen.queryByRole('menu')).toBeNull();
        expect(document.activeElement).toBe(trigger);
    });

    describe('a chosen item', () => {
        const removeMenu = (onSelect: (() => void) | undefined) => (
            <ActionMenu
                triggerLabel="Actions for beef brisket"
                title="beef brisket"
                closeLabel="Close actions for beef brisket"
                items={onSelect === undefined ? [] : [{ key: 'remove', label: 'Remove ingredient', onSelect }]}
            />
        );

        it('runs the handler the host renders now, not the one it rendered when the menu opened', async () => {
            const user = userEvent.setup();
            const opened = vi.fn();
            const current = vi.fn();
            const { rerender } = render(removeMenu(opened));

            await user.click(screen.getByRole('button', { name: 'Actions for beef brisket' }));
            // Another row's commit landed while the menu was open: the host's handler closes over the new draft.
            rerender(removeMenu(current));
            await user.click(screen.getByRole('menuitem', { name: 'Remove ingredient' }));

            expect(current).toHaveBeenCalledTimes(1);
            expect(opened).not.toHaveBeenCalled();
        });

        it('runs nothing when the host no longer offers the chosen item', async () => {
            const user = userEvent.setup();
            const opened = vi.fn();
            const { rerender } = render(removeMenu(opened));

            await user.click(screen.getByRole('button', { name: 'Actions for beef brisket' }));
            rerender(removeMenu(undefined));
            await user.click(screen.getByRole('menuitem', { name: 'Remove ingredient' }));

            expect(opened).not.toHaveBeenCalled();
            expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Actions for beef brisket' }));
        });

        it('runs once the menu has gone, with focus already back on the trigger', async () => {
            const user = userEvent.setup();
            const seen: { menu: HTMLElement | null; focus: Element | null }[] = [];
            const changeFood = vi.fn(() => {
                seen.push({ menu: screen.queryByRole('menu'), focus: document.activeElement });
            });
            render(
                <ActionMenu
                    triggerLabel="Actions for Saffron"
                    title="Saffron"
                    closeLabel="Close actions for Saffron"
                    items={[{ key: 'changeFood', label: 'Change food', onSelect: changeFood }]}
                />,
            );
            const trigger = screen.getByRole('button', { name: 'Actions for Saffron' });

            await user.click(trigger);
            await user.click(screen.getByRole('menuitem', { name: 'Change food' }));

            expect(changeFood).toHaveBeenCalledTimes(1);
            expect(seen).toStrictEqual([{ menu: null, focus: trigger }]);
        });

        it('opens a dialog that returns focus to the trigger when it closes (§S8.8)', async () => {
            const user = userEvent.setup();

            function Row(): JSX.Element {
                const [detailsOpen, setDetailsOpen] = useState(false);

                return (
                    <>
                        <ActionMenu
                            triggerLabel="Actions for beef brisket"
                            title="beef brisket"
                            closeLabel="Close actions for beef brisket"
                            items={[
                                { key: 'editDetails', label: 'Edit details', onSelect: () => setDetailsOpen(true) },
                            ]}
                        />
                        <Sheet
                            open={detailsOpen}
                            onOpenChange={setDetailsOpen}
                            title="Edit details"
                            closeLabel="Close details"
                            size="content"
                        >
                            <p>Flat half</p>
                        </Sheet>
                    </>
                );
            }

            render(<Row />);
            const trigger = screen.getByRole('button', { name: 'Actions for beef brisket' });
            await user.click(trigger);
            await user.click(screen.getByRole('menuitem', { name: 'Edit details' }));

            expect(screen.getByRole('dialog', { name: 'Edit details' })).toBeTruthy();

            await user.click(screen.getByRole('button', { name: 'Close details' }));

            expect(screen.queryByRole('dialog')).toBeNull();
            expect(document.activeElement).toBe(trigger);
        });

        it('makes a press on the trigger do nothing until it has run', async () => {
            const { trigger, remove } = renderMenu();
            await userEvent.setup().click(trigger);

            // Synchronous events, so nothing between the choice and the menu's own dismissal has run yet.
            fireEvent.click(screen.getByRole('menuitem', { name: 'Remove ingredient' }));
            fireEvent.pointerDown(trigger, { button: 0, pointerType: 'mouse' });
            fireEvent.keyDown(trigger, { key: 'Enter' });

            expect(screen.queryByRole('menu')).toBeNull();
            expect(remove).not.toHaveBeenCalled();

            await act(async () => {
                await new Promise((resolve) => {
                    setTimeout(resolve, 0);
                });
            });

            expect(remove).toHaveBeenCalledTimes(1);
            expect(screen.queryByRole('menu')).toBeNull();
        });
    });

    it('keeps the items it opened with while it stays open, and shows the new ones at the next opening', async () => {
        const user = userEvent.setup();
        const items = (labels: readonly string[]): readonly ActionMenuItem[] =>
            labels.map((label) => ({ key: label, label, onSelect: vi.fn() }));
        const menu = (props: Pick<ActionMenuProps, 'items'>) => (
            <ActionMenu
                triggerLabel="Actions for beef brisket"
                title="beef brisket"
                closeLabel="Close actions for beef brisket"
                {...props}
            />
        );
        const { rerender } = render(menu({ items: items(['Change food', 'Remove ingredient']) }));
        const trigger = screen.getByRole('button', { name: 'Actions for beef brisket' });
        const shown = (): readonly string[] => screen.getAllByRole('menuitem').map((item) => item.textContent ?? '');

        await user.click(trigger);
        rerender(menu({ items: items(['Change food', 'Add details', 'Remove ingredient']) }));

        expect(shown()).toStrictEqual(['Change food', 'Remove ingredient']);

        await user.keyboard('{Escape}');
        await user.click(trigger);

        expect(shown()).toStrictEqual(['Change food', 'Add details', 'Remove ingredient']);
    });

    it("takes a host's focus request on the trigger, and acknowledges it once", () => {
        const onFocusRequestHandled = vi.fn();
        render(
            <ActionMenu
                triggerLabel="Actions for Saffron"
                title="Saffron"
                closeLabel="Close actions for Saffron"
                items={[{ key: 'remove', label: 'Remove ingredient', onSelect: vi.fn() }]}
                focusRequested
                onFocusRequestHandled={onFocusRequestHandled}
            />,
        );

        expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Actions for Saffron' }));
        expect(onFocusRequestHandled).toHaveBeenCalledTimes(1);
    });

    it('is aria-disabled and opens nothing while unavailable, and stays focusable', async () => {
        const user = userEvent.setup();
        render(
            <ActionMenu
                triggerLabel="Actions for Saffron"
                title="Saffron"
                closeLabel="Close actions for Saffron"
                items={[{ key: 'remove', label: 'Remove ingredient', onSelect: vi.fn() }]}
                unavailable
            />,
        );
        const trigger = screen.getByRole('button', { name: 'Actions for Saffron' });

        await user.click(trigger);
        trigger.focus();
        await user.keyboard('{Enter}');

        expect(trigger.getAttribute('aria-disabled')).toBe('true');
        expect(trigger.hasAttribute('disabled')).toBe(false);
        expect(document.activeElement).toBe(trigger);
        expect(screen.queryByRole('menu')).toBeNull();
    });
});
