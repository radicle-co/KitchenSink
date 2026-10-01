/**
 * Nutrient identity by definition (plan R53, KTD-23). A value is stored under the INFOODS tag of its own definition,
 * never under another definition's name, and each macronutrient has one read rule.
 *
 * USDA reports carbohydrate by difference, which includes fibre. CIQUAL and BLS report available carbohydrate by
 * weight, which excludes it, and CoFID reports available carbohydrate as monosaccharide equivalents. Stored under
 * one name, they differ by the fibre, and by the water a monosaccharide equivalent adds, with nothing to show it.
 *
 * @pattern Policy — the one place a total carbohydrate is read from stored definitions
 * @module
 */

/** One stored definition: its INFOODS tag, or `null` where INFOODS defines none, and its dictionary entry. */
export interface NutrientDefinition {
    readonly tag: string | null;
    readonly name: string;
    readonly unit: string;
}

/**
 * Every definition the catalog stores (KTD-23), the one mapping from a definition to its tag and its `nutrient`
 * dictionary `(name, unit)`. Names and units are written as `canonicalizeNutrientName` and `canonicalizeUnit` fold
 * them, so a value resolved from a source lands on the same dictionary row.
 *
 * The two Atwater energies carry no tag: INFOODS names none that is clearly theirs, so none is invented. They are
 * definitions of their own so KTD-21's energy order (1008, then 2048, then 2047) stays expressible.
 */
export const NUTRIENT_DEFINITIONS = {
    energyKcal: { tag: 'ENERC_KCAL', name: 'Energy', unit: 'kcal' },
    energyKj: { tag: 'ENERC_KJ', name: 'Energy', unit: 'kj' },
    protein: { tag: 'PROCNT', name: 'Protein', unit: 'g' },
    fat: { tag: 'FAT', name: 'Total lipid (fat)', unit: 'g' },
    carbohydrateByDifference: { tag: 'CHOCDF', name: 'Carbohydrate, by difference', unit: 'g' },
    carbohydrateAvailable: { tag: 'CHOAVL', name: 'Carbohydrate, available', unit: 'g' },
    carbohydrateAvailableMonosaccharides: {
        tag: 'CHOAVLM',
        name: 'Carbohydrate, available (monosaccharide equivalents)',
        unit: 'g',
    },
    fibre: { tag: 'FIBTG', name: 'Fiber, total dietary', unit: 'g' },
    energyKcalAtwaterSpecific: { tag: null, name: 'Energy (atwater specific factors)', unit: 'kcal' },
    energyKcalAtwaterGeneral: { tag: null, name: 'Energy (atwater general factors)', unit: 'kcal' },
} as const satisfies Readonly<Record<string, NutrientDefinition>>;

/** A definition the catalog stores. */
export type NutrientDefinitionKey = keyof typeof NUTRIENT_DEFINITIONS;

/**
 * KTD-21's energy order, the one read rule for calories: Energy (1008), then Atwater Specific (2048), then Atwater
 * General (2047), the order the seed's supplier election used (owner register, 2026-09-28).
 */
export const ENERGY_READ_ORDER = [
    'energyKcal',
    'energyKcalAtwaterSpecific',
    'energyKcalAtwaterGeneral',
] as const satisfies readonly NutrientDefinitionKey[];

type Definitions = typeof NUTRIENT_DEFINITIONS;

/** The definitions that carry an INFOODS tag. */
type TaggedKey = {
    [Key in NutrientDefinitionKey]: Definitions[Key]['tag'] extends string ? Key : never;
}[NutrientDefinitionKey];

/** Each tagged definition's tag, by definition. */
type TagsByKey = { readonly [Key in TaggedKey]: Definitions[Key]['tag'] };

/**
 * The tagged definitions' tags. Pure.
 *
 * @returns `INFOODS`.
 */
