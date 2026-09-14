/**
 * @module @commise/ui/dialog-focus — move focus only when it has nowhere the person put it.
 *
 * When the control holding focus is removed (a form swapped for a notice, a pressed row gone after an add), a
 * real browser drops focus to <body> and the next Tab starts from the top of the page (WCAG 2.2 SC 2.4.3). The
 * repair is to move focus somewhere sensible — but a response can land after the person has moved on, and taking
 * focus from where they are typing corrupts what they type. So focus moves only when it is on <body>, or still
 * inside the region that owns the move.
 *
 * WEB ONLY: it reads `document.activeElement`. The native counterpart moves the screen-reader cursor
 * (`@commise/ui/screen-reader-focus`), and React Native cannot read where that cursor is.
 */

/**
 * Focus `target` if focus is lost (on <body>) or inside `within`.
 *
 * @param target - The element to focus; nothing happens when it is not mounted.
 * @param within - The region that owns the move. Omitted, only a lost focus is taken.
 * @sideEffect Moves DOM focus.
 */
export function focusIfLost(target: HTMLElement | null | undefined, within?: Element | null): void {
    if (target === null || target === undefined) {
        return;
    }

    const holder = document.activeElement;
    const lost = holder === null || holder === document.body;

    if (lost || (holder !== null && within?.contains(holder) === true)) {
        target.focus();
    }
}
