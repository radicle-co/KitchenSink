/**
 * @module @commise/features-recipes — web recipe create/edit form (T067 building block).
 *
 * Controlled, presentational editor over the full `RecipeFormValues`: Basics (title, description,
 * cuisine, tags, dietary flags, servings, prep/cook time + a READ-ONLY computed total), a dynamic
 * Ingredients list (name/quantity/unit + a resolution-status badge + add/remove), a dynamic Instructions
 * list (instruction + optional timer + add/remove), and a visibility toggle. It fetches nothing and
 * resolves no ingredient — the composing app owns the food-service typeahead and submission; this leaf just
 * renders the current values, surfaces `errors`, and reports every edit up via `onChange`.
 *
 * Styled to the Commise design language (@commise/ui tokens as Tailwind v4 utilities): card sections,
 * rounded seafoam-focused fields with visible labels, and a seafoam primary submit. Every control keeps
 * its `aria-label` so name-based selection (tests, Playwright, Maestro) resolves it unchanged.
 *
 * Photo upload (wireframe step 4) is intentionally OUT OF SCOPE here — a later increment adds it.
 *
 * The field groups below (Basics, Ingredients, Instructions, Visibility) are the shared
 * `Recipe*Fields.js`/`RecipeVisibilityField.js` leaves (w3) — this component's job is now just the `<form>` shell (heading +
 * submit/cancel chrome) that arranges them in one page; the SAME leaves compose the 4-step edit wizard
 * (`wizard/Wizard.tsx`) one-to-one with its steps. This is a pure relocation: the rendered markup and every
 * accessible name are unchanged from before the extraction.
 */
import { Button } from '@commise/ui/button';
import { useMessages } from '@commise/i18n/react';
import type { FC } from 'react';

import { CheckIcon, XIcon } from './icons.js';
import { recipeFormMessages } from './messages.js';
import { RecipeBasicsFields } from './RecipeBasicsFields.js';
import { RecipeIngredientsFields } from './RecipeIngredientsFields.js';
import { RecipeInstructionsFields } from './RecipeInstructionsFields.js';
import { RecipeVisibilityField } from './RecipeVisibilityField.js';
import type { RecipeFormProps } from './props.js';

export const RecipeForm: FC<RecipeFormProps> = ({
    values,
    errors,
    mode,
    submitting = false,
    onChange,
    onSubmit,
    onCancel,
}) => {
    const m = useMessages(recipeFormMessages);
    const headingText = mode === 'create' ? m.createHeading : m.editHeading;
    const submitLabel = mode === 'create' ? m.createSubmit : m.editSubmit;

    return (
        <form
            aria-label={headingText}
            onSubmit={(event) => {
                event.preventDefault();
                onSubmit();
            }}
            className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-8"
        >
            <h1 className="font-display text-display-md font-bold text-charcoal">{headingText}</h1>

            <RecipeBasicsFields values={values} errors={errors} onChange={onChange} />
            <RecipeIngredientsFields values={values} errors={errors} onChange={onChange} />
            <RecipeInstructionsFields values={values} errors={errors} onChange={onChange} />
            <RecipeVisibilityField values={values} onChange={onChange} />

            <div className="flex items-center gap-3">
                <Button type="submit" icon={<CheckIcon />} busy={submitting}>
                    {submitLabel}
                </Button>
                <Button variant="secondary" icon={<XIcon />} onPress={onCancel}>
                    {m.cancel}
                </Button>
            </div>
        </form>
    );
};
