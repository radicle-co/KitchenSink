/**
 * v1's golden set (qse F-5). Every text here is OUR OWN, written for this file: never a source's text, a paid site's
 * or a cook's (R1a). Each case states the answer v1 gave when it was frozen. A changed answer fails
 * `goldenV1.test.ts`; a real change of the measure is a new version with its own set, never an edit of this one.
 *
 * Three base recipes, each in the cook's own steps. The rewrites are written independently of the base text; the
 * mechanical edits are derived from it by the named transform, so the derivation is part of the frozen case.
 */

import { seededDraw, synthWord } from './synthetic.js';

/** One golden pair and the answer v1 gives for it. */
export interface GoldenCase {
    /** A short name, unique in the set. */
    readonly name: string;
    /** The stored original steps text. */
    readonly baseline: string;
    /** The cook's new steps text. */
    readonly steps: string;
    /** Whether v1 passes the pair, written by hand from the edit's nature before the measure existed. */
    readonly pass: boolean;
}

export const SAUCE_BASE =
    'Heat the olive oil in a heavy pan over a medium flame. Add the chopped onion and cook it slowly until it turns soft and golden, which takes about eight minutes. Stir in two cloves of garlic and a tin of tomatoes, then let the sauce simmer gently for twenty minutes until thick. Season with salt and black pepper, tear in the basil leaves and serve over hot pasta.';

export const PANCAKE_BASE =
    'Sift the flour and a pinch of salt into a large bowl and make a well in the middle. Whisk the eggs with the milk and pour a little into the well, beating until the batter is smooth with no lumps. Rest the batter for thirty minutes. Heat a lightly greased frying pan, pour in a thin layer of batter and tilt the pan so it spreads evenly. Cook until the underside is golden, flip, and cook the other side for one minute.';

export const ROOTS_BASE =
    'Preheat the oven to 220 degrees. Peel the carrots and parsnips and cut them into thick batons of the same size. Toss them in a roasting tin with oil, a good pinch of salt and a few sprigs of thyme. Roast for forty minutes, turning once, until the edges are dark and crisp. Drizzle with honey for the last five minutes and serve hot.';

