'use client';

/**
 * @module @commise/features-recipes/editor — the web editor's alert for a write the outbox parked (build spec §7.8,
 * ADR-0057: it waits for the cook): what happened, and what the cook can do. Words are `staff-ux-engineer`'s (slice 7).
 *
 * Presentational: props → JSX.
 */
import { Button } from '@commise/ui/button';
import type { FC } from 'react';

import type { FailureAlertProps } from './frameProps.js';

/** A write the outbox parked: what happened, and what the cook can do. */
export const FailureAlert: FC<FailureAlertProps> = ({ body, primary, secondary }) => (
    <div role="alert" className="flex flex-col gap-2 rounded-md border border-line-control bg-paper p-3">
        <p className="text-body-sm text-ink">{body}</p>
        <div className="flex flex-wrap gap-2">
            <Button size="sm" icon={primary.icon} onPress={primary.onPress}>
                {primary.label}
            </Button>
            {secondary !== undefined && (
                <Button size="sm" variant="secondary" icon={secondary.icon} onPress={secondary.onPress}>
                    {secondary.label}
                </Button>
            )}
        </div>
    </div>
);
