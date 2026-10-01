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
 * named buttons that read as UNAVAILABLE at the ends of the range rather than silently doing nothing. At a limit
 * they are `aria-disabled` with the press refused, never natively `disabled`: pressing + TO the maximum makes the
 * button just pressed unavailable, and native `disabled` would drop the keyboard user's focus to <body> (WCAG 2.2
 * SC 2.4.3). A pure render cannot tell "at the limit on load" from "just pressed to it", so both ends take the
 * focusable form (staff-ux-engineer). A step changes a number nobody is focused on, so a screen-reader-only status
 * region speaks the count — and "maximum"/"minimum" at the ends — via `servingsAnnouncement`.
 * Selectable by role/label only, per repo policy.
 *
 * The main piece of state is the input's in-progress TEXT (`draft`) — not a duplicate of the serving count,
 * which stays owned by the caller. It exists because a fully-controlled numeric field cannot be cleared:
 * the empty string parses to `NaN`, clamps to the minimum, and the next keystroke lands AFTER it, so a cook
 * clearing "4" to type "12" gets "112". While the field is being edited it shows what was typed; the moment
 * it loses focus, or a step button is used, the draft is dropped and the authoritative value shows again. The other,
 * `hasChanged`, only gates the spoken count so it starts once the cook has changed something.
 */
import { useLocale, useMessages } from '@commise/i18n/react';
import { refusedPressProps } from '@commise/ui/button';
import { clampServings, servingsRange } from '@kitchensink/recipe-core/scaling';
import { useState, type FC } from 'react';

import { recipeMessages } from '../messages.js';
import { servingsAnnouncement, type ServingScaleControlProps } from './model.js';

/** Shared surface for the two step buttons: 44px touch floor, DS pill, visible unavailable state. */
const stepButton =
    'flex min-h-11 min-w-11 items-center justify-center rounded-full border border-slate text-body-lg font-medium text-charcoal transition hover:bg-pearl aria-disabled:cursor-not-allowed aria-disabled:opacity-40 aria-disabled:hover:bg-transparent sm:min-h-9 sm:min-w-9';

export const ServingScaleControl: FC<ServingScaleControlProps> = ({ servings, baseServings, onServingsChange }) => {
    const { detail } = useMessages(recipeMessages);
    const locale = useLocale();
    const { min, max } = servingsRange(baseServings);
    const [draft, setDraft] = useState<string | null>(null);
    // Whether the cook has changed the count yet: the status region stays empty until then, so opening a recipe is
    // not read out as its serving count.
    const [hasChanged, setHasChanged] = useState(false);

    const change = (next: number): void => {
        setDraft(null);
        setHasChanged(true);
        onServingsChange?.(clampServings(next, baseServings));
    };

    return (
        <div className="flex items-center justify-center gap-1">
            <button
                type="button"
                aria-label={detail.servingsDecrease}
                {...refusedPressProps({ unavailable: servings <= min, onClick: () => change(servings - 1) })}
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
                onBlur={() => {
                    // Leaving a field the cook edited commits the (clamped) value, and that is announced once.
                    if (draft !== null) {
                        setHasChanged(true);
                    }

                    setDraft(null);
                }}
                className="w-14 rounded-lg border border-border bg-card py-1 text-center font-display text-2xl font-bold text-charcoal"
            />
            <button
                type="button"
                aria-label={detail.servingsIncrease}
                {...refusedPressProps({ unavailable: servings >= max, onClick: () => change(servings + 1) })}
                className={stepButton}
            >
                <span aria-hidden>+</span>
            </button>
            {/* What a step SAYS. ALWAYS MOUNTED, because a status region must exist before its text changes for the
                change to be announced; screen-reader-only, because the count is already visible in the field.
                Empty until the first change and while the cook types; leaving an edited field speaks the value. */}
            <span role="status" className="sr-only">
                {hasChanged && draft === null ? servingsAnnouncement(servings, baseServings, detail, locale) : ''}
            </span>
        </div>
    );
};
