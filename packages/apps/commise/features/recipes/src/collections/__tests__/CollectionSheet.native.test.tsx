/**
 * The native new-collection sheet, the twin of `CollectionSheet.test.tsx` (`buildSpec.md` §5.1): create with the
 * trimmed name and description, refuse an empty name with an inline error, cap the name with its counter, say a server
 * failure, and confirm before discarding a typed name.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LocaleProvider } from '@commise/i18n/react';
import { recordedTextInputs } from '@commise/ui/testing/record-text-inputs';

import {
    CollectionSheet,
    type CollectionCreateSheetProps,
    type CollectionRenameSheetProps,
} from '../CollectionSheet.native.js';

// react-native-web drops `accessibilityHint` and iOS ignores `aria-labelledby`, so the fields are wrapped to record the
// accessibility props a screen reader is actually given.
vi.mock('@commise/ui/text-input', async (importOriginal) => {
    const { recordingTextInputModule } = await import('@commise/ui/testing/record-text-inputs');

    return recordingTextInputModule(await importOriginal<typeof import('@commise/ui/text-input')>());
});

afterEach(() => {
    cleanup();
    recordedTextInputs.clear();
});

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

const nameField = () => screen.getByLabelText('Name');

/** The recorded props of the field whose accessibility label is this (the sheet's ids are generated). */
const recorded = (label: string) =>
    [...recordedTextInputs.values()].find((props) => props.accessibilityLabel === label);

describe('CollectionSheet (native) — dismissal', () => {
    it('passes the sheet’s dismissal on, once, after it closes and not while it is open', () => {
        const onDismissed = vi.fn();
        const props: CollectionCreateSheetProps = {
            open: true,
            onOpenChange: vi.fn(),
            onCreate: vi.fn(),
            onDismissed,
            submitting: false,
            failed: false,
        };
        const view = render(
            <LocaleProvider locale="en">
                <CollectionSheet {...props} />
            </LocaleProvider>,
        );

        expect(onDismissed).not.toHaveBeenCalled();

        view.rerender(
            <LocaleProvider locale="en">
                <CollectionSheet {...props} open={false} />
            </LocaleProvider>,
        );

        expect(onDismissed).toHaveBeenCalledTimes(1);
    });
});

describe('CollectionSheet (native) — what a screen reader receives', () => {
    it('names the name and description fields by their visible labels, for iOS', () => {
        sheet();

        expect(recorded('Name')).toBeDefined();
        expect(recorded('Description (optional)')).toBeDefined();
    });

    it('has no hint on the name field until it is refused', () => {
        sheet();

        expect(recorded('Name')?.accessibilityHint).toBeUndefined();
    });

    it('hands the refusal of an empty name to the name field as its hint', () => {
        sheet();

        fireEvent.click(screen.getByRole('button', { name: 'Create collection' }));

        expect(recorded('Name')?.accessibilityHint).toBe('Give your collection a name.');
        expect(recorded('Description (optional)')?.accessibilityHint).toBeUndefined();
    });
});

describe('CollectionSheet (native)', () => {
    it('creates with the trimmed name and description', () => {
        const props = sheet();

        fireEvent.change(nameField(), { target: { value: '  Weeknights ' } });
        fireEvent.change(screen.getByLabelText('Description (optional)'), { target: { value: 'Quick' } });
        fireEvent.click(screen.getByRole('button', { name: 'Create collection' }));

        expect(props.onCreate).toHaveBeenCalledWith({ name: 'Weeknights', description: 'Quick' });
    });

    it('refuses an empty name and says why', () => {
        const props = sheet();

        fireEvent.click(screen.getByRole('button', { name: 'Create collection' }));

        expect(props.onCreate).not.toHaveBeenCalled();
        expect(screen.getByText('Give your collection a name.')).toBeTruthy();
    });

    it('caps the name at 80 with the counter', () => {
        sheet();

        fireEvent.change(nameField(), { target: { value: 'x'.repeat(90) } });

        expect((nameField() as HTMLInputElement).value).toHaveLength(80);
        expect(screen.getByText('80/80')).toBeTruthy();
    });

    it('says a server failure', () => {
        sheet({ failed: true });

        expect(screen.getByText('We couldn’t create the collection. Try again.')).toBeTruthy();
    });

    it('confirms before discarding a typed name', () => {
        const props = sheet();

        fireEvent.change(nameField(), { target: { value: 'Picnics' } });
        fireEvent.click(screen.getByRole('button', { name: 'Close' }));

        expect(props.onOpenChange).not.toHaveBeenCalled();
        expect(screen.getByText('Discard this collection?')).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: 'Discard' }));

        expect(props.onOpenChange).toHaveBeenCalledWith(false);
    });
});

/**
 * Rename uses the SAME sheet (`docs/design/uiOverhaul/buildSpec.md` §5.1): the title "Rename collection", the name and
 * description filled in, the primary "Save name", and the same caps. It replaces the `/collections/{id}/rename` page.
 */
describe('CollectionSheet (native) — rename', () => {
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
        expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Weeknights');
        expect((screen.getByLabelText('Description (optional)') as HTMLTextAreaElement).value).toBe('Quick ones');
        expect(screen.getByRole('button', { name: 'Save name' })).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'Create collection' })).toBeNull();
    });

    it('saves the trimmed edits through onRename, never onCreate', () => {
        const { props } = renameSheet();

        fireEvent.change(screen.getByLabelText('Name'), { target: { value: '' } });
        fireEvent.change(screen.getByLabelText('Name'), { target: { value: '  Dinners ' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save name' }));

        expect(props.onRename).toHaveBeenCalledWith({ name: 'Dinners', description: 'Quick ones' });
    });

    it('refuses an emptied name', () => {
        const { props } = renameSheet();

        fireEvent.change(screen.getByLabelText('Name'), { target: { value: '' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save name' }));

        expect(props.onRename).not.toHaveBeenCalled();
        expect(screen.getByText('Give your collection a name.')).toBeTruthy();
    });

    it('says a failed rename in its own words, keeping what was typed', () => {
        renameSheet({ failed: true });

        expect(screen.getByRole('alert').textContent).toBe('We couldn’t rename the collection. Try again.');
    });

    it('closes at once when nothing changed, and asks before discarding an edit', () => {
        const first = renameSheet();

        fireEvent.click(screen.getByRole('button', { name: 'Close' }));
        expect(first.props.onOpenChange).toHaveBeenCalledWith(false);
        cleanup();

        const second = renameSheet();
        fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Weeknights and more' } });
        fireEvent.click(screen.getByRole('button', { name: 'Close' }));

        expect(second.props.onOpenChange).not.toHaveBeenCalled();
        expect(screen.getByText('Discard this collection?')).toBeTruthy();
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
        expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('First name');

        rerender(false, 'First name');
        rerender(true, 'Renamed elsewhere');

        expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Renamed elsewhere');
    });
});
