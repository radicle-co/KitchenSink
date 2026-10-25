/**
 * @module @commise/features-recipes/import/__fixtures__ — the boards' Lemon drizzle cake (feature 004 WizardStep) as
 * import lines, one per state, for the web and native component tests.
 */
import type { ImportCandidate, ImportLine } from '../importLine.js';

/** The line of one state. */
type LineOf<State extends ImportLine['state']> = Extract<ImportLine, { readonly state: State }>;

/** The flour line's candidates: the default first, as the server orders them. */
export const FLOUR_CANDIDATES: readonly ImportCandidate[] = [
    { id: 'f-ap', name: 'All-purpose flour', isDefault: true },
    { id: 'f-sr', name: 'Self-raising flour', isDefault: false },
    { id: 'f-cake', name: 'Cake flour', isDefault: false },
];

/** A bound line. */
export function makeConfidentLine(overrides: Partial<Omit<LineOf<'confident'>, 'state'>> = {}): LineOf<'confident'> {
    return {
        key: 'butter',
        text: '225 g butter, softened',
        state: 'confident',
        food: 'Butter, unsalted',
        candidates: [],
        ...overrides,
    };
}

/** An open default line. */
export function makeDefaultLine(overrides: Partial<Omit<LineOf<'default'>, 'state'>> = {}): LineOf<'default'> {
    return {
        key: 'flour',
        text: '275 g flour',
        state: 'default',
        noun: 'flour',
        candidates: FLOUR_CANDIDATES,
        ...overrides,
    };
}

/** A line still being checked. */
export function makeCheckingLine(overrides: Partial<Omit<LineOf<'checking'>, 'state'>> = {}): LineOf<'checking'> {
    return { key: 'lemons', text: '2 lemons, zest only', state: 'checking', proposal: 'Lemon peel, raw', ...overrides };
}

/** An open line with more than one fitting food. */
export function makeNeedsChoiceLine(
    overrides: Partial<Omit<LineOf<'needsChoice'>, 'state'>> = {},
): LineOf<'needsChoice'> {
    return {
        key: 'bread',
        text: '6 slices day-old bread',
        state: 'needsChoice',
        candidates: [
            { id: 'b-white', name: 'White bread, sliced', isDefault: false },
            { id: 'b-brioche', name: 'Brioche', isDefault: false },
        ],
        ...overrides,
    };
}

/** An open line with no food found. */
export function makeNoMatchLine(overrides: Partial<Omit<LineOf<'noMatch'>, 'state'>> = {}): LineOf<'noMatch'> {
    return { key: 'syrup', text: '4 tbsp drizzle syrup', state: 'noMatch', ...overrides };
}