/** Genuine rewrites: the same dish, independent words. */
const REWRITES: Readonly<Record<string, readonly string[]>> = {
    sauce: [
        'Warm a splash of oil in your widest saucepan. Soften a diced onion without letting it colour, then add crushed garlic and canned plum tomatoes. Leave everything bubbling quietly for about twenty minutes, stirring now and then, and finish with a handful of torn basil, plenty of seasoning and cooked spaghetti.',
        'Start by sweating the onions in oil on a gentle heat. Once translucent, drop in garlic, tomatoes and a pinch of sugar to take the edge off. Reduce the mixture until it coats a spoon, taste for salt, and toss through freshly boiled pasta with basil on top.',
        'Onions first: fry them in olive oil until they look glossy and sweet. Garlic goes in next, then the tomatoes. Simmer until the sauce has lost its wateriness, season it boldly, and spoon it over whatever pasta you have, scattering basil as a last step.',
        'Pour oil into a frying pan and cook finely sliced onion over low heat until tender. Mix in garlic and chopped tomatoes, cover, and leave to bubble for twenty minutes. Uncover for the final five to thicken, add pepper and salt, and combine with pasta and fresh basil.',
        'Gentle heat, good oil and patience are the whole secret here. Cook the onion down until sweet, stir through garlic and tomatoes, and let time do the work. When the sauce is thick, add seasoning and basil and ladle it over pasta.',
    ],
    pancakes: [
        'Put flour and salt in a mixing bowl, hollow out the centre and crack the eggs inside. Add milk gradually while whisking from the middle outwards so no lumps form. Let the mixture stand for half an hour, then fry thin rounds in a buttered skillet, turning each when its base colours.',
        'Make a smooth batter by beating together flour, eggs, milk and a little salt. Leave it alone for thirty minutes. Brush a hot pan with fat, swirl in just enough batter to cover the bottom, and flip the pancake after a minute or so once golden.',
        'Combine the dry ingredients first, then whisk in eggs and milk a little at a time until the mixture runs off the whisk like cream. Allow it to sit. Pour a ladle into a hot, oiled pan, rotate to spread it thin, and turn it over when set.',
        'Whisk eggs and milk, tip them onto the flour and salt, and beat until silky. After a half hour rest, heat a greased pan, add a thin ladleful, and cook one side until golden before flipping to finish the other for around sixty seconds.',
        'A good pancake needs a rested batter. Mix flour, salt, eggs and milk until completely smooth, wait thirty minutes, and then cook in a very hot greased pan, tipping the pan so the batter reaches the edges before turning.',
    ],
    roots: [
        'Set the oven very hot. Scrub or peel carrots and parsnips, slice them into chunky sticks and tumble them in a tray with oil, salt and thyme. Cook for around forty minutes, shaking the tray halfway, and brush with honey near the end before serving warm.',
        'Heat the oven to 220. Cut your carrots and parsnips into fat fingers, coat them in oil and season well, scatter thyme over the top and roast until deeply browned at the edges, turning them once. A drizzle of honey in the closing minutes gives a sticky glaze.',
        'Roots like these roast best at a high temperature. Chop them evenly, dress with oil, salt and woody thyme, and spread out in a single layer. Turn them after twenty minutes, keep going until crisp, then finish with a little honey and bring to the table.',
        'Trim and peel parsnips and carrots, then batons of equal thickness in a roasting dish with thyme, salt and a good glug of oil. Into a very hot oven for forty minutes, stirring once. Honey over the top for the last few minutes makes them glossy.',
        'Peeled carrots, parsnips, plenty of oil, some thyme: that is all you need. Cut the vegetables into similar sticks so they cook together, roast them hard until the ends char slightly, and add honey just before they come out.',
    ],
};

/** The base each rewrite set belongs to. */
const BASES: Readonly<Record<string, string>> = { sauce: SAUCE_BASE, pancakes: PANCAKE_BASE, roots: ROOTS_BASE };

/** A mechanical edit: a named transform of the base text that v1 must NOT pass. */
interface Transform {
    readonly name: string;
    readonly apply: (text: string) => string;
}

/** Plain letters and their Cyrillic look-alikes (a, c, e, o, p, x). */
const LOOK_ALIKES: Readonly<Record<string, string>> = {
    a: 'а',
    c: 'с',
    e: 'е',
    o: 'о',
    p: 'р',
    x: 'х',
};

/** Words swapped for a near synonym: about one word in three of the text, the spinner's edit. */
const SYNONYMS: Readonly<Record<string, string>> = {
    heat: 'warm',
    add: 'put',
    cook: 'prepare',
    stir: 'mix',
    slowly: 'gently',
    large: 'big',
    thick: 'dense',
    serve: 'plate',
    hot: 'warm',
    pour: 'tip',
    cut: 'slice',
    peel: 'skin',
    until: 'till',
    golden: 'brown',
    thin: 'fine',
};

