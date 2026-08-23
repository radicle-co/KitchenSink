/**
 * @module unitEquivalence — what a gill is worth IN THIS BOOK, and how a line that states one is restated
 * into a measure the food catalog can actually weigh (R32, R33, R34, R35).
 *
 * DESIGN PATTERN: a **Chain of Responsibility** (the source book's own table, then the named external
 * standard) behind a function-shaped **Port** ({@link UnitEquivalenceResolver}), over **Value Objects**
 * ({@link UnitEquivalence}, {@link HistoricalUnitConversion}) and a **Strategy selected by data** (the
 * book's {@link BookMeasures}). One operation does not earn an interface, so the port is a function type.
 *
 * ## ⛔ Why this is per BOOK and not one global table
 *
 * An imperial gill is 142 mL against the US customary 118 mL — the same word, 20% apart. Four of the five
 * registered books are American; Montefiore's *The Jewish Manual* (London, 1846) is British, and is the
 * book most likely to lean on gills and wineglassfuls in the first place. A single global convention
 * would silently misconvert one book's entire corpus, and WHICH book depends only on which convention was
 * picked. So the equivalence is resolved from the source's own published table of weights and measures,
 * and a book with no table of its own follows the measure system of its ORIGIN — never a default.
 *
 * ## ⛔ Nothing here fetches anything
 *
 * {@link INTERNATIONAL_JEWISH_TABLE} is a TRANSCRIPTION, typed in from a copy an operator downloaded by
 * hand, with the book's own printed words kept beside each ratio so a reviewer checks the transcription
 * rather than trusting it. Project Gutenberg's terms bar automated access and the persisted `sourceUrl`
 * is a citation, not a fetch target — see `cookbooks.ts` and ADR-0023.
 *
 * ## ⚠️ The restated unit is read in US customary, deliberately, whatever the BOOK's system is
 *
 * A resolved equivalence is a MILLILITRE value read in the book's system. The unit that value is then
 * expressed in is `cup`/`tablespoon`/`teaspoon` as the USDA's household-portion table means them — US
 * customary — because that table is what `unitToGrams` matches against downstream. Restating an imperial
 * gill as "0.5 imperial cup" and shipping the string `cup` would reintroduce the exact 20% error this
 * module exists to remove. Millilitres are the bridge, and they are the only place the two systems meet.
 */
import {
    normalizeUnit,
    quantityLowerBound,
    quantityUpperBound,
    statedQuantity,
    type IngredientQuantity,
} from '@kitchensink/recipe-core';
import { millilitresPerUnit, roundToQuantityStorageScale, type MeasureSystem } from '@kitchensink/recipe-import-core';

/**
 * What is known about the system a book's volumes are written in (R33).
 *
 * ⛔ A DISCRIMINATED UNION, not a nullable `MeasureSystem`. "We have not established where this book comes
 * from" must not be spellable as US customary, and a `?? 'us-customary'` anywhere would do exactly that to
 * a whole corpus in one character. The `unestablished` member carries no system field at all, so there is
 * nothing to read one out of.
 */
export type BookMeasureOrigin =
    | {
          readonly kind: 'established';
          /** The system this book's measures are read in. */
          readonly system: MeasureSystem;
          /** WHY we say so — the evidence, in a sentence a reviewer can check. R34's other half. */
          readonly basis: string;
      }
    | {
          readonly kind: 'unestablished';
          /** Why the origin has not been established. A book in this state converts NOTHING. */
          readonly why: string;
      };

/** One line of a book's own printed table of weights and measures, transcribed. */
export interface PrintedEquivalence {
    /** The historical unit, canonicalised (`gill`, `wineglass`, `saltspoon`). */
    readonly unit: string;
    /** How many {@link per} make ONE {@link unit}. `2 gills = 1 cup` is recorded here as `0.5` of a cup. */
    readonly count: number;
    /** The unit {@link count} is measured in — one the measurement standard already defines. */
    readonly per: string;
    /**
     * The book's OWN words for this line, verbatim.
     *
     * ⚠️ Load-bearing, not decoration. `count`/`per` INVERT the direction the book prints ("2 gills = 1
     * cup" becomes "1 gill = 0.5 cup"), and an inverted transcription is a 4x error that looks perfectly
     * plausible in review. This is the string a reviewer checks the ratio against.
     */
    readonly printed: string;
}

/**
 * A book's own table of weights and measures — read from the bytes, or honestly recorded as unread.
 *
 * ⛔ `not-transcribed` is a MEMBER rather than an absent field, because R33 asks for the table to be
 * "read and recorded before that book is imported" and four of the five registered files are not held
 * locally. An absent field says nothing; this says which of the two it is, and why.
 */
