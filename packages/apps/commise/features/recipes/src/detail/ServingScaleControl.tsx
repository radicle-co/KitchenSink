'use client';

/**
 * @module @commise/features-recipes — WEB serving-count control.
 *
 * Pattern: **pure presentational (render) component** in its CONTROLLED form — `props → JSX`, one
 * responsibility (offer a serving count and report the chosen one), no state, no effect, no ref.
 *
 * The range is not hard-coded: it IS `servingsRange(baseServings)` from the domain, so an option can never
 * exist that the scaling policy would reject — including for a recipe authored ABOVE the display cap, which
 * must still sit at, and scale down from, its own yield. Every value leaving here has been through
 * `clampServings`, so a cleared field (parsed `NaN`) can never reach the arithmetic.
 *
 * Accessibility: a real labelled number input (a native `spinbutton`, keyboard-operable) flanked by two
 * named buttons that read as UNAVAILABLE at the ends of the range rather than silently doing nothing.
 * Selectable by role/label only, per repo policy.
 *
 * The one piece of state is the input's in-progress TEXT (`draft`) — not a duplicate of the serving count,
 * which stays owned by the caller. It exists because a fully-controlled numeric field cannot be cleared:
 * the empty string parses to `NaN`, clamps to the minimum, and the next keystroke lands AFTER it, so a cook
 * clearing "4" to type "12" gets "112". While the field is being edited it shows what was typed; the moment
 * it loses focus, or a step button is used, the draft is dropped and the authoritative value shows again.
 */
import { useMessages } from '@commise/i18n/react';
import { clampServings, servingsRange } from '@kitchensink/recipe-core/scaling';
import { useState, type FC } from 'react';

import { recipeMessages } from '../messages.js';
import type { ServingScaleControlProps } from './model.js';

/** Shared surface for the two step buttons: 44px touch floor, DS pill, visible disabled state. */
const stepButton =
    'flex min-h-11 min-w-11 items-center justify-center rounded-full border border-slate text-body-lg font-medium text-charcoal transition hover:bg-pearl disabled:cursor-not-allowed disabled:opacity-40 sm:min-h-9 sm:min-w-9';

export const ServingScaleControl: FC<ServingScaleControlProps> = ({ servings, baseServings, onServingsChange }) => {
    const { detail } = useMessages(recipeMessages);
    const { min, max } = servingsRange(baseServings);
    const [draft, setDraft] = useState<string | null>(null);

    const change = (next: number): void => {
        setDraft(null);
        onServingsChange?.(clampServings(next, baseServings));
    };

    return (
        <div className="flex items-center justify-center gap-1">
            <button
                type="button"
                aria-label={detail.servingsDecrease}
                disabled={servings <= min}
                onClick={() => change(servings - 1)}
                className={stepButton}
            >
                <span aria-hidden>−</span>
            </button>
            <input
                type="number"
                inputMode="numeric"
                aria-label={detail.servingsAdjustLabel}
                value={draft ?? String(servings)}
                min={min}
                max={max}
                step={1}
                onChange={(event) => {
                    const typed = event.target.value;
                    const parsed = Number.parseInt(typed, 10);

                    setDraft(typed);

                    // An empty (or otherwise unparseable) field is a transient EDITING state, not a request
                    // for zero servings — nothing is reported until there is a number to report, so `NaN`
                    // can never reach the scaling arithmetic.
                    if (Number.isFinite(parsed)) {
                        onServingsChange?.(clampServings(parsed, baseServings));
                    }
                }}
                onBlur={() => setDraft(null)}
                className="w-14 rounded-lg border border-border bg-card py-1 text-center font-display text-2xl font-bold text-charcoal"
            />
            <button
                type="button"
                aria-label={detail.servingsIncrease}
                disabled={servings >= max}
                onClick={() => change(servings + 1)}
                className={stepButton}
            >
                <span aria-hidden>+</span>
            </button>
        </div>
    );
};