const TRANSFORMS: readonly Transform[] = [
    {
        name: 'a copy with every number changed',
        apply: (text) =>
            text.replace(/\b(eight|twenty|thirty|forty|two|one|five|220)\b/g, (word) =>
                word === '220' ? '180' : 'ten',
            ),
    },
    { name: 'the same text in capitals', apply: (text) => text.toUpperCase() },
    {
        name: 'a typo in every sixth word',
        apply: (text) =>
            text
                .split(' ')
                .map((word, index) =>
                    index % 6 === 0 && word.length > 3
                        ? `${word.slice(0, -1)}${word.slice(-1)}${word.slice(-1)}`
                        : word,
                )
                .join(' '),
    },
    {
        name: 'a synonym for the words the spinner knows',
        apply: (text) => text.replace(/\b[a-z]+\b/gi, (word) => SYNONYMS[word.toLowerCase()] ?? word),
    },
    { name: 'the sentences in the reverse order', apply: (text) => text.split('. ').reverse().join('. ') },
    { name: 'half of the steps deleted', apply: (text) => text.slice(0, Math.floor(text.length / 2)) },
    {
        name: 'the whole text with a zero-width joiner inside every word',
        apply: (text) => text.replace(/[a-z]{2,}/gi, (word) => `${word.slice(0, 1)}‍${word.slice(1)}`),
    },
    {
        name: 'Cyrillic look-alikes for six letters',
        apply: (text) => text.replace(/[acepox]/g, (letter) => LOOK_ALIKES[letter] ?? letter),
    },
    {
        name: 'the full text with a long padding paragraph that never repeats its words',
        apply: (text) =>
            `${text} Kitchen notes: keep a clean cloth close, wash your hands often, trust your nose, rest the finished plate briefly, and enjoy the company around you.`,
    },
    {
        name: 'a dotted capital I in place of i in every word (qse P4-Q4)',
        apply: (text) => text.replace(/i/g, '\u0130'),
    },
    {
        name: 'new words that are only accent variants of baseline words (qse P4-Q4)',
        apply: (text) =>
            text.replace(
                /[aeou]/g,
                (vowel) => ({ a: '\u00e1', e: '\u00e9', o: '\u00f3', u: '\u00fa' })[vowel] ?? vowel,
            ),
    },
    {
        name: 'one accent and one combining mark on every word',
        apply: (text) => text.replace(/[a-z]{3,}/gi, (word) => `${word.slice(0, 1)}́${word.slice(1)}`),
    },
];

/** The pairs v1 must pass: every rewrite of every base. */
const PASSING: readonly GoldenCase[] = Object.entries(REWRITES).flatMap(([dish, rewrites]) =>
    rewrites.map((steps, index) => ({
        name: `${dish}: a genuine rewrite, ${String(index + 1)}`,
        baseline: BASES[dish] ?? '',
        steps,
        pass: true,
    })),
);

/** The pairs v1 must fail: every mechanical edit of every base, the empty edit and the identical text included. */
const FAILING: readonly GoldenCase[] = Object.entries(BASES).flatMap(([dish, baseline]) => [
    ...TRANSFORMS.map((transform) => ({
        name: `${dish}: ${transform.name}`,
        baseline,
        steps: transform.apply(baseline),
        pass: false,
    })),
    {
        name: `${dish}: the identical text`,
        baseline,
        steps: baseline,
        pass: false,
    },
]);

/**
 * A mark-dependent script (staff 2026-11-21): 30 synthetic Devanagari words, each a consonant and a vowel sign, and the
 * same consonants with other vowel signs. Stage 1 strips every mark, so v1 reads the two as the same text and does not
 * earn the fact. The case pins that looser matching on a script whose marks carry meaning, so the gate cannot change
 * quietly. The words are generated for this case and are not Hindi.
 */
const CONSONANTS = ['\u0915', '\u0916', '\u0917', '\u0918', '\u091a', '\u091b', '\u091c', '\u091f', '\u0920', '\u0921'];
const DEVANAGARI_BASE = Array.from(
    { length: 30 },
    (_, index) =>
        `${CONSONANTS[index % 10] ?? ''}${CONSONANTS[(index * 3 + 1) % 10] ?? ''}\u093e${CONSONANTS[(index * 7 + 2) % 10] ?? ''}`,
).join(' ');
const DEVANAGARI_OTHER_SIGNS = DEVANAGARI_BASE.replace(/\u093e/g, '\u093f');

const SCRIPT_CASES: readonly GoldenCase[] = [
    {
        name: 'devanagari: the same consonants with other vowel signs',
        baseline: DEVANAGARI_BASE,
        steps: DEVANAGARI_OTHER_SIGNS,
        pass: false,
    },
];

