// @vitest-environment jsdom
/**
 * The web new-collection sheet (`docs/design/uiOverhaul/buildSpec.md` §5.1): a name (required, 80 characters, a counter
 * from 60) and an optional description (280), Create collection, an inline error for an empty name with focus moved to
 * the field (SC 3.3.1), an inline alert for a server failure that keeps the input, and a discard confirmation when a
 * typed name would be lost.
 */
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LocaleProvider } from '@commise/i18n/react';

import {
    CollectionSheet,
    type CollectionCreateSheetProps,
    type CollectionRenameSheetProps,
} from '../CollectionSheet.js';

afterEach(cleanup);

function sheet(over: Partial<CollectionCreateSheetProps> = {}) {
    const props: CollectionCreateSheetProps = {
        open: true,
        onOpenChange: vi.fn(),
        onCreate: vi.fn(),
        submitting: false,
        failed: false,
        ...over,
    };

    render(
        <LocaleProvider locale="en">
            <CollectionSheet {...props} />
        </LocaleProvider>,
    );

    return props;
}

describe('CollectionSheet (web)', () => {
    it('is a dialog titled "New collection" with a named Name and Description', () => {
        sheet();
        const dialog = screen.getByRole('dialog', { name: 'New collection' });

        expect(within(dialog).getByRole('textbox', { name: 'Name' })).toBeTruthy();
        expect(within(dialog).getByRole('textbox', { name: 'Description (optional)' })).toBeTruthy();
    });

    it('creates with the trimmed name and description', async () => {
        const props = sheet();
        const user = userEvent.setup();

        await user.type(screen.getByRole('textbox', { name: 'Name' }), '  Weeknights ');
        await user.type(screen.getByRole('textbox', { name: 'Description (optional)' }), 'Quick ones');
        await user.click(screen.getByRole('button', { name: 'Create collection' }));

        expect(props.onCreate).toHaveBeenCalledWith({ name: 'Weeknights', description: 'Quick ones' });
    });

    it('sends no description when none was typed', async () => {
        const props = sheet();
        const user = userEvent.setup();

        await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Holidays');
        await user.click(screen.getByRole('button', { name: 'Create collection' }));

        expect(props.onCreate).toHaveBeenCalledWith({ name: 'Holidays' });
    });

    it('refuses an empty name, says why under the field, and moves focus to it', async () => {
        const props = sheet();
        const user = userEvent.setup();

        await user.type(screen.getByRole('textbox', { name: 'Name' }), '   ');
        await user.click(screen.getByRole('button', { name: 'Create collection' }));
        const field = screen.getByRole('textbox', { name: 'Name' });

        expect(props.onCreate).not.toHaveBeenCalled();
        expect(field.getAttribute('aria-invalid')).toBe('true');
        expect(document.getElementById(field.getAttribute('aria-describedby') ?? '')?.textContent).toBe(
            'Give your collection a name.',
        );
        expect(document.activeElement).toBe(field);
    });

    it('caps the name at 80 and shows the counter from 60', async () => {
        sheet();
        const user = userEvent.setup();
        const field = screen.getByRole('textbox', { name: 'Name' });

        await user.type(field, 'x'.repeat(59));
        expect(screen.queryByText('59/80')).toBeNull();

        await user.type(field, 'x'.repeat(30));

        expect((field as HTMLInputElement).value).toHaveLength(80);
        expect(screen.getByText('80/80')).toBeTruthy();
    });

    it('caps the description at 280', async () => {
        sheet();
        const user = userEvent.setup();
        const field = screen.getByRole('textbox', { name: 'Description (optional)' });

        await user.click(field);
        await user.paste('y'.repeat(300));

        expect((field as HTMLTextAreaElement).value).toHaveLength(280);
    });

    it('says a server failure in an alert above the button, keeping what was typed', () => {
        sheet({ failed: true });

        expect(screen.getByRole('alert').textContent).toBe('We couldn’t create the collection. Try again.');
    });

    it('marks Create collection busy while the request is in flight', () => {
        sheet({ submitting: true });

        expect(screen.getByRole('button', { name: 'Create collection' }).getAttribute('aria-busy')).toBe('true');
    });

    // F11 (`evaluateFinal.md`; `buildSpec.md` §5.1): below 840 the primary fills the sheet and there is no Cancel (the
    // sheet's × closes it); at 840+ the dialog has a ghost Cancel beside a content-width primary.
    it('fills the primary and hides Cancel below 840, and shows Cancel at 840+', () => {
        sheet();

        const create = screen.getByRole('button', { name: 'Create collection' });
        const cancel = screen.getByRole('button', { name: 'Cancel' });

        expect(create.className.split(' ')).toContain('w-full');
        expect((cancel.closest('.hidden') as HTMLElement | null)?.className.split(' ')).toContain('nav:block');
    });

    it('closes at once when nothing was typed', async () => {
        const props = sheet();
        const user = userEvent.setup();

        await user.click(screen.getByRole('button', { name: 'Cancel' }));

        expect(props.onOpenChange).toHaveBeenCalledWith(false);
    });

    it('asks before discarding a typed name, and Keep editing keeps it', async () => {
        const props = sheet();
        const user = userEvent.setup();

        await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Picnics');
        await user.click(screen.getByRole('button', { name: 'Cancel' }));
        const confirm = screen.getByRole('alertdialog', { name: 'Discard this collection?' });

        expect(props.onOpenChange).not.toHaveBeenCalled();

        await user.click(within(confirm).getByRole('button', { name: 'Keep editing' }));

        expect(screen.getByRole('textbox', { name: 'Name' })).toHaveProperty('value', 'Picnics');

        await user.click(screen.getByRole('button', { name: 'Cancel' }));
        await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Discard' }));

        expect(props.onOpenChange).toHaveBeenCalledWith(false);
    });
});

