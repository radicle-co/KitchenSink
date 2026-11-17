/**
 * The shape a meta label's value must have: a duration ("10 minutes"), a count ("4 servings", "6 slices"), or text that
 * holds no amount and no measure ("Dessert").
 */
export type CardMetaKind = 'time' | 'count' | 'text';

/**
 * The labels of a recipe card's meta facts ("Prep Time: 10 minutes"), lower case, each with the shape its value must
 * have: data for the card-furniture policy (`schemaCorroboration.ts`). Before the lines the schema reads, a list item is
 * meta only under one of these labels and with a value of that shape, so an omitted ingredient group written
 * "Eggs: 2", "Мука: 200 г" or "Calories: 2 eggs" is never read as meta.
 *
 * ⛔ CLOSED on purpose: a label is added only when a real page of the tuning corpus shows it as a card meta label (the
 * page named beside it, under `~/.local/state/kitchensink/pasteImport/corpus/`). A label not on the list refuses the card:
 * any doubt is no.
 */
export const CARD_META_LABELS: ReadonlyMap<string, CardMetaKind> = new Map<string, CardMetaKind>([
    // English.
    ['prep time', 'time'], // control/cookieKateQuiche
    ['cook time', 'time'], // control/cookieKateQuiche
    ['total time', 'time'], // control/cookieKateQuiche
    ['servings', 'count'], // fresh6/jA_enChelseasmessyapronCranberrySaladRecipe
    ['yield', 'count'], // control/cookieKateQuiche
    ['course', 'text'], // fresh6/jA_enHolycowveganCrescentRolls
    ['cuisine', 'text'], // fresh6/jA_enAcouplecooksPumpkinTiramisu
    ['category', 'text'], // fresh6/jA_enAcouplecooksPumpkinTiramisu
    ['diet', 'text'], // fresh6/jA_enCookieandkateCrustlessQuiche
    ['calories', 'count'], // controlFresh/modernProperBakedSalmon
    ['difficulty', 'text'], // controlFresh/cookieRookieGreenChickenEnchiladas
    ['author', 'text'], // control/cookieKateQuiche
    ['keywords', 'text'], // fresh6/jA_enPinchofyumSloppyJoes
    // Italian.
    ['tempo totale', 'time'], // controlFresh/itTiramisuCucchiaio
    ['porzioni', 'count'], // fresh8/mB_itUnamammaincucinaPastaPeperoni
    ['dosi per', 'count'], // controlFresh/itTiramisuCucchiaio
    ['cucina', 'text'], // controlFresh/itLasagneBologneseNonna
    ['categoria', 'text'], // controlFresh/itLasagneBologneseNonna
    ['calorie', 'count'], // controlFresh/itTiramisuCucchiaio
    ['difficoltà', 'text'], // controlFresh/itLasagneBologneseNonna
    // Russian.
    ['время приготовления', 'time'], // fresh6/mB_ruPovarImbirnoe
    ['общее время', 'time'], // fresh6/mB_ruVolshebnayaOgurcy
    ['количество порций', 'count'], // fresh8/mA_ruRutxt
    ['выход', 'count'], // fresh6/mB_ruVolshebnayaOgurcy
    ['сложность', 'text'], // controlFresh/ruKurnikGotovim
    // Japanese.
    ['調理時間', 'time'], // fresh8/mA_jpSirogohan
]);

/**
 * The units of a time value ("1 hour 10 minutes", "1 ora e 30 min", "30 минут", "30分"), lower case, as `tokensOf` splits
 * them. A time value holds one at least, and no word but these and {@link DURATION_JOINS}: "Prep Time: 2 eggs" is no
 * duration.
 */
export const DURATION_WORDS: ReadonlySet<string> = new Set([
    // English.
    'min',
    'mins',
    'minute',
    'minutes',
    'm',
    'h',
    'hr',
    'hrs',
    'hour',
    'hours',
    'd',
    'day',
    'days',
    // Italian.
    'minuto',
    'minuti',
    'ora',
    'ore',
    'giorno',
    'giorni',
    // Russian.
    'мин',
    'минута',
    'минуты',
    'минут',
    'ч',
    'час',
    'часа',
    'часов',
    'сут',
    'сутки',
    'день',
    'дня',
    'дней',
    // Japanese.
    '分',
    '時間',
    '日',
]);

/** The words that join the parts of a time value: "1 hour and 10 minutes", "1 ora e 30 min", "1 час и 10 минут". */
export const DURATION_JOINS: ReadonlySet<string> = new Set(['and', 'e', 'и']);