export type BookMeasureTable =
    | {
          readonly kind: 'transcribed';
          /** Where in the book the table appears — the citation every equivalence drawn from it carries. */
          readonly citation: string;
          readonly entries: readonly PrintedEquivalence[];
      }
    | { readonly kind: 'not-transcribed'; readonly why: string };

/** Everything the registry knows about one book's measures. */
export interface BookMeasures {
    readonly origin: BookMeasureOrigin;
    readonly table: BookMeasureTable;
}

/** Which authority supplied a factor — the distinction R34 forbids leaving implicit. */
export type EquivalenceSource = 'source-book-table' | 'external-standard';

/** One resolved equivalence: the value, and the two facts R34 requires beside it. */
export interface UnitEquivalence {
    /** The canonical historical unit this is an equivalence for. */
    readonly unit: string;
    /** How many millilitres ONE of it holds, read in {@link measureSystem}. */
    readonly millilitres: number;
    /** The system the factor is read in. An imperial gill and a US customary gill are 20% apart. */
    readonly measureSystem: MeasureSystem;
    /** Who says so, in words. Never implicit (R34). */
    readonly citation: string;
    /** Who says so, machine-readably — so "the book told us" is assertable without matching a string. */
    readonly source: EquivalenceSource;
    /** The authority's own printed statement, verbatim. */
    readonly statedAs: string;
}

/**
 * THE PORT — given a unit as the source spelled it, the equivalence THIS book's measures give it.
 *
 * @returns The equivalence, or `null` when the unit is not historical, or no authority defines it, or the
 *   book has no established measure system to read it in.
 */
export type UnitEquivalenceResolver = (unit: string) => UnitEquivalence | null;

/**
 * R35's MARKER — a quantity restated out of a historical unit, carrying where its factor came from.
 *
 * ⛔ The `stated` half is kept, not discarded. A restated amount is no longer the amount the source
 * printed, and a conversion that cannot say what it converted FROM, under whose authority, and in which
 * measure system, is indistinguishable from a directly-stated metric quantity — which is precisely what
 * R35 forbids. This is the sibling of `RecipeNutrition.rangeDerivedBound`'s disclosure.
 */
export interface HistoricalUnitConversion {
    /** What the source printed. */
    readonly stated: { readonly quantity: IngredientQuantity; readonly unit: string };
    /** The same amount, in a unit the USDA household-portion table carries. */
    readonly restated: { readonly quantity: IngredientQuantity; readonly unit: CanonicalVolumeUnit };
    /** The factor used, its measure system and its citation (R34). */
    readonly equivalence: UnitEquivalence;
}

/** The volumetric units the food catalog's household portions actually speak. */
export type CanonicalVolumeUnit = 'cup' | 'tablespoon' | 'teaspoon';

/**
 * Restatement targets, LARGEST FIRST.
 *
 * The order is the preference: half a cup reads better than eight tablespoons, and both are the same
 * amount. See {@link restatementTarget} for the rule that picks among them.
 */
const CANONICAL_TARGETS: readonly CanonicalVolumeUnit[] = ['cup', 'tablespoon', 'teaspoon'];

/**
 * The system the RESTATED unit is read in — the USDA household-portion table's, not the book's.
 *
 * ⛔ Do not "fix" this to follow the book's own system. The string `cup` leaves this tool on a wire whose
 * other end matches it against USDA portions, which are US customary. See this module's header.
 */
const CATALOG_SYSTEM: MeasureSystem = 'us-customary';

/** How far from a value the column can store counts as "stores this exactly". Floats, not arithmetic. */
const EXACTNESS_TOLERANCE = 1e-9;

/** Smallest restated amount worth printing when no target stores the value exactly. */
const MIN_READABLE_AMOUNT = 0.25;

/**
 * The NAMED EXTERNAL STANDARD (R32) — the fallback for units a book leaves undefined.
 *
 * ⚠️ Each entry names the authority it ACTUALLY has, which is the whole of R34. Two different authorities
 * are involved and they are not merged:
 *
 *  - **The gill and the wineglass** are capacity measures a measurement standard defines. NIST Handbook 44,
 *    Appendix C ("General Tables of Units of Measurement") carries both the US customary and the British
 *    imperial liquid-measure tables, in which `4 gills = 1 pint` — the SAME relation in both, which is why
 *    one transcribed ratio yields 118 mL under one system and 142 mL under the other.
 *  - **The spoons** are NOT in any measurement standard. No standards body defines a `dessertspoon`; the
 *    UK Weights and Measures Act 1985 defined the gill but that definition was struck from Schedule 1 in
 *    1995. What exists is the pharmacopoeial "approximate measures" scale that these books were written
 *    beside — 1 dessertspoonful = 2 teaspoonfuls, 1 saltspoonful = a quarter teaspoonful. It is cited AS
 *    a household convention rather than dressed as a statute: naming what an authority actually is IS
 *    R34 compliance, and a false statutory citation is not.
 *
 * ⛔ Every entry is a RELATION to a unit the standard already sizes per system — never a millilitre
 * constant. That is what makes the US/imperial split fall out of arithmetic instead of out of two
 * hand-typed numbers that can disagree.
 */
