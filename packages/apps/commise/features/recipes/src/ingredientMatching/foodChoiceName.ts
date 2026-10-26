/**
 * @module @commise/features-recipes/ingredientMatching — the ONE rule for a food option's accessible name, shared by
 * every list that offers foods to choose: the matching lists of both flows, and the "Add an ingredient" picker
 * (`form/entryCombobox.ts`). The food's name, then its variant's parts in the picker's existing words
 * (`suggestionWithDetails`), then the Default tag on the default food only — the order the eye reads them, so the name
 * starts with the visible label (WCAG 2.5.3). The tag's word is the one `defaultTag` key the badge draws, so the name and
 * the badge cannot say two different words.
 *
 * Pure and platform-agnostic.
 */
import { fillTemplate } from '../format/fillTemplate.js';

/** The food being named. */
export interface NamedFoodChoice {
    readonly name: string;
    readonly detailParts: readonly [string, ...string[]] | undefined;
    readonly isDefault: boolean;
}

/** The templates the rule reads. */
export interface FoodChoiceNameCopy {
    /** `{food}, {parts}` (`IngredientDetailsMessages.suggestionWithDetails`). */
    readonly suggestionWithDetails: string;
    /** `{food}, {tag}` (`MatchLineMessages.defaultOptionName`). */
    readonly defaultOptionName: string;
    /** The tag's word (`MatchLineMessages.defaultTag`), the same one the badge draws. */
    readonly defaultTag: string;
}

/**
 * A food's name with its variant's parts, in the picker's existing words (`suggestionWithDetails`): the first half of
 * every food option's name, and the whole of it where no default tag can apply (the picker's catalog options, whose
 * search wire carries no `isDefault` yet). Pure.
 *
 * @param name - The food's name.
 * @param detailParts - Its variant's parts, if any.
 * @param suggestionWithDetails - `{food}, {parts}`.
 * @returns The name, with the parts after it.
 */
export const foodNameWithPartsOf = (
    name: string,
    detailParts: readonly [string, ...string[]] | undefined,
    suggestionWithDetails: string,
): string =>
    detailParts === undefined
        ? name
        : fillTemplate(suggestionWithDetails, { food: name, parts: detailParts.join(', ') });

/**
 * A food option's accessible name: its name and parts, then the Default tag on the default food only. Pure.
 *
 * @param food - The food.
 * @param copy - The localised templates.
 * @returns The name.
 */
export const foodChoiceNameOf = (food: NamedFoodChoice, copy: FoodChoiceNameCopy): string => {
    const withParts = foodNameWithPartsOf(food.name, food.detailParts, copy.suggestionWithDetails);

    return food.isDefault ? fillTemplate(copy.defaultOptionName, { food: withParts, tag: copy.defaultTag }) : withParts;
};
