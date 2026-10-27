'use client';

/**
 * @module @commise/features-recipes/ingredientMatching — `SeeWhy` (web): the VISIBLE disclosure behind "See why"
 * (owner design 2026-10-26, "INTERACTION GAPS"). It used to be spoken only — the reason went to the list's polite region
 * and nowhere else — so a cook who looked away, or cannot hear it, never saw why. The link now toggles `aria-expanded`,
 * the reason opens in place under the row in the 14 px muted `meta` role, it is announced once (on opening, through
 * `onOpen`), and pressing again closes it.
 *
 * It holds the one bit of state a disclosure has — open or closed — because nothing else reads it: the host owns the
 * announcement, not the visibility. A row that remounts closes it, which is the right reading of "tap again closes".
 * The native leaf is `./SeeWhy.native.tsx`.
 *
 * Orchestration: it holds the open state, so it is not a pure render leaf.
 *
 * @pattern Disclosure — a button with `aria-expanded` that reveals its region in place
 */
import { Button } from '@commise/ui/button';
import { useState, type FC } from 'react';

import type { SeeWhyProps } from './seeWhyProps.js';

/** The See why disclosure. */
export const SeeWhy: FC<SeeWhyProps> = ({ label, name, reason, onOpen }) => {
    const [open, setOpen] = useState(false);

    return (
        <div className="flex flex-col items-start gap-1">
            <Button
                variant="ghost"
                size="sm"
                expanded={open}
                {...(name === undefined ? {} : { accessibilityLabel: name })}
                onPress={() => {
                    if (!open) {
                        onOpen();
                    }

                    setOpen(!open);
                }}
            >
                {label}
            </Button>
            {open ? <p className="break-words px-3 text-meta text-ink-muted">{reason}</p> : null}
        </div>
    );
};
