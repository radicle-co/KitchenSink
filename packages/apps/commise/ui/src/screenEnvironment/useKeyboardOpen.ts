'use client';

/**
 * @module screenEnvironment/useKeyboardOpen — whether an on-screen keyboard is open (web). A browser does not say, so
 * the honest reading is: a text field has focus AND the pointer is coarse (a phone or a tablet, which raise a keyboard
 * for it). A desktop with a physical keyboard never counts. The floating create button and "Back to top" hide while it
 * is open (`buildSpec.md` §3.4, §3.6). Internal to `@commise/ui`.
 */
import { useSyncExternalStore } from 'react';

/** The input types that raise no text keyboard. */
const NON_TEXT_INPUTS: ReadonlySet<string> = new Set([
    'button',
    'checkbox',
    'color',
    'file',
    'hidden',
    'image',
    'radio',
    'range',
    'reset',
    'submit',
]);

/** Whether an element takes typed text. Pure over the element. */
export function isTextEntry(element: Element | null): boolean {
    if (element instanceof HTMLTextAreaElement) {
        return !element.readOnly;
    }

    if (element instanceof HTMLInputElement) {
        return !element.readOnly && !NON_TEXT_INPUTS.has(element.type);
    }

    return element instanceof HTMLElement && element.isContentEditable === true;
}

/** Re-read after focus moves. */
function subscribe(onChange: () => void): () => void {
    document.addEventListener('focusin', onChange);
    document.addEventListener('focusout', onChange);

    return () => {
        document.removeEventListener('focusin', onChange);
        document.removeEventListener('focusout', onChange);
    };
}

/**
 * Whether the pointer is coarse. A browser without `matchMedia` (an embedded view, a test DOM) reports no media
 * features at all, so it is read as a fine pointer: no on-screen keyboard is assumed.
 *
 * @sideEffect Reads the pointer media query.
 */
function coarsePointer(): boolean {
    return typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
}

/** @sideEffect Reads the focused element and the pointer media query. */
function snapshot(): boolean {
    return isTextEntry(document.activeElement) && coarsePointer();
}

/** No keyboard on the server. */
const serverSnapshot = (): boolean => false;

/** Whether an on-screen keyboard is open. */
export function useKeyboardOpen(): boolean {
    return useSyncExternalStore(subscribe, snapshot, serverSnapshot);
}
