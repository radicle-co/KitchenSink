/**
 * A web popup leaves the DOM tree: Radix portals a dialog, a menu and a popover to `<body>`, so a sheet opened from a
 * muted card is no longer inside it, and a control in the sheet would read the page's surface (the canvas) instead of
 * the sheet's. So each popup ROOT states its own tone (`paperOverlay`), and a control inside reads that
 * (`componentFixes.md` §10). Each popup below is opened FROM INSIDE a muted surface to prove it does not matter where it
 * was opened from.
 *
 * Mutation lens: give a root back `bg-paper-overlay` without the tone's custom properties, or drop its tone, and the
 * popup's controls read the canvas and a test below fails.
 */
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState, type FC } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ActionMenu } from '../../actionMenu/ActionMenu.js';
import { Combobox } from '../../combobox/Combobox.js';
import { ConfirmDialog } from '../../confirmDialog/ConfirmDialog.js';
import { Popover } from '../../popover/Popover.js';
import { Sheet } from '../../sheet/Sheet.js';
import { surfaceToneOf } from '../../testing/surfaceToneOf.js';
import { Surface } from '../Surface.js';

afterEach(cleanup);

if (typeof Element.prototype.scrollIntoView !== 'function') {
    Element.prototype.scrollIntoView = (): void => undefined;
}

describe('a web popup states its own surface, whatever it was opened from', () => {
    it('Sheet: the panel and its footer are paperOverlay', () => {
        render(
            <Surface tone="muted">
                <Sheet
                    open
                    onOpenChange={vi.fn()}
                    title="Filters"
                    closeLabel="Close filters"
                    size="content"
                    footer={<button type="button">Apply</button>}
                >
                    <button type="button">In the sheet</button>
                </Sheet>
            </Surface>,
        );

        expect(surfaceToneOf(screen.getByRole('dialog'))).toBe('paperOverlay');
        expect(surfaceToneOf(screen.getByRole('button', { name: 'In the sheet' }))).toBe('paperOverlay');
        expect(surfaceToneOf(screen.getByRole('button', { name: 'Apply' }))).toBe('paperOverlay');
    });

    it('ConfirmDialog: the card is paperOverlay', () => {
        render(
            <Surface tone="muted">
                <ConfirmDialog
                    open
                    title="Discard?"
                    body="You will lose your changes."
                    confirm={{ label: 'Discard', icon: 'trash' }}
                    keep={{ label: 'Keep editing' }}
                    onConfirm={vi.fn()}
                    onKeep={vi.fn()}
                />
            </Surface>,
        );

        expect(surfaceToneOf(screen.getByRole('alertdialog'))).toBe('paperOverlay');
        expect(surfaceToneOf(screen.getByRole('button', { name: 'Keep editing' }))).toBe('paperOverlay');
    });

    it('Popover: the panel is paperOverlay', async () => {
        const user = userEvent.setup();

        render(
            <Surface tone="muted">
                <Popover triggerLabel="About Kale" triggerIcon="info" title="Kale" closeLabel="Close details for Kale">
                    <button type="button">In the popover</button>
                </Popover>
            </Surface>,
        );
        await user.click(screen.getByRole('button', { name: 'About Kale' }));

        expect(surfaceToneOf(screen.getByRole('button', { name: 'In the popover' }))).toBe('paperOverlay');
        expect(surfaceToneOf(screen.getByRole('button', { name: 'About Kale' }))).toBe('muted');
    });

    it('ActionMenu: the menu is paperOverlay', async () => {
        const user = userEvent.setup();

        render(
            <Surface tone="muted">
                <ActionMenu
                    triggerLabel="Actions for Saffron"
                    title="Saffron"
                    closeLabel="Close actions for Saffron"
                    items={[{ id: 'tryAgain', label: 'Try again', onSelect: vi.fn() }]}
                />
            </Surface>,
        );
        await user.click(screen.getByRole('button', { name: 'Actions for Saffron' }));

        expect(surfaceToneOf(screen.getByRole('menu'))).toBe('paperOverlay');
        expect(surfaceToneOf(screen.getByRole('menuitem', { name: 'Try again' }))).toBe('paperOverlay');
    });

    it('Combobox: the listbox is paperOverlay', async () => {
        const user = userEvent.setup();
        const Host: FC = () => {
            const [value, setValue] = useState('');

            return (
                <Surface tone="muted">
                    <Combobox
                        id="add"
                        label="Add an ingredient"
                        listLabel="Food suggestions"
                        value={value}
                        onValueChange={setValue}
                        groups={
                            value === ''
                                ? []
                                : [{ key: 'own', label: 'Yours', options: [{ key: 'flour', label: 'Flour' }] }]
                        }
                        onSelect={vi.fn()}
                        countAnnouncement=""
                    />
                </Surface>
            );
        };

        render(<Host />);
        await user.type(screen.getByRole('combobox', { name: 'Add an ingredient' }), 'f');

        expect(surfaceToneOf(screen.getByRole('listbox'))).toBe('paperOverlay');
        expect(surfaceToneOf(screen.getByRole('combobox', { name: 'Add an ingredient' }))).toBe('muted');
    });
});
