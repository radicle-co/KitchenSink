/**
 * @module standardUnits — where each historical unit's SIZE comes from.
 *
 * ## Two kinds of unit, and only one of them is ours to define
 *
 * **The gill is standardised.** UCUM — the Unified Code for Units of Measure — carries `[gil_us]` and
 * `[gil_br]` as distinct units, and that pair IS the 118 mL / 142 mL split. `@lhncbc/ucum-lhc` is the US
 * National Library of Medicine's maintained implementation, so the number comes from the standard rather
 * than from arithmetic of ours.
 *
 * ⛔ It used to be ours: `{ count: 0.25, per: 'pint' }`, hand-transcribed beside a hand-written citation.
 * That is a reimplementation of a published standard — exactly what `CLAUDE.md`'s library-first rule exists
 * to prevent — and nobody checked for a library. The cost was not hypothetical: it took a round of research
 * against primary legislation and NIST handbooks to verify by hand what UCUM already encodes, and two of
 * the citations that research checked turned out to be false.
 *
 * **The wineglass, saltspoon and dessertspoon are not standardised, and never will be.** Checked: UCUM has
 * none of them, `convert-units` has none of them, and of NIST (HB 44 App. C, HB 133 App. E, SP 811),
 * BIPM's SI Brochure, ISO 80000, the UK Weights and Measures Act 1985 and 21 CFR 101, **none defines a
 * dessertspoon**. They are household conventions, so they are ours — a ratio to a unit the standard does
 * define, which is what keeps them sized per system without a second constant.
 *
 * ## Why a dependency and not a service
 *
 * A gill has been a quarter pint since 1824. There is nothing to refresh, so a lookup would be a network
 * call on the ingredient-parse path — through ADR-0004's single `t4g.nano` NAT — to learn a fact that
 * cannot change, and it would make the golden-corpus tests non-deterministic. Frozen data belongs in the
 * build.
 */
import { UcumLhcUtils } from '@lhncbc/ucum-lhc';
import { normalizeUnit } from '@kitchensink/recipe-core';
import { millilitresPerUnit, type MeasureSystem } from '@kitchensink/recipe-import-core';

/** How one historical unit is sized. The discriminant IS the distinction a reader is owed. */
export type StandardEquivalence =
    | {
          /** A published standard defines this unit outright. */
          readonly kind: 'standard';
          /** Its UCUM code per measure system — the codes ARE the per-system difference. */
          readonly ucum: Readonly<Record<MeasureSystem, string>>;
          /** Short attribution. ⚠️ Rendered to a cook in the recipe's description; keep it that way. */
          readonly citation: string;
      }
    | {
          /** No standard defines it; this is a household convention expressed against one that is. */
          readonly kind: 'convention';
          /** How many `per` make one of this unit. */
          readonly count: number;
          /** The standard unit it is measured in, sized per system by the parser's own converter. */
          readonly per: string;
          /** Short attribution. ⚠️ Rendered to a cook. */
          readonly citation: string;
      };

/**
 * The historical units this importer understands.
 *
 * ⚠️ Deliberately NOT per-book. A book's own printed table was tried and removed: measured on the one book
 * that had been transcribed, all three of its ratios were bit-identical to these — `diff 0.000000000` — so
 * it produced the same numbers by a longer route and changed only which citation printed. What genuinely
 * varies per book is the measure SYSTEM, which is one field on its registry entry, not a table.
 */
export const STANDARD_EQUIVALENCES: Readonly<Record<string, StandardEquivalence>> = {
    gill: {
        kind: 'standard',
        ucum: { 'us-customary': '[gil_us]', 'british-imperial': '[gil_br]' },
        citation: 'UCUM (gill)',
    },
    wineglass: {
        kind: 'convention',
        count: 2,
        per: 'fluid ounce',
        citation: 'a household convention (1 wineglassful = 2 fluid ounces)',
    },
    dessertspoon: {
        kind: 'convention',
        count: 2,
        per: 'teaspoon',
        citation: 'a household convention (1 dessertspoonful = 2 teaspoonfuls)',
    },
    saltspoon: {
        kind: 'convention',
        count: 0.25,
        per: 'teaspoon',
        citation: 'a household convention (1 saltspoonful = ¼ teaspoonful)',
    },
};

/** UCUM's converter is expensive to construct and immutable once built, so it is built once. */
const ucum = UcumLhcUtils.getInstance();

/**
 * The size of one historical unit in millilitres, in a given measure system.
 *
 * @param unit - The unit as written; normalized here.
 * @param system - Which system sizes it.
 * @returns Millilitres, or `null` when neither a standard nor a convention covers the unit.
 * @sideEffect None beyond UCUM's own memoized table lookup.
 */
export function millilitresForStandardUnit(unit: string, system: MeasureSystem): number | null {
    const entry = STANDARD_EQUIVALENCES[normalizeUnit(unit)];

    if (entry === undefined) {
        return null;
    }

    if (entry.kind === 'convention') {
        const perUnit = millilitresPerUnit(entry.per, system);

        return perUnit === null ? null : entry.count * perUnit;
    }

    const converted = ucum.convertUnitTo(entry.ucum[system], 1, 'mL');

    // A failed conversion is `null` rather than a throw: an unreadable unit is DATA the import carries
    // forward as unconverted, exactly as an unparseable line is.
    return converted.status === 'succeeded' && typeof converted.toVal === 'number' ? converted.toVal : null;
}