/**
 * AE18 (po Q-L3, qse 2026-11-21): "Adapted" means restructured. Each case is defined by its edit operations on
 * {@link ROOTS_BASE}, never by a measure. Our own text.
 *
 * Case P': every sentence kept, in order, with its structure, and about one content word in three replaced, spread so
 * every three-word phrase of the original holds a change. Expected: not earned. v1 as built passes it, so it pins the
 * alignment measure.
 *
 * Case H: a heavy in-order paraphrase, about two thirds of the words changed. Expected: earned, as the named residual
 * (ADR-0100, OQ9).
 *
 * Case M: the same recipe with the steps merged and their order changed (the seasoning before the cutting, the oven
 * heat moved into the roasting step), new wording. Expected: earned.
 */
const AE18_CASES: readonly GoldenCase[] = [
    {
        name: "roots: an in-order paraphrase with about one content word in three replaced (AE18 case P')",
        baseline: ROOTS_BASE,
        steps: 'Heat the stove to 220 degrees. Skin the carrots plus parsnips and slice them into chunky batons from our same length. Turn them in one baking tray with oil, one good pinch from salt plus a handful of sprigs from thyme. Roast for forty minutes, flipping once, till the sides are dark plus crisp. Drizzle with honey for the final five minutes plus serve warm.',
        pass: false,
    },
    {
        name: 'roots: a heavy in-order paraphrase, about two thirds of the words changed (named residual, ADR-0100, OQ9)',
        baseline: ROOTS_BASE,
        steps: 'Bring the oven up to 220 degrees. Scrape your carrots together with the parsnips, then slice them into chunky sticks of equal length. Coat them in a deep baking tray with oil and a generous sprinkling of salt plus some thyme sprigs. Cook for forty minutes in the oven, flipping them once, till the borders darken and crisp up. Trickle honey over for the final five minutes and bring to the table hot.',
        pass: true,
    },
    {
        name: 'roots: the steps merged and reordered (AE18 case M)',
        baseline: ROOTS_BASE,
        steps: 'Put the oil, a generous pinch of salt and some thyme sprigs into a deep baking tray first. Scrape the carrots and parsnips, cut them into chunky sticks of equal length and roll them in that mixture. Roast in an oven heated to 220 degrees, flipping once, for forty minutes until dark and crunchy at the edges, and trickle honey over for the last five minutes. Bring everything to the table hot.',
        pass: true,
    },
];

/** A short baseline, near the 20-shingle minimum (23 distinct shingles): the short band of the spinning cases. */
const EGGS_BASE =
    'Whisk two eggs with salt. Melt butter in a pan and pour in the eggs. Stir gently until just set, then serve on warm toast.';

/** A long baseline (about 200 distinct shingles): the long band of the spinning cases. */
const BREAD_BASE =
    'Start the bread the night before. Pour the warm water into a large bowl, sprinkle the yeast over it and leave it alone for ten minutes until it foams. Stir in the honey and the olive oil, then add the flour and salt a little at a time, working the mixture with a wooden spoon until it pulls away from the sides. Tip the dough onto a clean counter and knead it firmly for about eight minutes, until it feels smooth and springs back when pressed. Place it in an oiled bowl, cover the bowl with a damp cloth and keep it somewhere warm until it has doubled in size, which usually takes about two hours. Press the air out gently, shape the dough into a tight round and set it on a floured tray. Cover it again and let it rise for another forty minutes while the oven heats to 230 degrees. Slash the top with a sharp knife, slide the tray onto the middle shelf and bake for thirty minutes, until the crust is deep brown and the loaf sounds hollow when you tap the bottom. Cool it on a rack for at least an hour before slicing, because the crumb needs time to set.';

/**
 * Replace the words at the given positions with synthetic words, the way a spinner does.
 *
 * @param text - Words one space apart.
 * @param isReplaced - Whether the word at an index is replaced.
 * @returns The edited text.
 */
function spin(text: string, isReplaced: (index: number) => boolean): string {
    return text
        .split(' ')
        .map((word, index) => (isReplaced(index) ? synthWord(index) : word))
        .join(' ');
}

