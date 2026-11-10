'use client';

/**
 * @module @commise/features-recipes/form — `PrivateFoodNote` (web): what a row says of a food only the cook can see
 * (private foods spec D3). In a PUBLIC recipe it is an attention line, `caption` in `attention` with the lock glyph; in a
 * private recipe it is the quiet "Private food" `StatusBadge`. Neither is a control: opening the food is the row's ⋯ menu.
 *
 * Presentational: `props → JSX`.
 */
import { Icon } from '@commise/ui/icon';
import { StatusBadge } from '@commise/ui/status-badge';
import type { FC } from 'react';

import type { RowPrivateFoodView } from './ingredientRowView.js';

/** The note. */
export const PrivateFoodNote: FC<{ readonly view: RowPrivateFoodView }> = ({ view }) =>
    view.kind === 'badge' ? (
        <span>
            <StatusBadge status="private">{view.text}</StatusBadge>
        </span>
    ) : (
        <span className="flex items-start gap-1 text-caption text-attention">
            <Icon name="lock" size={16} />
            <span>{view.text}</span>
        </span>
    );
