/**
 * @module @commise/features-recipes/editor — the editor's four sections, and which section owns which validation field.
 *
 * One page holds Details · Ingredients · Steps · Photos & publish (build spec §7). This Registry is read by the section
 * index (its rows), the publish gate (where a refusal lands), the web hash (`/recipes/{id}/edit#ingredients`,
 * blueprint A16) and the native `section` route param. A section's id is also its heading's element id on web and its
 * section id in the native `ScrollHost`, so a deep link, a jump and the scroll spy name a section the same way.
 *
 * ⛔ {@link FIELD_SECTION} is the ONE statement of which section owns which field. It is a `Record` over the
 * validator's error keys, so a new validation field without a section is a compile error rather than an error the
 * index never shows.
 *
 * Pure and platform-agnostic. No React, no platform APIs.
 *
 * @pattern Registry — a closed `as const` tuple, its union, and a total map keyed by the validator's fields
 */
import type { RecipeFormErrors } from '../form/validate.js';

/** The editor's sections, in page order. */
export const EDITOR_SECTIONS = ['details', 'ingredients', 'steps', 'photos'] as const;

/** One editor section. */
export type EditorSectionId = (typeof EDITOR_SECTIONS)[number];

/** Which section each validation field belongs to. */
const FIELD_SECTION: Readonly<Record<keyof RecipeFormErrors, EditorSectionId>> = {
    title: 'details',
    servings: 'details',
    times: 'details',
    ingredients: 'ingredients',
    steps: 'steps',
};

/**
 * The section a validation field belongs to.
 *
 * @param field - A validation field.
 * @returns Its section. Pure.
 */
export function sectionOfField(field: keyof RecipeFormErrors): EditorSectionId {
    return FIELD_SECTION[field];
}

/**
 * The subset of `errors` that belongs to `section`. A key present with no code is no error.
 *
 * @param errors - Errors a gate already has.
 * @param section - The section to isolate.
 * @returns The section's own errors (empty when it holds none). Pure.
 */
export function errorsInSection(errors: RecipeFormErrors, section: EditorSectionId): RecipeFormErrors {
    // A null prototype: the keys are the validator's, but an accumulator indexed by keys never takes the `__proto__` setter.
    const inSection = Object.create(null) as RecipeFormErrors;

    for (const field of Object.keys(FIELD_SECTION) as (keyof RecipeFormErrors)[]) {
        const code = errors[field];

        if (code !== undefined && FIELD_SECTION[field] === section) {
            inSection[field] = code;
        }
    }

    return inSection;
}

/**
 * The first section, in page order, holding one of `errors`: where a refused Publish takes the cook (build spec §7.8,
 * WCAG 3.3.1).
 *
 * @param errors - The errors a gate refused with.
 * @returns The section, or `undefined` when nothing was refused. Pure.
 */
export function firstSectionWithErrors(errors: RecipeFormErrors): EditorSectionId | undefined {
    return EDITOR_SECTIONS.find((section) => Object.keys(errorsInSection(errors, section)).length > 0);
}

/**
 * Whether a string names an editor section.
 *
 * @param value - Any string, e.g. a route param.
 * @returns Whether it is one of {@link EDITOR_SECTIONS}. Pure.
 */
export function isEditorSectionId(value: string): value is EditorSectionId {
    return (EDITOR_SECTIONS as readonly string[]).includes(value);
}

/**
 * The section a URL hash names (blueprint A16): `#ingredients` → `ingredients`. Read once, on mount; the hash never
 * reaches the server.
 *
 * @param hash - `location.hash`, with or without its `#`.
 * @returns The section, or `undefined` for an empty or unknown hash. Pure.
 */
export function sectionFromHash(hash: string): EditorSectionId | undefined {
    const name = hash.startsWith('#') ? hash.slice(1) : hash;

    return isEditorSectionId(name) ? name : undefined;
}
