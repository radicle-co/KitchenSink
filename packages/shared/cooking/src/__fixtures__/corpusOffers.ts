/**
 * Hand-labelled expectations for "times written in words" (S8.U1, AE4a). Labelled by reading the text as a cook
 * would, before any word reader existed, never by running a reader.
 */

/** One public-domain corpus step: the offer, in seconds, of each line that offers a timer, in line order. */
export interface CorpusOffer {
    readonly recipe: string;
    readonly step: number;
    /** Empty means no line of the step offers a timer. */
    readonly offers: readonly number[];
}

/**
 * All 31 `GOLDEN_CORPUS_STEPS`. Labelling notes:
 * - "a few minutes", "a moment" and "several days" state no length: no offer.
 * - CANNING FRUIT BAKED IN OVEN 3, "eight to ten minutes or according to the fruit": the time is hedged by "or
 *   according to", so it offers nothing (a wrong timer is worse than none).
 * - JERUSALEM ARTICHOKE 2 offers the 20 minutes. "one-half hour longer" is open ended ("longer") and is a fraction
 *   word, so it offers nothing.
 */
export const CORPUS_OFFERS: readonly CorpusOffer[] = [
    { recipe: 'STUFFED TOMATOES', step: 1, offers: [] },
    { recipe: 'CHOCOLATE LAYER CAKE', step: 1, offers: [] },
    { recipe: 'CRANBERRY JELLY', step: 1, offers: [600] },
    { recipe: 'SWEET SOUR BEANS', step: 1, offers: [] },
    { recipe: 'CHERRIES FOR PIES', step: 1, offers: [900] },
    { recipe: 'LEMON SAUCE', step: 1, offers: [] },
    { recipe: 'LAMB STEW--TOCANE', step: 1, offers: [] },
    { recipe: 'BRANDY SAUCE', step: 1, offers: [] },
    { recipe: 'EGG SANDWICHES', step: 1, offers: [] },
    { recipe: 'TO KEEP EGG YOLKS', step: 1, offers: [] },
    { recipe: 'TO KEEP EGG YOLKS', step: 2, offers: [] },
    { recipe: 'TO KEEP EGG YOLKS', step: 3, offers: [] },
    { recipe: 'PRESERVED STRAWBERRIES', step: 1, offers: [] },
    { recipe: 'PRESERVED STRAWBERRIES', step: 2, offers: [600] },
    { recipe: 'SAUCE HOLLANDAISE', step: 1, offers: [] },
    { recipe: 'BRANDIED CHERRIES', step: 1, offers: [480, 900] },
    { recipe: 'VEGETABLE HASH', step: 1, offers: [1800] },
    { recipe: 'CANNING FRUIT BAKED IN OVEN', step: 1, offers: [] },
    { recipe: 'CANNING FRUIT BAKED IN OVEN', step: 2, offers: [] },
    { recipe: 'CANNING FRUIT BAKED IN OVEN', step: 3, offers: [] },
    { recipe: 'CANNING FRUIT BAKED IN OVEN', step: 4, offers: [] },
    { recipe: 'LETTUCE', step: 1, offers: [] },
    { recipe: 'FRIED BEEFSTEAK', step: 1, offers: [] },
    { recipe: 'SAUERKRAUT', step: 1, offers: [] },
    { recipe: 'VEGETABLES', step: 1, offers: [] },
    { recipe: 'VEGETABLES', step: 2, offers: [] },
    { recipe: 'VEGETABLES', step: 3, offers: [] },
    { recipe: 'VEGETABLES', step: 4, offers: [] },
    { recipe: 'VEGETABLES', step: 5, offers: [] },
    { recipe: 'JERUSALEM ARTICHOKE', step: 1, offers: [] },
    { recipe: 'JERUSALEM ARTICHOKE', step: 2, offers: [1200] },
];

/** One line and the offer it must give: the seconds, or `undefined` for no offer. */
export interface LineOffer {
    readonly line: string;
    readonly seconds: number | undefined;
}

/** AE4a's positive rows, and the plan's extra positives. */
export const POSITIVE_LINE_OFFERS: readonly LineOffer[] = [
    { line: 'An hour and a half', seconds: 5_400 },
    { line: 'Ten to fifteen minutes', seconds: 600 },
    { line: 'Five or six minutes', seconds: 300 },
    { line: 'Twenty-five minutes', seconds: 1_500 },
    { line: 'Ten minutes or until golden', seconds: 600 },
    { line: 'An hour or until tender', seconds: 3_600 },
    { line: 'Half an hour or until set', seconds: 1_800 },
    { line: 'An hour and twenty minutes', seconds: 4_800 },
    { line: 'Boil a minute then add the sugar', seconds: 60 },
    { line: 'Simmer ten minutes, or until thick.', seconds: 600 },
    { line: 'Stir for thirty seconds', seconds: 30 },
    { line: 'Bake 20 minutes, then ten minutes more.', seconds: 1_200 },
];

/** AE4a's negative rows, and the plan's extra negatives. Each offers nothing. */
export const NEGATIVE_LINES: readonly string[] = [
    'two eggs',
    'every five minutes',
    'two minutes before the end',
    'ten minutes each side',
    'an hour or overnight',
    'a minute or two',
    'an hour or two',
    'a couple of minutes',
    'a few minutes',
    'a second time',
    'a second egg',
    'a minute quantity',
    'an hour or longer',
    'an hour or so',
    'a minute or less',
    'once an hour',
    'twice an hour',
    'an hour glass',
    'a second',
    'an hour before serving',
    'Boil one hour and a half.',
    'Bake an hour and a quarter.',
    'Leave an hour (or overnight).',
    'Bake an hour, or overnight.',
    'Rest ten minutes per pound.',
    'Roast twenty minutes to the pound',
    'Bake ten minutes, then rest five minutes.',
];
