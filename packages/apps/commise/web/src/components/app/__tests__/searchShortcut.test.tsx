/**
 * The `/` shortcut (`docs/architecture/uiOverhaulBlueprint.md` A18; WCAG 2.1.4). One document `keydown` listener
 * focuses the page's search field. The predicate is the part that must never misfire: a `/` typed into a field, a
 * chord, an IME composition, or a key some other handler already took is NOT a shortcut — and neither is a `/` pressed
 * while a modal dialog is open, where focus must not jump behind it.
 */
import { cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The preference lives on the server (D19, ADR-0059); the hook reads it through the settings query. The query is the
// seam: what it answers is what the hook obeys, so the tests set the answer and never touch browser storage.
const { settings } = vi.hoisted(() => ({
    settings: {
        current: { searchShortcut: true } as { searchShortcut: boolean } | undefined,
        placeholder: false,
    },
}));

vi.mock('@/hooks/useUserSettings', () => ({
    useUserSettings: () => ({ data: settings.current, isPlaceholderData: settings.placeholder }),
}));

import { AccountEraseDialog } from '@commise/features-account/danger';
import { ConfirmDialog } from '@commise/ui/confirm-dialog';

import { findSearchField, hasOpenModal, isSearchShortcut, isEditableTarget } from '../searchShortcut';
import { useSearchShortcut } from '../useSearchShortcut';

beforeEach(() => {
    settings.current = { searchShortcut: true };
    settings.placeholder = false;
});

afterEach(cleanup);

const key = (init: Partial<KeyboardEventInit> = {}, target: EventTarget | null = null) => {
    const event = new KeyboardEvent('keydown', { key: '/', bubbles: true, cancelable: true, ...init });

    return { event, target };
};

describe('isSearchShortcut', () => {
    it('accepts a bare slash', () => {
        const { event } = key();

        expect(isSearchShortcut(event)).toBe(true);
    });

    it('accepts a slash that needs Shift on the cook’s layout', () => {
        expect(isSearchShortcut(key({ shiftKey: true }).event)).toBe(true);
    });

    it.each([{ ctrlKey: true }, { metaKey: true }, { altKey: true }])('refuses a chord %o', (modifier) => {
        expect(isSearchShortcut(key(modifier).event)).toBe(false);
    });

    it('refuses other keys', () => {
        expect(isSearchShortcut(key({ key: 's' }).event)).toBe(false);
    });

    it('refuses a key in an IME composition', () => {
        expect(isSearchShortcut(key({ isComposing: true }).event)).toBe(false);
    });

    it('refuses a key another handler already took', () => {
        const { event } = key();

        event.preventDefault();

        expect(isSearchShortcut(event)).toBe(false);
    });
});

describe('isEditableTarget', () => {
    const el = (html: string): Element => {
        const host = document.createElement('div');

        host.innerHTML = html;
        document.body.append(host);

        return host.firstElementChild as Element;
    };

    it.each([
        ['a text input', '<input type="text">'],
        ['an input with no type', '<input>'],
        ['a search input', '<input type="search">'],
        ['an email input', '<input type="email">'],
        ['a textarea', '<textarea></textarea>'],
        ['a select', '<select><option>a</option></select>'],
        ['a contenteditable region', '<div contenteditable="true" tabindex="0">x</div>'],
        ['a textbox role', '<div role="textbox" tabindex="0"></div>'],
        ['a searchbox role', '<div role="searchbox" tabindex="0"></div>'],
        ['a combobox role', '<div role="combobox" tabindex="0"></div>'],
    ])('treats %s as editable', (_name, html) => {
        expect(isEditableTarget(el(html))).toBe(true);
    });

    it.each([
        ['a button', '<button>x</button>'],
        ['a checkbox', '<input type="checkbox">'],
        ['a link', '<a href="/x">x</a>'],
        ['the body', '<p>x</p>'],
    ])('does not treat %s as editable', (_name, html) => {
        expect(isEditableTarget(el(html))).toBe(false);
    });

    it('is false for a target that is not an element', () => {
        expect(isEditableTarget(null)).toBe(false);
        expect(isEditableTarget(document)).toBe(false);
    });
});

function Page({ modal = false, search = true }: { readonly modal?: boolean; readonly search?: boolean }) {
    useSearchShortcut();

    return (
        <>
            <button type="button">Elsewhere</button>
            <main>
                {search ? <input type="search" aria-label="Search recipes" /> : null}
                <input type="text" aria-label="Title" />
            </main>
            {modal ? <div role="dialog" aria-modal="true" aria-label="Sheet" /> : null}
        </>
    );
}

describe('findSearchField', () => {
    const mount = (html: string): void => {
        document.body.innerHTML = html;
    };

    afterEach(() => {
        document.body.innerHTML = '';
        Reflect.deleteProperty(HTMLElement.prototype, 'checkVisibility');
    });

    it('is the first search input in <main>', () => {
        mount('<main><input type="search" id="a"><input type="search" id="b"></main>');

        expect(findSearchField(document)?.id).toBe('a');
    });

    it('is nothing when there is no <main> or no search input', () => {
        mount('<input type="search" id="a">');
        expect(findSearchField(document)).toBeUndefined();

        mount('<main><input type="text"></main>');
        expect(findSearchField(document)).toBeUndefined();
    });

    it('skips a disabled field and one the `hidden` attribute hides', () => {
        mount(
            '<main><input type="search" id="a" disabled><input type="search" id="b" hidden><input type="search" id="c"></main>',
        );

        expect(findSearchField(document)?.id).toBe('c');
    });

    // A browser answers `checkVisibility()` for what a stylesheet hides (`display: none`, `visibility: hidden`); jsdom
    // has no layout and no such method, so the test supplies the browser's answer.
    it('skips a field a stylesheet hides, so the key is never swallowed for a field that cannot take focus', () => {
        HTMLElement.prototype.checkVisibility = function (this: HTMLElement) {
            return this.id !== 'a';
        };

        mount('<main><input type="search" id="a"><input type="search" id="b"></main>');

        expect(findSearchField(document)?.id).toBe('b');
    });

    it('skips a facet search inside an <aside>, because the page’s own search is the one the shortcut means', () => {
        mount('<main><aside><input type="search" id="facet"></aside><input type="search" id="page"></main>');

        expect(findSearchField(document)?.id).toBe('page');
    });
});

describe('useSearchShortcut', () => {
    it('focuses the page’s search field on /, and takes the key so no slash is typed', () => {
        render(<Page />);
        screen.getByRole('button', { name: 'Elsewhere' }).focus();

        const event = new KeyboardEvent('keydown', { key: '/', bubbles: true, cancelable: true });
        screen.getByRole('button', { name: 'Elsewhere' }).dispatchEvent(event);

        expect(document.activeElement).toBe(screen.getByRole('searchbox', { name: 'Search recipes' }));
        expect(event.defaultPrevented).toBe(true);
    });

    it('does nothing inside a text field, so a slash types a slash', () => {
        render(<Page />);
        const title = screen.getByRole('textbox', { name: 'Title' });

        title.focus();
        const event = new KeyboardEvent('keydown', { key: '/', bubbles: true, cancelable: true });
        title.dispatchEvent(event);

        expect(document.activeElement).toBe(title);
        expect(event.defaultPrevented).toBe(false);
    });

    it('does nothing while a modal dialog is open, so focus does not jump behind it', () => {
        render(<Page modal />);
        screen.getByRole('button', { name: 'Elsewhere' }).focus();

        const event = new KeyboardEvent('keydown', { key: '/', bubbles: true, cancelable: true });
        screen.getByRole('button', { name: 'Elsewhere' }).dispatchEvent(event);

        expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Elsewhere' }));
        expect(event.defaultPrevented).toBe(false);
    });

    it('leaves the key alone when the page has no search field', () => {
        render(<Page search={false} />);
        screen.getByRole('button', { name: 'Elsewhere' }).focus();

        const event = new KeyboardEvent('keydown', { key: '/', bubbles: true, cancelable: true });
        screen.getByRole('button', { name: 'Elsewhere' }).dispatchEvent(event);

        expect(event.defaultPrevented).toBe(false);
    });

    it('does nothing once the cook has turned the shortcut off', () => {
        settings.current = { searchShortcut: false };
        render(<Page />);
        screen.getByRole('button', { name: 'Elsewhere' }).focus();

        const event = new KeyboardEvent('keydown', { key: '/', bubbles: true, cancelable: true });
        screen.getByRole('button', { name: 'Elsewhere' }).dispatchEvent(event);

        expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Elsewhere' }));
        expect(event.defaultPrevented).toBe(false);
    });

    it('attaches NO keydown listener while the setting is off, and attaches one when it is on', () => {
        const add = vi.spyOn(document, 'addEventListener');
        const keydownListeners = (): number => add.mock.calls.filter(([type]) => type === 'keydown').length;

        settings.current = { searchShortcut: false };
        const { rerender } = render(<Page />);
        expect(keydownListeners()).toBe(0);

        settings.current = { searchShortcut: true };
        rerender(<Page />);
        expect(keydownListeners()).toBe(1);

        add.mockRestore();
    });

    it('attaches NO listener while the settings are the placeholder default, even though the default is on (WCAG 2.1.4)', () => {
        const add = vi.spyOn(document, 'addEventListener');

        settings.current = { searchShortcut: true };
        settings.placeholder = true;
        render(<Page />);
        screen.getByRole('button', { name: 'Elsewhere' }).focus();

        const event = new KeyboardEvent('keydown', { key: '/', bubbles: true, cancelable: true });
        screen.getByRole('button', { name: 'Elsewhere' }).dispatchEvent(event);

        expect(add.mock.calls.filter(([type]) => type === 'keydown')).toHaveLength(0);
        expect(event.defaultPrevented).toBe(false);
        add.mockRestore();
    });

    it('attaches NO listener when the query has no data at all', () => {
        settings.current = undefined;
        render(<Page />);
        screen.getByRole('button', { name: 'Elsewhere' }).focus();

        const event = new KeyboardEvent('keydown', { key: '/', bubbles: true, cancelable: true });
        screen.getByRole('button', { name: 'Elsewhere' }).dispatchEvent(event);

        expect(event.defaultPrevented).toBe(false);
    });

    it('obeys a change made while mounted — off then on', () => {
        const { rerender } = render(<Page />);

        const press = (): KeyboardEvent => {
            screen.getByRole('button', { name: 'Elsewhere' }).focus();
            const event = new KeyboardEvent('keydown', { key: '/', bubbles: true, cancelable: true });
            screen.getByRole('button', { name: 'Elsewhere' }).dispatchEvent(event);

            return event;
        };

        settings.current = { searchShortcut: false };
        rerender(<Page />);
        expect(press().defaultPrevented).toBe(false);

        settings.current = { searchShortcut: true };
        rerender(<Page />);
        expect(press().defaultPrevented).toBe(true);
    });

    it('removes its listener on unmount', () => {
        const { unmount } = render(<Page />);

        unmount();
        document.body.focus();
        const event = new KeyboardEvent('keydown', { key: '/', bubbles: true, cancelable: true });
        document.body.dispatchEvent(event);

        expect(event.defaultPrevented).toBe(false);
    });

    it('ignores a chord such as Ctrl+/', () => {
        render(<Page />);
        screen.getByRole('button', { name: 'Elsewhere' }).focus();

        const event = new KeyboardEvent('keydown', { key: '/', ctrlKey: true, bubbles: true, cancelable: true });
        screen.getByRole('button', { name: 'Elsewhere' }).dispatchEvent(event);

        expect(event.defaultPrevented).toBe(false);
    });

    it('is a hook with no return value to misuse', () => {
        const { result } = renderHook(() => useSearchShortcut());

        expect(result.current).toBeUndefined();
        fireEvent.keyDown(document, { key: 'a' });
    });
});

/**
 * The modal check against the dialogs the app really opens. Radix `Dialog.Content` does not set `aria-modal` (it hides
 * the rest of the page from assistive technology instead), so a check for `[aria-modal="true"]` alone saw no dialog
 * while the erase dialog was open, and `/` moved focus behind it. These render the real components, not a hand-built
 * element that happens to carry the attribute.
 */
describe('hasOpenModal — the app’s real dialogs', () => {
    const noop = (): void => undefined;

    /** The Radix `Dialog` the danger zone opens. */
    function EraseDialog() {
        return (
            <AccountEraseDialog
                open
                donatableRecipes={[]}
                selectedRecipeIds={[]}
                onToggleRecipe={noop}
                phrase=""
                onPhraseChange={noop}
                onConfirm={noop}
                onCancel={noop}
            />
        );
    }

    it('sees an open Radix dialog', () => {
        render(<EraseDialog />);

        expect(screen.getByRole('dialog')).toBeTruthy();
        expect(hasOpenModal(document)).toBe(true);
    });

    it('sees an open alert dialog', () => {
        render(
            <ConfirmDialog
                open
                title="Close your account?"
                body="You can come back."
                confirm={{ label: 'Close account', icon: 'userX' }}
                keep={{ label: 'Keep account' }}
                onConfirm={noop}
                onKeep={noop}
            />,
        );

        expect(screen.getByRole('alertdialog')).toBeTruthy();
        expect(hasOpenModal(document)).toBe(true);
    });

    it('sees an open native <dialog>, and not a closed one', () => {
        const { rerender } = render(<dialog aria-label="Native" />);

        expect(hasOpenModal(document)).toBe(false);

        rerender(<dialog aria-label="Native" open />);

        expect(hasOpenModal(document)).toBe(true);
    });

    it('sees nothing when no dialog is open', () => {
        render(<Page />);

        expect(hasOpenModal(document)).toBe(false);
    });

    it('keeps focus inside the open erase dialog when the cook presses /', () => {
        render(
            <>
                <Page />
                <EraseDialog />
            </>,
        );
        const inside = screen.getAllByRole('button').find((button) => screen.getByRole('dialog').contains(button));

        if (inside === undefined) {
            throw new Error('the erase dialog renders a button');
        }

        inside.focus();
        const event = new KeyboardEvent('keydown', { key: '/', bubbles: true, cancelable: true });
        inside.dispatchEvent(event);

        expect(document.activeElement).toBe(inside);
        expect(event.defaultPrevented).toBe(false);
    });
});
