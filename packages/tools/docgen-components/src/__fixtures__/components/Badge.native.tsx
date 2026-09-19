/**
 * @module fixtures/Badge — the native leaf of the cross-platform Badge fixture. Presentational, and it
 * implements the SAME {@link BadgeProps} contract as the web leaf.
 *
 * @pattern Value Object
 */
import type { FC } from 'react';

import type { BadgeProps } from './badgeProps.js';

/** The fixture badge — native leaf. */
export const Badge: FC<BadgeProps> = ({ tone = 'neutral', children, compact = false }) => (
    <span data-tone={tone} data-compact={compact}>
        {children}
    </span>
);
