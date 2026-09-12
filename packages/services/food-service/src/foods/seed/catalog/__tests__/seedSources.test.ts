/**
 * The seed's one I/O door (plan U1): it verifies every pinned file before reading it, reads the two USDA
 * archives into the universe, and parses the committed files. Driven here against a miniature data directory
 * of real zips, so the tamper cases exercise the same bytes-then-parse order the real load does.
 */
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { isUsdaBulkFormatError } from '../../../../sources/usda/bulk/usdaBulk.errors.js';
import { fdcCsv, makeZip } from '../../archive/__fixtures__/zipFixture.js';
import { renderBrandedExtract } from '../../archive/brandedExtract.js';
import { renderSourceExtract } from '../../archive/sourceExtract.js';
import { isSourcePinMismatchError } from '../../archive/sourcePin.errors.js';
import { isSourcePinsFormatError } from '../../archive/usdaSourceArchive.errors.js';
import {
    catalogText,
    changesText,
    makeBrandedProduct,
    makeCatalogChanges,
    makeExtractLine,
    makeItemRoot,
    makeSourceItemCitation,
    makeSourcelessRoot,
} from '../__fixtures__/curatedSeed.fixtures.js';
import { isSeedRefusedError } from '../curatedSeedFormat.errors.js';
import { composeSeedImage } from '../seedImage.js';
import { loadSeedSources } from '../seedSources.js';

const FOOD_HEADER = ['fdc_id', 'data_type', 'description', 'food_category_id', 'publication_date'];
const NUTRIENT_HEADER = ['id', 'name', 'unit_name', 'nutrient_nbr', 'rank'];
const FOOD_NUTRIENT_HEADER = ['id', 'fdc_id', 'nutrient_id', 'amount'];
const NUTRIENTS = [NUTRIENT_HEADER, ['1008', 'Energy', 'KCAL', '208', '300']];

const sha256 = (bytes: Buffer | string): string => createHash('sha256').update(bytes).digest('hex');

const FNDDS_SORBET = makeExtractLine({ key: 'fdc:2709314', name: 'Sorbet', values: { ENERC_KCAL: '135' } });
const COFID_PORT = makeExtractLine({
    key: '17-234',
    name: 'Port',
    basis: 'per100mL',
    values: { ENERC_KCAL: '157' },
    densityGramsPerMl: '1.03',
});

/** The SR Legacy archive: brisket and its two halves. */
async function srZip(): Promise<Buffer> {
    const root = 'FoodData_Central_sr_legacy_food_csv_2018-04/';

    return makeZip({
        [`${root}food.csv`]: fdcCsv([
            FOOD_HEADER,
            ['100', 'sr_legacy_food', 'Beef, brisket, whole', '13', '2019-04-01'],
            ['101', 'sr_legacy_food', 'Beef, brisket, flat half', '13', '2019-04-01'],
            ['102', 'sr_legacy_food', 'Beef, brisket, point half', '13', '2019-04-01'],
        ]),
        [`${root}nutrient.csv`]: fdcCsv(NUTRIENTS),
        [`${root}food_nutrient.csv`]: fdcCsv([
            FOOD_NUTRIENT_HEADER,
            ['1', '100', '1008', '155'],
            ['2', '101', '1008', '140'],
            ['3', '102', '1008', '170'],
        ]),
        [`${root}food_portion.csv`]: fdcCsv([
            ['id', 'fdc_id', 'seq_num', 'amount', 'measure_unit_id', 'portion_description', 'modifier', 'gram_weight'],
            ['1', '100', '1', '3', '', '', 'oz', '85'],
        ]),
        [`${root}measure_unit.csv`]: fdcCsv([['id', 'name']]),
    });
}

/**
 * The Foundation archive: two current items and one superseded row under the same data type.
 *
 * @param members - The ids `foundation_food.csv` lists.
 * @returns The archive.
 */
async function foundationZip(members: readonly string[] = ['2646170', '748278']): Promise<Buffer> {
    const root = 'FoodData_Central_foundation_food_csv_2026-04-30/';

    return makeZip({
        [`${root}food.csv`]: fdcCsv([
            FOOD_HEADER,
            ['2646170', 'foundation_food', 'Chicken, breast, boneless, skinless, raw', '5', '2024-04-18'],
            ['748278', 'foundation_food', 'Oil, canola', '4', '2019-12-16'],
            ['334462', 'foundation_food', 'Restaurant, Chinese, sweet and sour pork', '36', '2019-04-01'],
            ['321829', 'sub_sample_food', 'Chicken, breast, sub sample', '5', '2019-04-01'],
        ]),
        [`${root}foundation_food.csv`]: fdcCsv([
            ['fdc_id', 'NDB_number', 'footnote'],
            ...members.map((id) => [id, '', '']),
        ]),
        [`${root}nutrient.csv`]: fdcCsv(NUTRIENTS),
        [`${root}food_nutrient.csv`]: fdcCsv([FOOD_NUTRIENT_HEADER, ['1', '2646170', '1008', '120']]),
    });
}

