/**
 * @module @commise/features-cooking/ScaleSelector — the WEB yield-scale control (FR-034a).
 *
 * Pattern: **pure presentational (render) component** in its CONTROLLED form — `props → JSX` with one
 * responsibility (offer the supported yields and report the chosen one). No fetching, no mutation, no
 * state, no ref. The option set is not hard-coded: it IS `ALLOWED_SCALE_FACTORS`, the domain's bounded set
 * (MOD-020), so an option can never exist that `setScaleFactor` would reject. The advisory's visibility is
 * likewise not re-derived here — `shouldShowNotScaledAdvisory` owns that rule.
 *
 * SAFETY INVARIANT (spec.md D-002): this control changes DISPLAYED ingredient quantities only. Cook time
 * does not scale linearly with yield — doubling a batch does not double bake time — so scaling MUST NOT
 * touch any countdown, and the cook is told so whenever the factor is not 1x. The invariant is structural:
 * the component neither imports nor receives anything countdown-shaped (asserted on this file's own import
 * graph and props contract, mirroring the domain module's `UTS-020-D2`).
 *
 * Accessibility (NFR-003/NFR-004): a real labelled `radiogroup` of named `radio`s (arrow-key operable),
 * with the active factor carried by `checked` and the advisory exposed as an `alert` so it is announced the
 * moment it appears — state never rides on colour. Copy comes only from the shared `cookingMessages`
 * dictionary; the native leaf (`ScaleSelector.native.tsx`) mirrors this contract.
 */
import { useLocale, useMessages } from '@commise/i18n/react';
import { ALLOWED_SCALE_FACTORS, shouldShowNotScaledAdvisory } from '@kitchensink/cooking-core';
import { useId, type FC } from 'react';

import { cookingMessages } from './messages';
import type { ScaleSelectorProps } from './sessionExtras';

/** The yield-scale control shown inside Cooking Mode (FR-034a): quantities scale, cook times do not. */
export const ScaleSelector: FC<ScaleSelectorProps> = ({ scaleFactor, onScaleChange }) => {
    const cooking = useMessages(cookingMessages);
    const locale = useLocale();
    const groupName = useId();
    const formatFactor = new Intl.NumberFormat(locale);

    return (
        <div className="flex w-full flex-col gap-2">
            <fieldset role="radiogroup" aria-label={cooking.scaleLabel} className="flex flex-col gap-2">
                <legend className="text-body-sm font-medium text-charcoal">{cooking.scaleLabel}</legend>
                <div className="flex items-center gap-2">
                    {ALLOWED_SCALE_FACTORS.map((factor) => {
                        const optionLabel = cooking.scaleOption.replace('{factor}', formatFactor.format(factor));
                        const active = factor === scaleFactor;

                        return (
                            <label
                                key={factor}
                                className={`relative flex min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-full border px-3 text-body-sm font-medium sm:min-h-9 ${
                                    active
                                        ? 'border-seafoam bg-seafoam text-white'
                                        : 'border-slate bg-transparent text-charcoal'
                                }`}
                            >
                                {/* Transparent overlay covering the pill, so the radio itself is the
                                    click/tap target (directly actionable for pointer users + E2E) rather
                                    than a 1px `sr-only` point the pill would cover. */}
                                <input
                                    type="radio"
                                    name={groupName}
                                    className="absolute inset-0 cursor-pointer opacity-0"
                                    aria-label={optionLabel}
                                    checked={active}
                                    onChange={() => onScaleChange(factor)}
                                />
                                <span aria-hidden>{optionLabel}</span>
                            </label>
                        );
                    })}
                </div>
            </fieldset>

            {shouldShowNotScaledAdvisory(scaleFactor) && (
                <p role="alert" className="text-body-sm text-charcoal">
                    {cooking.scaleNotAppliedToTimes}
                </p>
            )}
        </div>
    );
};
