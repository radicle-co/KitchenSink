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

/** The four inflections of a regular verb: `chop` with `double` gives chop, chops, chopped, chopping. */
function inflect(base: string, options: { readonly double?: boolean } = {}): readonly string[] {
    if (base.endsWith('e')) {
        return [base, `${base}s`, `${base}d`, `${base.slice(0, -1)}ing`];
    }

    if (base.endsWith('y') && !/[aeiou]y$/u.test(base)) {
        return [base, `${base.slice(0, -1)}ies`, `${base.slice(0, -1)}ied`, `${base}ing`];
    }

    const stem = options.double === true ? `${base}${base.slice(-1)}` : base;
    const plural = /(?:s|x|ch|sh)$/u.test(base) ? `${base}es` : `${base}s`;

    return [base, plural, `${stem}ed`, `${stem}ing`];
}

/**
 * The action lexicon: each canonical verb and every spelling that stands for it, lower case. One spelling belongs to
 * one verb, which a unit test holds.
 */
export const ACTION_VERBS: Readonly<Record<string, readonly string[]>> = {
    preheat: inflect('preheat'),
    heat: inflect('heat'),
    melt: inflect('melt'),
    boil: inflect('boil'),
    simmer: inflect('simmer'),
    sauté: [...inflect('sauté'), 'saute', 'sautes', 'sauteed', 'sauteing'],
    fry: inflect('fry'),
    sear: inflect('sear'),
    brown: inflect('brown'),
    roast: inflect('roast'),
    bake: inflect('bake'),
    grill: inflect('grill'),
    broil: inflect('broil'),
    steam: inflect('steam'),
    poach: inflect('poach'),
    blanch: inflect('blanch'),
    toast: inflect('toast'),
    chop: inflect('chop', { double: true }),
    dice: inflect('dice'),
    slice: inflect('slice'),
    mince: inflect('mince'),
    grate: inflect('grate'),
    peel: inflect('peel'),
    trim: inflect('trim', { double: true }),
    cut: ['cut', 'cuts', 'cutting'],
    mash: inflect('mash'),
    crush: inflect('crush'),
    mix: inflect('mix'),
    stir: inflect('stir', { double: true }),
    whisk: inflect('whisk'),
    beat: [...inflect('beat'), 'beaten'],
    fold: inflect('fold'),
    blend: inflect('blend'),
    knead: inflect('knead'),
    roll: inflect('roll'),
    shape: inflect('shape'),
    spread: ['spread', 'spreads', 'spreading'],
    pour: inflect('pour'),
    add: inflect('add'),
    combine: inflect('combine'),
    drain: inflect('drain'),
    rinse: inflect('rinse'),
    wash: inflect('wash'),
    dry: inflect('dry'),
    season: inflect('season'),
    sprinkle: inflect('sprinkle'),
    coat: inflect('coat'),
    toss: inflect('toss'),
    marinate: inflect('marinate'),
    rest: inflect('rest'),
    cool: inflect('cool'),
    chill: inflect('chill'),
    freeze: ['freeze', 'freezes', 'froze', 'frozen', 'freezing'],
    thaw: inflect('thaw'),
    cover: inflect('cover'),
    uncover: inflect('uncover'),
    remove: inflect('remove'),
    transfer: inflect('transfer', { double: true }),
    place: inflect('place'),
    serve: inflect('serve'),
    garnish: inflect('garnish'),
    reduce: inflect('reduce'),
    thicken: inflect('thicken'),
    deglaze: inflect('deglaze'),
    strain: inflect('strain'),
    sift: inflect('sift'),
    squeeze: inflect('squeeze'),
    flip: inflect('flip', { double: true }),
    turn: inflect('turn'),
    stuff: inflect('stuff'),
    layer: inflect('layer'),
    brush: inflect('brush'),
    glaze: inflect('glaze'),
    dredge: inflect('dredge'),
};

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
