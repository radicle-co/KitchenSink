/**
 * CIQUAL 2025's extractor (plan U23, KTD-20, KTD-24): Anses's composition rows become extract lines keyed by the
 * INFOODS tag of each constituent's definition. The pure mapping is driven with parsed records; the XML Adapter is
 * driven with files laid out as Anses publishes them (BOM, CRLF, space-padded text, `missing=" "` empties, entities).
 * `traces` and a below-limit bound (`< 0,5`) are traces and land in the line's traces; `-` is not known and stays
 * absent.
 */
import { Buffer } from 'node:buffer';

import { describe, expect, it } from 'vitest';

import { ciqualExtractor, ciqualLines, type CiqualComposition, type CiqualFood } from '../ciqualExtract.js';
import { isTableFormatError } from '../tableExtract.errors.js';

/** One food as the foods file lists it. */
const PASTIS: CiqualFood = { alim_code: '1000', alim_nom_eng: 'Pastis (anise-flavoured spirit)' };

/**
 * One composition row.
 *
 * @param constCode - The constituent's code.
 * @param teneur - The amount as printed.
 * @param alimCode - The food's code.
 * @returns The row.
 */
function row(constCode: string, teneur: string, alimCode = '1000'): CiqualComposition {
    return { alim_code: alimCode, const_code: constCode, teneur };
}

/**
 * The error a call throws.
 *
 * @param call - The call.
 * @returns What it threw.
 */
function thrown(call: () => unknown): unknown {
    try {
        call();
    } catch (error) {
        return error;
    }

    return undefined;
}

describe('ciqualLines', () => {
    it('reads each mapped constituent into the tag of its definition, with the decimal comma read', () => {
        const lines = ciqualLines(
            [PASTIS],
            [
                row('327', '1140'),
                row('328', '274'),
                row('25000', '0,5'),
                row('31000', '2,86'),
                row('34100', '1,2'),
                row('40000', '0,13'),
            ],
            new Set(['1000']),
        );

        expect(lines).toEqual([
            {
                key: '1000',
                name: 'Pastis (anise-flavoured spirit)',
                basis: 'per100g',
                values: {
                    ENERC_KJ: '1140',
                    ENERC_KCAL: '274',
                    PROCNT: '0.5',
                    CHOAVL: '2.86',
                    FIBTG: '1.2',
                    FAT: '0.13',
                },
            },
        ]);
    });

    it('maps no other constituent: Jones energy, crude protein and sugars stay out', () => {
        const lines = ciqualLines(
            [PASTIS],
            [row('332', '1200'), row('333', '290'), row('25003', '0,7'), row('32000', '2,1'), row('400', '60')],
            new Set(['1000']),
        );

        expect(lines).toEqual([{ key: '1000', name: PASTIS.alim_nom_eng, basis: 'per100g', values: {} }]);
    });

    it('reads -, not known, as no value and no trace', () => {
        const [line] = ciqualLines([PASTIS], [row('40000', '-'), row('328', '274')], new Set(['1000']));

        expect(line).toEqual({
            key: '1000',
            name: PASTIS.alim_nom_eng,
            basis: 'per100g',
            values: { ENERC_KCAL: '274' },
        });
        expect(line).not.toHaveProperty('traces');
    });
    it.each(['traces', '< 0,5', '< 1', '<10', ' < 0,05 '])('reads %j as a trace of its constituent', (teneur) => {
        const [line] = ciqualLines([PASTIS], [row('40000', teneur), row('328', '274')], new Set(['1000']));

        expect(line?.values).toEqual({ ENERC_KCAL: '274' });
        expect(line?.traces).toEqual(['FAT']);
    });

    it('keeps a trace of a constituent it does not map out of the traces', () => {
        const [line] = ciqualLines(
            [PASTIS],
            [row('32000', 'traces'), row('25003', '< 0,5'), row('328', '274')],
            new Set(['1000']),
        );

        expect(line).not.toHaveProperty('traces');
    });

    it.each([
        ['1.140', 'a point, which CIQUAL never writes as its decimal mark'],
        ['0,0046', 'more places than an extract holds'],
        ['ND', 'a mark CIQUAL does not print'],
        ['', 'an empty amount'],
        ['< 0.5', 'a bound with a point'],
        ['> 5', 'a lower bound'],
        ['<', 'a bound with no number'],
        ['Traces', 'a trace mark CIQUAL does not print'],
        ['(0,5)', 'a bracketed amount'],
        ['-1', 'a negative amount'],
    ])('refuses %j (%s), naming the food and the constituent', (teneur) => {
        const error = thrown(() => ciqualLines([PASTIS], [row('40000', teneur)], new Set(['1000'])));

        expect(isTableFormatError(error)).toBe(true);
        expect(String(error)).toContain('1000');
        expect(String(error)).toContain('40000');
    });

    it('leaves out a requested key the table does not hold, and reads no amount of a food nobody requested', () => {
        const ham: CiqualFood = { alim_code: '28000', alim_nom_eng: 'Ham' };
        const lines = ciqualLines(
            [PASTIS, ham],
            [row('328', '274'), row('328', '0,0046', '28000')],
            new Set(['1000', '99999']),
        );

        expect(lines.map((line) => line.key)).toEqual(['1000']);
    });

    it('refuses a food the foods file lists twice', () => {
        const error = thrown(() => ciqualLines([PASTIS, { ...PASTIS, alim_nom_eng: 'Other' }], [], new Set()));

        expect(isTableFormatError(error)).toBe(true);
        expect(String(error)).toContain('1000');
    });

    it('refuses a requested food with two rows for one constituent', () => {
        const error = thrown(() => ciqualLines([PASTIS], [row('328', '274'), row('328', '275')], new Set(['1000'])));

        expect(isTableFormatError(error)).toBe(true);
        expect(String(error)).toContain('328');
    });

    it('refuses a composition row for a requested food the foods file does not list', () => {
        const error = thrown(() => ciqualLines([], [row('328', '274')], new Set(['1000'])));

        expect(isTableFormatError(error)).toBe(true);
        expect(String(error)).toContain('1000');
    });

    it.each(['', '   '])('refuses a requested food whose English name is %j', (name) => {
        const error = thrown(() => ciqualLines([{ ...PASTIS, alim_nom_eng: name }], [], new Set(['1000'])));

        expect(isTableFormatError(error)).toBe(true);
    });

    it.each([
        ['foods', [{ ...PASTIS, alim_code: ' ' }], []],
        ['composition', [PASTIS], [row('328', '274', '')]],
    ] as const)('refuses a %s row with no food code', (_file, foods, composition) => {
        expect(isTableFormatError(thrown(() => ciqualLines(foods, composition, new Set(['1000']))))).toBe(true);
    });
});

