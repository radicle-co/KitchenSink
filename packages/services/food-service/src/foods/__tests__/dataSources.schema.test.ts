/**
 * The `GET /api/v1/foods/sources` wire contract (plan R55, design §S16).
 *
 * The page renders whatever this shape carries and never maps a source id to anything itself, so the shape must hold
 * every word the page shows: the short name only where the register has one, the licence by name and link, and the
 * attribution with its language. An unknown source id must still parse: a released mobile binary renders a source
 * added after it shipped instead of failing the whole page.
 */
import { describe, expect, it } from 'vitest';

import { dataSourcesResponseSchema, dataSourceViewSchema } from '../dataSources.schema.js';

/** One source as the endpoint sends it. */
const CIQUAL = {
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
};

describe('dataSourceViewSchema', () => {
    it('parses a source with every field (positive control)', () => {
        expect(dataSourceViewSchema.parse(CIQUAL)).toStrictEqual(CIQUAL);
    });

    it('parses a source with no short name, which the page heads with its name', () => {
        const { shortName: _omitted, ...noShortName } = CIQUAL;

        expect(dataSourceViewSchema.parse(noShortName).shortName).toBeUndefined();
    });

    it('parses a source id it was not built with, so an older client still shows a newer source', () => {
        expect(dataSourceViewSchema.parse({ ...CIQUAL, id: 'nevertheless' }).id).toBe('nevertheless');
    });

    it.each([
        ['no converted flag', { ...CIQUAL, converted: undefined }],
        ['a licence link that is not a URL', { ...CIQUAL, licenceUrl: 'etalab-2.0' }],
        ['a homepage that is not a URL', { ...CIQUAL, homepage: 'ciqual.anses.fr' }],
        // Both links render as an `href` (the page's source card), so only a web link may pass (GATE m6).
        ['a licence link that runs script', { ...CIQUAL, licenceUrl: 'javascript:alert(1)' }],
        ['a homepage that is not a web link', { ...CIQUAL, homepage: 'data:text/html,<p>x</p>' }],
        ['an empty attribution', { ...CIQUAL, attribution: '' }],
        ['no attribution language', { ...CIQUAL, attributionLanguage: undefined }],
        ['no licence name', { ...CIQUAL, licenceName: undefined }],
    ])('refuses a source with %s', (_label, source) => {
        expect(dataSourceViewSchema.safeParse(source).success).toBe(false);
    });
});

describe('dataSourcesResponseSchema', () => {
    it('carries the sources under one key, in the order sent', () => {
        const usda = { ...CIQUAL, id: 'usda', shortName: 'USDA', name: 'FoodData Central' };

        expect(dataSourcesResponseSchema.parse({ sources: [usda, CIQUAL] }).sources.map((source) => source.id)).toEqual(
            ['usda', 'ciqual'],
        );
    });

    it('parses an empty list, the page’s empty state', () => {
        expect(dataSourcesResponseSchema.parse({ sources: [] })).toStrictEqual({ sources: [] });
    });
});
