/**
 * @module @commise/features-recipes — web concurrent-edit conflict view (T070 / C-005 building block).
 *
 * Controlled, presentational conflict resolver for FR-007c. It presents the user's in-progress version and
 * the latest saved version side-by-side — each an accessible region with a heading and the key differing
 * fields (title, servings, prep/cook/total times, ingredient count, step count) — and offers ALL THREE
 * resolutions the spec requires: keep mine, use theirs, or MERGE field-by-field. The merge panel is a
 * per-field chooser (a radio group per editable field, defaulting to the user's draft) that composes a new
 * draft and delegates it upward via `onMerge`; the app re-submits it as a fresh write with the latest server
 * version. Nothing is auto-merged — every field's resolution is the user's explicit choice.
 */
import { useLocale, useMessages } from '@commise/i18n/react';
import { useState } from 'react';
import type { FC } from 'react';

import { recipeVersionMessages } from './messages.js';
import {
    buildRecipeMergeFields,
    composeMergedRecipe,
    fillTemplate,
    toConflictSideFields,
    type ConflictField,
    type MergeSide,
    type RecipeConflictViewProps,
} from './model.js';

/** Render one side of the conflict — an accessible region with a heading, its fields, and its choice. */
const ConflictSide: FC<{
    readonly heading: string;
    readonly fields: readonly ConflictField[];
    readonly actionLabel: string;
    readonly onChoose: () => void;
}> = ({ heading, fields, actionLabel, onChoose }) => (
    <section
        aria-label={heading}
        className="flex flex-1 flex-col gap-3 rounded-2xl bg-card p-5 shadow-sm ring-1 ring-border"
    >
        <h3 className="font-display text-heading-md font-semibold text-charcoal">{heading}</h3>
        <dl className="flex flex-col gap-2">
            {fields.map((field) => (
                <div key={field.key} className="flex flex-col">
                    <dt className="text-caption uppercase tracking-wide text-slate">{field.label}</dt>
                    <dd className="text-body-md text-charcoal">{field.value}</dd>
                </div>
            ))}
        </dl>
        <button
            type="button"
            onClick={onChoose}
            className="mt-auto self-start rounded-full bg-seafoam px-5 py-2 text-body-sm font-semibold text-white shadow-sm transition hover:bg-ocean-dark"
        >
            {actionLabel}
        </button>
    </section>
);

export const RecipeConflictView: FC<RecipeConflictViewProps> = ({
    mineTitle,
    theirs,
    mine,
    mineValues,
    theirsValues,
    onKeepMine,
    onUseTheirs,
    onMerge,
}) => {
    const { conflict } = useMessages(recipeVersionMessages);
    const locale = useLocale();
    const [merging, setMerging] = useState(false);
    // Sparse per-field resolution: an absent field is the default ("mine"), so `composeMergedRecipe` and the
    // radio state both read a missing key as the user's own draft. No server data lives here — only the UI
    // choice of which side each field resolves to.
    const [selections, setSelections] = useState<Record<string, MergeSide>>({});

    const optionLabel = (side: string, value: string): string =>
        fillTemplate(conflict.mergeOptionLabel, { side, value });

    if (merging) {
        const fields = buildRecipeMergeFields(mineValues, theirsValues, conflict, locale);
        const sideOf = (key: string): MergeSide => selections[key] ?? 'mine';
        const choose = (key: string, side: MergeSide): void =>
            setSelections((current) => ({ ...current, [key]: side }));

        return (
            <section aria-label={conflict.mergeHeading} className="mx-auto flex max-w-3xl flex-col gap-4 px-4 py-8">
                <h2 className="font-display text-heading-lg font-semibold text-charcoal">{conflict.mergeHeading}</h2>
                <p className="text-body-md text-slate">{conflict.mergeExplanation}</p>
                <div className="flex flex-col gap-3">
                    {fields.map((field) => (
                        <fieldset
                            key={field.key}
                            role="radiogroup"
                            aria-label={field.label}
                            className="flex flex-col gap-1 rounded-2xl bg-card p-4 ring-1 ring-border"
                        >
                            <legend className="text-caption uppercase tracking-wide text-slate">{field.label}</legend>
                            <label className="flex items-center gap-2 text-body-md text-charcoal">
                                <input
                                    type="radio"
                                    name={field.key}
                                    checked={sideOf(field.key) === 'mine'}
                                    onChange={() => choose(field.key, 'mine')}
                                />
                                {optionLabel(conflict.mineHeading, field.mineValue)}
                            </label>
                            <label className="flex items-center gap-2 text-body-md text-charcoal">
                                <input
                                    type="radio"
                                    name={field.key}
                                    checked={sideOf(field.key) === 'theirs'}
                                    onChange={() => choose(field.key, 'theirs')}
                                />
                                {optionLabel(conflict.theirsHeading, field.theirsValue)}
                            </label>
                        </fieldset>
                    ))}
                </div>
                <div className="flex flex-wrap gap-3">
                    <button
                        type="button"
                        onClick={() => onMerge(composeMergedRecipe(mineValues, theirsValues, selections))}
                        className="rounded-full bg-seafoam px-5 py-2 text-body-sm font-semibold text-white shadow-sm transition hover:bg-ocean-dark"
                    >
                        {conflict.mergeSubmit}
                    </button>
                    <button
                        type="button"
                        onClick={() => {
                            setSelections({});
                            setMerging(false);
                        }}
                        className="rounded-full px-5 py-2 text-body-sm font-semibold text-charcoal ring-1 ring-border transition hover:bg-card"
                    >
                        {conflict.mergeBack}
                    </button>
                </div>
            </section>
        );
    }

    return (
        <section aria-label={conflict.heading} className="mx-auto flex max-w-3xl flex-col gap-4 px-4 py-8">
            <h2 className="font-display text-heading-lg font-semibold text-charcoal">{conflict.heading}</h2>
            <p className="text-body-md text-slate">{conflict.explanation}</p>
            <div className="flex flex-col gap-4 sm:flex-row">
                <ConflictSide
                    heading={conflict.mineHeading}
                    fields={toConflictSideFields(mineTitle, mine, conflict, locale)}
                    actionLabel={conflict.keepMine}
                    onChoose={onKeepMine}
                />
                <ConflictSide
                    heading={conflict.theirsHeading}
                    fields={toConflictSideFields(theirs.title, theirs, conflict, locale)}
                    actionLabel={conflict.useTheirs}
                    onChoose={onUseTheirs}
                />
            </div>
            <button
                type="button"
                onClick={() => setMerging(true)}
                className="self-start rounded-full px-5 py-2 text-body-sm font-semibold text-charcoal ring-1 ring-border transition hover:bg-card"
            >
                {conflict.mergeAction}
            </button>
        </section>
    );
};
