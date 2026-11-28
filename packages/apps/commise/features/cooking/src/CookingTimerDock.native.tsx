/**
 * @module CookingTimerDock — the native timer dock: one row for each timer of this recipe, pinned in the foot.
 *
 * Presentational: props → JSX.
 *
 * @pattern Slot — each row's body is the shared summary part, filled here
 */
import { CookingTimerRow, CookingTimerSummary } from '@commise/ui/cooking-timer-row';
import type { FC } from 'react';
import { YStack } from 'tamagui';

import { dockRowState } from './timer/dockRowState.js';
import type { CookingTimerDockProps } from './CookingTimerDock.js';

/** The native timer dock. */
export const CookingTimerDock: FC<CookingTimerDockProps> = ({ rows }) => (
    <YStack gap="$2">
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
    </YStack>
);
