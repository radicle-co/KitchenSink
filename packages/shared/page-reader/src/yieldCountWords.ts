/**
 * The words a count label's value (`cardMetaLabels.ts`) may carry after its number: "Yield: 6 slices", "Dosi per: 4
 * persone", "2人分". Lower case, as `tokensOf` splits them. Data for the card-furniture policy (`schemaCorroboration.ts`).
 *
 * ⛔ CLOSED on purpose (coordinator ruling on #324, round 4): the English words are the ruling's own list, and a word in
 * another language is here only when the tuning corpus shows it after a number. A word not here refuses the value, so
 * "Calories: 2 eggs" or "Выход: 2 яйца" is never read as meta.
 */
export const YIELD_COUNT_WORDS: ReadonlySet<string> = new Set([
    // English.
    'servings',
    'serves',
    'people',
    'persons',
    'portions',
    'slices',
    'pieces',
    // Italian.
    'persone',
    'porzioni',
    'pezzi',
    // Russian: "шт", pieces.
    'шт',
    // Japanese: "人分", servings.
    '人分',
]);
