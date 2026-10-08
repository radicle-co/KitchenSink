/**
 * @module @commise/ui/duration-field — the web `DurationField`: a duration stored in seconds, entered as hours and
 * minutes (`docs/design/uiOverhaul/specRecipeAndWizard.md` S0.4).
 *
 * Two number boxes in one labelled group, each with its own accessible name and a short decorative unit beside it.
 * An empty box means "none", so the field never shows a "0". Minutes past 59 carry into the hours on the next render
 * (typing 90 minutes shows 1 h 30 min), which is the arithmetic in `./duration.ts`, shared with the native leaf.
 *
 * Presentational and controlled: it owns no state; the caller holds the seconds.
 *
 * @pattern Adapter — presents a value stored in seconds as an hours/minutes pair, and converts each edit back.
 */
import { useId, type FC } from 'react';

import { durationBoxes, durationFromBoxes } from './duration.js';
import type { DurationFieldProps } from './props.js';

/** The box chrome: a 48 px rectangle, the form inputs' border and focus ring. */
const box =
    'h-12 w-16 rounded-lg border border-border bg-white px-3 text-body-md text-charcoal outline-none focus:ring-2 focus:ring-seafoam';

export const DurationField: FC<DurationFieldProps> = ({
    label,
    hoursLabel,
    minutesLabel,
    hoursUnit,
    minutesUnit,
    value,
    onChange,
}) => {
    const labelId = useId();
    const shown = durationBoxes(value);

    return (
        <div role="group" aria-labelledby={labelId} className="flex flex-col gap-1">
            <span id={labelId} className="text-body-sm font-medium text-slate">
                {label}
            </span>
            <div className="flex items-center gap-2">
                <input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    step={1}
                    aria-label={hoursLabel}
                    value={shown.hours}
                    onChange={(event) => onChange(durationFromBoxes(event.target.value, shown.minutes))}
                    className={box}
                />
                <span aria-hidden="true" className="text-body-sm text-slate">
                    {hoursUnit}
                </span>
                <input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    step={1}
                    aria-label={minutesLabel}
                    value={shown.minutes}
                    onChange={(event) => onChange(durationFromBoxes(shown.hours, event.target.value))}
                    className={box}
                />
                <span aria-hidden="true" className="text-body-sm text-slate">
                    {minutesUnit}
                </span>
            </div>
        </div>
    );
};