describe('loadSeedSources', () => {
    let dir: string;

    /**
     * Write a complete miniature data directory, pinning every file it writes: the USDA archives, the Branded and FNDDS
     * extracts, and one other table's extract (CoFID's).
     *
     * @param options - A replacement Foundation archive, catalog or CoFID pins text (pinned as written), or one pinned
     *   file to tamper with AFTER its pin is computed.
     */
    async function writeDataDir(
        options: {
            foundation?: Buffer;
            catalog?: string;
            cofidPins?: string;
            tamper?: 'srLegacy.zip' | 'brandedExtract.jsonl' | 'fnddsExtract.jsonl' | 'cofidExtract.jsonl';
        } = {},
    ): Promise<void> {
        const sr = await srZip();
        const foundation = options.foundation ?? (await foundationZip());
        const extract = Buffer.from(renderBrandedExtract([makeBrandedProduct()]), 'utf8');
        const fndds = Buffer.from(renderSourceExtract([FNDDS_SORBET]), 'utf8');
        const cofid = Buffer.from(renderSourceExtract([COFID_PORT]), 'utf8');

        const flipLastByte = (bytes: Buffer, name: string): Buffer => {
            const copy = Buffer.from(bytes);

            if (options.tamper === name) {
                copy[copy.length - 1] = (copy[copy.length - 1] ?? 0) ^ 0x01;
            }

            return copy;
        };

        mkdirSync(join(dir, 'usda'), { recursive: true });
        writeFileSync(join(dir, 'usda', 'srLegacy.zip'), flipLastByte(sr, 'srLegacy.zip'));
        writeFileSync(join(dir, 'usda', 'foundation.zip'), foundation);
        writeFileSync(join(dir, 'usda', 'brandedExtract.jsonl'), flipLastByte(extract, 'brandedExtract.jsonl'));
        writeFileSync(join(dir, 'usda', 'fnddsExtract.jsonl'), flipLastByte(fndds, 'fnddsExtract.jsonl'));
        mkdirSync(join(dir, 'cofid'));
        writeFileSync(join(dir, 'cofid', 'cofidExtract.jsonl'), flipLastByte(cofid, 'cofidExtract.jsonl'));
        writeFileSync(
            join(dir, 'cofid', 'sourcePins.json'),
            options.cofidPins ??
                JSON.stringify({
                    upstreams: { table: { upstream: 'CoFID 2021.xlsx', upstreamSha256: 'd'.repeat(64) } },
                    extract: 'cofidExtract.jsonl',
                    extractSha256: sha256(cofid),
                }),
        );
        writeFileSync(
            join(dir, 'usda', 'sourcePins.json'),
            JSON.stringify({
                srLegacy: { upstream: 'sr.zip', upstreamSha256: sha256(sr), file: 'srLegacy.zip' },
                foundation: { upstream: 'foundation.zip', upstreamSha256: sha256(foundation), file: 'foundation.zip' },
                brandedFoods: {
                    upstream: 'branded.zip',
                    upstreamSha256: 'a'.repeat(64),
                    extract: 'brandedExtract.jsonl',
                    extractSha256: sha256(extract),
                },
                fnddsPrior: {
                    label: 'fixture',
                    survey: { upstream: 'survey.zip', upstreamSha256: 'b'.repeat(64) },
                    intake: { upstream: 'intake.csv', upstreamSha256: 'c'.repeat(64) },
                },
                fndds: {
                    upstreams: { survey: { upstream: 'survey.zip', upstreamSha256: 'b'.repeat(64) } },
                    extract: 'fnddsExtract.jsonl',
                    extractSha256: sha256(fndds),
                },
            }),
        );
        writeFileSync(
            join(dir, 'curatedCatalog.jsonl'),
            options.catalog ??
                catalogText([
                    makeItemRoot(),
                    makeSourcelessRoot({
                        seedKey: 'curated:adobo-seasoning',
                        name: 'adobo seasoning',
                        nutrition: makeSourceItemCitation(),
                    }),
                ]),
        );
        writeFileSync(join(dir, 'catalogChanges.json'), changesText(makeCatalogChanges()));
        writeFileSync(
            join(dir, 'sourceCandidates.tsv'),
            'seedKey\tdataset\tkey\tmatch\ncurated:adobo-seasoning\tusdaBranded\tfdc:2096555\texact\n',
        );
        writeFileSync(join(dir, 'foodPopularity.jsonl'), '{"item":"fdc:100","weight":40000}\n');
    }

    beforeEach(() => {
        dir = mkdtempSync(join(tmpdir(), 'seed-data-'));
    });

    afterEach(() => {
        rmSync(dir, { recursive: true, force: true });
    });

    it('reads the SR items and ONLY the current Foundation items into the universe', async () => {
        await writeDataDir();

        const inputs = await loadSeedSources(dir);

        expect(inputs.usdaItems.map((item) => [item.key, item.isFoundation])).toEqual([
            ['fdc:100', false],
            ['fdc:101', false],
            ['fdc:102', false],
            ['fdc:2646170', true],
            ['fdc:748278', true],
        ]);
        expect(inputs.usdaItems.find((item) => item.key === 'fdc:100')).toMatchObject({
            hasEnergy: true,
            portions: [{ label: 'oz', gramWeight: '85' }],
        });
        expect(inputs.usdaItems.find((item) => item.key === 'fdc:748278')?.hasEnergy).toBe(false);
    });

    it('parses the committed files the image composes from', async () => {
        await writeDataDir();

        const inputs = await loadSeedSources(dir);
        const image = composeSeedImage(inputs);

        expect(inputs.curated.roots.map((root) => root.seedKey)).toEqual(['fdc:100', 'curated:adobo-seasoning']);
        expect([...inputs.branded.keys()]).toEqual(['fdc:2096555']);
        expect(inputs.popularity.get('fdc:100')).toBe(40000);
        expect(inputs.candidates).toEqual([
            { seedKey: 'curated:adobo-seasoning', dataset: 'usdaBranded', key: 'fdc:2096555', match: 'exact' },
        ]);
        expect([...image.roots.keys()]).toEqual(['fdc:100', 'curated:adobo-seasoning', 'fdc:748278', 'fdc:2646170']);
    });

    it('reads each pinned table extract, FNDDS under usda, and no extract for a dataset with no pins', async () => {
        await writeDataDir();

        const { extracts } = await loadSeedSources(dir);

        expect(extracts.get('usdaFndds')?.get('fdc:2709314')).toEqual(FNDDS_SORBET);
        expect(extracts.get('cofid')?.get('17-234')).toEqual(COFID_PORT);
        expect([...extracts.keys()].sort()).toEqual(['cofid', 'usdaFndds']);
    });

    it.each(['fnddsExtract.jsonl', 'cofidExtract.jsonl'] as const)(
        '⛔ refuses a tampered %s byte before any line is read',
        async (tamper) => {
            await writeDataDir({ tamper });

            await expect(loadSeedSources(dir)).rejects.toSatisfy(isSourcePinMismatchError);
        },
    );

    it('refuses a table pins file that is not the pins shape', async () => {
        await writeDataDir({ cofidPins: '{"extract":"cofidExtract.jsonl"}' });

        await expect(loadSeedSources(dir)).rejects.toSatisfy(isSourcePinsFormatError);
    });

    it('⛔ refuses a tampered archive byte before any row is read', async () => {
        await writeDataDir({ tamper: 'srLegacy.zip' });

        await expect(loadSeedSources(dir)).rejects.toSatisfy(isSourcePinMismatchError);
    });

    it('⛔ refuses a tampered extract byte before any row is read', async () => {
        await writeDataDir({ tamper: 'brandedExtract.jsonl' });

        await expect(loadSeedSources(dir)).rejects.toSatisfy(isSourcePinMismatchError);
    });

    it('refuses a Foundation archive that lists an item food.csv does not hold', async () => {
        await writeDataDir({ foundation: await foundationZip(['2646170', '748278', '999']) });

        await expect(loadSeedSources(dir)).rejects.toSatisfy(isUsdaBulkFormatError);
    });

    it('refuses a curated catalog that breaks the format, with the named rule', async () => {
        await writeDataDir({ catalog: catalogText([{ ...makeItemRoot(), nutrition: null }]) });

        await expect(loadSeedSources(dir)).rejects.toSatisfy(
            (error: unknown) =>
                isSeedRefusedError(error) && error.issues.some((issue) => issue.rule === 'nutritionBesideItem'),
        );
    });
});
