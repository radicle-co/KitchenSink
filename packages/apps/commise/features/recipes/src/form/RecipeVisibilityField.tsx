/**
 * @module @commise/features-recipes/form — `RecipeVisibilityField` (web): the private-visibility toggle.
 *
 * One of the four field GROUPS extracted from `RecipeForm.tsx` (T067, w3). It belongs to step 1 but is split
 * out from `RecipeBasicsFields` because the wireframe's step-1 field list and `RecipeForm`'s original
 * layout both treat it as its own control, not part of the "Basics" card.
 */
import { useMessages } from '@commise/i18n/react';
import type { FC } from 'react';

import { recipeFormMessages } from './messages.js';
import type { RecipeFormSectionProps } from './props.js';

/** The private-visibility toggle — its own field (step 1) per the original `RecipeForm` layout. */
export const RecipeVisibilityField: FC<Omit<RecipeFormSectionProps, 'errors'>> = ({ values, onChange }) => {
    const m = useMessages(recipeFormMessages);

    return (
        <label className="flex items-center gap-3 rounded-2xl bg-card p-4 shadow-sm">
            <input
                type="checkbox"
                aria-label={m.visibilityLabel}
                checked={values.visibility === 'private'}
                onChange={(event) => onChange({ ...values, visibility: event.target.checked ? 'private' : 'public' })}
                className="size-5 accent-seafoam"
            />
            <span className="text-body-md text-charcoal">{m.visibilityLabel}</span>
        </label>
    );
};
