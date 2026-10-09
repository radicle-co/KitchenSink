'use client';

/**
 * @module components/profile/ShortcutSwitchRow — Profile › Keyboard shortcuts (web only): the switch that turns the `/`
 * search shortcut off (`docs/architecture/uiOverhaulBlueprint.md` A18; WCAG 2.1.4 Character Key Shortcuts).
 *
 * The whole 56 px row is one `switch`, so the target is the row, not the 40 px track. State is never colour alone: the
 * thumb sits at the end when on and the start when off. It reads and writes the per-device preference through
 * `useSyncExternalStore`, so a change in another tab shows here too.
 *
 * ⚠️ The track and thumb are drawn here from role colours because the design system names no row switch
 * (`KeepAwakeToggle` is a chip). It is a gap for `staff-ux-engineer` to specify and for `@commise/ui` to own.
 *
 * @sideEffect Writes `localStorage` through `writeSearchShortcutEnabled`.
 */
import { useMessages } from '@commise/i18n/react';
import { profileMessages } from '@commise/features-account/profile';
import { useSyncExternalStore, type FC } from 'react';

import {
    readSearchShortcutEnabled,
    subscribeToSearchShortcut,
    writeSearchShortcutEnabled,
} from '@/lib/searchShortcutPreference';

/** The server render reads the default; the client corrects it after hydration. */
const enabledOnServer = (): boolean => true;

/** The keyboard-shortcuts switch row. */
export const ShortcutSwitchRow: FC = () => {
    const t = useMessages(profileMessages);
    const enabled = useSyncExternalStore(subscribeToSearchShortcut, readSearchShortcutEnabled, enabledOnServer);

    return (
        <button
            type="button"
            role="switch"
            aria-checked={enabled}
            onClick={() => writeSearchShortcutEnabled(!enabled)}
            className="flex min-h-14 w-full items-center justify-between gap-3 px-4 py-2 text-start text-body text-ink hover:bg-ink/6 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus-ring"
        >
            <span>{t.shortcuts}</span>
            <span
                aria-hidden="true"
                className={`flex h-7 w-12 shrink-0 items-center rounded-full border p-0.5 ${
                    enabled
                        ? 'justify-end border-action bg-action'
                        : 'justify-start border-line-control bg-surface-muted'
                }`}
            >
                <span className={`size-5 rounded-full ${enabled ? 'bg-paper' : 'bg-line-control'}`} />
            </span>
        </button>
    );
};
