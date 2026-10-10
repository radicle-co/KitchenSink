/**
 * @module @commise/features-recipes/dataSources/__fixtures__ — one Data sources entry, as the food service sends it.
 *
 * The defaults are USDA's real register entry. {@link CIQUAL_SOURCE} carries a French credit, so a test can show the
 * credit keeps its own language; {@link SWISS_SOURCE} has no short name, so a test can show the name heads it.
 */
import type { DataSourceView } from '@kitchensink/food-service-client';

/**
 * A source, overridable per field.
 *
 * @param overrides - Fields to override on USDA's entry.
 * @returns A complete source.
 */
export const makeDataSource = (overrides: Partial<DataSourceView> = {}): DataSourceView => ({
    id: 'usda',
    shortName: 'USDA',
    name: 'FoodData Central',
    publisher: 'U.S. Department of Agriculture, Agricultural Research Service',
    edition: 'SR Legacy 2018-04, Foundation 2026-04-30, FNDDS 2021-2023, Branded 2026-04-30',
    licenceName: 'CC0 1.0 Universal',
    licenceUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
    attribution:
        'U.S. Department of Agriculture, Agricultural Research Service, Beltsville Human Nutrition Research Center. FoodData Central.',
    attributionLanguage: 'en',
    homepage: 'https://fdc.nal.usda.gov/',
    converted: false,
    ...overrides,
});

/** Ciqual: a French credit, values converted. */
export const CIQUAL_SOURCE: DataSourceView = makeDataSource({
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
    converted: true,
});

/** The Swiss table: no short name, so its name heads its card. */
export const SWISS_SOURCE: DataSourceView = (() => {
    const { shortName: _none, ...source } = makeDataSource({
        id: 'fsvo',
        name: 'Swiss Food Composition Database',
        publisher: 'Federal Food Safety and Veterinary Office',
        licenceName: 'opendata.swiss terms of use: open use, must provide the source',
        licenceUrl: 'https://opendata.swiss/en/terms-of-use',
        attribution:
            'Swiss Food Composition Database, Federal Food Safety and Veterinary Office, https://naehrwertdaten.ch/.',
        homepage: 'https://naehrwertdaten.ch/',
    });

    return source;
})();
