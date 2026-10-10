/**
 * @module components/app/useSearchShortcut — the `/` shortcut: ONE document `keydown` listener that focuses the page's
 * search field (`buildSpec.md` §10 "Character shortcuts").
 *
 * It is a no-op where the cook is typing, while a modal dialog is open, on a page with no search field, and once the
 * cook has turned it off. It takes the key (`preventDefault`) only when it actually moves focus, so a `/` it does not
 * use still types a slash.
 *
 * WCAG 2.1.4 (Character Key Shortcuts) lets a single-character shortcut stand only if it can be turned off. That
 * switch is Profile › Keyboard shortcuts, and the choice is a SETTING ON THE SERVER (`searchShortcut`, owner ruling
 * D19, ADR-0059), read here through the settings query. It follows the cook to another browser, and none of it is kept
 * in browser storage. Until the first read answers, the query holds the server's published default as a placeholder, and
 * the shortcut stays OFF: a cook who turned it off must never see `/` act on a guess (WCAG 2.1.4). It comes on when
 * the real setting arrives and says on.
 *
 * Mounted once, in `AppShell`. The listener is not attached at all until the real setting is known and on.
 *
 * @pattern Observer — one document `keydown` listener, attached only once the real setting is on
 * @sideEffect Adds a `keydown` listener on `document` and moves focus.
 */
import { useEffect } from 'react';

import { useUserSettings } from '@/hooks/useUserSettings';

import { findSearchField, hasOpenModal, isEditableTarget, isSearchShortcut } from './searchShortcut';

/** Focus the page's search field on `/`. */
export function useSearchShortcut(): void {
    const { data, isPlaceholderData } = useUserSettings();
    // The placeholder is the published default, not the cook's choice: only a real read may switch the key on.
    const enabled = !isPlaceholderData && data?.searchShortcut === true;

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
