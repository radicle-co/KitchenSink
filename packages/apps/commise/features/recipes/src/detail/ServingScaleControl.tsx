'use client';

/**
 * @module @commise/features-recipes — the serving-count control, ONE file for web and native (the Stepper resolves its own
 * platform leaf): the design system's `Stepper` bound to the recipe's
 * serving range (`buildSpec.md` §1.11, §6.1). It used to be a hand-built twin with a Playfair number field; Playfair
 * never sets a number, and the control was built twice (F8, `evaluateFinal.md`).
 *
 * The range IS `servingsRange(baseServings)` from the domain, so an option can never exist that the scaling policy
 * would reject — including for a recipe authored ABOVE the display cap, which must still sit at, and scale down from,
 * its own yield. Every value leaving here has been through `clampServings`.
 *
 * Accessibility is the Stepper's: a group named "Servings" (its label hidden, because the heading row already says
 * "for {n}"), two named buttons that are `aria-disabled` with the press refused at the ends (never natively `disabled`,
 * which would drop focus, SC 2.4.3), and a polite announcement after a step — empty on open — that names the limit at
 * the ends, through `servingsAnnouncement`.
 *
 * @pattern Adapter — binds the `Stepper` primitive to the domain's serving range and announcement.
 */
import { useLocale, useMessages } from '@commise/i18n/react';
import { Stepper } from '@commise/ui/input';
import { clampServings, servingsRange } from '@kitchensink/recipe-core/scaling';
import { useId, type FC } from 'react';

import { recipeMessages } from '../messages.js';
import { servingsAnnouncement, type ServingScaleControlProps } from './model.js';

export const ServingScaleControl: FC<ServingScaleControlProps> = ({ servings, baseServings, onServingsChange }) => {
    const { detail } = useMessages(recipeMessages);
    const locale = useLocale();
    const id = useId();
    const { min, max } = servingsRange(baseServings);

    return (
        <Stepper
            id={id}
            label={detail.servingsAdjustLabel}
            labelVisibility="hidden"
            value={servings}
            min={min}
            max={max}
            onChange={(next) => onServingsChange?.(clampServings(next, baseServings))}
            announce={(next) => servingsAnnouncement(next, baseServings, detail, locale)}
            decreaseLabel={detail.servingsDecrease}
            increaseLabel={detail.servingsIncrease}
        />
    );
};
