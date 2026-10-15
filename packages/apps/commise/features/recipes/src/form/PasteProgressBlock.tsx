'use client';

/**
 * @module @commise/features-recipes/form — `PasteProgressBlock` (web): the ONE block over a paste's unjoined lines (UX
 * spec, plan 2026-10-15-011). It says how many lines are in the recipe, what step the paste is at, and — when lines wait
 * on the cook — offers Try again (job-wide) and Add the rest as written. It is NOT a live region: up to 200 lines change
 * under it, and the paste's one polite region speaks only at milestones (`usePasteAnnouncement`).
 *
 * Presentational, but it holds a ref: after an action its own control may disappear, and focus must land on the block
 * rather than on the page (SC 2.4.3). Nothing moves (WCAG 2.2.2). The native leaf is `./PasteProgressBlock.native.tsx`.
 *
 * @pattern Adapter over `useFocusOnSignal` — the DOM focus move the action's signal asks for
 */
import { useLocale, useMessages } from '@commise/i18n/react';
import { Button } from '@commise/ui/button';
import { useFocusOnSignal } from '@commise/ui/dialog-focus';
import { Icon } from '@commise/ui/icon';
import type { FC } from 'react';

import { recipeFormMessages } from './messages.js';
import type { PasteProgressBlockProps } from './pasteProgressBlockProps.js';
import { pasteProgressViewOf } from './pasteStatusCopy.js';

/** The progress block over a paste. */
export const PasteProgressBlock: FC<PasteProgressBlockProps> = ({
    progress,
    onRetryParse,
    onAddRestAsWritten,
    focusSignal,
}) => {
    const m = useMessages(recipeFormMessages);
    const locale = useLocale();
    const view = pasteProgressViewOf(progress, m, locale);
    const block = useFocusOnSignal<HTMLDivElement>(focusSignal);
    const toneText = view.tone === 'attention' ? 'text-attention' : 'text-ink-muted';

    return (
        <div ref={block} tabIndex={-1} className="flex flex-col gap-1 py-2 outline-none">
            <span className="text-body-sm tabular-nums text-ink">{view.title}</span>
            <span className={`flex items-center gap-2 ${toneText}`}>
                <Icon name={view.icon} size={16} />
                <span className="text-caption">{view.status}</span>
            </span>
            {view.hint !== undefined && <span className="text-caption text-ink-muted">{view.hint}</span>}
            {(view.retryLabel !== undefined || view.addRestLabel !== undefined) && (
                <span className="flex flex-wrap gap-2">
                    {view.retryLabel !== undefined && (
                        <Button
                            variant="ghost"
                            size="sm"
                            icon="refreshCw"
                            accessibilityLabel={view.retryLabel}
                            onPress={onRetryParse}
                        >
                            {m.statusActionRetry}
                        </Button>
                    )}
                    {view.addRestLabel !== undefined && (
                        <Button
                            variant="ghost"
                            size="sm"
                            icon="listPlus"
                            accessibilityLabel={view.addRestLabel}
                            onPress={onAddRestAsWritten}
                        >
                            {m.pasteAddRestAsWritten}
                        </Button>
                    )}
                </span>
            )}
        </div>
    );
};
