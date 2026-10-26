'use client';

/**
 * @module @commise/features-recipes/actions - the web refusal of "Save a copy" when the copy would be private and every
 * private slot is in use (ADR-0073; redesign canvas v44, board `RecipeSaveCopyNoSlot`). It says the fact, how to free a
 * slot, and - only where paid features are shown - that Premium has no limit: **Not now** and **See Premium** (primary),
 * or a single **OK** where they are hidden. It offers no way to make the copy public: the source is private and FR-005c
 * keeps the copy as private as the original.
 *
 * Presentational: it sends nothing; the host decides what follows. The server's refusal (`PRIVATE_SLOTS_FULL`) comes
 * BEFORE any row is written, so there is no half-made copy to clean up.
 *
 * @pattern Adapter over the design-system `Sheet`
 */
import { useMessages } from '@commise/i18n/react';
import { Button } from '@commise/ui/button';
import { Sheet } from '@commise/ui/sheet';
import type { FC } from 'react';

import { fillTemplate } from '../format/fillTemplate.js';
import { recipeActionMessages } from './messages.js';
import type { RecipeSaveCopyNoSlotProps } from './model.js';

/** The web refusal of a copy that has no private slot to land in. */
export const RecipeSaveCopyNoSlot: FC<RecipeSaveCopyNoSlotProps> = ({ open, total, offer, onClose }) => {
    const { cloneNoSlot: m } = useMessages(recipeActionMessages);
    const body = fillTemplate(offer.kind === 'premium' ? m.body : m.bodyNoPremium, { total });

    return (
        <Sheet
            open={open}
            onOpenChange={(next) => {
                if (!next) {
                    onClose();
                }
            }}
            title={m.title}
            closeLabel={m.close}
            size="content"
            footer={
                offer.kind === 'premium' ? (
                    <div className="flex gap-3">
                        <div className="flex-1">
                            <Button variant="secondary" icon="x" width="fill" onPress={onClose}>
                                {m.notNow}
                            </Button>
                        </div>
                        <div className="flex-1">
                            <Button variant="primary" icon="star" width="fill" onPress={offer.onSeePremium}>
                                {m.seePremium}
                            </Button>
                        </div>
                    </div>
                ) : (
                    <Button variant="primary" icon="check" width="fill" onPress={onClose}>
                        {m.ok}
                    </Button>
                )
            }
        >
            <p className="text-body text-ink-muted">{body}</p>
        </Sheet>
    );
};
