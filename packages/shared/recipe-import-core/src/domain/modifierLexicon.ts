/**
 * @module modifierLexicon — the vocabulary KTD-11b's ruling is made of.
 *
 * DESIGN PATTERN: **Lexicon / lookup table behind a pure total function**, the sibling of
 * `quantityWords.ts` — a vocabulary is a piece of knowledge, and it is filed apart from the policy that
 * consumes it (`parseComparator.ts`) for the reason §1 gives: a file that is a policy AND a word list is
 * two files wearing one name. Nothing here is on the package barrel; the classification is an
 * implementation detail of the comparator, exactly as `WHOLE_NUMBER_WORDS` is of the pre-normalizer.
 *
 * ## The ruling this carries (KTD-11b, owner ruling 2026-08-23)
 *
 *  - a **past participle is preparation** — `chopped`, `grated`, `melted`, `sifted`, `minced`, `stoned`,
 *    `beaten`;
 *  - an **adjective is identity** — `sweet`, `brown`, `pastry`, `Russian`, `fresh`, `red`, `green`, and
 *    `large`/`small`, which is why `ParsedLine` has no `size` member (U16);
 *  - **temperature is preparation** — `hot`, `cold`, `boiling`, `lukewarm`, `warm`.
 *
 * ⛔ **THIS IS A DEFINITION, NOT A CLAIM ABOUT ENGLISH**, and that is precisely why no part-of-speech
 * tagger can implement it. See the library-first note below before proposing one.
 *
 * ## ⛔ LIBRARY-FIRST: what was checked, and why a POS tagger was rejected (measured 2026-08-24)
 *
 * KTD-11b says "the CRF package already ships one". It does not, quite: `ingredient-parser-nlp` 2.3.0
 * ships a **CRF** tagger (`pycrfsuite`) for ingredient COMPONENTS and depends on **NLTK's**
 * `averaged_perceptron_tagger_eng`, which it calls in `en/preprocess.py` to build a `pos` FEATURE for that
 * CRF. So the part-of-speech tagger is NLTK's, it is Python, and it lives behind the CRF Lambda — three
 * reasons a pure, total, no-I/O policy in this package cannot reach it, and a JS re-implementation would
 * be a DIFFERENT tagger with different errors.
 *
 * The decisive reason is not availability, though. NLTK's tagger was run over the ruling's own vocabulary
 * and it **contradicts the ruling on 7 of 25 words**, in both directions:
 *
 * | word      | NLTK, in `"<word> onions"` | KTD-11b       |
 * | --------- | -------------------------- | ------------- |
 * | `chopped` | `JJ` (adjective)           | preparation   |
 * | `beaten`  | `JJ`                       | preparation   |
 * | `cut`     | `NN` (noun)                | preparation   |
 * | `ground`  | `NN`                       | preparation   |
 * | `hot`     | `JJ`                       | preparation   |
 * | `cold`    | `JJ`                       | preparation   |
 * | `warm`    | `JJ`                       | preparation   |
 *
 * The temperature row is the one that settles it: `hot` IS an adjective, to every tagger and to every
 * grammar, and KTD-11b files it as preparation **deliberately**. A tagger cannot be wrong about that
 * because it is not the same question. An explicit vocabulary is therefore the correct tool, and it is
 * what the ruling itself asks for: "the vocabulary needs an explicit irregular list (`cut`, `ground`,
 * `beaten`) plus an adjective exception list."
 *
 * ⚠️ Accepted limit, stated rather than hidden: a lexicon only decides the words it knows. Everything else
 * comes back `unclassified` (see {@link ModifierRole}) and is left exactly where the engine put it, which is the
 * safe direction — an unclassified word cannot be moved into the wrong field, it can only fail to settle a
 * disagreement that then reaches the adjudication list (U23) as it would have anyway.
 */

/**
 * What KTD-11b says a modifier word IS.
 *
 * `qualifier` is not part of the ruling; it is the machinery the ruling needs. `finely` in
 * `finely chopped` has no home of its own — it belongs wherever `chopped` goes — so it is marked rather
 * than decided, and `parseComparator.ts` moves it with the word it qualifies. Filing it as
 * identity would leave `finely onions`; filing it as preparation would strand it when it qualifies an
 * adjective.
 */
export type ModifierRole = 'preparation' | 'identity' | 'qualifier' | 'unclassified';

/**
 * Temperatures. ⛔ Every one is an adjective; KTD-11b files them as preparation anyway, which is the
 * middle case the ruling says it committed to deliberately.
 */
const TEMPERATURES: ReadonlySet<string> = new Set([
    'boiling',
    'chilled',
    'cold',
    'frozen',
    'hot',
    'iced',
    'lukewarm',
    'scalding',
    'tepid',
    'warm',
]);

