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
 * and a book follows the measure system of its ORIGIN — never a default.
 *
 * ## ⛔ Nothing here fetches anything
 *
 * `standardUnits.ts` holds the sizes, and its gill comes from UCUM — a DEPENDENCY, resolved at build time,
 * not a service queried at runtime. Project Gutenberg's terms bar automated access and the persisted
 * `sourceUrl` is a citation, not a fetch target — see `cookbooks.ts` and ADR-0023.
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
    type StatedAmount,
} from '@kitchensink/recipe-core';
import { millilitresPerUnit, roundToQuantityStorageScale, type MeasureSystem } from '@kitchensink/recipe-import-core';
import { STANDARD_EQUIVALENCES, millilitresForStandardUnit } from './standardUnits.js';

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
 * ⛔ A book's OWN printed table used to live here and was removed on measurement. The one book that had
 * been transcribed printed three ratios, and all three were bit-identical to the shared standard —
 * `diff 0.000000000` — so the per-book table produced the same numbers by a longer route and changed only
 * which citation printed. It also made every new cookbook a TypeScript change plus a transcription step.
 *
 * What genuinely varies per book is the measure SYSTEM below, because a gill is a quarter pint in both
 * systems and it is the PINT that differs. One field, not a table. A per-book override earns its place the
 * day a book prints a ratio that actually disagrees with the standard; none does today, and building the
 * mechanism before that case exists is speculative capability with a per-book carrying cost.
 */

/** Everything the registry knows about one book's measures. */
export interface BookMeasures {
    readonly origin: BookMeasureOrigin;
}

/**
 * Which KIND of authority supplied a factor — the distinction R34 forbids leaving implicit.
 *
 * ⚠️ It is no longer "the book or the standard": the book's table is gone (see above). It is now the
 * distinction that actually matters to a reader — a published standard defines this unit, or nobody does
 * and we are applying a household convention.
 */
export type EquivalenceSource = 'standard' | 'convention';

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
    /**
     * What the source printed.
     *
     * ⛔ `StatedAmount`, not `IngredientQuantity`: a restatement OF nothing is not a thing, and this value is
     * persisted through `statedMeasureSchema`, which has no `absent` member either. The type carries the
     * refusal rather than leaving it to a runtime check downstream.
     */
    readonly stated: { readonly quantity: StatedAmount; readonly unit: string };
    /** The same amount, in a unit the USDA household-portion table carries. Never `absent`, for the same reason. */
    readonly restated: { readonly quantity: StatedAmount; readonly unit: CanonicalVolumeUnit };
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
 * Resolve one historical unit against this book's measure system.
 *
 * ⛔ There is no book-table branch any more, and its absence is the design. The chain used to prefer a
 * book's own printed ratio over the standard so a false citation could never be produced — a sound rule for
 * a chain that had two links. Measured, the second link never disagreed with the first: the single
 * transcribed book's three ratios matched the standard exactly. So the branch guarded a case that did not
 * occur, at the cost of a transcription step per cookbook.
 *
 * @param measures - What the registry knows about the book, of which only the system is now load-bearing.
 * @param unit - The unit as the source spelled it.
 * @returns The equivalence, or `null` when the book is unplaced or nothing sizes the unit. Pure.
 */
export function resolveUnitEquivalence(measures: BookMeasures, unit: string): UnitEquivalence | null {
    const { origin } = measures;

    // ⛔ An unplaced book converts NOTHING. `unestablished` carries no system field precisely so that "we
    // have not placed this book" cannot be read as US customary — the default that would silently misstate
    // every British gill by 20%.
    if (origin.kind === 'unestablished') {
        return null;
    }

    const canonical = normalizeUnit(unit);
    const entry = STANDARD_EQUIVALENCES[canonical];
    const millilitres = millilitresForStandardUnit(canonical, origin.system);

    if (entry === undefined || millilitres === null) {
        return null;
    }

    return {
        unit: canonical,
        millilitres,
        measureSystem: origin.system,
        citation: entry.citation,
        source: entry.kind,
        statedAs: entry.citation,
    };
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

    if (restated === null || restated.kind === 'absent') {
        return null;
    }

    // ⛔ THE ARITHMETIC CHECKS ITSELF, and a failure is OUR bug rather than a verdict about the cook's line.
    // See `representsStatedAmount` below for why this cannot be left to the verification gate.
    if (!representsStatedAmount(quantity, restated, equivalence.millilitres, target.millilitres)) {
        return null;
    }

    return Object.freeze({
        stated: Object.freeze({ quantity, unit: equivalence.unit }),
        restated: Object.freeze({ quantity: restated, unit: target.unit }),
        equivalence,
    });
}

