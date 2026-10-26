/**
 * @module @commise/features-recipes/form — the ONE rule for a food option's accessible name, shared by every list that
 * offers foods to choose (the paste list now; the "Add an ingredient" picker once the wire carries `isDefault`): the
 * food's name, then its variant's parts in the picker's existing words (`suggestionWithDetails`), then the Default tag
 * on the default food only — the order the eye reads them, so the name starts with the visible label (WCAG 2.5.3).
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

/** The two templates the rule reads. */
export interface FoodChoiceNameCopy {
    /** `{food}, {parts}` (`IngredientDetailsMessages.suggestionWithDetails`). */
    readonly suggestionWithDetails: string;
    /** `{food}, Default` (`RecipeFormMessages.foodSearch.defaultOptionName`). */
    readonly defaultOptionName: string;
}

/**
 * A food option's accessible name. Pure.
 *
 * @param food - The food.
 * @param copy - The localised templates.
 * @returns The name.
 */
export const foodChoiceNameOf = (food: NamedFoodChoice, copy: FoodChoiceNameCopy): string => {
    const withParts =
        food.detailParts === undefined
            ? food.name
            : fillTemplate(copy.suggestionWithDetails, { food: food.name, parts: food.detailParts.join(', ') });

    return food.isDefault ? fillTemplate(copy.defaultOptionName, { food: withParts }) : withParts;
};
