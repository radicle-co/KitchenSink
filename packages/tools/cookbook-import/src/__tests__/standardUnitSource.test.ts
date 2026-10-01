/**
 * Where each historical unit's size comes FROM — a standard, or our own table.
 *
 * ## The distinction this pins, and why it is the whole design
 *
 * Four units are involved and they are not the same kind of thing:
 *
 *  - **The gill IS standardised.** UCUM — the Unified Code for Units of Measure — carries `[gil_us]` and
 *    `[gil_br]` as distinct units, which is exactly the split that makes a gill 118 mL in an American book
 *    and 142 mL in a British one. `@lhncbc/ucum-lhc` is the NLM's maintained implementation of it.
 *  - **The wineglass, saltspoon and dessertspoon are NOT.** Checked: UCUM has none of them, `convert-units`
 *    has none of them, and NIST/BIPM/ISO/21 CFR/the UK Weights and Measures Act define no dessertspoon at
 *    all. No library will ever carry them, because they are household conventions rather than units.
 *
 * ⛔ So the gill must NOT be a ratio of ours. It was `0.25 × pint`, hand-transcribed with a hand-written
 * citation — a reimplementation of a published standard, which `CLAUDE.md`'s library-first rule exists to
 * stop, and which cost a round of research verifying by hand what the library already encodes.
 *
 * ⚠️ The library is a DEPENDENCY, not a service. A gill has been a quarter pint since 1824; there is
 * nothing to refresh, and a network call on the ingredient-parse path would put ADR-0004's single
 * `t4g.nano` NAT between a cook and their recipe.
 */
import { describe, expect, it } from 'vitest';

import { STANDARD_EQUIVALENCES, millilitresForStandardUnit } from '../standardUnits.js';

describe('the gill comes from UCUM, not from us', () => {
    it('sizes a US gill from the standard', () => {
        // 118.294 118 25 mL exactly — 4 US fluid ounces. NOT a number this repository computed.
        expect(millilitresForStandardUnit('gill', 'us-customary')).toBeCloseTo(118.29411825, 6);
    });

    it('sizes a British gill from the standard', () => {
        // 142.065 312 5 mL exactly — a quarter of the imperial pint the 1985 Act defines as 0.568 261 25 L.
        expect(millilitresForStandardUnit('gill', 'british-imperial')).toBeCloseTo(142.0653125, 6);
    });

    it('⛔ gives the two systems DIFFERENT sizes — the whole reason the system is tracked', () => {
        const us = millilitresForStandardUnit('gill', 'us-customary');
        const imperial = millilitresForStandardUnit('gill', 'british-imperial');

        expect(us).not.toBeCloseTo(imperial ?? 0, 3);
        // ~20% apart. A book placed in the wrong system misstates every gill by that much.
        expect((imperial ?? 0) / (us ?? 1)).toBeCloseTo(1.2009, 3);
    });

    it('declares the gill as standard-sourced rather than as a ratio of ours', () => {
        expect(STANDARD_EQUIVALENCES['gill']?.kind).toBe('standard');
    });
});

describe('the household conventions stay ours, because nothing else has them', () => {
    it.each(['wineglass', 'saltspoon', 'dessertspoon'])('declares %s a convention, not a standard', (unit) => {
        expect(STANDARD_EQUIVALENCES[unit]?.kind).toBe('convention');
    });

    it('sizes a convention through a unit the standard DOES define', () => {
        // A wineglassful is two fluid ounces — the convention is the ratio, the fluid ounce is standard.
        expect(millilitresForStandardUnit('wineglass', 'us-customary')).toBeCloseTo(59.1470591, 5);
    });

    it('carries a SHORT attribution, because a cook reads it', () => {
        // It renders into the recipe's description. The scholarship lives in the module header.
        for (const entry of Object.values(STANDARD_EQUIVALENCES)) {
            expect(entry.citation.length).toBeLessThan(80);
        }
    });

    it('returns null for a unit no standard and no convention covers', () => {
        expect(millilitresForStandardUnit('handful', 'us-customary')).toBeNull();
    });
});
