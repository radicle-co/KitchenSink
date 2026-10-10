'use client';

/**
 * @module @commise/features-recipes/editor — the web editor's resume notice (build spec §7.3): a published recipe has
 * device changes from an earlier visit, with Save changes and Discard.
 *
 * Presentational: props → JSX.
 */
import { Button } from '@commise/ui/button';
import type { FC } from 'react';

import type { ResumeNoticeProps } from './frameProps.js';

/** A published recipe's device changes, waiting for Save changes. */
export const ResumeNotice: FC<ResumeNoticeProps> = ({ body, saveLabel, discardLabel, onSave, onDiscard }) => (
    <section aria-label={body} className="flex flex-col gap-3 rounded-md bg-surface-muted p-4">
        <p className="text-body-sm text-ink">{body}</p>
        <div className="flex flex-wrap gap-2">
            <Button size="sm" icon="check" onPress={onSave}>
                {saveLabel}
            </Button>
            <Button size="sm" variant="ghost" onPress={onDiscard}>
                {discardLabel}
            </Button>
        </div>
    </section>
);