const EXTERNAL_STANDARD: Readonly<Record<string, PrintedEquivalence & { readonly citation: string }>> = {
    gill: {
        unit: 'gill',
        count: 0.25,
        per: 'pint',
        printed: '4 gills = 1 pint',
        citation:
            'NIST Handbook 44, Appendix C — General Tables of Units of Measurement, liquid measure ' +
            '("4 gills = 1 pint" in both the US customary and British imperial tables)',
    },
    wineglass: {
        unit: 'wineglass',
        count: 2,
        per: 'fluid ounce',
        printed: '1 wineglassful = 2 fluid ounces',
        citation:
            'Household approximate-measures convention (a wineglassful is two fluid ounces), sized per ' +
            'system by NIST Handbook 44, Appendix C — General Tables of Units of Measurement',
    },
    dessertspoon: {
        unit: 'dessertspoon',
        count: 2,
        per: 'teaspoon',
        printed: '1 dessertspoonful = 2 teaspoonfuls',
        citation:
            'Pharmacopoeial approximate-measures scale (1 dessertspoonful = 2 teaspoonfuls). ⚠️ A ' +
            'household convention, NOT a measurement standard — no standards body defines a dessertspoon',
    },
    saltspoon: {
        unit: 'saltspoon',
        count: 0.25,
        per: 'teaspoon',
        printed: '1 saltspoonful = one quarter teaspoonful',
        citation:
            'Household approximate-measures convention (a saltspoonful is a quarter teaspoonful). ⚠️ A ' +
            'household convention, NOT a measurement standard',
    },
};

/**
 * #12350's OWN table of weights and measures, transcribed.
 *
 * The book pins its own system in prose — "the cup should be the regulation half-pint cup" — which is the
 * US customary pint, and that sentence is the `basis` its registry entry records. Its ratios AGREE with
 * the external standard to the millilitre; the difference the reader is owed is the CITATION, because
 * "the book printed this" and "we applied the standard" are different claims even at the same number.
 *
 * ⚠️ Only the UNIT equivalences are taken. The period tables also carry ingredient-specific mass
 * equivalences ("4 cups of flour = 1 pound"); food densities stay USDA.
 */
export const INTERNATIONAL_JEWISH_TABLE: BookMeasureTable = {
    kind: 'transcribed',
    citation:
        'The International Jewish Cook Book, Florence Kreisler Greenbaum (Project Gutenberg #12350), ' +
        '"TABLE OF WEIGHTS AND MEASURES"',
    entries: [
        { unit: 'gill', count: 0.5, per: 'cup', printed: '2 gills = 1 cup' },
        { unit: 'wineglass', count: 4, per: 'tablespoon', printed: '4 tablespoons = 1 wine-glass' },
        { unit: 'saltspoon', count: 0.25, per: 'teaspoon', printed: '4 saltspoons = 1 teaspoon' },
    ],
};

/**
 * The equivalence this book's measures give one unit.
 *
 * DESIGN PATTERN: Chain of Responsibility, two links deep — the book's own table answers first, and the
 * named external standard covers only what that book leaves undefined (R32).
 *
 * @param measures - What the registry knows about the book.
 * @param unit - The unit as the source spelled it; canonicalised here.
 * @returns The equivalence, or `null`. `null` for an UNESTABLISHED origin is the point of R33: a book
 *   whose measure system nobody has established converts nothing, rather than converting as though it
 *   were American. Pure.
 */
export function resolveUnitEquivalence(measures: BookMeasures, unit: string): UnitEquivalence | null {
    const { origin, table } = measures;

    if (origin.kind === 'unestablished') {
        return null;
    }

    const canonical = normalizeUnit(unit);
    const printed = table.kind === 'transcribed' ? table.entries.find((entry) => entry.unit === canonical) : undefined;

    if (printed !== undefined) {
        return equivalenceFrom(
            printed,
            origin.system,
            table.kind === 'transcribed' ? table.citation : '',
            'source-book-table',
        );
    }

    const standard = EXTERNAL_STANDARD[canonical];

    return standard === undefined
        ? null
        : equivalenceFrom(standard, origin.system, standard.citation, 'external-standard');
}