/** The first line of every CIQUAL XML file, after its BOM. */
const DECLARATION = '<?xml version="1.0" encoding="utf-8" ?>';

/**
 * Lay records out the way Anses publishes them: a BOM, CRLF line ends, each text padded with one space either side,
 * and an empty element written as `missing=" "`. Values are written as given, so a test can put an entity in one.
 *
 * @param tag - The record element (`ALIM` or `COMPO`).
 * @param records - Each record's elements, in order.
 * @returns The file's bytes.
 */
function ciqualXml(tag: string, records: readonly (readonly (readonly [string, string])[])[]): Buffer {
    const body = records.map((fields) =>
        [
            `   <${tag}>`,
            ...fields.map(([name, text]) =>
                text === '' ? `      <${name} missing=" " />` : `      <${name}> ${text} </${name}>`,
            ),
            `   </${tag}>`,
        ].join('\r\n'),
    );

    return Buffer.from(`\uFEFF${[DECLARATION, '<TABLE>', ...body, '</TABLE>'].join('\r\n')}\r\n`, 'utf8');
}

/**
 * A foods file record, with the fields the extractor does not read.
 *
 * @param code - The food's code.
 * @param english - Its English name, as written in the file.
 * @returns The record's elements.
 */
function alim(code: string, english: string): (readonly [string, string])[] {
    return [
        ['alim_code', code],
        ['alim_nom_fr', 'Nom'],
        ['alim_nom_eng', english],
        ['alim_nom_sci', ''],
        ['alim_grp_code', '06'],
    ];
}

/**
 * A composition file record, with the fields the extractor does not read.
 *
 * @param code - The food's code.
 * @param constCode - The constituent's code.
 * @param teneur - The amount, as written in the file.
 * @returns The record's elements.
 */
function compo(code: string, constCode: string, teneur: string): (readonly [string, string])[] {
    return [
        ['alim_code', code],
        ['const_code', constCode],
        ['teneur', teneur],
        ['min', ''],
        ['max', ''],
        ['code_confiance', 'D'],
        ['source_code', '444'],
    ];
}

/**
 * The upstreams the extractor reads, by role.
 *
 * @param foods - The foods file.
 * @param composition - The composition file.
 * @returns The map.
 */
function upstreams(foods: Buffer, composition: Buffer): ReadonlyMap<string, Buffer> {
    return new Map([
        ['foods', foods],
        ['composition', composition],
    ]);
}

