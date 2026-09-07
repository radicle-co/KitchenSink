'use client';

/**
 * @module @commise/features-recipes/form — the web REVIEW step body (U33, owner ruling 2026-08-25).
 *
 * The wizard's fourth step. It REPLACED the `Preview` overlay `Wizard.tsx` used to own: two surfaces
 * rendering the same draft drift, and each would have needed its own tests. Its accepted cost is recorded
 * with the ruling — a cook can no longer sanity-check from step 1 without walking forward.
 *
 * **A pure RENDER component** (`props -> JSX`): no fetching, no mutation, no state, one responsibility. It
 * reads the SAME `RecipeFormValues` the other three steps edit, which is the structural reason it cannot
 * drift from them the way a second surface with its own props did.
 *
 * **The rows are not decided here.** `reviewRows` (`./props.ts`) states which rows exist, in what order, and
 * how each value is formatted — one statement, consumed by this leaf and by `RecipeReviewFields.native.tsx`,
 * so a field cannot appear on one platform and not the other. This file is the web SPELLING of that list.
 *
 * ⛔ Every optional field states its absence rather than dropping its row; the one exception is the
 * pending-photo row. See `reviewRows` for why.
 */
import { useMessages } from '@commise/i18n/react';
import type { FC } from 'react';

import { sectionCard, sectionHeading } from './formSectionStyles.js';
import { recipeFormMessages } from './messages.js';
import type { RecipeFormValues } from './model.js';
import { reviewIngredientLabel, reviewRows } from './props.js';

/** Props for {@link RecipeReviewFields}. */
export interface RecipeReviewFieldsProps {
    /** The draft to summarise. Read-only — this step edits nothing. */
    readonly values: RecipeFormValues;
}

/** Step 4: a read-only summary of the whole draft, and the last surface before Publish. */
export const RecipeReviewFields: FC<RecipeReviewFieldsProps> = ({ values }) => {
    const m = useMessages(recipeFormMessages);

    return (
        <section aria-label={m.reviewHeading} className={sectionCard}>
            <h2 className={sectionHeading}>{m.reviewHeading}</h2>
            <dl className="flex flex-col gap-2 text-body-sm text-charcoal">
                {reviewRows(values, m).map((row) => (
                    <div key={row.label} className="flex justify-between gap-3">
                        <dt className="font-medium text-slate">{row.label}</dt>
                        <dd className="text-right">{row.value}</dd>
                    </div>
                ))}
            </dl>
            {values.ingredients.length === 0 ? (
                <p className="text-body-sm text-slate">{m.reviewNoIngredients}</p>
            ) : (
                <ul aria-label={m.ingredientsHeading} className="flex flex-col gap-1 text-body-sm text-charcoal">
                    {values.ingredients.map((line, index) => (
                        // Index-keyed deliberately: a draft line has no stable identity of its own (an
                        // unresolved line's `ingredientId` is `null`, and two lines may share a catalog id),
                        // and this list is READ-ONLY — nothing here reorders, inserts or focuses, which is
                        // where an index key actually bites.
                        <li key={`${line.ingredientId ?? 'unresolved'}-${index}`}>{reviewIngredientLabel(line)}</li>
                    ))}
                </ul>
            )}
        </section>
    );
};
