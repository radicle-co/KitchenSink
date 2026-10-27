'use client';

/**
 * @module @commise/features-recipes/editor — `PublishBlockedSheet` (web): what Publish says when the cook chose Private and
 * cannot keep it - every private slot is used, or the recipe is an imported public-web one that needs Premium and a change
 * of the cook's own (owner ruling 2026-10-26). A polite dialog with two choices of EQUAL weight, side by side, neither
 * preselected: Keep as draft and Publish as public.
 *
 * Escape, the scrim and Close all mean Keep as draft, so dismissing can never publish (DSA Art. 25: no nudge into making
 * public what the cook asked to keep private). On the design-system `Sheet`, not `ConfirmDialog`, as
 * `PublishOpenChoicesSheet` is: that primitive is for a destructive step, and this is a non-destructive choice. The Premium
 * line is off until feature 010 exists (`PUBLISH_BLOCKED_PREMIUM_UPSELL`).
 *
 * Presentational: props in, markup out; the words are `publishBlockedCopyOf`'s. The native leaf is
 * `./PublishBlockedSheet.native.tsx`.
 *
 * @pattern Adapter over the design-system `Sheet` — the ask's words and the one dismiss path on the house sheet
 */
import { useMessages } from '@commise/i18n/react';
import { Button } from '@commise/ui/button';
import { Sheet } from '@commise/ui/sheet';
import type { FC } from 'react';

import { editorMessages } from './messages.js';
import { publishBlockedCopyOf } from './publishBlockedCopy.js';
import type { PublishBlockedSheetProps } from './publishBlockedSheetProps.js';

/** The blocked-publish dialog. */
export const PublishBlockedSheet: FC<PublishBlockedSheetProps> = ({
    open,
    ask,
    slotTotal,
    onKeepDraft,
    onPublishPublic,
}) => {
    const { publishBlocked: m } = useMessages(editorMessages);
    const copy = publishBlockedCopyOf(ask, slotTotal, m);

    return (
        <Sheet
            open={open}
            onOpenChange={(next) => {
                if (!next) {
                    onKeepDraft();
                }
            }}
            title={copy.title}
            closeLabel={m.close}
            size="content"
            presentation="dialog"
            footer={
                <div className="flex gap-3">
                    <Button variant="secondary" icon="pencilLine" width="fill" onPress={onKeepDraft}>
                        {m.keepDraft}
                    </Button>
                    <Button variant="secondary" icon="globe" width="fill" onPress={onPublishPublic}>
                        {m.publishPublic}
                    </Button>
                </div>
            }
        >
            <div className="flex flex-col gap-3">
                <p className="text-body text-ink">{copy.body}</p>
                {copy.upsell === undefined ? null : <p className="text-list text-ink-muted">{copy.upsell}</p>}
            </div>
        </Sheet>
    );
};