describe('ciqualExtractor', () => {
    it('reads the files named foods and composition', () => {
        expect([...ciqualExtractor.roles].sort()).toEqual(['composition', 'foods']);
    });
    it('reads the published XML: BOM, CRLF, padded text, entities, empty elements, a bound and a trace', async () => {
        const foods = ciqualXml('ALIM', [
            alim('1000', 'Pastis'),
            alim('11060', 'Cook&apos;s &quot;herbs&quot; &amp; salt'),
        ]);
        const composition = ciqualXml('COMPO', [
            compo('1000', '328', '274'),
            compo('11060', '327', '1180'),
            compo('11060', '328', '281'),
            compo('11060', '25000', '9,4'),
            compo('11060', '31000', '&lt; 0,5'),
            compo('11060', '34100', 'traces'),
            compo('11060', '40000', '-'),
            compo('11060', '333', '300'),
        ]);

        const lines = await ciqualExtractor.extract(upstreams(foods, composition), new Set(['11060']));

        expect(lines).toEqual([
            {
                key: '11060',
                name: 'Cook\'s "herbs" & salt',
                basis: 'per100g',
                values: { ENERC_KJ: '1180', ENERC_KCAL: '281', PROCNT: '9.4' },
                traces: ['CHOAVL', 'FIBTG'],
            },
        ]);
    });

    it('reads a file that holds a single record', async () => {
        const lines = await ciqualExtractor.extract(
            upstreams(ciqualXml('ALIM', [alim('1000', 'Pastis')]), ciqualXml('COMPO', [compo('1000', '328', '274')])),
            new Set(['1000']),
        );

        expect(lines).toEqual([{ key: '1000', name: 'Pastis', basis: 'per100g', values: { ENERC_KCAL: '274' } }]);
    });

    it.each([
        ['the composition file given as foods', 'COMPO'],
        ['the foods file given as composition', 'ALIM'],
    ])('refuses a file of the wrong kind: %s', async (_case, swapped) => {
        const foodsFile = ciqualXml('ALIM', [alim('1000', 'Pastis')]);
        const compositionFile = ciqualXml('COMPO', [compo('1000', '328', '1')]);
        const extract =
            swapped === 'COMPO'
                ? ciqualExtractor.extract(upstreams(compositionFile, compositionFile), new Set(['1000']))
                : ciqualExtractor.extract(upstreams(foodsFile, foodsFile), new Set(['1000']));

        await expect(extract).rejects.toSatisfy(isTableFormatError);
    });

    it.each([
        ['a field written twice', [...compo('1000', '328', '274'), ['teneur', '275'] as const]],
        ['a field left out', compo('1000', '328', '274').filter(([name]) => name !== 'teneur')],
        ['a nested element', [...compo('1000', '328', '274').slice(0, 2), ['teneur', '<v>274</v>'] as const]],
    ])('refuses a record with %s', async (_case, fields) => {
        const extract = ciqualExtractor.extract(
            upstreams(ciqualXml('ALIM', [alim('1000', 'Pastis')]), ciqualXml('COMPO', [fields])),
            new Set(['1000']),
        );

        await expect(extract).rejects.toSatisfy(isTableFormatError);
    });

    it('refuses a character reference, which the parser would leave undecoded', async () => {
        const extract = ciqualExtractor.extract(
            upstreams(ciqualXml('ALIM', [alim('1000', 'Caf&#233;')]), ciqualXml('COMPO', [compo('1000', '328', '1')])),
            new Set(['1000']),
        );

        await expect(extract).rejects.toSatisfy(isTableFormatError);
    });

    it('refuses XML that is not well formed, even when every record before the cut is whole', async () => {
        const whole = ciqualXml('ALIM', [alim('1000', 'Pastis')]);
        const broken = whole.subarray(0, whole.lastIndexOf('</TABLE>'));
        const extract = ciqualExtractor.extract(
            upstreams(broken, ciqualXml('COMPO', [compo('1000', '328', '1')])),
            new Set(['1000']),
        );

        await expect(extract).rejects.toSatisfy(isTableFormatError);
    });

    it('refuses bytes that are not UTF-8, rather than reading a replacement character into a name', async () => {
        const utf8 = ciqualXml('ALIM', [alim('1000', 'Caf')]);
        const at = utf8.indexOf('Caf') + 'Caf'.length;
        const latin1 = Buffer.concat([utf8.subarray(0, at), Buffer.from([0xe9]), utf8.subarray(at)]);
        const extract = ciqualExtractor.extract(
            upstreams(latin1, ciqualXml('COMPO', [compo('1000', '328', '1')])),
            new Set(['1000']),
        );

        await expect(extract).rejects.toSatisfy(isTableFormatError);
    });

    it('refuses upstreams that do not name a role it reads', async () => {
        const extract = ciqualExtractor.extract(
            new Map([['foods', ciqualXml('ALIM', [alim('1000', 'Pastis')])]]),
            new Set(['1000']),
        );

        await expect(extract).rejects.toSatisfy(isTableFormatError);
    });
});
