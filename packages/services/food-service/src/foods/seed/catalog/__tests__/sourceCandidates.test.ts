/**
 * `sourceCandidates.tsv` (plan KTD-22): every candidate source for every root with no USDA item, so the format check
 * can assert that each committed citation is the policy's choice. Refusals are asserted by their named rule.
 */
import { describe, expect, it } from 'vitest';

import { isSeedRefusedError, type SeedRule } from '../curatedSeedFormat.errors.js';
import { candidateKeysOf, parseSourceCandidates } from '../sourceCandidates.js';

const HEADER = 'seedKey\tdataset\tkey\tmatch\n';

/**
 * The rules a refused parse reports.
 *
 * @param text - The file's text.
 * @returns The rules, in order.
 */
function rulesOf(text: string): SeedRule[] {
    try {
        parseSourceCandidates(text);
    } catch (error) {
        if (isSeedRefusedError(error)) {
            return error.issues.map((issue) => issue.rule);
        }

        throw error;
    }

    throw new Error('Expected the candidates to be refused, but they parsed.');
}

describe('parseSourceCandidates', () => {
    it('parses a table candidate, each USDA dataset and a label candidate', () => {
        const text =
            HEADER +
            'curated:apple-nectar\tciqual\t2076\texact\n' +
            'curated:whole-nutmeg\tusdaSrFoundation\tfdc:171326\tsameSubstance\n' +
            'curated:sorbet\tusdaFndds\tfdc:2709314\texact\n' +
            'curated:adobo-seasoning\tusdaBranded\tfdc:2096555\texact\n' +
            'curated:goya-sazon\tlabel\thttps://example.com/products/adobo\texact\n';

        expect(parseSourceCandidates(text)).toEqual([
            { seedKey: 'curated:apple-nectar', dataset: 'ciqual', key: '2076', match: 'exact' },
            { seedKey: 'curated:whole-nutmeg', dataset: 'usdaSrFoundation', key: 'fdc:171326', match: 'sameSubstance' },
            { seedKey: 'curated:sorbet', dataset: 'usdaFndds', key: 'fdc:2709314', match: 'exact' },
            { seedKey: 'curated:adobo-seasoning', dataset: 'usdaBranded', key: 'fdc:2096555', match: 'exact' },
            {
                seedKey: 'curated:goya-sazon',
                dataset: 'label',
                key: 'https://example.com/products/adobo',
                match: 'exact',
            },
        ]);
    });

    it('parses a file with only its header as no candidates', () => {
        expect(parseSourceCandidates(HEADER)).toEqual([]);
    });

    it.each([
        ['the old source header', 'seedKey\tsource\tkey\tmatch\n'],
        ['a row with three columns', `${HEADER}curated:apple-nectar\tciqual\t2076\n`],
        ['a source id where a dataset belongs', `${HEADER}curated:sorbet\tusda\tfdc:2709314\texact\n`],
        ['a dataset nothing names', `${HEADER}curated:apple-nectar\topenfoodfacts\t1\texact\n`],
        ['a match outside the tiers', `${HEADER}curated:apple-nectar\tciqual\t2076\tprobable\n`],
        ['an fdc seed key, since only a curated root can lack a USDA item', `${HEADER}fdc:100\tciqual\t2076\texact\n`],
        ['an empty key', `${HEADER}curated:apple-nectar\tciqual\t\texact\n`],
        ['an FNDDS key that is not an fdc key', `${HEADER}curated:sorbet\tusdaFndds\t2709314\texact\n`],
        ['a Branded key that is not an fdc key', `${HEADER}curated:adobo\tusdaBranded\t2096555\texact\n`],
        ['a label key that is not an https URL', `${HEADER}curated:goya-sazon\tlabel\twww.example.com\texact\n`],
        ['a missing final newline', `${HEADER}curated:apple-nectar\tciqual\t2076\texact`],
    ])('refuses %s', (_, text) => {
        expect(rulesOf(text)).toContain('candidateMalformed');
    });

    it.each(['exact', 'close', 'generic'])(
        'refuses an SR Legacy or Foundation stand-in graded %s, since R50 admits one only as the same substance',
        (match) => {
            expect(rulesOf(`${HEADER}curated:whole-nutmeg\tusdaSrFoundation\tfdc:171326\t${match}\n`)).toEqual([
                'candidateStandInNotSameSubstance',
            ]);
        },
    );

    it('refuses one candidate listed twice for a root', () => {
        const row = 'curated:apple-nectar\tciqual\t2076\texact\n';

        expect(rulesOf(HEADER + row + row)).toEqual(['candidateRepeated']);
    });

    it('refuses one key listed under two USDA datasets for a root, since an FDC id belongs to one', () => {
        const text =
            HEADER +
            'curated:sorbet\tusdaFndds\tfdc:2709314\texact\n' +
            'curated:sorbet\tusdaBranded\tfdc:2709314\texact\n';

        expect(rulesOf(text)).toEqual(['candidateRepeated']);
    });

    // ADR-0052: an exact grade says the entry IS the root, so it names one root. An entry that stands for two foods
    // ("Brandy, Armagnac or Cognac type") is exact for neither.
    it.each([
        [
            'one table entry graded exact for two roots',
            'curated:armagnac\tciqual\t1023\texact\n' + 'curated:cognac\tciqual\t1023\texact\n',
        ],
        [
            'one FDC id graded exact for two roots under two USDA datasets, since an FDC id belongs to one',
            'curated:brandy\tusdaFndds\tfdc:2710699\texact\n' + 'curated:cognac\tusdaBranded\tfdc:2710699\texact\n',
        ],
        [
            'one label graded exact for two roots',
            'curated:goya-sazon\tlabel\thttps://example.com/sazon\texact\n' +
                'curated:sazon\tlabel\thttps://example.com/sazon\texact\n',
        ],
    ])('refuses %s', (_, rows) => {
        expect(rulesOf(HEADER + rows)).toEqual(['candidateExactShared']);
    });

    // A grade below exact lends numbers and names no root, so any number of roots may share the entry.
    it.each([
        ['an exact and a close grade of one entry', 'exact', 'close'],
        ['two close grades of one entry', 'close', 'close'],
        ['two generic grades of one entry', 'generic', 'generic'],
        ['two same-substance grades of one entry', 'sameSubstance', 'sameSubstance'],
    ])('accepts %s', (_, first, second) => {
        const text = `${HEADER}curated:armagnac\tciqual\t1023\t${first}\ncurated:cognac\tciqual\t1023\t${second}\n`;

        expect(parseSourceCandidates(text)).toHaveLength(2);
    });

    it('accepts one key graded exact under two sources, since each source keys its own entries', () => {
        const text = `${HEADER}curated:armagnac\tciqual\t1023\texact\ncurated:cognac\tcofid\t1023\texact\n`;

        expect(parseSourceCandidates(text)).toHaveLength(2);
    });
});

describe('candidateKeysOf', () => {
    it('lists the distinct keys one dataset is a candidate under, across every root', () => {
        const candidates = parseSourceCandidates(
            [
                'seedKey\tdataset\tkey\tmatch',
                'curated:port\tcofid\t17-234\texact',
                'curated:port\tusdaFndds\tfdc:2710692\tgeneric',
                'curated:ruby-port\tcofid\t17-234\tclose',
                'curated:gin\tcofid\t17-100\texact',
                'curated:gin\tusdaBranded\tfdc:2096555\texact',
                '',
            ].join('\n'),
        );

        expect([...candidateKeysOf(candidates, 'cofid')].sort()).toEqual(['17-100', '17-234']);
        expect([...candidateKeysOf(candidates, 'usdaFndds')]).toEqual(['fdc:2710692']);
        expect([...candidateKeysOf(candidates, 'usdaBranded')]).toEqual(['fdc:2096555']);
        expect(candidateKeysOf(candidates, 'ciqual').size).toBe(0);
    });
});