/** One relation, sized in a system. `null` when the standard does not define the unit it is measured in. */
function equivalenceFrom(
    printed: PrintedEquivalence,
    system: MeasureSystem,
    citation: string,
    source: EquivalenceSource,
): UnitEquivalence | null {
    const perUnit = millilitresPerUnit(printed.per, system);

    if (perUnit === null) {
        return null;
    }

    return Object.freeze({
        unit: printed.unit,
        millilitres: printed.count * perUnit,
        measureSystem: system,
        citation,
        source,
        statedAs: printed.printed,
    });
}

/**
 * Bind one book's measures to the port, so a caller physically cannot mix two books' factors.
 *
 * @param measures - What the registry knows about the book.
 * @returns A resolver closed over exactly that book. Pure.
 */
export function unitEquivalenceFor(measures: BookMeasures): UnitEquivalenceResolver {
    return (unit) => resolveUnitEquivalence(measures, unit);
}

/**
 * Restate a stated historical amount into a unit the food catalog can weigh, carrying R35's marker.
 *
 * @param resolve - The port, bound to the book this line came from.
 * @param quantity - What the source stated. An `absent` quantity converts to nothing: there is no number
 *   to restate, and inventing one is R40's forbidden fabrication.
 * @param unit - The unit the source stated.
 * @returns The conversion and its provenance, or `null` — for a modern unit, an unresolvable historical
 *   one, an absent quantity, or a restated bound the `numeric(10,3)` column could not store. `null` is a
 *   REFUSAL the caller reports and the line keeps its own words; it never silently half-converts. Pure.
 */
export function convertHistoricalUnit(
    resolve: UnitEquivalenceResolver,
    quantity: IngredientQuantity,
    unit: string,
): HistoricalUnitConversion | null {
    const equivalence = resolve(unit);

    if (equivalence === null || quantity.kind === 'absent') {
        return null;
    }

    const target = restatementTarget(equivalence.millilitres);

    if (target === null) {
        return null;
    }

    const low = quantityLowerBound(quantity);
    const high = quantityUpperBound(quantity);

    if (low === null) {
        return null;
    }

    const restated = statedQuantity(
        restate(low, equivalence.millilitres, target.millilitres),
        quantity.kind === 'range' && high !== null ? restate(high, equivalence.millilitres, target.millilitres) : null,
    );

    if (restated === null) {
        return null;
    }

    return Object.freeze({
        stated: Object.freeze({ quantity, unit: equivalence.unit }),
        restated: Object.freeze({ quantity: restated, unit: target.unit }),
        equivalence,
    });
}

/** One bound, restated and rounded to what the column keeps. */
function restate(bound: number, millilitres: number, perTarget: number): number {
    return roundToQuantityStorageScale((bound * millilitres) / perTarget);
}

/**
 * Which canonical unit to restate into, and its size.
 *
 * The rule is: the LARGEST target the column can store the result of EXACTLY; failing that, the largest
 * whose result is still readable at three decimal places. Exactness first is not aesthetics — a saltspoon
 * in cups is 0.005208…, stored as 0.005, a 4% error on a public recipe's nutrition. It also lands on each
 * authority's own framing (a saltspoon becomes 0.25 teaspoon, which is exactly how #12350 prints it), so
 * the restatement is checkable against the source rather than being an arbitrary pick.
 *
 * @param millilitres - One historical unit, in millilitres.
 * @returns The target and its US customary size, or `null` when the standard sizes none of them. Pure.
 */
function restatementTarget(
    millilitres: number,
): { readonly unit: CanonicalVolumeUnit; readonly millilitres: number } | null {
    const sized = CANONICAL_TARGETS.map((unit) => ({
        unit,
        millilitres: millilitresPerUnit(unit, CATALOG_SYSTEM),
    })).flatMap((candidate) =>
        candidate.millilitres === null ? [] : [{ unit: candidate.unit, millilitres: candidate.millilitres }],
    );

    const exact = sized.find((candidate) => {
        const value = millilitres / candidate.millilitres;

        return Math.abs(value - roundToQuantityStorageScale(value)) <= EXACTNESS_TOLERANCE;
    });

    return (
        exact ??
        sized.find((candidate) => millilitres / candidate.millilitres >= MIN_READABLE_AMOUNT) ??
        sized.at(-1) ??
        null
    );
}