/**
 * Rename uses the SAME sheet (`docs/design/uiOverhaul/buildSpec.md` §5.1): the title "Rename collection", the name and
 * description filled in, the primary "Save name", and the same caps. It replaces the `/collections/{id}/rename` page.
 */
describe('CollectionSheet (web) — rename', () => {
    function renameSheet(over: Partial<CollectionRenameSheetProps> = {}) {
        const props: CollectionRenameSheetProps = {
            open: true,
            onOpenChange: vi.fn(),
            intent: 'rename',
            initial: { name: 'Weeknights', description: 'Quick ones' },
            onRename: vi.fn(),
            submitting: false,
            failed: false,
            ...over,
        };

        const view = render(
            <LocaleProvider locale="en">
                <CollectionSheet {...props} />
            </LocaleProvider>,
        );

        return { props, view };
    }

    it('is a dialog titled "Rename collection" with the current name and description filled in', () => {
        renameSheet();
        const dialog = screen.getByRole('dialog', { name: 'Rename collection' });

        expect(within(dialog).getByRole<HTMLInputElement>('textbox', { name: 'Name' }).value).toBe('Weeknights');
        expect(within(dialog).getByRole<HTMLTextAreaElement>('textbox', { name: 'Description (optional)' }).value).toBe(
            'Quick ones',
        );
        expect(within(dialog).getByRole('button', { name: 'Save name' })).toBeTruthy();
        expect(within(dialog).queryByRole('button', { name: 'Create collection' })).toBeNull();
    });

    it('saves the trimmed edits through onRename, never onCreate', async () => {
        const { props } = renameSheet();
        const user = userEvent.setup();

        await user.clear(screen.getByRole('textbox', { name: 'Name' }));
        await user.type(screen.getByRole('textbox', { name: 'Name' }), '  Dinners ');
        await user.click(screen.getByRole('button', { name: 'Save name' }));

        expect(props.onRename).toHaveBeenCalledWith({ name: 'Dinners', description: 'Quick ones' });
    });

    it('refuses an emptied name', async () => {
        const { props } = renameSheet();
        const user = userEvent.setup();

        await user.clear(screen.getByRole('textbox', { name: 'Name' }));
        await user.click(screen.getByRole('button', { name: 'Save name' }));

        expect(props.onRename).not.toHaveBeenCalled();
        expect(screen.getByText('Give your collection a name.')).toBeTruthy();
    });

    it('says a failed rename in its own words, keeping what was typed', () => {
        renameSheet({ failed: true });

        expect(screen.getByRole('alert').textContent).toBe('We couldn’t rename the collection. Try again.');
    });

    it('closes at once when nothing changed, and asks before discarding an edit', async () => {
        const first = renameSheet();
        const user = userEvent.setup();

        await user.click(screen.getByRole('button', { name: 'Cancel' }));
        expect(first.props.onOpenChange).toHaveBeenCalledWith(false);
        cleanup();

        const second = renameSheet();
        await user.type(screen.getByRole('textbox', { name: 'Name' }), ' and more');
        await user.click(screen.getByRole('button', { name: 'Cancel' }));

        expect(second.props.onOpenChange).not.toHaveBeenCalled();
        expect(screen.getByRole('alertdialog', { name: 'Discard this collection?' })).toBeTruthy();
    });

    it('starts again from the collection’s current name each time it opens', () => {
        const { view } = renameSheet({ open: false });
        const rerender = (open: boolean, name: string) =>
            view.rerender(
                <LocaleProvider locale="en">
                    <CollectionSheet
                        open={open}
                        onOpenChange={vi.fn()}
                        intent="rename"
                        initial={{ name }}
                        onRename={vi.fn()}
                        submitting={false}
                        failed={false}
                    />
                </LocaleProvider>,
            );

        rerender(true, 'First name');
        expect(screen.getByRole<HTMLInputElement>('textbox', { name: 'Name' }).value).toBe('First name');

        rerender(false, 'First name');
        rerender(true, 'Renamed elsewhere');

        expect(screen.getByRole<HTMLInputElement>('textbox', { name: 'Name' }).value).toBe('Renamed elsewhere');
    });
});
