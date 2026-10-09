'use client';

/**
 * @module components/app/useSearchShortcut — the `/` shortcut: ONE document `keydown` listener that focuses the page's
 * search field (`docs/architecture/uiOverhaulBlueprint.md` A18, `buildSpec.md` §10 "Character shortcuts").
 *
 * It is a no-op where the cook is typing, while a modal dialog is open, on a page with no search field, and once the
 * cook has turned it off (Profile › Keyboard shortcuts, `lib/searchShortcutPreference`). It takes the key
 * (`preventDefault`) only when it actually moves focus, so a `/` it does not use still types a slash.
 *
 * Mounted once, in `AppShell`. The listener is not attached at all while the preference is off.
 *
 * @pattern Observer — one document `keydown` listener, attached only while the preference is on
 * @sideEffect Adds a `keydown` listener on `document` and moves focus.
 */
import { useEffect, useSyncExternalStore } from 'react';

import { readSearchShortcutEnabled, subscribeToSearchShortcut } from '@/lib/searchShortcutPreference';

import { findSearchField, hasOpenModal, isEditableTarget, isSearchShortcut } from './searchShortcut';

/** The server render has no stored preference: it reads as on, and the client corrects it after hydration. */
const enabledOnServer = (): boolean => true;

/** Focus the page's search field on `/`. */
export function useSearchShortcut(): void {
    const enabled = useSyncExternalStore(subscribeToSearchShortcut, readSearchShortcutEnabled, enabledOnServer);

    useEffect(() => {
        if (!enabled) {
            return undefined;
        }

        const onKeyDown = (event: KeyboardEvent): void => {
            if (!isSearchShortcut(event) || isEditableTarget(event.target) || hasOpenModal(document)) {
                return;
            }

            const field = findSearchField(document);

            if (field === undefined) {
                return;
            }

            event.preventDefault();
            field.focus();
        };

        document.addEventListener('keydown', onKeyDown);

        return () => document.removeEventListener('keydown', onKeyDown);
    }, [enabled]);
}
