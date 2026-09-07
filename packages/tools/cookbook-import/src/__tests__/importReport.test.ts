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
import { emptyReport, recordHistoricalConversion, recordSuggestionLead, renderReport } from '../importReport.js';
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
 * instrument for the suggest blend's ordering. The capture census U15 had to derive by SQL after the fact
 * ("Lentils … without salt" captured 18 distinct phrases) is now a first-class report figure.
 */
describe('recordSuggestionLead', () => {
    it('partitions leads by provenance and counts the weak token-only captures', () => {
        const report = emptyReport('international-jewish');

        recordSuggestionLead(report, { provenance: 'catalog', weakTokenLead: false }, 'Salt, table', 'salt');
        recordSuggestionLead(report, { provenance: 'local', weakTokenLead: false }, 'Onions, raw', 'onion');
        recordSuggestionLead(report, { provenance: 'local', weakTokenLead: true }, 'Lentils, without salt', 'salt');

        expect(report.suggestionLeads).toMatchObject({ local: 2, catalog: 1, weakTokenLeads: 1 });
    });

    it('records each attractor with the DISTINCT queries it captured — repeats collapse', () => {
        const report = emptyReport('international-jewish');

        recordSuggestionLead(report, { provenance: 'local', weakTokenLead: true }, 'Lentils, without salt', 'salt');
        recordSuggestionLead(report, { provenance: 'local', weakTokenLead: true }, 'Lentils, without salt', 'salt');
        recordSuggestionLead(
            report,
            { provenance: 'local', weakTokenLead: true },
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
        recordSuggestionLead(report, { provenance: 'local', weakTokenLead: true }, 'Lentils, without salt', 'salt');
        recordSuggestionLead(report, { provenance: 'local', weakTokenLead: true }, 'Lentils, without salt', 'pepper');
        recordSuggestionLead(report, { provenance: 'local', weakTokenLead: true }, 'Rice, white', 'white wine');
        recordSuggestionLead(report, { provenance: 'catalog', weakTokenLead: false }, 'Salt, table', 'salt');

        const rendered = renderReport(report);

        expect(rendered).toContain('SUGGESTION RANKING');
        expect(rendered).toContain('weak token-only local leads         3');
        expect(rendered.indexOf('"Lentils, without salt" captured 2')).toBeLessThan(
            rendered.indexOf('"Rice, white" captured 1'),
        );
    });

    it('omits the section entirely for a run where nothing resolved via a suggestion', () => {
        expect(renderReport(emptyReport('international-jewish'))).not.toContain('SUGGESTION RANKING');
    });
});

describe('renderReport', () => {
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
});
