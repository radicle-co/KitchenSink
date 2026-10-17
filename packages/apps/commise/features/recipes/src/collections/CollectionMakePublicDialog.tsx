'use client';

/**
 * @module @commise/features-recipes/collections — "Make this collection public?", the confirm a downgraded owner sees
 * before a private collection goes public (plan 2026-10-14-009 T1). The collection twin of `RecipeMakePublicDialog`:
 * one component for both platforms, because the design system's `ConfirmDialog` resolves to its own leaf on each.
 *
 * Going public is destructive in the design system's sense — anyone may save a copy of a public collection, and this
 * cook cannot simply make it private again — so the primitive is used as it is: the danger-filled "Make public"
 * against "Keep private", where focus opens. The body says the cost plainly, per reason (`makePublicConsequence`).
 * ⛔ Nothing here sells: no Premium button and no third choice (DSA Art. 25).
 *
 * Presentational: props → JSX, no data, no mutation, no effect of its own.
 *
 * @pattern Adapter over the design-system `ConfirmDialog` — the collection's make-public copy on the house confirmation
 */
import { useMessages } from '@commise/i18n/react';
import { ConfirmDialog } from '@commise/ui/confirm-dialog';
import type { FC } from 'react';

import type { CollectionMakePublicDialogProps } from './detailModel.js';
import { collectionMessages } from './messages.js';

/** "Make this collection public?": the cost, said plainly, then Keep private or Make public. */
export const CollectionMakePublicDialog: FC<CollectionMakePublicDialogProps> = ({
    open,
    consequence,
    onConfirm,
    onKeep,
}) => {
    const { dialogs } = useMessages(collectionMessages);
    const body = {
        final: dialogs.makePublicBodyFinal,
        premium: dialogs.makePublicBodyPremium,
        unknown: dialogs.makePublicBodyUnknown,
    }[consequence];

    return (
        <ConfirmDialog
            open={open}
            title={dialogs.makePublicTitle}
            body={body}
            confirm={{ label: dialogs.makePublicConfirm, icon: 'globe' }}
            keep={{ label: dialogs.makePublicKeep, icon: 'lock' }}
            onConfirm={onConfirm}
            onKeep={onKeep}
        />
    );
};
