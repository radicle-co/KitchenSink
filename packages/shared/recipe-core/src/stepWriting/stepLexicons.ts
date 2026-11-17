/**
 * The closed lexicons the facts sheet reads steps with (spec 027 FR-035, FR-041, research R1): cooking verbs,
 * kitchen equipment, and the detectors of the seven safety categories.
 *
 * Each list is closed on purpose. A word outside it is not a fact, so it never reaches the writer, and a change to a
 * list is a reviewed change to what the writer is told. Safety terms carry a `fact` key. The sheet records the key,
 * never the step's words.
 *
 */
import type { SafetyCategory } from './factsSheet.types.js';

/**
 * The action lexicon: each verb in its base form, as it is written where an instruction starts ("Chop the onion."), lower
 * case, with the key the sheet records. A participle ("chopped") or a noun use is not an instruction, so no other form is
 * listed. One spelling belongs to one key, which a unit test holds.
 */
export const ACTION_VERBS: Readonly<Record<string, string>> = {
    preheat: 'preheat',
    heat: 'heat',
    melt: 'melt',
    boil: 'boil',
    simmer: 'simmer',
    sauté: 'sauté',
    fry: 'fry',
    sear: 'sear',
    brown: 'brown',
    roast: 'roast',
    bake: 'bake',
    grill: 'grill',
    broil: 'broil',
    steam: 'steam',
    poach: 'poach',
    blanch: 'blanch',
    toast: 'toast',
    chop: 'chop',
    dice: 'dice',
    slice: 'slice',
    mince: 'mince',
    grate: 'grate',
    peel: 'peel',
    trim: 'trim',
    cut: 'cut',
    mash: 'mash',
    crush: 'crush',
    mix: 'mix',
    stir: 'stir',
    whisk: 'whisk',
    beat: 'beat',
    fold: 'fold',
    blend: 'blend',
    knead: 'knead',
    roll: 'roll',
    shape: 'shape',
    spread: 'spread',
    pour: 'pour',
    add: 'add',
    combine: 'combine',
    drain: 'drain',
    rinse: 'rinse',
    wash: 'wash',
    dry: 'dry',
    season: 'season',
    sprinkle: 'sprinkle',
    coat: 'coat',
    toss: 'toss',
    marinate: 'marinate',
    rest: 'rest',
    cool: 'cool',
    chill: 'chill',
    freeze: 'freeze',
    thaw: 'thaw',
    cover: 'cover',
    uncover: 'uncover',
    remove: 'remove',
    transfer: 'transfer',
    place: 'place',
    serve: 'serve',
    garnish: 'garnish',
    reduce: 'reduce',
    thicken: 'thicken',
    deglaze: 'deglaze',
    strain: 'strain',
    sift: 'sift',
    squeeze: 'squeeze',
    flip: 'flip',
    turn: 'turn',
    stuff: 'stuff',
    layer: 'layer',
    brush: 'brush',
    glaze: 'glaze',
    dredge: 'dredge',
    saute: 'sauté',
};

/**
 * Adverbs that may come before an instruction's verb ("Gently stir"), lower case. The verb after them is still where the
 * instruction starts.
 */
export const INSTRUCTION_ADVERBS: ReadonlySet<string> = new Set([
    'gently',
    'slowly',
    'carefully',
    'quickly',
    'lightly',
    'briefly',
    'thoroughly',
    'well',
    'immediately',
    'first',
    'next',
    'finally',
    'then',
    'also',
    'just',
    'now',
    'meanwhile',
    'again',
]);

/**
 * Function words, lower case: articles, prepositions and conjunctions. A run of an ingredient name's last words counts as
 * a mention only at a sentence or clause edge, or between two of these.
 */
export const FUNCTION_WORDS: readonly string[] = [
    'a',
    'an',
    'the',
    'of',
    'to',
    'in',
    'into',
    'on',
    'onto',
    'with',
    'without',
    'and',
    'or',
    'then',
    'until',
    'for',
    'from',
    'over',
    'under',
    'through',
    'about',
    'by',
    'at',
    'as',
    'before',
    'after',
    'if',
    'while',
    'when',
    'plus',
];

/** The verbs that report a thermometer's reading, lower case. A doneness temperature is the one such a verb states. */
export const READING_VERBS: readonly string[] = ['read', 'reads', 'register', 'registers', 'reach', 'reaches'];

/**
 * The equipment lexicon: canonical singular names, lower case. A plural in a step matches too. Whisk and grill are not
 * listed: they are verbs first, and the action lexicon reads them.
 */
