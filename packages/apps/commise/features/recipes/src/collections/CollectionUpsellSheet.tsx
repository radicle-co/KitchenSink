'use client';

/**
 * @module @commise/features-recipes/collections — the web Premium sheet for "Make private"
 * (`docs/design/uiOverhaul/buildSpec.md` §5.2). A free-tier cook choosing private is told the plain fact — "Private
 * collections are part of Premium." — and offered **See Premium** and **Not now**: both secondary `md` buttons, equal in
 * size and weight, side by side, nothing pre-selected. That passes the DSA Art. 25 test: it is true, and it does not distort
 * the choice. The subscription surface is not built yet (010), so the host closes the sheet on See Premium.
 *
 * Presentational: it sends nothing; the host decides what follows.
 *
 * @pattern Adapter over the design-system `Sheet`
 */
import { useMessages } from '@commise/i18n/react';
import { Button } from '@commise/ui/button';
import { Sheet } from '@commise/ui/sheet';
import type { FC } from 'react';

import type { CollectionUpsellSheetProps } from './detailModel.js';
import { collectionMessages } from './messages.js';

export const CollectionUpsellSheet: FC<CollectionUpsellSheetProps> = ({ open, onOpenChange, onSeePremium }) => {
    const { dialogs } = useMessages(collectionMessages);

    return (
        <Sheet
            open={open}
            onOpenChange={onOpenChange}
            title={dialogs.upsellTitle}
            closeLabel={dialogs.upsellClose}
            size="content"
            footer={
                <div className="flex gap-3">
                    <div className="flex-1">
                        <Button variant="secondary" icon="star" width="fill" onPress={onSeePremium}>
                            {dialogs.upsellSee}
                        </Button>
                    </div>
                    <div className="flex-1">
                        <Button variant="secondary" icon="x" width="fill" onPress={() => onOpenChange(false)}>
                            {dialogs.upsellNotNow}
                        </Button>
                    </div>
                </div>
            }
        >
            <p className="text-body text-ink-muted">{dialogs.upsellBody}</p>
        </Sheet>
    );
};
