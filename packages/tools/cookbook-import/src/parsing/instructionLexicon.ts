/**
 * @module instructionLexicon — the words of a cooking instruction (plan 001 §5): the imperative verbs that open one,
 * and the other words it can hold that name no food.
 *
 * DESIGN PATTERN: **Lexicon / lookup table behind pure total predicates**, the sibling of `recipe-import-core`'s
 * `notAFoodLexicon.ts` and `modifierLexicon.ts`. The lists are private: callers ask {@link isImperativeCookingVerb} or
 * {@link isMethodWord} a question and never hold the words, so no second copy of the vocabulary can drift. Vessels and
 * no-substance measures are NOT repeated here: `notAFoodLexicon.ts` owns them, and `lineAdmission.ts` asks it.
 *
 * ⛔ CONSERVATIVE BY CONSTRUCTION. A word that also names a food or opens an ingredient line is left out, however
 * often it opens a method line too: `cream`, `butter`, `salt`, `brown` (brown sugar), `roast` (roast beef), `toast`,
 * `stew` (stew meat), `mince`, `juice`, `zest`, `pinch`, `dash`, `slice`, `line` and `garnish` (`Garnish: parsley`)
 * all head real ingredient lines. Leaving a verb out costs only an instruction reaching the parser, which is the
 * behaviour without the gate; putting a homograph in skips an ingredient.
 *
 * ⚠️ A lexicon decides only the words it knows, and it is a DEFINITION, not a claim about English — the same stance
 * ADR-0026 KTD-11b takes against a POS tagger. Every word added here is measured over the corpora first (plan 001
 * §6), because a unit test cannot see a false refusal the corpus holds.
 */

/** Imperative verbs that open method lines and name no food. */
const IMPERATIVE_COOKING_VERBS: ReadonlySet<string> = new Set([
    'add',
    'arrange',
    'bake',
    'baste',
    'beat',
    'blanch',
    'blend',
    'boil',
    'braise',
    'bring',
    'broil',
    'brush',
    'chill',
    'chop',
    'combine',
    'cook',
    'cool',
    'cover',
    'cut',
    'dip',
    'discard',
    'dissolve',
    'divide',
    'drain',
    'dredge',
    'drop',
    'fold',
    'fry',
    'grate',
    'grease',
    'grill',
    'heat',
    'keep',
    'knead',
    'lay',
    'leave',
    'let',
    'lift',
    'melt',
    'mix',
    'moisten',
    'place',
    'poach',
    'pour',
    'preheat',
    'press',
    'put',
    'reduce',
    'remove',
    'repeat',
    'return',
    'roll',
    'rub',
    'scald',
    'scatter',
    'season',
    'serve',
    'set',
    'shape',
    'shake',
    'simmer',
    'skim',
    'soak',
    'spread',
    'sprinkle',
    'steam',
    'stir',
    'strain',
    'stuff',
    'take',
    'toss',
    'transfer',
    'turn',
    'wash',
    'whip',
    'whisk',
    'wipe',
    'work',
]);

/**
 * The words besides verbs, vessels and measures that a method line holds and that name no food: function words,
 * pronouns, adverbs, method adjectives and the few nouns of heat and place.
 *
 * ⛔ A food never goes here, and neither does a mixture of foods (`dough`, `batter`, `paste`, `cream`): the gate is
 * closed-world, so a word missing from this list lets the line through to the parser, and a food word added to it
 * skips an ingredient. `mixture` is here because it refers back to foods already listed and introduces none.
 */
const METHOD_WORDS: ReadonlySet<string> = new Set([
    // Articles, determiners and pronouns.
    'a',
    'an',
    'the',
    'this',
    'that',
    'these',
    'those',
    'it',
    'them',
    'they',
    'each',
    'every',
    'all',
    'some',
    'few',
    'little',
    'whole',
    'everything',
    'your',
    // Prepositions and particles.
    'in',
    'into',
    'on',
    'onto',
    'over',
    'under',
    'through',
    'with',
    'without',
    'for',
    'to',
    'from',
    'of',
    'at',
    'by',
    'about',
    'until',
    'till',
    'before',
    'after',
    'off',
    'out',
    'up',
    'down',
    'aside',
    'together',
    'around',
    'between',
    'again',
    'away',
    'back',
    // Conjunctions.
    'and',
    'or',
    'then',
    'while',
    'when',
    // Adverbs.
    'well',
    'thoroughly',
    'constantly',
    'slowly',
    'gently',
    'lightly',
    'briskly',
    'quickly',
    'carefully',
    'occasionally',
    'frequently',
    'often',
    'once',
    'twice',
    'longer',
    'more',
    'very',
    'just',
    'immediately',
    'rapidly',
    'closely',
    'tightly',
    'evenly',
    'fine',
    'finely',
    'hot',
    'cold',
    'warm',
    'cool',
    'moderate',
    'quick',
    'slow',
    'low',
    'high',
    'medium',
    'large',
    'small',
    'deep',
    'shallow',
    'heated',
    'greased',
    'covered',
    'clean',
    'dry',
    'smooth',
    'stiff',
    'thick',
    'thin',
    'flat',
    'wide',
    'firm',
    'tender',
    'done',
    'stand',
    // Nouns of heat, place and timing that are never a food. A vessel (`oven`, `stove`) is the not-a-food lexicon's.
    'fire',
    'heat',
    'place',
    'side',
    'top',
    'bottom',
    'edge',
    'center',
    'middle',
    'boil',
    'froth',
    'lid',
    'layer',
    'mixture',
]);

/**
 * Whether a word can sit in a method line and names no food. Pure and total.
 *
 * @param word - One word, in any case.
 * @returns `true` for a listed method word; `false` for anything else, every food included.
 */
export function isMethodWord(word: string): boolean {
    return METHOD_WORDS.has(word.toLowerCase());
}

/**
 * Whether a word is an imperative cooking verb that can open a method line. Pure and total.
 *
 * @param word - One word, in any case.
 * @returns `true` for a listed verb; `false` for anything else, a food homograph included.
 */
export function isImperativeCookingVerb(word: string): boolean {
    return IMPERATIVE_COOKING_VERBS.has(word.toLowerCase());
}
