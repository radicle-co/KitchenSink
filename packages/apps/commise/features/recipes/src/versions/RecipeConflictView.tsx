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
    <section aria-label={heading}>
        <h3>{heading}</h3>
        <dl>
            {fields.map((field) => (
                <div key={field.key}>
                    <dt>{field.label}</dt>
                    <dd>{field.value}</dd>
                </div>
            ))}
        </dl>
        <button type="button" onClick={onChoose}>
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
        <section aria-label={conflict.heading}>
            <h2>{conflict.heading}</h2>
            <p>{conflict.explanation}</p>
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
        </section>
    );
};
