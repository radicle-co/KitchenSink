/**
 * The Data sources card's pure model (plan R55, design §S16): what heads a card, when the full name shows under it,
 * the links' accessible names, and which addresses may become a link at all.
 *
 * Both platforms render from this one model, so a rule here cannot hold on one platform and not the other.
 */
import { describe, expect, it } from 'vitest';

import type { DataSourceView } from '@kitchensink/food-service-client';

import { dataSourcesMessages } from '../messages.js';
import { dataSourceCardModel } from '../model.js';

const messages = dataSourcesMessages.en;

/** USDA as the endpoint sends it. */
const USDA: DataSourceView = {
    id: 'usda',
    shortName: 'USDA',
    name: 'FoodData Central',
    publisher: 'U.S. Department of Agriculture, Agricultural Research Service',
    edition: 'SR Legacy 2018-04, Foundation 2026-04-30',
    licenceName: 'CC0 1.0 Universal',
    licenceUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
    attribution: 'U.S. Department of Agriculture, Agricultural Research Service. FoodData Central.',
    attributionLanguage: 'en',
    homepage: 'https://fdc.nal.usda.gov/',
    converted: false,
};

describe('dataSourceCardModel', () => {
    it('heads a card with the short name and shows the full name under it', () => {
        const card = dataSourceCardModel(USDA, messages);

        expect(card.heading).toBe('USDA');
        expect(card.fullName).toBe('FoodData Central');
    });

    it('heads a card with the full name, shown once, when the source has no short name', () => {
        const { shortName: _omitted, ...swiss } = { ...USDA, name: 'Swiss Food Composition Database' };
        const card = dataSourceCardModel(swiss, messages);

        expect(card.heading).toBe('Swiss Food Composition Database');
        expect(card.fullName).toBeUndefined();
    });

    it('names the licence link by the licence and the source it licenses', () => {
        expect(dataSourceCardModel(USDA, messages).licence?.accessibleName).toBe('CC0 1.0 Universal, license for USDA');
    });

    it('names the website link by the source', () => {
        expect(dataSourceCardModel(USDA, messages).homepage?.accessibleName).toBe('Source website, USDA');
    });

    it('inserts a name literally, even one holding a replacement pattern', () => {
        const card = dataSourceCardModel({ ...USDA, shortName: 'A$&B' }, messages);

        expect(card.homepage?.accessibleName).toBe('Source website, A$&B');
    });

    it('links only to an http(s) address, so a hostile address never becomes a link', () => {
        const card = dataSourceCardModel(
            { ...USDA, licenceUrl: 'javascript:alert(1)', homepage: 'intent://scan/#Intent;end' },
            messages,
        );

        expect(card.licence).toBeNull();
        expect(card.homepage).toBeNull();
    });

    it('links to the address the source gives, as a verified href', () => {
        const card = dataSourceCardModel(USDA, messages);

        expect(card.licence?.href).toBe('https://creativecommons.org/publicdomain/zero/1.0/');
        expect(card.homepage?.href).toBe('https://fdc.nal.usda.gov/');
    });
});
