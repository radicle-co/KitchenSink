'use client';

/**
 * The WEB paste leaf — a cook's entry point into the ingredient parse pipeline (plan U9).
 *
 * DESIGN PATTERN: presentational leaf over a pure projection. It renders `props → JSX` and decides nothing:
 * the admission verdict arrives as {@link ParsePasteFormProps.submission}, already computed by
 * `toParseSubmissionModel`, so the control that blocks submission and the sentence explaining why are
 * provably one judgement rather than two that happen to agree.
 *
 * ⚠️ THE REFUSAL IS NOT SHOWN ON AN UNTOUCHED FIELD. An empty paste is inadmissible and that is TRUE, but
 * it is also the resting state — announcing it before a keystroke turns the first thing a cook sees into a
 * complaint about something they have not done yet.
 */
import { Button } from '@commise/ui/button';
import { useMessages } from '@commise/i18n/react';
import { useLocale } from '@commise/i18n/react';
import type { FC, JSX } from 'react';

import { ArrowLeftIcon, CheckIcon } from '../wizard/icons.js';
import { recipeParseMessages } from './messages.js';
import { formatParseLineCount } from './model.js';
import type { ParsePasteFormProps } from './props.js';

export const ParsePasteForm: FC<ParsePasteFormProps> = ({
    value,
    onChange,
    submission,
    onSubmit,
    submitting,
    errorNotice,
    onBack,
}): JSX.Element => {
    const messages = useMessages(recipeParseMessages);
    const locale = useLocale();
    // The field is untouched, so its (true) "nothing to read yet" refusal is withheld — see the module doc.
    const refusals = value === '' ? [] : submission.refusals;
    const blocked = !submission.canSubmit || submitting;

    return (
        <section aria-label={messages.pasteHeading} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1">
                <h1 className="text-heading-md font-semibold text-charcoal">{messages.pasteHeading}</h1>
                <p className="text-body-sm text-slate">{messages.pasteIntro}</p>
            </div>

            <label className="flex flex-col gap-2">
                <span className="text-body-sm font-medium text-charcoal">{messages.pasteLabel}</span>
                <textarea
                    value={value}
                    onChange={(event) => onChange(event.target.value)}
                    placeholder={messages.pastePlaceholder}
                    rows={10}
                    className="min-h-40 rounded-lg border border-border bg-card p-3 font-mono text-body-sm text-charcoal"
                />
            </label>

            <p className="text-caption text-slate">
                {formatParseLineCount(submission.lineCount, messages.pasteLineCount, locale)}
            </p>

            {refusals.length > 0 && (
                <ul role="alert" className="flex flex-col gap-1">
                    {refusals.map((refusal) => (
                        <li key={refusal} className="text-body-sm text-error-dark">
                            {refusal}
                        </li>
                    ))}
                </ul>
            )}

            {errorNotice !== undefined && (
                <p role="alert" className="text-body-sm text-error-dark">
                    {errorNotice}
                </p>
            )}

            {submitting && (
                <p role="status" className="text-body-sm text-slate">
                    {messages.pasteSubmitting}
                </p>
            )}

            {/* ⛔ THE `Button` PRIMITIVE, not a hand-rolled pill, and the reason is measured. This row used
                `bg-seafoam` with `text-ocean-dark`: 1.33:1, against WCAG 2.2 SC 1.4.3's 4.5:1 — the same
                class as the white-on-white difficulty chip. `buttonSurfaceClass` already pairs the seafoam
                fill with `text-white` (4.67:1) because that pairing was decided once, in the design system.
                It also carries the house 44px touch floor (`min-h-11 md:min-h-0`), which these pills did not:
                they measured 39px. One substitution closes a contrast failure and a target failure together,
                which is why this is the class fix rather than a `text-white` at each call site.
                ⚠️ `Button` takes the same `busyControlProps` underneath, mapping `disabled` to `blocked`, so
                the two-reasons-to-be-unavailable distinction this row documented is preserved exactly. */}
            {/* ⛔ STACKED BELOW `sm`, and measured rather than assumed. "Back to recipes" beside "Read my
                ingredients" needs more room than a phone has: side by side, BOTH labels wrapped to two
                lines at 320-375, which fits — the row grows taller instead of overflowing — and looks
                broken, because a pill is sized for one line.
                ⚠️ Stacked rather than truncated: "Read my ingredients" is the label that explains what this
                screen DOES, so shortening it to fit is the wrong trade. Full-width at base also puts the
                primary in the thumb zone and gives both controls a 288px target at 320. */}
            <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center">
                <Button variant="secondary" icon={<ArrowLeftIcon />} onPress={onBack}>
                    {messages.backAction}
                </Button>
                <Button icon={<CheckIcon />} busy={submitting} disabled={blocked} onPress={onSubmit}>
                    {messages.pasteSubmit}
                </Button>
            </div>
        </section>
    );
};
