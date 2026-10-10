/**
 * Unit tests for the historical-unit half of the import REPORT (R34, R35).
 *
 * The report is where a converted amount becomes AUDITABLE: R34 says an equivalence that leaves its
 * citation or its measure system implicit does not satisfy the requirement, and a run that converted
 * hundreds of lines without recording under whose authority is exactly that failure at scale.
 *
 * ⛔ The assertion that matters is the PARTITION by citation. A single "conversions: 47" counter would
 * pass every test here while hiding the one thing a reader needs — that the gills came from the book's
 * own table and the dessertspoons from an external standard the book never mentions (AE16).
 */
import { describe, it, expect } from 'vitest';
import { statedQuantity, type IngredientQuantity } from '@kitchensink/recipe-core';

import { COOKBOOKS } from '../cookbooks.js';
import {
    emptyObservation,
    emptyReport,
    recordHistoricalConversion,
    recordSuggestionLead,
    renderReport,
} from '../importReport.js';
import { convertHistoricalUnit, unitEquivalenceFor, type HistoricalUnitConversion } from '../unitEquivalence.js';

/** A real conversion, produced by the real resolver — never a hand-built literal that cannot go stale. */
function conversionOf(bookKey: string, unit: string): HistoricalUnitConversion {
    const quantity = statedQuantity(1) as IngredientQuantity;
    const conversion = convertHistoricalUnit(unitEquivalenceFor(COOKBOOKS[bookKey].measures), quantity, unit);

    if (conversion === null) {
        throw new Error(`test fixture: ${bookKey} resolves no equivalence for ${unit}`);
    }

    return conversion;
}

describe('recordHistoricalConversion', () => {
    it('counts conversions and partitions them by the authority that sized each unit (R34, AE16)', () => {
        const report = emptyReport('a book');

        recordHistoricalConversion(report, conversionOf('international-jewish', 'gill'));
        recordHistoricalConversion(report, conversionOf('international-jewish', 'gill'));
        recordHistoricalConversion(report, conversionOf('international-jewish', 'dessertspoon'));

        expect(report.historicalConversions).toBe(3);

        const authorities = report.historicalEquivalences;

        expect(authorities).toHaveLength(2);
        expect(authorities.find((entry) => entry.unit === 'gill')?.source).toBe('standard');
        expect(authorities.find((entry) => entry.unit === 'dessertspoon')?.source).toBe('convention');
        expect(authorities.find((entry) => entry.unit === 'gill')?.lines).toBe(2);
    });

    it('records each equivalence ONCE however many lines used it', () => {
        const report = emptyReport('a book');

        for (let index = 0; index < 20; index += 1) {
            recordHistoricalConversion(report, conversionOf('international-jewish', 'gill'));
        }

        expect(report.historicalEquivalences).toHaveLength(1);
        expect(report.historicalEquivalences[0]?.lines).toBe(20);
    });

    /**
     * ⛔ The same unit from two books is two DIFFERENT equivalences, and collapsing them would erase the
     * distinction the whole unit exists to draw. A report cannot be keyed on the unit alone.
     */
    it('keeps the same unit apart when two books size it differently (R33)', () => {
        const report = emptyReport('two books');

        recordHistoricalConversion(report, conversionOf('international-jewish', 'gill'));
        recordHistoricalConversion(report, conversionOf('jewish-manual', 'gill'));

        expect(report.historicalEquivalences).toHaveLength(2);
        expect(report.historicalEquivalences.map((entry) => entry.measureSystem).sort()).toEqual([
            'british-imperial',
            'us-customary',
        ]);
    });
});

/**
 * Ranking-quality aggregation (owner ruling 2026-08-31, U15 report "Owner rulings" §2) — the operator-side
 * instrument for the list's ordering. The capture census U15 had to derive by SQL after the fact
 * ("Lentils … without salt" captured 18 distinct phrases) is now a first-class report figure. After plan 002 S5 the
 * group that can capture is the curator's own foods, which lead whenever they match.
 */