/**
 * Spinning (U2 spike, qse 2026-11-21): the original with a fraction of its words swapped for new ones. No sentence
 * is rewritten, and a person would call every one of these the same text. A, R and F all compare contiguous runs, so
 * v1 as first built passed every one. Expected: not earned. The draw is seeded, so each case never changes.
 */
const SPINNING_CASES: readonly GoldenCase[] = [
    {
        name: 'bread: every third word replaced, from the third',
        baseline: BREAD_BASE,
        steps: spin(BREAD_BASE, (index) => index % 3 === 2),
        pass: false,
    },
    {
        name: 'bread: every second word replaced, from the second',
        baseline: BREAD_BASE,
        steps: spin(BREAD_BASE, (index) => index % 2 === 1),
        pass: false,
    },
    {
        name: 'eggs: a seeded draw replacing each word with a chance of one in three (short baseline)',
        baseline: EGGS_BASE,
        steps: spin(
            EGGS_BASE,
            (
                (draw) => () =>
                    draw() < 1 / 3
            )(seededDraw(5)),
        ),
        pass: false,
    },
    {
        name: 'bread: a seeded draw replacing each word with a chance of one in three (long baseline)',
        baseline: BREAD_BASE,
        steps: spin(
            BREAD_BASE,
            (
                (draw) => () =>
                    draw() < 1 / 3
            )(seededDraw(5)),
        ),
        pass: false,
    },
];

/**
 * Reorder and spin together (redteam R2-2): the base's sentences in the reverse order, and in each sentence one word
 * in three replaced. Defined by its edits. po labels it not earned: the sentences are the original's and only
 * single words changed. Measure L reads the order of the words, so reversing the sentences breaks the alignment and v1
 * EARNS the case (aligned .20). It is pinned at v1's answer as a named residual (ADR-0100, OQ9), as R2-2 says, and
 * P4b's re-check rules on it before Public depends on the fact.
 */
const REORDER_SPIN_CASE: GoldenCase = {
    name: 'roots: the sentences reversed and one word in three of each replaced (named residual, ADR-0100, OQ9)',
    baseline: ROOTS_BASE,
    steps: ROOTS_BASE.split('. ')
        .map((sentence) => sentence.replace(/\.$/u, ''))
        .reverse()
        .map((sentence, sentenceIndex) =>
            sentence
                .split(' ')
                .map((word, index) => (index % 3 === 1 ? synthWord(sentenceIndex * 40 + index) : word))
                .join(' '),
        )
        .join('. ')
        .concat('.'),
    pass: true,
};

/** The whole golden set. */
export const GOLDEN_V1: readonly GoldenCase[] = [
    ...PASSING,
    ...FAILING,
    ...SCRIPT_CASES,
    ...AE18_CASES,
    ...SPINNING_CASES,
    REORDER_SPIN_CASE,
];

/**
 * The measures v1 reported for each case when it was frozen (2026-11-21). A change in any number fails the golden test,
 * though the pass flag might hold: the numbers are v1's answer too, and the metric a later stage reads.
 *
 * A look-alike quantity folds in v1 (S-1): a unit spelled with look-alike letters folds by its skeleton, and a number
 * spelled with letters for digits (`l8O`) folds back to the digit, so the cases with Cyrillic look-alikes read as the
 * baseline. A number spelled with letters only (`lO` for 10) stays a word: the named residual in ADR-0100.
 */
export const GOLDEN_V1_MEASURES: Readonly<
    Record<
        string,
        {
            readonly kept: number;
            readonly total: number;
            readonly longestRun: number;
            readonly newWords: number;
            readonly aligned: number;
            readonly alignTotal: number;
        }
    >