/**
 * Past participles the `-ed` suffix rule below cannot see.
 *
 * ⛔ TRAP 2, hit while the ruling was verified: "`-ed` alone is not a participle test". `cut` does not
 * inflect at all, `ground` and `beaten` are irregular, and every one of them is a word this corpus uses
 * constantly (`ground almonds`, `cut dates`, `beaten eggs`). Without this list they stay unclassified and
 * the placement canonicalisation never fires on them.
 */
const IRREGULAR_PARTICIPLES: ReadonlySet<string> = new Set([
    'beaten',
    'broken',
    'cut',
    'drawn',
    'ground',
    'shaken',
    'split',
    'torn',
]);

/**
 * Adjectives — identity under KTD-11b.
 *
 * ⛔ TRAP 1, and the reason this set is consulted BEFORE the `-ed` suffix rule: `red` and `green` end in
 * `-ed`/`-en` and are COLOURS. A suffix test files them as preparation, which asks the catalog to resolve
 * `peppers` where the line said `red peppers` — a different ingredient.
 *
 * The size words are here for the reason U16 gives: the CRF emits a `size` field, `ParsedLine` has no slot
 * for it, and `large` is an adjective. There is no exception for `large` that does not also reopen
 * `sweet`, `brown` and `Italian`, so it is canonicalised into the name by the ordinary rule rather than by
 * a special case.
 */
const ADJECTIVES: ReadonlySet<string> = new Set([
    // colours — trap 1
    'black',
    'blue',
    'brown',
    'golden',
    'green',
    'orange',
    'pink',
    'purple',
    'red',
    'white',
    'yellow',
    // size — the CRF's `size` field, U16
    'big',
    'large',
    'little',
    'medium',
    'small',
    'tiny',
    // origin
    'american',
    'chinese',
    'danish',
    'dutch',
    'english',
    'french',
    'german',
    'greek',
    'indian',
    'irish',
    'italian',
    'russian',
    'scotch',
    'scottish',
    'spanish',
    'swiss',
    'turkish',
    // the rest of what a period cookbook uses to say WHICH food this is
    'bitter',
    'coarse',
    'dark',
    'dry',
    'fine',
    'fresh',
    'light',
    'new',
    'old',
    'pastry',
    'plain',
    'raw',
    'rich',
    'ripe',
    'sharp',
    'sour',
    'stale',
    'strong',
    'sweet',
    'thick',
    'thin',
    'unripe',
    'weak',
    'whole',
    'wild',
    'young',
]);

/** Adverbs that qualify a modifier without being one. `-ly` catches the rest. */
const QUALIFIERS: ReadonlySet<string> = new Set(['well']);

/** Everything that is not a letter, a digit or an internal hyphen — punctuation an engine carried along. */
const NON_WORD_EDGE = /^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu;

/**
 * Reduce a word to the form the sets are keyed on.
 *
 * @param word - The word as an engine returned it.
 * @returns Lower-cased and stripped of leading/trailing punctuation. Pure.
 */
function fold(word: string): string {
    return word.trim().toLowerCase().replace(NON_WORD_EDGE, '');
}

/**
 * The part of a hyphenated compound that decides it.
 *
 * `well-beaten` is preparation because `beaten` is; `wine-glass` is unclassified because `glass` is. The
 * head of an English compound modifier is its last element, so reading the compound by its last segment
 * costs nothing and stops the whole compound falling through as an unknown word.
 *
 * @param word - An already-folded word.
 * @returns The final hyphen-separated segment, or the word itself. Pure.
 */
function head(word: string): string {
    const lastHyphen = word.lastIndexOf('-');

    return lastHyphen > 0 && lastHyphen < word.length - 1 ? word.slice(lastHyphen + 1) : word;
}

/**
 * Classify one modifier word under KTD-11b.
 *
 * ⛔ THE ORDER OF THESE TESTS IS THE RULING. The adjective set is consulted before the `-ed` suffix rule,
 * because that is what keeps `red` a colour; the irregular list is consulted at all, because that is what
 * makes `ground` a participle.
 *
 * @param word - The word as an engine returned it — any case, with or without trailing punctuation.
 * @returns Its role. `unclassified` for every word the lexicon does not know, which is the safe answer:
 *   the comparator leaves such a word exactly where the engine put it. Pure and TOTAL.
 */
export function classifyModifier(word: string): ModifierRole {
    const folded = fold(word);

    if (folded === '') {
        return 'unclassified';
    }

    const key = head(folded);

    if (TEMPERATURES.has(key) || IRREGULAR_PARTICIPLES.has(key)) {
        return 'preparation';
    }

    if (ADJECTIVES.has(key)) {
        return 'identity';
    }

    if (QUALIFIERS.has(key) || (key.endsWith('ly') && key.length > 3)) {
        return 'qualifier';
    }

    if (key.endsWith('ed') && key.length > 3) {
        return 'preparation';
    }

    return 'unclassified';
}
