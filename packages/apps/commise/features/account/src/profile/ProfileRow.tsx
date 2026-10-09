'use client';

/**
 * @module @commise/features-account/profile/ProfileRow — a pressable Profile row (web): 56 px, the label, its value
 * truncated to one line, an optional hint, and a chevron when it opens something (`buildSpec.md` §9.1).
 *
 * One control: the whole row is the button (or the link, when it has a destination), and its hint is inside it, so the
 * consequence of Close account is read with the name. The danger tone changes the TEXT colour only. Sign out is `ink`:
 * it is not destructive. While busy the row stays focusable and cancels the press (`aria-busy`), the same rule as the
 * design-system `Button` (SC 2.4.3).
 *
 * @pattern Visitor — an exhaustive pick of the element by whether the row has a destination
 */
import { Icon } from '@commise/ui/icon';
import { useId, type FC, type MouseEvent } from 'react';

import type { ProfileRowProps } from './props.js';

/** The row's box, shared by the button and the link. */
const BOX =
    'flex min-h-14 w-full items-center gap-3 px-4 py-2 text-start hover:bg-ink/6 ' +
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus-ring';

/** The label colour per tone. */
const TONE = { ink: 'text-ink', danger: 'text-danger-text' } as const;

/** The pressable row. */
export const ProfileRow: FC<ProfileRowProps> = ({ label, value, hint, tone, chevron, busy = false, onPress, href }) => {
    const labelId = useId();
    const valueId = useId();
    const hintId = useId();
    // The control is NAMED by its label alone; the value and the hint are its description, read after the name.
    const describedBy = [value === undefined ? null : valueId, hint === undefined ? null : hintId]
        .filter((id) => id !== null)
        .join(' ');
    const naming = { 'aria-labelledby': labelId, ...(describedBy === '' ? {} : { 'aria-describedby': describedBy }) };
    const body = (
        <>
            <span className="flex min-w-0 flex-1 flex-col">
                <span id={labelId} className="text-body">
                    {label}
                </span>
                {hint === undefined ? null : (
                    <span id={hintId} className="text-caption text-ink-muted">
                        {hint}
                    </span>
                )}
            </span>
            {value === undefined ? null : (
                <span id={valueId} className="min-w-0 max-w-[50%] truncate text-body text-ink-muted">
                    {value}
                </span>
            )}
            {chevron ? <Icon name="chevronRight" size={20} /> : null}
        </>
    );
    const className = `${BOX} ${TONE[tone]}`;

    if (href !== undefined) {
        // A plain click is the app's own navigation; a modified click (a new tab) keeps the link's.
        const onClick = (event: MouseEvent<HTMLAnchorElement>): void => {
            if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) {
                return;
            }

            event.preventDefault();
            onPress();
        };

        return (
            <a href={href} onClick={onClick} className={className} {...naming}>
                {body}
            </a>
        );
    }

    return (
        <button
            type="button"
            {...naming}
            aria-busy={busy || undefined}
            aria-disabled={busy || undefined}
            onClick={() => {
                if (!busy) {
                    onPress();
                }
            }}
            className={className}
        >
            {body}
        </button>
    );
};