> = {
    'sauce: a genuine rewrite, 1': { kept: 0, total: 67, longestRun: 2, newWords: 19, aligned: 6, alignTotal: 38 },
    'sauce: a genuine rewrite, 2': { kept: 0, total: 67, longestRun: 2, newWords: 22, aligned: 5, alignTotal: 38 },
    'sauce: a genuine rewrite, 3': { kept: 0, total: 67, longestRun: 2, newWords: 21, aligned: 7, alignTotal: 38 },
    'sauce: a genuine rewrite, 4': { kept: 1, total: 67, longestRun: 3, newWords: 17, aligned: 8, alignTotal: 38 },
    'sauce: a genuine rewrite, 5': { kept: 0, total: 67, longestRun: 2, newWords: 16, aligned: 12, alignTotal: 38 },
    'pancakes: a genuine rewrite, 1': { kept: 0, total: 81, longestRun: 2, newWords: 27, aligned: 8, alignTotal: 41 },
    'pancakes: a genuine rewrite, 2': { kept: 1, total: 81, longestRun: 3, newWords: 17, aligned: 8, alignTotal: 41 },
    'pancakes: a genuine rewrite, 3': { kept: 0, total: 81, longestRun: 2, newWords: 23, aligned: 7, alignTotal: 41 },
    'pancakes: a genuine rewrite, 4': { kept: 1, total: 81, longestRun: 3, newWords: 13, aligned: 13, alignTotal: 41 },
    'pancakes: a genuine rewrite, 5': { kept: 1, total: 81, longestRun: 3, newWords: 14, aligned: 9, alignTotal: 41 },
    'roots: a genuine rewrite, 1': { kept: 2, total: 62, longestRun: 3, newWords: 16, aligned: 10, alignTotal: 31 },
    'roots: a genuine rewrite, 2': { kept: 3, total: 62, longestRun: 4, newWords: 17, aligned: 9, alignTotal: 31 },
    'roots: a genuine rewrite, 3': { kept: 0, total: 62, longestRun: 2, newWords: 24, aligned: 7, alignTotal: 31 },
    'roots: a genuine rewrite, 4': { kept: 4, total: 62, longestRun: 3, newWords: 11, aligned: 9, alignTotal: 31 },
    'roots: a genuine rewrite, 5': { kept: 0, total: 62, longestRun: 2, newWords: 22, aligned: 7, alignTotal: 31 },
    'sauce: a copy with every number changed': {
        kept: 58,
        total: 67,
        longestRun: 29,
        newWords: 1,
        aligned: 35,
        alignTotal: 38,
    },
    'sauce: the same text in capitals': {
        kept: 67,
        total: 67,
        longestRun: 64,
        newWords: 0,
        aligned: 38,
        alignTotal: 38,
    },
    'sauce: a typo in every sixth word': {
        kept: 51,
        total: 67,
        longestRun: 29,
        newWords: 6,
        aligned: 35,
        alignTotal: 38,
    },
    'sauce: a synonym for the words the spinner knows': {
        kept: 43,
        total: 67,
        longestRun: 19,
        newWords: 8,
        aligned: 29,
        alignTotal: 38,
    },
    'sauce: the sentences in the reverse order': {
        kept: 61,
        total: 67,
        longestRun: 22,
        newWords: 0,
        aligned: 11,
        alignTotal: 38,
    },
    'sauce: half of the steps deleted': {
        kept: 33,
        total: 67,
        longestRun: 35,
        newWords: 1,
        aligned: 19,
        alignTotal: 38,
    },
    'sauce: the whole text with a zero-width joiner inside every word': {
        kept: 67,
        total: 67,
        longestRun: 64,
        newWords: 0,
        aligned: 38,
        alignTotal: 38,
    },
    'sauce: Cyrillic look-alikes for six letters': {
        kept: 67,
        total: 67,
        longestRun: 64,
        newWords: 0,
        aligned: 38,
        alignTotal: 38,
    },
    'sauce: the full text with a long padding paragraph that never repeats its words': {
        kept: 67,
        total: 67,
        longestRun: 64,
        newWords: 20,
        aligned: 38,
        alignTotal: 38,
    },
    'sauce: a dotted capital I in place of i in every word (qse P4-Q4)': {
        kept: 67,
        total: 67,
        longestRun: 64,
        newWords: 0,
        aligned: 38,
        alignTotal: 38,
    },
    'sauce: new words that are only accent variants of baseline words (qse P4-Q4)': {
        kept: 67,
        total: 67,
        longestRun: 64,
        newWords: 0,
        aligned: 38,
        alignTotal: 38,
    },
    'sauce: one accent and one combining mark on every word': {
        kept: 67,
        total: 67,
        longestRun: 64,
        newWords: 0,
        aligned: 38,
        alignTotal: 38,
    },
    'sauce: the identical text': { kept: 67, total: 67, longestRun: 64, newWords: 0, aligned: 38, alignTotal: 38 },
    'pancakes: a copy with every number changed': {
        kept: 76,
        total: 81,
        longestRun: 45,
        newWords: 1,
        aligned: 40,
        alignTotal: 41,
    },
    'pancakes: the same text in capitals': {
        kept: 81,
        total: 81,
        longestRun: 64,
        newWords: 0,
        aligned: 41,
        alignTotal: 41,
    },
    'pancakes: a typo in every sixth word': {
        kept: 71,
        total: 81,
        longestRun: 41,
        newWords: 4,
        aligned: 37,
        alignTotal: 41,
    },
    'pancakes: a synonym for the words the spinner knows': {
        kept: 53,
        total: 81,
        longestRun: 15,
        newWords: 7,
        aligned: 33,
        alignTotal: 41,
    },
    'pancakes: the sentences in the reverse order': {
        kept: 74,
        total: 81,
        longestRun: 22,
        newWords: 0,
        aligned: 13,
        alignTotal: 41,
    },
    'pancakes: half of the steps deleted': {
        kept: 41,
        total: 81,
        longestRun: 43,
        newWords: 1,
        aligned: 19,
        alignTotal: 41,
    },
    'pancakes: the whole text with a zero-width joiner inside every word': {
        kept: 81,
        total: 81,
        longestRun: 64,
        newWords: 0,
        aligned: 41,
        alignTotal: 41,
    },
    'pancakes: Cyrillic look-alikes for six letters': {
        kept: 81,
        total: 81,
        longestRun: 64,
        newWords: 0,
        aligned: 41,
        alignTotal: 41,
    },
    'pancakes: the full text with a long padding paragraph that never repeats its words': {
        kept: 81,
        total: 81,
        longestRun: 64,
        newWords: 19,
        aligned: 41,
        alignTotal: 41,
    },
    'pancakes: a dotted capital I in place of i in every word (qse P4-Q4)': {
        kept: 81,
        total: 81,
        longestRun: 64,
        newWords: 0,
        aligned: 41,
        alignTotal: 41,
    },
    'pancakes: new words that are only accent variants of baseline words (qse P4-Q4)': {
        kept: 81,
        total: 81,
        longestRun: 64,
        newWords: 0,
        aligned: 41,
        alignTotal: 41,
    },
    'pancakes: one accent and one combining mark on every word': {
        kept: 81,
        total: 81,
        longestRun: 64,
        newWords: 0,
        aligned: 41,
        alignTotal: 41,
    },
    'pancakes: the identical text': { kept: 81, total: 81, longestRun: 64, newWords: 0, aligned: 41, alignTotal: 41 },
    'roots: a copy with every number changed': {
        kept: 56,
        total: 62,
        longestRun: 42,
        newWords: 1,
        aligned: 29,
        alignTotal: 31,
    },
    'roots: the same text in capitals': {
        kept: 62,
        total: 62,
        longestRun: 64,
        newWords: 0,
        aligned: 31,
        alignTotal: 31,
    },
    'roots: a typo in every sixth word': {
        kept: 43,
        total: 62,
        longestRun: 23,
        newWords: 7,
        aligned: 26,
        alignTotal: 31,
    },
    'roots: a synonym for the words the spinner knows': {
        kept: 48,
        total: 62,
        longestRun: 30,
        newWords: 5,
        aligned: 26,
        alignTotal: 31,
    },
    'roots: the sentences in the reverse order': {
        kept: 54,
        total: 62,
        longestRun: 19,
        newWords: 0,
        aligned: 9,
        alignTotal: 31,
    },
    'roots: half of the steps deleted': {
        kept: 31,
        total: 62,
        longestRun: 33,
        newWords: 0,
        aligned: 15,
        alignTotal: 31,
    },
    'roots: the whole text with a zero-width joiner inside every word': {
        kept: 62,
        total: 62,
        longestRun: 64,
        newWords: 0,
        aligned: 31,
        alignTotal: 31,
    },
    'roots: Cyrillic look-alikes for six letters': {
        kept: 62,
        total: 62,
        longestRun: 64,
        newWords: 0,
        aligned: 31,
        alignTotal: 31,
    },
    'roots: the full text with a long padding paragraph that never repeats its words': {
        kept: 62,
        total: 62,
        longestRun: 64,
        newWords: 20,
        aligned: 31,
        alignTotal: 31,
    },
    'roots: a dotted capital I in place of i in every word (qse P4-Q4)': {
        kept: 62,
        total: 62,
        longestRun: 64,
        newWords: 0,
        aligned: 31,
        alignTotal: 31,
    },
    'roots: new words that are only accent variants of baseline words (qse P4-Q4)': {
        kept: 62,
        total: 62,
        longestRun: 64,
        newWords: 0,
        aligned: 31,
        alignTotal: 31,
    },
    'roots: one accent and one combining mark on every word': {
        kept: 62,
        total: 62,
        longestRun: 64,
        newWords: 0,
        aligned: 31,
        alignTotal: 31,
    },
    'roots: the identical text': { kept: 62, total: 62, longestRun: 64, newWords: 0, aligned: 31, alignTotal: 31 },
    'devanagari: the same consonants with other vowel signs': {
        kept: 10,
        total: 10,
        longestRun: 30,
        newWords: 0,
        aligned: 30,
        alignTotal: 30,
    },
    "roots: an in-order paraphrase with about one content word in three replaced (AE18 case P')": {
        kept: 8,
        total: 62,
        longestRun: 6,
        newWords: 16,
        aligned: 17,
        alignTotal: 31,
    },
    'roots: a heavy in-order paraphrase, about two thirds of the words changed (named residual, ADR-0100, OQ9)': {
        kept: 4,
        total: 62,
        longestRun: 3,
        newWords: 26,
        aligned: 12,
        alignTotal: 31,
    },
    'roots: the steps merged and reordered (AE18 case M)': {
        kept: 10,
        total: 62,
        longestRun: 5,
        newWords: 24,
        aligned: 10,
        alignTotal: 31,
    },
    'bread: every third word replaced, from the third': {
        kept: 0,
        total: 203,
        longestRun: 2,
        newWords: 69,
        aligned: 69,
        alignTotal: 106,
    },
    'bread: every second word replaced, from the second': {
        kept: 0,
        total: 203,
        longestRun: 1,
        newWords: 103,
        aligned: 62,
        alignTotal: 106,
    },
    'eggs: a seeded draw replacing each word with a chance of one in three (short baseline)': {
        kept: 3,
        total: 23,
        longestRun: 4,
        newWords: 10,
        aligned: 8,
        alignTotal: 15,
    },
    'bread: a seeded draw replacing each word with a chance of one in three (long baseline)': {
        kept: 35,
        total: 203,
        longestRun: 7,
        newWords: 79,
        aligned: 65,
        alignTotal: 106,
    },
    'roots: the sentences reversed and one word in three of each replaced (named residual, ADR-0100, OQ9)': {
        kept: 0,
        total: 62,
        longestRun: 2,
        newWords: 21,
        aligned: 6,
        alignTotal: 31,
    },
};
