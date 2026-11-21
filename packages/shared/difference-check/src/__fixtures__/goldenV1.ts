/**
 * v1's golden set (qse F-5). Every text here is OUR OWN, written for this file: never a source's text, a paid site's
 * or a cook's (R1a). Each case states the answer v1 gave when it was frozen. A changed answer fails
 * `goldenV1.test.ts`; a real change of the measure is a new version with its own set, never an edit of this one.
 *
 * Three base recipes, each in the cook's own steps. The rewrites are written independently of the base text; the
 * mechanical edits are derived from it by the named transform, so the derivation is part of the frozen case.
 */

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
    { name: `${dish}: the identical text`, baseline, steps: baseline, pass: false },
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

/** The whole golden set. */
export const GOLDEN_V1: readonly GoldenCase[] = [...PASSING, ...FAILING, ...SCRIPT_CASES];

/**
 * The measures v1 reported for each case when it was frozen (2026-11-21). A change in any number fails the golden test,
 * though the pass flag might hold: the numbers are v1's answer too, and the metric a later stage reads.
 *
 * Known and accepted in v1: a Cyrillic look-alike inside a unit word (`minutes` spelled with one) is not folded to the
 * unit, because the skeleton must run after the unit fold; the cases with Cyrillic look-alikes show it as one or two new words.
 */
export const GOLDEN_V1_MEASURES: Readonly<
    Record<
        string,
        { readonly kept: number; readonly total: number; readonly longestRun: number; readonly newWords: number }
    >
