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

import { FIELD_CLASS } from '../input/fieldClass.js';
import { DURATION_BOX_WIDTH_CSS } from './boxWidth.js';
import { durationBoxes, durationFromBoxes } from './duration.js';
import type { DurationFieldProps } from './props.js';

/**
 * The box chrome: the shared field surface (the Input rules, spec §1.11), narrowed to a number's width. Both boxes
 * take one width from the font (`./boxWidth.ts`), never stretched, so the field fits the 136 px a half-width cell has
 * at 320 (build spec §7.4). It gives back half the surface's side padding (`px-2!`: `FIELD_CLASS` sets `px-4`, and the
 * stylesheet's emission order would decide a plain clash), and draws no spin buttons, which take the digits' room and
 * are too small to tap.
 */
const box =
    `shrink-0 px-2! text-ink [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none ` +
    `[&::-webkit-outer-spin-button]:appearance-none ${FIELD_CLASS}`;

/**
 * A box and its unit stay on one line together, at their own width; the row wraps between the pairs only when they do
 * not fit.
 */
const pair = 'flex items-center gap-1';

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
            <span id={labelId} className="text-label text-ink-muted">
                {label}
            </span>
            <div className="flex flex-wrap items-center gap-2">
                <div className={pair}>
                    <input
                        type="number"
                        inputMode="numeric"
                        min={0}
                        step={1}
                        aria-label={hoursLabel}
                        value={shown.hours}
                        onChange={(event) => onChange(durationFromBoxes(event.target.value, shown.minutes))}
                        style={{ width: DURATION_BOX_WIDTH_CSS }}
                        className={box}
                    />
                    <span aria-hidden="true" className="text-meta text-ink-muted">
                        {hoursUnit}
                    </span>
                </div>
                <div className={pair}>
                    <input
                        type="number"
                        inputMode="numeric"
                        min={0}
                        step={1}
                        aria-label={minutesLabel}
                        value={shown.minutes}
                        onChange={(event) => onChange(durationFromBoxes(shown.hours, event.target.value))}
                        style={{ width: DURATION_BOX_WIDTH_CSS }}
                        className={box}
                    />
                    <span aria-hidden="true" className="text-meta text-ink-muted">
                        {minutesUnit}
                    </span>
                </div>
            </div>
        </div>
    );
};
