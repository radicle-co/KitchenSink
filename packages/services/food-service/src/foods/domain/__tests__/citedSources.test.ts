/**
 * Which sources the Data sources page lists, and what it says about each (plan R55, design §S16).
 *
 * The owner ruled the page lists ONLY a source some stored value cites (2026-10-01). A citation names its DATASET,
 * and USDA publishes three that rank apart (KTD-22), so a source is listed when ANY of its datasets is cited, and it
 * is marked converted when ANY citation of it recorded an R54 conversion. A manufacturer's label is not a register
 * source, so it is never listed.
 */
import { describe, expect, it } from 'vitest';

import { citedSourceViews } from '../citedSources.js';

describe('citedSourceViews', () => {
    it('lists nothing when nothing is cited, the page’s empty state', () => {
        expect(citedSourceViews([])).toEqual([]);
    });

    it.each(['usdaSrFoundation', 'usdaFndds', 'usdaBranded'] as const)(
        'lists USDA when only its %s dataset is cited',
        (dataset) => {
            expect(citedSourceViews([{ dataset, converted: false }]).map((source) => source.id)).toEqual(['usda']);
        },
    );

    it('never lists a registered source no stored value cites', () => {
        expect(citedSourceViews([{ dataset: 'ciqual', converted: false }]).map((source) => source.id)).toEqual([
            'ciqual',
        ]);
    });

    it('never lists a manufacturer’s label, which is not a register source', () => {
        expect(citedSourceViews([{ dataset: 'label', converted: false }])).toEqual([]);
    });

    it('lists USDA once however many of its datasets are cited', () => {
        const cited = citedSourceViews([
            { dataset: 'usdaBranded', converted: false },
            { dataset: 'usdaSrFoundation', converted: false },
            { dataset: 'usdaFndds', converted: false },
        ]);

        expect(cited.map((source) => source.id)).toEqual(['usda']);
    });

    it('orders the sources as the register does, whatever order the citations arrive in', () => {
        const cited = citedSourceViews([
            { dataset: 'cnf', converted: false },
            { dataset: 'livsmedelsverket', converted: false },
            { dataset: 'ciqual', converted: false },
            { dataset: 'usdaBranded', converted: false },
        ]);

        expect(cited.map((source) => source.id)).toEqual(['usda', 'ciqual', 'livsmedelsverket', 'cnf']);
    });

    it('marks a source converted when any of its citations recorded a conversion, in either order', () => {
        const convertedFirst = citedSourceViews([
            { dataset: 'usdaFndds', converted: true },
            { dataset: 'usdaSrFoundation', converted: false },
        ]);
        const convertedLast = citedSourceViews([
            { dataset: 'usdaSrFoundation', converted: false },
            { dataset: 'usdaFndds', converted: true },
        ]);

        expect(convertedFirst.map((source) => source.converted)).toEqual([true]);
        expect(convertedLast.map((source) => source.converted)).toEqual([true]);
    });

    it('marks a source not converted when none of its citations recorded a conversion', () => {
        const cited = citedSourceViews([
            { dataset: 'cofid', converted: true },
            { dataset: 'ciqual', converted: false },
        ]);

        expect(cited.map((source) => [source.id, source.converted])).toEqual([
            ['ciqual', false],
            ['cofid', true],
        ]);
    });

    it('carries every word the page shows from the register, the credit word for word', () => {
        expect(citedSourceViews([{ dataset: 'ciqual', converted: false }])).toStrictEqual([
            {
                id: 'ciqual',
                shortName: 'Ciqual',
                name: 'Ciqual French food composition table',
                publisher: 'Anses',
                edition: '2025',
                licenceName: 'Licence Ouverte / Open Licence 2.0',
                licenceUrl: 'https://www.etalab.gouv.fr/licence-ouverte-open-licence/',
                attribution: 'Anses. 2025. Table de composition nutritionnelle des aliments Ciqual.',
                attributionLanguage: 'fr',
                homepage: 'https://ciqual.anses.fr/',
                converted: false,
            },
        ]);
    });

    it('sends no short name for a source the register gives none, so the page heads it with its name', () => {
        const [swiss] = citedSourceViews([{ dataset: 'fsvo', converted: false }]);

        expect(swiss).toBeDefined();
        expect(swiss).not.toHaveProperty('shortName');
        expect(swiss?.name).toBe('Swiss Food Composition Database');
    });
});
