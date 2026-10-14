/**
 * The recipe cuisine vocabulary: the suggested list, its aliases, and the one canonical form a written cuisine takes
 * (`docs/design/uiOverhaul/cuisineField.md` §1, §2; owner rulings 2026-10-13).
 *
 * A cuisine is FREE TEXT on the wire (`recipeCuisineSchema`, a bounded string): {@link CUISINES} is what the editor
 * suggests, never a closed enum, so a cook's own words are accepted. What keeps free text from splitting Discover's
 * facets is {@link canonicalCuisine}, which every writer applies — the editor when the cook commits the field, and
 * the recipe service at its request boundary — so "thai", "THAI" and "Thai" are one stored value.
 *
 * ⚠️ ONE-WAY DOOR: an entry's SPELLING is stored on the wire as its English display string (§1.4). Renaming one splits
 * its facet, and localising the list later means treating these names as keys. `__tests__/cuisine.test.ts` writes the
 * approved list out so that a change to it is a deliberate change to the test as well.
 *
 * Pure and platform-agnostic.
 *
 * @pattern Value Object — the canonical cuisine string, produced by one total, idempotent function
 */

/**
 * The suggested cuisines, alphabetical by `Intl.Collator('en')` (§1.2: with 90 entries a popularity order cannot be
 * predicted, and typing reaches any entry in one or two letters). `Other` is deliberately absent: free text replaces it.
 */
export const CUISINES = [
    'Afghan',
    'Algerian',
    'American',
    'Argentinian',
    'Armenian',
    'Australian',
    'Austrian',
    'Bangladeshi',
    'Belgian',
    'Brazilian',
    'British',
    'Burmese',
    'Cajun',
    'Cambodian',
    'Canadian',
    'Cantonese',
    'Caribbean',
    'Chilean',
    'Chinese',
    'Colombian',
    'Creole',
    'Cuban',
    'Czech',
    'Dominican',
    'Dutch',
    'Egyptian',
    'Ethiopian',
    'Filipino',
    'French',
    'Georgian',
    'German',
    'Ghanaian',
    'Greek',
    'Haitian',
    'Hawaiian',
    'Hungarian',
    'Indian',
    'Indonesian',
    'Iraqi',
    'Irish',
    'Israeli',
    'Italian',
    'Jamaican',
    'Japanese',
    'Jewish',
    'Kenyan',
    'Korean',
    'Lao',
    'Lebanese',
    'Malaysian',
    'Mediterranean',
    'Mexican',
    'Middle Eastern',
    'Moroccan',
    'Native American',
    'Nepalese',
    'New Zealand',
    'Nigerian',
    'Nordic',
    'Pakistani',
    'Palestinian',
    'Persian',
    'Peruvian',
    'Polish',
    'Portuguese',
    'Puerto Rican',
    'Romanian',
    'Russian',
    'Salvadoran',
    'Senegalese',
    'Sichuan',
    'Singaporean',
    'Somali',
    'Soul food',
    'South African',
    'Southern',
    'Spanish',
    'Sri Lankan',
    'Swiss',
    'Syrian',
    'Taiwanese',
    'Tex-Mex',
    'Thai',
    'Trinidadian',
    'Tunisian',
    'Turkish',
    'Ukrainian',
    'Venezuelan',
    'Vietnamese',
    'Yemeni',
] as const;

/**
 * One suggested cuisine. NOT the type of the `cuisine` wire field, which stays `string`: this types only a value drawn
 * from {@link CUISINES} itself.
 */
export type Cuisine = (typeof CUISINES)[number];

/**
 * Other spellings of a list entry (§1.3). An alias does two things: typing it suggests its entry, and a value equal to
 * it is saved as its entry. An alias is never itself an entry (asserted by the test).
 */
export const CUISINE_ALIASES: Readonly<Record<string, Cuisine>> = {
    Szechuan: 'Sichuan',
    Szechwan: 'Sichuan',
    Iranian: 'Persian',
    Scandinavian: 'Nordic',
    Argentine: 'Argentinian',
    Laotian: 'Lao',
    Nepali: 'Nepalese',
    Philippine: 'Filipino',
};

/** Combining marks, which NFD separates from their base letter. */
const COMBINING_MARKS = /\p{M}/gu;
/** Every dash punctuation character, the ASCII hyphen-minus included: "Tex-Mex" and "Tex Mex" are one cuisine. */
const DASHES = /\p{Pd}/gu;
/** A run of whitespace of any kind. */
const WHITESPACE_RUN = /\s+/gu;

/**
 * The text a cuisine is compared by: NFD with combining marks stripped, lower case, dashes read as spaces, whitespace
 * collapsed, trimmed (§2). Two strings that fold equal name the same cuisine. Pure.
 *
 * @param text - Any text.
 * @returns The folded text; `''` for text that holds nothing.
 */
export function foldCuisine(text: string): string {
    return text
        .normalize('NFD')
        .replace(COMBINING_MARKS, '')
        .toLowerCase()
        .replace(DASHES, ' ')
        .replace(WHITESPACE_RUN, ' ')
        .trim();
}

/** Each entry and each alias by its folded text, to the entry's own spelling. Built once. */
const ENTRY_BY_FOLD: ReadonlyMap<string, Cuisine> = new Map<string, Cuisine>([
    ...CUISINES.map((cuisine): [string, Cuisine] => [foldCuisine(cuisine), cuisine]),
    ...Object.entries(CUISINE_ALIASES).map(([alias, cuisine]): [string, Cuisine] => [foldCuisine(alias), cuisine]),
]);

/**
 * The list entry a text names, directly or through an alias, or `undefined` when it names none. Pure.
 *
 * @param text - Any text.
 * @returns The entry, in the list's spelling.
 */
export function cuisineEntryOf(text: string): Cuisine | undefined {
    return ENTRY_BY_FOLD.get(foldCuisine(text));
}

/**
 * The one form a cuisine is saved in (§2). Spaces are trimmed and collapsed; empty stays `''` (absent on the wire). A
 * text that names a list entry, directly or through an alias, becomes the entry's spelling; any other text keeps the
 * cook's words with its FIRST character upper-cased for `en`, so "nyonya" and "Nyonya" are one facet while "BBQ-style"
 * keeps its inner case. Idempotent, which is what lets the editor and the service both apply it. Pure.
 *
 * @param text - The cuisine as typed or sent.
 * @returns The canonical cuisine, or `''`.
 */
export function canonicalCuisine(text: string): string {
    const collapsed = text.replace(WHITESPACE_RUN, ' ').trim();

    if (collapsed === '') {
        return '';
    }

    const entry = cuisineEntryOf(collapsed);

    if (entry !== undefined) {
        return entry;
    }

    // By code point, so a first character outside the Basic Multilingual Plane is not split in half.
    const [first = '', ...rest] = Array.from(collapsed);

    return `${first.toLocaleUpperCase('en')}${rest.join('')}`;
}
