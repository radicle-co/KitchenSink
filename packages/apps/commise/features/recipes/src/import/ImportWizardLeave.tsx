'use client';

/**
 * @module @commise/features-recipes/import — `ImportWizardLeave` (web): "Save and leave?" (board WizardLeave). Says how
 * many recipes the cook reviewed, that the rest are saved now — matched foods and the usual defaults set, every other
 * line as written — and that they wait under "To review" in My recipes, resuming at the next recipe. Then Keep reviewing
 * or Save and leave.
 *
 * ⚠️ NOT the design system's `ConfirmDialog`: that primitive is for a destructive step and paints its confirm in the
 * danger tone, and leaving loses nothing. So it is the house `Sheet` (a dialog on web, sized to its content), whose
 * every close route keeps reviewing.
 *
 * Presentational and controlled. The native leaf is `./ImportWizardLeave.native.tsx`.
 */
import { useLocale, useMessages } from '@commise/i18n/react';
import { Button } from '@commise/ui/button';
import { Sheet } from '@commise/ui/sheet';
import type { FC } from 'react';

import { importMessages } from './messages.js';
import type { ImportWizardLeaveProps } from './props.js';
import { leaveCopyOf } from './wizardCopy.js';

/** "Save and leave?" */
export const ImportWizardLeave: FC<ImportWizardLeaveProps> = ({
    open,
    reviewed,
    total,
    resumeAt,
    onKeepReviewing,
    onConfirm,
    saving = false,
}) => {
    const { leave: l } = useMessages(importMessages);
    const locale = useLocale();
    const copy = leaveCopyOf({ reviewed, total, resumeAt }, l, locale);

    return (
        <Sheet
            open={open}
            onOpenChange={(next) => {
                if (!next) {
                    onKeepReviewing();
                }
            }}
            title={l.title}
            closeLabel={l.close}
            size="content"
            footer={
                <div className="flex flex-col-reverse gap-3 nav:flex-row nav:justify-end">
                    <Button variant="secondary" icon="chevronLeft" onPress={onKeepReviewing}>
                        {l.keep}
                    </Button>
                    <Button icon="save" busy={saving} onPress={onConfirm}>
                        {l.confirm}
                    </Button>
                </div>
            }
        >
            <div className="flex flex-col gap-3 text-body text-ink">
                <p>{copy.reviewed}</p>
                <p>{copy.rest}</p>
                <p>{copy.resume}</p>
            </div>
        </Sheet>
    );
};
