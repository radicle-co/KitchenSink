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
 * in browser storage. Until the first read answers, the query's placeholder is the server's published default, which is
 * on, so the shortcut works from the first paint and a cook who turned it off sees it go quiet once the read lands.
 *
 * Mounted once, in `AppShell`. The listener is not attached at all while the setting is off.
 *
 * @pattern Observer — one document `keydown` listener, attached only while the setting is on
 * @sideEffect Adds a `keydown` listener on `document` and moves focus.
 */
import { SETTINGS_DEFAULTS } from '@kitchensink/schema-identity';
import { useEffect } from 'react';

import { useUserSettings } from '@/hooks/useUserSettings';

import { findSearchField, hasOpenModal, isEditableTarget, isSearchShortcut } from './searchShortcut';

/** Focus the page's search field on `/`. */
export function useSearchShortcut(): void {
    const enabled = useUserSettings().data?.searchShortcut ?? SETTINGS_DEFAULTS.searchShortcut;

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
