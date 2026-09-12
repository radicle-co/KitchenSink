/**
 * @module fixtures/Badge — the web leaf of the cross-platform Badge fixture.
 *
 * A pure presentational chip: `props -> JSX`, no state, no effects.
 *
 * @pattern Value Object
 */
import type { FC } from 'react';

import type { BadgeProps } from './badgeProps.js';

/** The fixture badge — web leaf. */
export const Badge: FC<BadgeProps> = ({ tone = 'neutral', children, compact = false }) => (
    <span data-tone={tone} data-compact={compact}>
        {children}
    </span>
);
