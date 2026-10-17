'use client';

/**
 * @module components/profile/ShortcutSwitchRow — Profile › Keyboard shortcuts (web only): the switch that turns the `/`
 * search shortcut off (WCAG 2.1.4 Character Key Shortcuts).
 *
 * The whole 56 px row is one `switch`, so the target is the row, not the 40 px track. State is never colour alone: the
 * thumb sits at the end when on and the start when off.
 *
 * PURE: `checked` in, `onChange` out. The setting lives on the server (D19, ADR-0059), and the orchestration layer
 * (`ProfileSurface`) reads it and saves it; this row neither knows where the value comes from nor waits for a save, so
 * it never branches on connectivity.
 *
 * ⚠️ The track and thumb are drawn here from role colours because the design system names no row switch
 * (`KeepAwakeToggle` is a chip). It is a gap for `staff-ux-engineer` to specify and for `@commise/ui` to own.
 *
 * @pattern Controlled Component — `checked` in, `onChange` out; the boolean draws the thumb, it selects no behaviour
 */
import { useMessages } from '@commise/i18n/react';
import { profileMessages } from '@commise/features-account/profile';
import type { FC } from 'react';

/** Props of {@link ShortcutSwitchRow}. */
export interface ShortcutSwitchRowProps {
    /** Whether the shortcut is on. */
    readonly checked: boolean;
    /** Called with the value the cook asked for. */
    readonly onChange: (next: boolean) => void;
}

/** The keyboard-shortcuts switch row. */
export const ShortcutSwitchRow: FC<ShortcutSwitchRowProps> = ({ checked, onChange }) => {
    const t = useMessages(profileMessages);

    return (
        <button
            type="button"
            role="switch"
            aria-checked={checked}
            onClick={() => onChange(!checked)}
            className="flex min-h-14 w-full items-center justify-between gap-3 px-4 py-2 text-start text-body text-ink hover:bg-ink/6 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus-ring"
        >
            <span>{t.shortcuts}</span>
            <span
                aria-hidden="true"
                className={`flex h-7 w-12 shrink-0 items-center rounded-full border p-0.5 ${
                    checked
                        ? 'justify-end border-action bg-action'
                        : 'justify-start border-line-control bg-surface-muted'
                }`}
            >
                <span className={`size-5 rounded-full ${checked ? 'bg-paper' : 'bg-line-control'}`} />
            </span>
        </button>
    );
};
