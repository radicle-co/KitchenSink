/**
 * The texts of a recipe card's jump links ("Jump to recipe", "Ingredients"), lower case: data for the card-furniture
 * policy (`schemaCorroboration.ts`). Before the lines the schema reads, a list item that links to them is furniture only
 * when its whole text is one of these, so an omitted ingredient written as a link ("One onion", "Half a lemon") is never
 * read as a jump link.
 *
 * ⛔ CLOSED on purpose: a phrase is added only when a real page of the tuning corpus shows it as the whole text of a
 * fragment link (the page named beside it, under `~/.local/state/kitchensink/pasteImport/corpus/`). A text not on the list
 * refuses the card: any doubt is no. The list also bounds the work: an item is matched by one lookup of its short text.
 */
export const JUMP_PHRASES: ReadonlySet<string> = new Set([
    // English.
    'jump to recipe', // control/bakingAddiction
    'skip to recipe', // fresh6/jA_enHalfbakedharvestCandiedBaconPinwheels
    'print recipe', // fresh8/mB_enRecipecommunityChickenPotPie
    'printable recipe', // fresh8/jB_enSudachirecipesAuthenticChickenKaraageC
    'ingredients', // controlFresh/cafeDelitesBeefStroganoff
    'instructions', // fresh8/jB_enCookingcarnivalChhuttiLapsiKansarRecipe
    'method', // controlFresh/cookieRookieChickenEnchiladas
    // German.
    'zutaten', // controlFresh/deRindergulaschKuechengoetter
    'zubereitung', // controlFresh/deRindergulaschKuechengoetter
    // Italian.
    'ingredienti', // controlFresh/itLasagneBologneseNonna
    // Russian.
    'ингредиенты', // fresh8/mA_ruRutxt
    'приготовление', // fresh8/mA_ruGotovimDoma
]);

/** The longest phrase on the list, in characters: a longer text is never looked up. */
export const MAX_JUMP_PHRASE_CHARS = Math.max(...Array.from(JUMP_PHRASES, (phrase) => phrase.length));