/**
 * How far a restated bound may sit from the amount it came from, as a fraction, before it is refused.
 *
 * ⛔ NOT A GUESS, and not to be widened. Measured against every unit this importer understands, in both
 * measure systems: the worst real case is a British gill restated into US customary cups — 0.6004… stored as
 * 0.600, an error of 0.08%. One per cent leaves that two orders of magnitude of headroom while still catching
 * the failure the fallback branches of {@link restatementTarget} can produce (a hundredth of a saltspoon
 * rounds from 0.0025 to 0.003 teaspoon: twenty per cent MORE of the ingredient than the source printed).
 *
 * If a future unit is refused by this bound, the answer is to widen {@link CANONICAL_TARGETS} so the
 * restatement lands on a unit that can hold it — never to widen the tolerance, which would let the error
 * through everywhere at once.
 */
const RESTATEMENT_TOLERANCE = 0.01;

/**
 * Whether a restated quantity still represents the amount the source printed.
 *
 * ## ⛔ WHY THIS EXISTS, AND WHY IT IS NOT THE VERIFICATION GATE'S JOB
 *
 * Since plan U7's gate fix the two halves of a conversion have different readers: the STATED pair is
 * persisted and is what U11's model is asked about (asking it about a number the source never printed
 * manufactures a false DISAGREE), while the RESTATED pair is what nutrition is computed from. That split is
 * only sound if the two describe the same amount — and nothing checked it. A conversion is deterministic
 * arithmetic we performed, so it needs an ASSERTION, not a language model: the model is bad at arithmetic,
 * and the comparison is one the source's own words do not support.
 *
 * Two ways the arithmetic can drift, both of which produce a perfectly plausible-looking row:
 *
 *  1. **The KIND changes.** `statedQuantity` collapses coincident bounds to `exact`, so a stated RANGE whose
 *     two bounds round together at three decimal places becomes a single restated value. The gate would then
 *     be shown two numbers while nutrition used one.
 *  2. **The VALUE moves.** `restate` rounds each bound to what `numeric(10,3)` keeps, and
 *     {@link restatementTarget}'s fallbacks can land on a target where that rounding is a large RELATIVE
 *     error even though it is a small absolute one.
 *
 * Millilitres are the comparison, because they are the only place the two units meet — the same reasoning
 * that makes them the bridge in the first place (see this module's header).
 *
 * @param stated - What the source printed.
 * @param restated - What it was restated to.
 * @param statedMillilitres - One stated unit, in millilitres, read in the BOOK's system.
 * @param targetMillilitres - One restated unit, in millilitres, read in the CATALOG's system.
 * @returns Whether every bound survives within {@link RESTATEMENT_TOLERANCE}, and the kind is unchanged. Pure.
 */
function representsStatedAmount(
    stated: IngredientQuantity,
    restated: IngredientQuantity,
    statedMillilitres: number,
    targetMillilitres: number,
): boolean {
    // ⛔ Kind first. Comparing bounds pairwise across two different kinds would compare a range's high bound
    // against an exact value's only one and call them equal.
    if (stated.kind !== restated.kind) {
        return false;
    }

    const bounds: readonly (readonly [number | null, number | null])[] = [
        [quantityLowerBound(stated), quantityLowerBound(restated)],
        [quantityUpperBound(stated), quantityUpperBound(restated)],
    ];

    return bounds.every(([statedBound, restatedBound]) => {
        if (statedBound === null || restatedBound === null) {
            // Both are `null` for the same member of the same kind, which the guard above already pinned.
            return statedBound === restatedBound;
        }

        const expected = statedBound * statedMillilitres;

        return Math.abs(restatedBound * targetMillilitres - expected) / expected <= RESTATEMENT_TOLERANCE;
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
