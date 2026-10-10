// @vitest-environment jsdom
/**
 * Component tests for the web Paste steps control (`docs/design/uiOverhaul/buildSpec.md` §7.6, §7.12): a ghost button
 * that opens a sheet with a labelled field, a live count in the primary "Add {n} steps" (disabled at 0), and Cancel. On
 * add the sheet closes and the split steps go up through `onAdd`. The splitting itself is `splitPastedSteps`'s, pinned
 * in `pasteSteps.test.ts`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { editorMessages } from '../../editor/messages.js';
import { PasteStepsControl } from '../PasteStepsControl.js';

const s = editorMessages.en.steps;

afterEach(cleanup);

const open = async (user: ReturnType<typeof userEvent.setup>): Promise<HTMLElement> => {
    await user.click(screen.getByRole('button', { name: s.paste }));

    return screen.getByRole('dialog', { name: s.pasteTitle });
};

const paste = (dialog: HTMLElement, text: string): void => {
    fireEvent.change(within(dialog).getByRole('textbox', { name: s.pasteLabel }), { target: { value: text } });
};

describe('PasteStepsControl (web)', () => {
    it('is a "Paste steps" button that opens nothing until pressed', () => {
        render(<PasteStepsControl onAdd={vi.fn()} />);

        expect(screen.getByRole('button', { name: s.paste })).toBeTruthy();
        expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('opens a sheet titled "Paste steps" with a labelled field and its hint', async () => {
        const user = userEvent.setup();
        render(<PasteStepsControl onAdd={vi.fn()} />);

        const dialog = await open(user);
        const field = within(dialog).getByRole('textbox', { name: s.pasteLabel });

        expect(field.getAttribute('aria-describedby')?.split(' ')).toContain(within(dialog).getByText(s.pasteHint).id);
    });

    it('starts at "Add 0 steps", disabled', async () => {
        const user = userEvent.setup();
        render(<PasteStepsControl onAdd={vi.fn()} />);

        const dialog = await open(user);
        const add = within(dialog).getByRole<HTMLButtonElement>('button', { name: 'Add 0 steps' });

        expect(add.disabled || add.getAttribute('aria-disabled') === 'true').toBe(true);
    });

    it('counts the steps live, in the right plural', async () => {
        const user = userEvent.setup();
        render(<PasteStepsControl onAdd={vi.fn()} />);
        const dialog = await open(user);

        paste(dialog, 'Boil the water.');
        expect(within(dialog).getByRole('button', { name: 'Add 1 step' })).toBeTruthy();

        paste(dialog, '1. Boil.\n2. Drain.\n3. Serve.');
        expect(within(dialog).getByRole('button', { name: 'Add 3 steps' })).toBeTruthy();
    });

    // F11 (`evaluateFinal.md`; `buildSpec.md` §5.1): below 840 the primary fills the sheet and the × is the only way out;
    // at 840+ a ghost Cancel sits beside a content-width primary.
    it('fills the primary and shows Cancel only from 840', async () => {
        const user = userEvent.setup();
        render(<PasteStepsControl onAdd={vi.fn()} />);
        const dialog = await open(user);

        const add = within(dialog).getByRole('button', { name: 'Add 0 steps' });
        const cancel = within(dialog).getByRole('button', { name: s.pasteCancel });

        expect(add.className.split(' ')).toContain('w-full');
        expect((cancel.closest('.hidden') as HTMLElement | null)?.className.split(' ')).toContain('nav:block');
    });

    it('adds the split steps and closes the sheet', async () => {
        const user = userEvent.setup();
        const onAdd = vi.fn();
        render(<PasteStepsControl onAdd={onAdd} />);
        const dialog = await open(user);

        paste(dialog, 'Boil.\n\nDrain.');
        await user.click(within(dialog).getByRole('button', { name: 'Add 2 steps' }));

        expect(onAdd).toHaveBeenCalledWith(['Boil.', 'Drain.']);
        expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('Cancel closes without adding, and the next open starts empty', async () => {
        const user = userEvent.setup();
        const onAdd = vi.fn();
        render(<PasteStepsControl onAdd={onAdd} />);
        const dialog = await open(user);

        paste(dialog, 'Boil.');
        await user.click(within(dialog).getByRole('button', { name: s.pasteCancel }));

        expect(onAdd).not.toHaveBeenCalled();
        expect(screen.queryByRole('dialog', { name: s.pasteTitle })).toBeNull();

        const again = await open(user);
        expect(within(again).getByRole<HTMLTextAreaElement>('textbox', { name: s.pasteLabel }).value).toBe('');
    });
});