function tagsOf(): TagsByKey {
    const tags = Object.fromEntries(
        Object.entries(NUTRIENT_DEFINITIONS).flatMap(([key, definition]) =>
            definition.tag === null ? [] : [[key, definition.tag]],
        ),
    );

    // ⚠️ Cast: `Object.entries` widens every key to `string` and every tag to the union, so TypeScript cannot follow
    // the filter. The result holds exactly the tagged keys with their own tags; the unit test pins both.
    return Object.freeze(tags) as TagsByKey;
}

/** The INFOODS tag of each tagged definition, derived from {@link NUTRIENT_DEFINITIONS}. */
export const INFOODS: TagsByKey = tagsOf();

/** An INFOODS tag the catalog stores. */
export type InfoodsTag = TagsByKey[TaggedKey];

/**
 * The FDC nutrient ids the catalog reads, and the definition each is stored under (KTD-23). These are
 * `nutrient.csv`'s `id` column (1008 is Energy in kcal), which the plan calls nutrient numbers. They are not its
 * `nutrient_nbr` column (208 for the same energy), which FNDDS files under the name `nutrient_id`.
 */
export const USDA_NUTRIENT_ID_DEFINITIONS: ReadonlyMap<number, NutrientDefinitionKey> = new Map<
    number,
    NutrientDefinitionKey
>([
    [1008, 'energyKcal'],
    [1062, 'energyKj'],
    [1003, 'protein'],
    [1004, 'fat'],
    [1005, 'carbohydrateByDifference'],
    [1079, 'fibre'],
    [2048, 'energyKcalAtwaterSpecific'],
    [2047, 'energyKcalAtwaterGeneral'],
]);

/** Precision of a stored amount: three decimal places, as the seed stores them. */
const SCALE = 1000;

/**
 * One arm's value: the stated value, else 0 when the source printed a trace or below-limit mark, else absent. Pure.
 *
 * @param values - The stated values.
 * @param traces - The tags the source printed as a trace.
 * @param tag - The arm.
 * @returns The arm's value for the sum.
 */
function armOf(
    values: Readonly<Partial<Record<InfoodsTag, number>>>,
    traces: ReadonlySet<InfoodsTag>,
    tag: InfoodsTag,
): number | undefined {
    return values[tag] ?? (traces.has(tag) ? 0 : undefined);
}

/**
 * A food's total carbohydrate per 100 g (owner, 2026-09-30). Pure.
 *
 * A trace or below-limit mark is present below the source's reporting limit, so it counts as 0 in the sum
 * (2026-10-01). A not-known mark is simply absent.
 *
 * @param values - The food's stated values by INFOODS tag.
 * @param traces - The tags its source printed as a trace or below-limit bound.
 * @returns The by-difference value when the source gives one; else available carbohydrate, by weight or else as
 *   monosaccharide equivalents, plus fibre when both are given; else `undefined`. A monosaccharide equivalent runs a
 *   little above the weight for a starchy food, and by-difference carbohydrate also absorbs every other proximate's
 *   error, so the two totals agree closely without being the same measurement.
 */
export function totalCarbohydrate(
    values: Readonly<Partial<Record<InfoodsTag, number>>>,
    traces: ReadonlySet<InfoodsTag> = new Set(),
): number | undefined {
    const byDifference = armOf(values, traces, INFOODS.carbohydrateByDifference);

    if (byDifference !== undefined) {
        return byDifference;
    }

    // A stated available value of either kind wins over a trace of the other, since a source can print both.
    const available =
        values[INFOODS.carbohydrateAvailable] ??
        values[INFOODS.carbohydrateAvailableMonosaccharides] ??
        armOf(values, traces, INFOODS.carbohydrateAvailable) ??
        armOf(values, traces, INFOODS.carbohydrateAvailableMonosaccharides);
    const fibre = armOf(values, traces, INFOODS.fibre);

    if (available === undefined || fibre === undefined) {
        return undefined;
    }

    return Math.round((available + fibre) * SCALE) / SCALE;
}