export const EQUIPMENT: readonly string[] = [
    'oven',
    'stove',
    'skillet',
    'frying pan',
    'saucepan',
    'pot',
    'pan',
    'wok',
    'baking sheet',
    'sheet pan',
    'baking dish',
    'casserole dish',
    'roasting tin',
    'cake tin',
    'loaf pan',
    'muffin tin',
    'bowl',
    'blender',
    'food processor',
    'mixer',
    'colander',
    'sieve',
    'steamer',
    'slow cooker',
    'pressure cooker',
    'thermometer',
    'rolling pin',
    'cutting board',
    'knife',
    'spatula',
    'ladle',
    'tongs',
    'foil',
    'parchment paper',
    'wire rack',
    'microwave',
];

/** The most words an ingredient name has. A longer line is a sentence, not a name. */
export const MAX_INGREDIENT_NAME_WORDS = 8;

/**
 * Words an ingredient name never holds, lower case: they join the steps of a method. A name holding one is step text.
 * A time ("10 minutes") is found from the time words, not listed here.
 */
export const INSTRUCTION_WORDS: ReadonlySet<string> = new Set(['then', 'until', 'preheat']);

/** One safety signal: the key the sheet records, and the phrases in a step that stand for it. */
export interface SafetyTerm {
    readonly fact: string;
    readonly phrases: readonly string[];
}

/**
 * One way a category fires. The rule fires when any of `anyOf` is in the step and, if `alsoNeeds` is given, any of
 * those too, and, if `needsTemperature` is set, the step states a temperature. Its facts are the matched keys, and for
 * `needsTemperature` the temperatures.
 */
export interface SafetyRule {
    readonly anyOf: readonly SafetyTerm[];
    readonly alsoNeeds?: readonly SafetyTerm[];
    readonly needsTemperature?: true;
}

/** A term; its phrases default to its key. */
const term = (fact: string, ...phrases: string[]): SafetyTerm => ({
    fact,
    phrases: phrases.length > 0 ? phrases : [fact],
});

/**
 * The seven categories of FR-041 and how each is detected. The keys come from `SAFETY_CATEGORIES`, so a category added
 * there without a rule here fails to compile.
 */
export const SAFETY_RULES: Readonly<Record<SafetyCategory, readonly SafetyRule[]>> = {
    internalTemperature: [
        {
            anyOf: [
                term('thermometer', 'thermometer', 'probe'),
                term('internal', 'internal temperature', 'internal'),
                term('doneness'),
            ],
            needsTemperature: true,
        },
    ],
    rawFood: [
        {
            anyOf: [term('raw'), term('uncooked'), term('undercooked', 'undercooked', 'under cooked')],
            alsoNeeds: [
                term('chicken'),
                term('poultry'),
                term('turkey'),
                term('meat'),
                term('beef'),
                term('pork'),
                term('lamb'),
                term('fish'),
                term('salmon'),
                term('egg'),
                term('flour'),
            ],
        },
    ],
    hotOil: [
        {
            anyOf: [
                term('hot oil', 'hot oil', 'hot fat'),
                term('deep fry', 'deep fry', 'deep fried', 'deep frying', 'deep fat'),
            ],
        },
    ],
    pressureCanningFermenting: [
        {
            anyOf: [
                term(
                    'pressure cook',
                    'pressure cook',
                    'pressure cooker',
                    'pressure cooking',
                    'pressure cooked',
                    'instant pot',
                ),
                term('canning', 'canning', 'pressure canner', 'water bath'),
                term('ferment', 'ferment', 'fermenting', 'fermented', 'fermentation'),
            ],
        },
    ],
    flameAlcohol: [
        { anyOf: [term('flambé', 'flambé', 'flambe', 'flambéed', 'flambeed')] },
        {
            anyOf: [
                term('flame', 'flame', 'flames', 'flaming'),
                term('ignite', 'ignite', 'ignited', 'igniting', 'set alight'),
            ],
            alsoNeeds: [
                term('brandy'),
                term('rum'),
                term('whisky', 'whisky', 'whiskey'),
                term('vodka'),
                term('liqueur'),
                term('cognac'),
                term('wine'),
            ],
        },
    ],
    allergen: [
        {
            anyOf: [
                term('peanut'),
                term('treeNut', 'almond', 'walnut', 'cashew', 'pecan', 'hazelnut', 'pistachio', 'macadamia'),
                term('milk'),
                term('egg'),
                term('wheat'),
                term('soy', 'soy', 'soya'),
                term('fish'),
                term('shellfish', 'shellfish', 'shrimp', 'prawn', 'crab', 'lobster'),
                term('sesame'),
                term('mustard'),
            ],
        },
    ],
    warning: [{ anyOf: [term('doNot', 'do not', "don't", 'dont'), term('never'), term('discard')] }],
};
