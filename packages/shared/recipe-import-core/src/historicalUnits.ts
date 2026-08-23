/**
 * @module historicalUnits — the period-cookery measures `parse-ingredient` has never heard of, and the
 * per-SYSTEM millilitre size of the ones it has (R32, R33).
 *
 * DESIGN PATTERN: **Adapter over a library's own extension point**, plus a **Null Object at the value
 * layer** — the historical units are declared here as SPELLINGS with deliberately NO conversion factor, so
 * every attempt to size one has to go somewhere that knows which BOOK is being read.
 *
 * ## Why the spellings live here and the values do not
 *
 * A gill is 118 mL in an American cookbook and 142 mL in a British one — the same word, two amounts, and
 * which one applies is a fact about the SOURCE, not about English. R32 puts that fact in the source book's
 * own published table of weights and measures, resolved behind a port in `@kitchensink/cookbook-import`'s
 * `unitEquivalence.ts`. If a conversion factor were declared here instead, every book would silently share
 * one set of factors and exactly one corpus would be misconverted by 20% — the failure R33 exists to stop.
 *
 * So {@link millilitresPerUnit} answers only for units a measurement STANDARD defines in both systems
 * (`cup`, `pint`, `fluid ounce`, `tablespoon`, `teaspoon`), which is what a book's relational table —
 * "2 gills = 1 cup" — needs in order to become a number at all. Asking it for a gill returns `null`, and a
 * test pins that null in place.
 *
 * ## Library-first
 *
 * The per-system sizes are `parse-ingredient`'s own `convertUnit`, not constants of ours: the library
 * already carries a `{ us, imperial, metric }` conversion factor per volume unit and a converter over it.
 * Restating 473.176 and 568.261 here would be a second representation of a table we already depend on.
 */
import { normalizeUnit } from '@kitchensink/recipe-core';
import { convertUnit, type UnitOfMeasureDefinitions } from 'parse-ingredient';

/**
 * The system of measure a source's volumes are read in.
 *
 * ⛔ TWO MEMBERS, AND NO "default". "We have not established this book's origin" is NOT a third member
 * here — it is modelled where a book is registered (`unitEquivalence.ts`'s `BookMeasureOrigin`), because
 * a book with an unknown origin has no measure system rather than a fallback one (R33).
 */
export type MeasureSystem = 'us-customary' | 'british-imperial';

/** Our system names, in the vocabulary `parse-ingredient` uses for the same distinction. */
const LIBRARY_SYSTEM: Readonly<Record<MeasureSystem, 'us' | 'imperial'>> = {
    'us-customary': 'us',
    'british-imperial': 'imperial',
};

/**
 * The historical measures, as `parse-ingredient` extension definitions.
 *
 * ⛔ NO `conversionFactor` ON ANY ENTRY — that omission is the design, not an oversight, and
 * `historicalUnits.test.ts` fails if one appears. See this module's header.
 *
 * The spellings are what the corpus actually prints: #12350 sets `wine-glass` hyphenated in its own table
 * of weights and measures, and these books reach for the `*ful` suffix (`wineglassful`, `saltspoonful`)
 * far more often than the bare noun. Each `id` matches the canonical form
 * `@kitchensink/recipe-core`'s `normalizeUnit` produces, so the parser and the equivalence lookup agree on
 * one spelling without a second mapping in between.
 */
export const HISTORICAL_UNIT_DEFINITIONS: UnitOfMeasureDefinitions = {
    gill: { short: 'gill', plural: 'gills', alternates: [], type: 'volume' },
    wineglass: {
        short: 'wineglass',
        plural: 'wineglasses',
        alternates: [
            'wineglassful',
            'wineglassfuls',
            'wine-glass',
            'wine-glasses',
            'wine-glassful',
            'wine-glassfuls',
            'wine glass',
            'wine glasses',
        ],
        type: 'volume',
    },
    saltspoon: {
        short: 'saltspoon',
        plural: 'saltspoons',
        alternates: ['saltspoonful', 'saltspoonfuls', 'salt-spoon', 'salt-spoons'],
        type: 'volume',
    },
    dessertspoon: {
        short: 'dessertspoon',
        plural: 'dessertspoons',
        alternates: [
            'dessertspoonful',
            'dessertspoonfuls',
            'dessert-spoon',
            'dessert-spoons',
            'dessert spoon',
            'dessert spoons',
        ],
        type: 'volume',
    },
};

/**
 * How many millilitres one `unit` holds, read in `system`.
 *
 * @param unit - A unit as the source spelled it; canonicalised here, so `Cups` and `tsp` both resolve.
 * @param system - Which measure system to read it in. A US customary pint and a British imperial pint
 *   differ by 20%, and that difference is the whole reason this parameter exists.
 * @returns The millilitre size, or `null` when the unit is not a volume the standard defines — which
 *   INCLUDES every historical unit in {@link HISTORICAL_UNIT_DEFINITIONS}, deliberately. Pure.
 */
export function millilitresPerUnit(unit: string, system: MeasureSystem): number | null {
    return convertUnit(1, normalizeUnit(unit), 'milliliter', {
        fromSystem: LIBRARY_SYSTEM[system],
        additionalUOMs: HISTORICAL_UNIT_DEFINITIONS,
    });
}
