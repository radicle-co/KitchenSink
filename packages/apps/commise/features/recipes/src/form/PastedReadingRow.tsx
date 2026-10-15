'use client';

/**
 * @module @commise/features-recipes/form — `PastedReadingRow` (web): a pasted line not in the recipe yet, as a row of the
 * Ingredients list (build spec §7.5.4; plan 2026-10-15-011). Its own text, then its state line — a static glyph and
 * words saying what the line is doing (`pasteStatusCopy.ts`) — then, on its own line, the one action its state allows:
 * Add as written for a line waiting on the cook, Try again for a failed lookup.
 *
 * Presentational: props in, markup out. Nothing moves (WCAG 2.2.2: the editor stays usable through the wait). The
 * native leaf is `./PastedReadingRow.native.tsx`.
 */
import { useMessages } from '@commise/i18n/react';
import { Button } from '@commise/ui/button';
import { Icon } from '@commise/ui/icon';
import type { FC } from 'react';

import { fillTemplate } from '../format/fillTemplate.js';
import { recipeFormMessages } from './messages.js';
import { pasteRowViewOf } from './pasteStatusCopy.js';
import type { PastedReadingRowProps } from './pastedReadingRowProps.js';

/** One pasted line still joining the recipe. */
export const PastedReadingRow: FC<PastedReadingRowProps> = ({
    row,
    onRetryLookup,
    onAddAsWritten,
    focusRequested,
    onFocusRequestHandled,
}) => {
    const m = useMessages(recipeFormMessages);
    const view = pasteRowViewOf(row.state, m);
    const toneText = view.tone === 'attention' ? 'text-attention' : 'text-ink-muted';

    return (
        <li className="flex min-h-12 flex-col justify-center gap-1">
            <span className="line-clamp-2 break-words text-body-md text-ink">{row.sourceLine}</span>
            <span className={`flex items-center gap-2 ${toneText}`}>
                <Icon name={view.icon} size={16} />
                <span className="text-caption">{view.stateText}</span>
            </span>
            {view.action === 'addAsWritten' && onAddAsWritten !== undefined && (
                <span>
                    <Button
                        variant="ghost"
                        size="sm"
                        icon="listPlus"
                        focusRequested={focusRequested}
                        onFocusRequestHandled={onFocusRequestHandled}
                        accessibilityLabel={fillTemplate(m.statusActionAddAsWrittenLabel, { line: row.sourceLine })}
                        onPress={() => onAddAsWritten(row.lineIndex)}
                    >
                        {m.statusActionAddAsWritten}
                    </Button>
                </span>
            )}
            {view.action === 'retryLookup' && onRetryLookup !== undefined && (
                <span>
                    <Button
                        variant="ghost"
                        size="sm"
                        icon="refreshCw"
                        accessibilityLabel={fillTemplate(m.statusActionRetryLookupLabel, { food: row.sourceLine })}
                        onPress={onRetryLookup}
                    >
                        {m.statusActionRetry}
                    </Button>
                </span>
            )}
        </li>
    );
};
