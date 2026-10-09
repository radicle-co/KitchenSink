/**
 * @module components/app/searchShortcut — the pure rules of the `/` search shortcut
 * (`docs/architecture/uiOverhaulBlueprint.md` A18; WCAG 2.1.4). Whether a key press IS the shortcut, whether the
 * focused thing is somewhere the cook is typing, and which field the shortcut reaches.
 */

/** The input types that take no typed text, so a `/` on them is not interference. */
const NON_TEXT_INPUT_TYPES: ReadonlySet<string> = new Set([
    'button',
    'checkbox',
    'color',
    'file',
    'image',
    'radio',
    'range',
    'reset',
    'submit',
]);

/** The ARIA roles whose widget takes typed text. */
const TEXT_ROLES: ReadonlySet<string> = new Set(['textbox', 'searchbox', 'combobox']);

/**
 * @param event - A `keydown`.
 * @returns Whether it is a bare `/`: no Ctrl, Meta or Alt (Shift stays allowed, because `/` needs it on some
 *     layouts), not part of an IME composition, and not already taken by another handler. Pure.
 */
export function isSearchShortcut(event: KeyboardEvent): boolean {
    return (
        event.key === '/' &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey &&
        !event.isComposing &&
        !event.defaultPrevented
    );
}

/**
 * @param target - The event's target.
 * @returns Whether the cook is typing there: a text-taking input, a textarea, a select, a contenteditable region, or
 *     a widget with a text-entry role. Pure.
 */
export function isEditableTarget(target: EventTarget | null): boolean {
    if (!(target instanceof Element)) {
        return false;
    }

    if (target instanceof HTMLInputElement) {
        return !NON_TEXT_INPUT_TYPES.has(target.type);
    }

    if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) {
        return true;
    }

    // `closest`, not `isContentEditable`: the attribute is inherited by descendants, and jsdom lacks the property.
    return (
        target.closest('[contenteditable]:not([contenteditable="false"])') !== null ||
        TEXT_ROLES.has(target.getAttribute('role') ?? '')
    );
}

/**
 * @param doc - The document.
 * @returns Whether a modal dialog is open. While one is, focus must not move behind it. Pure.
 */
export function hasOpenModal(doc: Document): boolean {
    return doc.querySelector('[aria-modal="true"]') !== null;
}

/**
 * @param field - A form field.
 * @returns Whether it can take focus now: not `disabled`, not `hidden`, and not hidden by a stylesheet. A browser's
 *     `checkVisibility()` answers the last; a DOM without it (jsdom has no layout) falls back to the attributes. Pure.
 */
function canTakeFocus(field: HTMLInputElement): boolean {
    return !field.disabled && !field.hidden && (field.checkVisibility === undefined || field.checkVisibility());
}

/**
 * @param doc - The document.
 * @returns The page's search field: the first search input in `<main>` that can take focus and is not inside an
 *     `<aside>` (the filter panel's own facet searches are not "the page's search"), or `undefined`. Reading it by
 *     selector leaves every list frame untouched. Pure.
 */
export function findSearchField(doc: Document): HTMLInputElement | undefined {
    return Array.from(doc.querySelectorAll<HTMLInputElement>('main input[type="search"]')).find(
        (field) => canTakeFocus(field) && field.closest('aside') === null,
    );
}
