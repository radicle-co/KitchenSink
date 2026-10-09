/**
 * The `/` shortcut (`docs/architecture/uiOverhaulBlueprint.md` A18; WCAG 2.1.4). One document `keydown` listener
 * focuses the page's search field. The predicate is the part that must never misfire: a `/` typed into a field, a
 * chord, an IME composition, or a key some other handler already took is NOT a shortcut — and neither is a `/` pressed
 * while a modal dialog is open, where focus must not jump behind it.
 */
import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { writeSearchShortcutEnabled } from '@/lib/searchShortcutPreference';

import { findSearchField, isSearchShortcut, isEditableTarget } from '../searchShortcut';
import { useSearchShortcut } from '../useSearchShortcut';

afterEach(() => {
    cleanup();
    window.localStorage.clear();
});

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
        writeSearchShortcutEnabled(false);
        render(<Page />);
        screen.getByRole('button', { name: 'Elsewhere' }).focus();

        const event = new KeyboardEvent('keydown', { key: '/', bubbles: true, cancelable: true });
        screen.getByRole('button', { name: 'Elsewhere' }).dispatchEvent(event);

        expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Elsewhere' }));
        expect(event.defaultPrevented).toBe(false);
    });

    it('obeys a change made while mounted — off then on', () => {
        render(<Page />);
        const press = (): KeyboardEvent => {
            screen.getByRole('button', { name: 'Elsewhere' }).focus();
            const event = new KeyboardEvent('keydown', { key: '/', bubbles: true, cancelable: true });
            screen.getByRole('button', { name: 'Elsewhere' }).dispatchEvent(event);

            return event;
        };

        act(() => writeSearchShortcutEnabled(false));
        expect(press().defaultPrevented).toBe(false);

        act(() => writeSearchShortcutEnabled(true));
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
