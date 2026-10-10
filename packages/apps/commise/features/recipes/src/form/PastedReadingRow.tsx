'use client';

/**
 * @module @commise/features-recipes/form — `PastedReadingRow` (web): a pasted line not in the recipe yet, as a row of
 * the Ingredients list (build spec §7.5.1 "Reading", §7.5.4). Its own text, then "Reading…" (or, while its work waits
 * for a connection, that it finishes once back online), or, when its lookup failed, ⚠ "Couldn't look up" in
 * `attention` with Try again named for the line.
 *
 * Presentational: props in, markup out. The native leaf is `./PastedReadingRow.native.tsx`.
 */
import { useMessages } from '@commise/i18n/react';
import { Button } from '@commise/ui/button';
import { Icon } from '@commise/ui/icon';
import type { FC } from 'react';

import { fillTemplate } from '../format/fillTemplate.js';
import { recipeFormMessages } from './messages.js';
import type { PastedReadingRowProps } from './pastedReadingRowProps.js';

/** One pasted line still joining the recipe. */
export const PastedReadingRow: FC<PastedReadingRowProps> = ({ row, onRetry }) => {
    const m = useMessages(recipeFormMessages);

    return (
        <li className="flex min-h-12 flex-col justify-center gap-1">
            <span className="line-clamp-2 break-words text-body-md text-ink">{row.sourceLine}</span>
            {row.state === 'failed' ? (
                <span className="flex flex-wrap items-center gap-2 text-attention">
                    <Icon name="triangleAlert" size={16} />
                    <span className="text-caption">{m.rowStateLookupFailed}</span>
                    {onRetry !== undefined && (
                        <Button
                            variant="ghost"
                            icon="refreshCw"
                            accessibilityLabel={fillTemplate(m.statusActionRetryLookupLabel, { food: row.sourceLine })}
                            onPress={onRetry}
                        >
                            {m.statusActionRetry}
                        </Button>
                    )}
                </span>
            ) : (
                <span className="text-caption text-ink-muted">
                    {row.state === 'waiting' ? m.rowStateWaitingForConnection : m.rowStateReading}
                </span>
            )}
        </li>
    );
};