> = {
    'sauce: a genuine rewrite, 1': { kept: 0, total: 67, longestRun: 2, newWords: 19 },
    'sauce: a genuine rewrite, 2': { kept: 0, total: 67, longestRun: 2, newWords: 22 },
    'sauce: a genuine rewrite, 3': { kept: 0, total: 67, longestRun: 2, newWords: 21 },
    'sauce: a genuine rewrite, 4': { kept: 1, total: 67, longestRun: 3, newWords: 17 },
    'sauce: a genuine rewrite, 5': { kept: 0, total: 67, longestRun: 2, newWords: 16 },
    'pancakes: a genuine rewrite, 1': { kept: 0, total: 81, longestRun: 2, newWords: 27 },
    'pancakes: a genuine rewrite, 2': { kept: 1, total: 81, longestRun: 3, newWords: 17 },
    'pancakes: a genuine rewrite, 3': { kept: 0, total: 81, longestRun: 2, newWords: 23 },
    'pancakes: a genuine rewrite, 4': { kept: 1, total: 81, longestRun: 3, newWords: 13 },
    'pancakes: a genuine rewrite, 5': { kept: 1, total: 81, longestRun: 3, newWords: 14 },
    'roots: a genuine rewrite, 1': { kept: 2, total: 62, longestRun: 3, newWords: 16 },
    'roots: a genuine rewrite, 2': { kept: 3, total: 62, longestRun: 4, newWords: 17 },
    'roots: a genuine rewrite, 3': { kept: 0, total: 62, longestRun: 2, newWords: 24 },
    'roots: a genuine rewrite, 4': { kept: 4, total: 62, longestRun: 3, newWords: 11 },
    'roots: a genuine rewrite, 5': { kept: 0, total: 62, longestRun: 2, newWords: 22 },
    'sauce: a copy with every number changed': { kept: 58, total: 67, longestRun: 29, newWords: 1 },
    'sauce: the same text in capitals': { kept: 67, total: 67, longestRun: 64, newWords: 0 },
    'sauce: a typo in every sixth word': { kept: 51, total: 67, longestRun: 29, newWords: 6 },
    'sauce: a synonym for the words the spinner knows': { kept: 43, total: 67, longestRun: 19, newWords: 8 },
    'sauce: the sentences in the reverse order': { kept: 61, total: 67, longestRun: 22, newWords: 0 },
    'sauce: half of the steps deleted': { kept: 33, total: 67, longestRun: 35, newWords: 1 },
    'sauce: the whole text with a zero-width joiner inside every word': {
        kept: 67,
        total: 67,
        longestRun: 64,
        newWords: 0,
    },
    'sauce: Cyrillic look-alikes for six letters': { kept: 58, total: 67, longestRun: 30, newWords: 2 },
    'sauce: the full text with a long padding paragraph that never repeats its words': {
        kept: 67,
        total: 67,
        longestRun: 64,
        newWords: 20,
    },
    'sauce: a dotted capital I in place of i in every word (qse P4-Q4)': {
        kept: 67,
        total: 67,
        longestRun: 64,
        newWords: 0,
    },
    'sauce: new words that are only accent variants of baseline words (qse P4-Q4)': {
        kept: 67,
        total: 67,
        longestRun: 64,
        newWords: 0,
    },
    'sauce: one accent and one combining mark on every word': { kept: 67, total: 67, longestRun: 64, newWords: 0 },
    'sauce: the identical text': { kept: 67, total: 67, longestRun: 64, newWords: 0 },
    'pancakes: a copy with every number changed': { kept: 76, total: 81, longestRun: 45, newWords: 1 },
    'pancakes: the same text in capitals': { kept: 81, total: 81, longestRun: 64, newWords: 0 },
    'pancakes: a typo in every sixth word': { kept: 71, total: 81, longestRun: 41, newWords: 4 },
    'pancakes: a synonym for the words the spinner knows': { kept: 53, total: 81, longestRun: 15, newWords: 7 },
    'pancakes: the sentences in the reverse order': { kept: 74, total: 81, longestRun: 22, newWords: 0 },
    'pancakes: half of the steps deleted': { kept: 41, total: 81, longestRun: 43, newWords: 1 },
    'pancakes: the whole text with a zero-width joiner inside every word': {
        kept: 81,
        total: 81,
        longestRun: 64,
        newWords: 0,
    },
    'pancakes: Cyrillic look-alikes for six letters': { kept: 74, total: 81, longestRun: 40, newWords: 2 },
    'pancakes: the full text with a long padding paragraph that never repeats its words': {
        kept: 81,
        total: 81,
        longestRun: 64,
        newWords: 19,
    },
    'pancakes: a dotted capital I in place of i in every word (qse P4-Q4)': {
        kept: 81,
        total: 81,
        longestRun: 64,
        newWords: 0,
    },
    'pancakes: new words that are only accent variants of baseline words (qse P4-Q4)': {
        kept: 81,
        total: 81,
        longestRun: 64,
        newWords: 0,
    },
    'pancakes: one accent and one combining mark on every word': { kept: 81, total: 81, longestRun: 64, newWords: 0 },
    'pancakes: the identical text': { kept: 81, total: 81, longestRun: 64, newWords: 0 },
    'roots: a copy with every number changed': { kept: 56, total: 62, longestRun: 42, newWords: 1 },
    'roots: the same text in capitals': { kept: 62, total: 62, longestRun: 64, newWords: 0 },
    'roots: a typo in every sixth word': { kept: 43, total: 62, longestRun: 23, newWords: 7 },
    'roots: a synonym for the words the spinner knows': { kept: 48, total: 62, longestRun: 30, newWords: 5 },
    'roots: the sentences in the reverse order': { kept: 54, total: 62, longestRun: 19, newWords: 0 },
    'roots: half of the steps deleted': { kept: 31, total: 62, longestRun: 33, newWords: 0 },
    'roots: the whole text with a zero-width joiner inside every word': {
        kept: 62,
        total: 62,
        longestRun: 64,
        newWords: 0,
    },
    'roots: Cyrillic look-alikes for six letters': { kept: 47, total: 62, longestRun: 25, newWords: 4 },
    'roots: the full text with a long padding paragraph that never repeats its words': {
        kept: 62,
        total: 62,
        longestRun: 64,
        newWords: 20,
    },
    'roots: a dotted capital I in place of i in every word (qse P4-Q4)': {
        kept: 62,
        total: 62,
        longestRun: 64,
        newWords: 0,
    },
    'roots: new words that are only accent variants of baseline words (qse P4-Q4)': {
        kept: 62,
        total: 62,
        longestRun: 64,
        newWords: 0,
    },
    'roots: one accent and one combining mark on every word': { kept: 62, total: 62, longestRun: 64, newWords: 0 },
    'roots: the identical text': { kept: 62, total: 62, longestRun: 64, newWords: 0 },
    'devanagari: the same consonants with other vowel signs': { kept: 10, total: 10, longestRun: 30, newWords: 0 },
};
