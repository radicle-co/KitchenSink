/**
 * @module @commise/features-recipes/form — what the row editor's Unit combobox suggests (build spec §7.5.2): the units
 * recipe-core recognises that start with what the cook typed.
 *
 * ⚠️ It suggests from the RECOGNITION vocabulary (`UNIT_VOCABULARY` and `SUBJECTIVE_UNIT_VOCABULARY`), which includes
 * period units such as `gill`. recipe-core records that narrowing what is suggested is a product decision for the
 * surface that suggests; none has been made, so nothing is hidden here. The field itself takes any text.
 *
 * Pure and platform-agnostic.
 */
import { SUBJECTIVE_UNIT_VOCABULARY, UNIT_VOCABULARY } from '@kitchensink/recipe-core';

/** The most units the list shows at once. */
export const UNIT_SUGGESTION_LIMIT = 8;

const UNITS: readonly string[] = [...UNIT_VOCABULARY, ...SUBJECTIVE_UNIT_VOCABULARY];

/**
 * The units to suggest for the field's text. Pure.
 *
 * @param text - The field's text.
 * @returns Up to {@link UNIT_SUGGESTION_LIMIT} units that start with it, case folded; none for an empty field.
 */
export const unitSuggestionsOf = (text: string): readonly string[] => {
    const typed = text.trim().toLowerCase();

    if (typed === '') {
        return [];
    }

    return UNITS.filter((unit) => unit.toLowerCase().startsWith(typed)).slice(0, UNIT_SUGGESTION_LIMIT);
};
