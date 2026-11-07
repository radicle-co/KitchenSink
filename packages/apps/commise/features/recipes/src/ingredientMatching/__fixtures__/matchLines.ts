/**
 * @module @commise/features-recipes/ingredientMatching/__fixtures__ — one matched line per state, from the boards'
 * bread pudding (RecipeEditorPasteChoose) and Lemon drizzle cake (feature 004 WizardStep), for the model, view and
 * component tests of both flows.
 */
import type { FoodChoice, LineBinding, MatchLine } from '../matchLine.js';

/** The line of one state. */
type LineOf<State extends MatchLine['state']> = Extract<MatchLine, { readonly state: State }>;

/** Milk's options, as the server orders them: the default is NOT first, so a test can see the client never re-sorts. */
export const MILKS: readonly FoodChoice[] = [
    { id: 'skim', name: 'Skim milk', isDefault: false },
    { id: 'whole', name: 'Whole milk', isDefault: true },
    { id: 'oat', name: 'Oat milk', isDefault: false, detailParts: ['unsweetened'] },
];

/** A food choice. */
export function makeFoodChoice(overrides: Partial<FoodChoice> & Pick<FoodChoice, 'id' | 'name'>): FoodChoice {
    return { isDefault: false, ...overrides };
}

/** The cook's pick of a food. */
export function cookPicked(
    food: FoodChoice,
    reviewNote: { suggestedFood: string; reason: string } | undefined = undefined,
): LineBinding {
    return { boundBy: 'cook', pick: { kind: 'food', foodId: food.id, name: food.name }, reviewNote };
}

/** An open default line: "2 cups milk". */
export function makeDefaultLine(overrides: Partial<Omit<LineOf<'default'>, 'state'>> = {}): LineOf<'default'> {
    return {
        key: 'milk',
        line: { measure: '2 cups', words: 'milk' },
        state: 'default',
        noun: 'milk',
        candidates: MILKS,
        binding: undefined,
        ...overrides,
    };
}

/** An open line with more than one fitting food and no default: "6 slices day-old bread". */
export function makeNeedsChoiceLine(
    overrides: Partial<Omit<LineOf<'needsChoice'>, 'state'>> = {},
): LineOf<'needsChoice'> {
    return {
        key: 'bread',
        line: { measure: '6 slices', words: 'day-old bread' },
        state: 'needsChoice',
        candidates: [
            { id: 'b-white', name: 'White bread, sliced', isDefault: false },
            { id: 'b-brioche', name: 'Brioche', isDefault: false },
        ],
        binding: undefined,
        ...overrides,
    };
}

/** An open line with no food found: "1 tsp spice mix". */
export function makeNoMatchLine(overrides: Partial<Omit<LineOf<'noMatch'>, 'state'>> = {}): LineOf<'noMatch'> {
    return {
        key: 'spice',
        line: { measure: '1 tsp', words: 'spice mix' },
        state: 'noMatch',
        binding: undefined,
        ...overrides,
    };
}

/** A line still being checked: "1/2 cup heavy cream". */
export function makeCheckingLine(overrides: Partial<Omit<LineOf<'checking'>, 'state'>> = {}): LineOf<'checking'> {
    return {
        key: 'cream',
        line: { measure: '1/2 cup', words: 'heavy cream' },
        state: 'checking',
        proposal: 'Heavy whipping cream',
        binding: undefined,
        ...overrides,
    };
}

/** A confident line, bound on arrival by the server: "eggs". */
export function makeConfidentLine(overrides: Partial<Omit<LineOf<'confident'>, 'state'>> = {}): LineOf<'confident'> {
    return {
        key: 'eggs',
        line: { measure: '', words: 'eggs' },
        state: 'confident',
        candidates: [],
        binding: { boundBy: 'server', pick: { kind: 'food', foodId: 'egg', name: 'Egg, whole, raw' } },
        ...overrides,
    };
}

/** A line whose options did not load: "2 cups milk". */
export function makeOptionsFailedLine(
    overrides: Partial<Omit<LineOf<'optionsFailed'>, 'state'>> = {},
): LineOf<'optionsFailed'> {
    return {
        key: 'milk',
        line: { measure: '2 cups', words: 'milk' },
        state: 'optionsFailed',
        binding: undefined,
        ...overrides,
    };
}
