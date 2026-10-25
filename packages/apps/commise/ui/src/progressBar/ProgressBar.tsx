/**
 * @module @commise/ui/progress-bar — the web design-system {@link ProgressBar}: a 6 px `surfaceMuted` track filled with
 * `action` to the share done, exposed as a determinate `progressbar` (name, `aria-valuenow`, `aria-valuemin`,
 * `aria-valuemax`). The fill does not animate.
 *
 * Presentational: props → JSX, with no data, no mutation and no effect of its own.
 *
 * @pattern Specification consumer — `progressFraction` decides the fill; both leaves draw its one answer
 */
import type { FC } from 'react';

import { progressFraction, type ProgressBarProps } from './props.js';

/** The web determinate progress bar. */
export const ProgressBar: FC<ProgressBarProps> = ({ label, value, max }) => {
    const fraction = progressFraction(value, max);
    const bound = Math.max(0, max);

    return (
        <div
            role="progressbar"
            aria-label={label}
            aria-valuenow={Math.round(fraction * bound)}
            aria-valuemin={0}
            aria-valuemax={bound}
            className="h-1.5 w-full overflow-hidden rounded-full bg-surface-muted"
        >
            <div className="h-full rounded-full bg-action" style={{ width: `${fraction * 100}%` }} />
        </div>
    );
};
