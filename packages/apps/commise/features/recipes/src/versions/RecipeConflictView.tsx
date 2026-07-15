/**
 * @module @commise/features-recipes — web concurrent-edit conflict view (T070 / C-005 building block).
 *
 * Controlled, presentational conflict resolver: presents the user's in-progress version and the latest
 * saved version side-by-side — each an accessible region with a heading and the key differing fields
 * (title, servings, prep/cook/total times, ingredient count, step count) — and offers the two resolution
 * choices ("keep mine" / "use theirs"), delegating the decision upward.
 */
import { useLocale, useMessages } from '@commise/i18n/react';
import type { FC } from 'react';

import { recipeVersionMessages } from './messages.js';
import { toConflictSideFields, type ConflictField, type RecipeConflictViewProps } from './model.js';

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
    onKeepMine,
    onUseTheirs,
}) => {
    const { conflict } = useMessages(recipeVersionMessages);
    const locale = useLocale();

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
        </section>
    );
};
