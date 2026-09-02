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
import { useMessages } from '@commise/i18n/react';
import { useLocale } from '@commise/i18n/react';
import type { FC, JSX } from 'react';

import { fillTemplate } from '../list/model.js';
import { recipeParseMessages } from './messages.js';
import type { ParsePasteFormProps } from './props.js';

/** Select the singular/plural template for `count` and fill it. Pure. */
function lineCountLabel(count: number, labels: { one: string; other: string }, locale: string): string {
    const template = new Intl.PluralRules(locale).select(count) === 'one' ? labels.one : labels.other;

    return fillTemplate(template, { count });
}

export const ParsePasteForm: FC<ParsePasteFormProps> = ({
    value,
    onChange,
    submission,
    onSubmit,
    submitting,
    errorNotice,
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
                {lineCountLabel(submission.lineCount, messages.pasteLineCount, locale)}
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

            <button
                type="button"
                onClick={onSubmit}
                disabled={blocked}
                aria-busy={submitting}
                className="self-start rounded-full bg-seafoam px-5 py-2 text-body-sm font-semibold text-ocean-dark disabled:opacity-60"
            >
                {messages.pasteSubmit}
            </button>
        </section>
    );
};
