/**
 * @module @commise/ui/input — the web design-system {@link FieldLabel}: the visible label above every field (`label`
 * role, `inkMuted`), associated by `htmlFor`, with an optional `caption` hint under it whose id the field's
 * `describedBy` names (`fieldHintId`). A field never relies on a placeholder for its label.
 *
 * Presentational: props → JSX, with no data, no mutation and no effect of its own.
 *
 * @pattern Template — the label half of the field geometry, shared by every text field
 */
import type { FC } from 'react';

import { fieldHintId, type FieldLabelProps } from './props.js';

/** The web design-system field label. */
export const FieldLabel: FC<FieldLabelProps> = ({ forId, label, hint }) => (
    <div className="flex flex-col gap-1">
        <label htmlFor={forId} className="text-label text-ink-muted">
            {label}
        </label>
        {hint === undefined ? null : (
            <p id={fieldHintId(forId)} className="text-caption text-ink-muted">
                {hint}
            </p>
        )}
    </div>
);
