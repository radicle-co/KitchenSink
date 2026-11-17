/**
 * The labels of a recipe card's meta facts ("Prep Time: 10 minutes"), lower case: data for the card-furniture policy
 * (`schemaCorroboration.ts`). Before the lines the schema reads, a list item is meta only under one of these labels, so
 * an omitted ingredient group written "Eggs: 2" or "Мука: 200 г" is never read as meta.
 *
 * ⛔ CLOSED on purpose: a label is added only when a real page of the tuning corpus shows it as a card meta label (the
 * page named beside it, under `~/.local/state/kitchensink/pasteImport/corpus/`). A label not on the list refuses the card:
 * any doubt is no.
 */
export const CARD_META_LABELS: ReadonlySet<string> = new Set([
    // English.
    'prep time', // control/cookieKateQuiche
    'cook time', // control/cookieKateQuiche
    'total time', // control/cookieKateQuiche
    'servings', // fresh6/jA_enChelseasmessyapronCranberrySaladRecipe
    'yield', // control/cookieKateQuiche
    'course', // fresh6/jA_enHolycowveganCrescentRolls
    'cuisine', // fresh6/jA_enAcouplecooksPumpkinTiramisu
    'category', // fresh6/jA_enAcouplecooksPumpkinTiramisu
    'diet', // fresh6/jA_enCookieandkateCrustlessQuiche
    'calories', // controlFresh/modernProperBakedSalmon
    'difficulty', // controlFresh/cookieRookieGreenChickenEnchiladas
    'author', // control/cookieKateQuiche
    'keywords', // fresh6/jA_enPinchofyumSloppyJoes
    // Italian.
    'tempo totale', // controlFresh/itTiramisuCucchiaio
    'porzioni', // fresh8/mB_itUnamammaincucinaPastaPeperoni
    'dosi per', // controlFresh/itTiramisuCucchiaio
    'cucina', // controlFresh/itLasagneBologneseNonna
    'categoria', // controlFresh/itLasagneBologneseNonna
    'calorie', // controlFresh/itTiramisuCucchiaio
    'difficoltà', // controlFresh/itLasagneBologneseNonna
    // Russian.
    'время приготовления', // fresh6/mB_ruPovarImbirnoe
    'общее время', // fresh6/mB_ruVolshebnayaOgurcy
    'количество порций', // fresh8/mA_ruRutxt
    'выход', // fresh6/mB_ruVolshebnayaOgurcy
    'сложность', // controlFresh/ruKurnikGotovim
    // Japanese.
    '調理時間', // fresh8/mA_jpSirogohan
]);