describe('recordSuggestionLead', () => {
    it('partitions leads by group and counts the weak token-only captures', () => {
        const report = emptyReport('international-jewish');

        recordSuggestionLead(report, { group: 'catalog', weakTokenLead: false }, 'Salt, table', 'salt');
        recordSuggestionLead(report, { group: 'authored', weakTokenLead: false }, 'Onions, raw', 'onion');
        recordSuggestionLead(report, { group: 'authored', weakTokenLead: true }, 'Lentils, without salt', 'salt');

        expect(report.suggestionLeads).toMatchObject({ authored: 2, catalog: 1, weakTokenLeads: 1 });
    });

    it('records each attractor with the DISTINCT queries it captured — repeats collapse', () => {
        const report = emptyReport('international-jewish');

        recordSuggestionLead(report, { group: 'authored', weakTokenLead: true }, 'Lentils, without salt', 'salt');
        recordSuggestionLead(report, { group: 'authored', weakTokenLead: true }, 'Lentils, without salt', 'salt');
        recordSuggestionLead(
            report,
            { group: 'authored', weakTokenLead: true },
            'Lentils, without salt',
            'a pinch of salt',
        );

        expect(report.suggestionLeads.attractors).toEqual({
            'Lentils, without salt': ['salt', 'a pinch of salt'],
        });
        expect(report.suggestionLeads.weakTokenLeads).toBe(3);
    });

    it('renders the section with the capture share, worst attractors first', () => {
        const report = emptyReport('international-jewish');
        recordSuggestionLead(report, { group: 'authored', weakTokenLead: true }, 'Lentils, without salt', 'salt');
        recordSuggestionLead(report, { group: 'authored', weakTokenLead: true }, 'Lentils, without salt', 'pepper');
        recordSuggestionLead(report, { group: 'authored', weakTokenLead: true }, 'Rice, white', 'white wine');
        recordSuggestionLead(report, { group: 'catalog', weakTokenLead: false }, 'Salt, table', 'salt');

        const rendered = renderReport(report);

        expect(rendered).toContain('SUGGESTION RANKING');
        expect(rendered).toContain("led by one of the curator's foods   3");
        expect(rendered).toContain('weak token-only own-food leads      3');
        expect(rendered.indexOf('"Lentils, without salt" captured 2')).toBeLessThan(
            rendered.indexOf('"Rice, white" captured 1'),
        );
    });

    it('omits the section entirely for a run where nothing resolved via a suggestion', () => {
        expect(renderReport(emptyReport('international-jewish'))).not.toContain('SUGGESTION RANKING');
    });
});

describe('renderReport', () => {
    /**
     * Each of food's two searches fails on its own (plan 002 S5), so the report counts each apart, and apart from a
     * search that answered with nothing: a rate measured while a search was down describes the outage.
     */
    it('prints each search’s failures on its own line', () => {
        const report = { ...emptyReport('a book'), catalogUnavailable: 4, authoredUnavailable: 2 };

        const rendered = renderReport(report);

        expect(rendered).toContain('catalog search failed (lookups)     4');
        expect(rendered).toContain('own-food search failed (lookups)    2');
    });

    it('prints the measure system and the citation, so a run is auditable from the terminal', () => {
        const report = emptyReport('The International Jewish Cook Book');

        recordHistoricalConversion(report, conversionOf('international-jewish', 'gill'));

        const rendered = renderReport(report);

        expect(rendered).toContain('HISTORICAL UNIT');
        expect(rendered).toContain('gill');
        expect(rendered).toContain('us-customary');
        expect(rendered).toContain('UCUM');
    });

    it('says nothing about historical units when a run converted none', () => {
        expect(renderReport(emptyReport('a book'))).not.toContain('HISTORICAL UNIT');
    });

    it('prints how many clauses the instruction gate kept from the engines, and each one verbatim', () => {
        const report = emptyReport('a book');
        const observation = emptyObservation();

        observation.skippedAsInstruction.push('drop in 2 pans');
        report.parseObservation = observation;

        const rendered = renderReport(report);

        expect(rendered).toContain('clauses skipped as instructions     1');
        expect(rendered).toContain('"drop in 2 pans"');
    });

    it('prints a zero when the gate skipped nothing, so a reader can tell it ran', () => {
        const report = emptyReport('a book');

        report.parseObservation = emptyObservation();

        expect(renderReport(report)).toContain('clauses skipped as instructions     0');
    });
});
