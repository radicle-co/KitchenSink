'use client';

/**
 * @module CookingTimerDock — the web timer dock: one row for each timer of this recipe, pinned in the foot above the
 * Next preview and the actions.
 *
 * Presentational: props → JSX.
 *
 * @pattern Slot — each row's body is the shared summary part, filled here
 */
import { CookingTimerRow, CookingTimerSummary } from '@commise/ui/cooking-timer-row';
import type { FC } from 'react';

import { dockRowState } from './timer/dockRowState.js';
import type { TimerDockRow } from './timer/useCookingTimerDock.js';

/** Props for {@link CookingTimerDock}. */
export interface CookingTimerDockProps {
    readonly rows: readonly TimerDockRow[];
}

/** The web timer dock. */
export const CookingTimerDock: FC<CookingTimerDockProps> = ({ rows }) => (
    <div className="flex flex-col gap-2">
        {rows.map((row) => (
            <CookingTimerRow
                key={row.id}
                state={dockRowState(row)}
                body={
                    <CookingTimerSummary
                        figure={row.figure}
                        {...(row.kind === 'running' ? {} : { status: row.status })}
                        meta={row.meta}
                        accessibilityLabel={row.accessibilityLabel}
                    />
                }
            />
        ))}
    </div>
);
