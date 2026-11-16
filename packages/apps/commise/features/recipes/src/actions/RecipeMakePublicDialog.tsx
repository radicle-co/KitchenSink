'use client';

/**
 * @module @commise/features-recipes — "Make this recipe public?", the confirm a downgraded owner sees before a private
 * recipe goes public (UX SPECIFY 2026-10-15; plan 2026-10-14-009 Q5). One component for both platforms: the design
 * system's `ConfirmDialog` resolves to its Radix leaf on web and its `DialogFrame` leaf on native.
 *
 * Making a private recipe public is destructive in the design system's sense — anyone may save a copy of a public
 * recipe — so the primitive is used as it is (public is NOT final, owner ruling 2026-10-26, and the body never says it
 * is): the danger-filled
 * "Make public" against "Keep private", where focus opens. The body says the cost plainly, per reason
 * (`makePublicConsequence`). ⛔ Nothing here sells: no Premium button and no third choice (DSA Art. 25; the
 * deceptive-pattern rule) — under `upsell` the body states the fact and the ⋯ menu's Make private is where Premium is.
 *
 * ADR-0092: the dialog always carries the passive line the confirmation records: as the body when there is nothing to free,
 * else as a second paragraph under the cost.
 *
 * Presentational: props → JSX, no data, no mutation, no effect of its own.
 *
 * @pattern Adapter over the design-system `ConfirmDialog` — the recipe's make-public copy on the house confirmation
 */
import { useMessages } from '@commise/i18n/react';
import { ConfirmDialog } from '@commise/ui/confirm-dialog';
import type { FC } from 'react';

import { recipeActionMessages } from './messages.js';
import type { RecipeMakePublicDialogProps } from './model.js';

/** "Make this recipe public?": the cost, said plainly, then Keep private or Make public. */
export const RecipeMakePublicDialog: FC<RecipeMakePublicDialogProps> = ({
    open,
    consequence,
    busy = false,
    error = false,
    onConfirm,
    onKeep,
}) => {
    const { makePublicDialog: m, publicConfirm, visibility } = useMessages(recipeActionMessages);
    // The passive line is what the confirm records, so it is on screen whichever consequence the dialog speaks.
    const frees = consequence === 'frees';

    return (
        <ConfirmDialog
            open={open}
            title={m.title}
            body={frees ? m.bodyFrees : publicConfirm.line}
            {...(frees ? { note: publicConfirm.line } : {})}
            confirm={{ label: m.confirm, icon: 'globe' }}
            keep={{ label: m.keep, icon: 'lock' }}
            busy={busy}
            busyLabel={m.busy}
            {...(error ? { error: visibility.error } : {})}
            onConfirm={onConfirm}
            onKeep={onKeep}
        />
    );
};
