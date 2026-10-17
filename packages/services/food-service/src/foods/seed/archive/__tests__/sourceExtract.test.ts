/**
 * A cited source's extract (plan KTD-20, U23): the committed lines of every candidate entry of one source, rendered
 * by one authority so a rebuild either reproduces the committed bytes or is refused. A line also keeps the tags the
 * table printed as a trace or a below-limit bound, because R53's total carbohydrate counts such a fibre as 0.
 */
import { describe, expect, it } from 'vitest';

import { isSourceExtractFormatError } from '../sourceExtract.errors.js';
import { isExtractDecimal, parseSourceExtract, renderSourceExtract, type ExtractLine } from '../sourceExtract.js';

const NECTAR: ExtractLine = {
    key: '2076',
    name: 'Apple nectar',
    basis: 'per100g',
    values: { ENERC_KCAL: '52', CHOAVL: '12.4', ENERC_KJ: '220' },
};
const PORT: ExtractLine = {
    key: '17-234',
    name: 'Port',
    basis: 'per100mL',
    values: { ENERC_KCAL: '157' },
    densityGramsPerMl: '1.03',
};
/** A food whose table printed its fat and its fibre as traces, given out of tag order. */
const VINEGAR: ExtractLine = {
    key: '17-300',
    name: 'Malt vinegar',
    basis: 'per100mL',
    values: { ENERC_KCAL: '22' },
    traces: ['FIBTG', 'FAT'],
    densityGramsPerMl: '1.01',
};

describe('renderSourceExtract', () => {
    it('writes one line per entry, sorted by key, with its values sorted by tag', () => {
        expect(renderSourceExtract([NECTAR, PORT])).toBe(
            '{"key":"17-234","name":"Port","basis":"per100mL","values":{"ENERC_KCAL":"157"},"densityGramsPerMl":"1.03"}\n' +
                '{"key":"2076","name":"Apple nectar","basis":"per100g","values":{"CHOAVL":"12.4","ENERC_KCAL":"52","ENERC_KJ":"220"}}\n',
        );
    });

    it('writes nothing for no entries', () => {
        expect(renderSourceExtract([])).toBe('');
    });

    it('writes the traces sorted, after the values and before the density', () => {
        expect(renderSourceExtract([VINEGAR])).toBe(
            '{"key":"17-300","name":"Malt vinegar","basis":"per100mL","values":{"ENERC_KCAL":"22"},' +
                '"traces":["FAT","FIBTG"],"densityGramsPerMl":"1.01"}\n',
        );
    });

    it('leaves out an empty traces list', () => {
        expect(renderSourceExtract([{ ...NECTAR, traces: [] }])).toBe(renderSourceExtract([NECTAR]));
    });
});

describe('isExtractDecimal', () => {
    it.each(['0', '12', '0.5', '12.345', '1070'])('accepts %s', (text) => {
        expect(isExtractDecimal(text)).toBe(true);
    });

    it.each(['', '-1', '1,5', '1.', '.5', '1.2345', '1e3', ' 1', 'Tr', '(0.1)'])('refuses %j', (text) => {
        expect(isExtractDecimal(text)).toBe(false);
    });
});

describe('parseSourceExtract', () => {
    it('reads back what it renders, keyed by the source’s key', () => {
        const parsed = parseSourceExtract(Buffer.from(renderSourceExtract([NECTAR, PORT]), 'utf8'));

        expect(parsed.get('2076')).toEqual({
            ...NECTAR,
            values: { CHOAVL: '12.4', ENERC_KCAL: '52', ENERC_KJ: '220' },
        });
        expect(parsed.get('17-234')).toEqual(PORT);
    });

    it('reads back a line’s traces, in tag order, and gives a line with none no traces at all', () => {
        const parsed = parseSourceExtract(Buffer.from(renderSourceExtract([VINEGAR, NECTAR]), 'utf8'));

        expect(parsed.get('17-300')).toEqual({ ...VINEGAR, traces: ['FAT', 'FIBTG'] });
        expect(parsed.get('2076')).not.toHaveProperty('traces');
    });

    it.each([
        ['a trace outside INFOODS', '"values":{},"traces":["SUGAR"]', 'not an INFOODS tag'],
        ['traces out of tag order', '"values":{},"traces":["FIBTG","FAT"]', 'not in strict tag order'],
        ['a trace written twice', '"values":{},"traces":["FAT","FAT"]', 'not in strict tag order'],
        ['an empty traces list, which is left out instead', '"values":{},"traces":[]', 'empty traces list'],
        ['a tag that is both a value and a trace', '"values":{"FAT":"1"},"traces":["FAT"]', 'FAT is both'],
    ])('refuses %s, saying why', (_, fields, reason) => {
        const text = `{"key":"1","name":"x","basis":"per100g",${fields}}\n`;
        const error = captured(() => parseSourceExtract(Buffer.from(text, 'utf8')));

        expect(isSourceExtractFormatError(error)).toBe(true);
        expect(String(error)).toContain('line 1');
        expect(String(error)).toContain(reason);
    });

    it.each([
        [
            'lines out of key order',
            `${renderSourceExtract([PORT])}${renderSourceExtract([{ ...NECTAR, key: '1000' }])}`,
        ],
        ['a key listed twice', `${renderSourceExtract([NECTAR])}${renderSourceExtract([NECTAR])}`],
        ['a tag outside INFOODS', '{"key":"1","name":"x","basis":"per100g","values":{"SUGAR":"1"}}\n'],
        ['an amount that is not a plain decimal', '{"key":"1","name":"x","basis":"per100g","values":{"FAT":"1,5"}}\n'],
        [
            'an amount with more than three decimal places',
            '{"key":"1","name":"x","basis":"per100g","values":{"FAT":"1.2000000000000002"}}\n',
        ],
        ['a per-100 mL line with no density', '{"key":"1","name":"x","basis":"per100mL","values":{"FAT":"1"}}\n'],
        [
            'a density on a per-100 g line',
            '{"key":"1","name":"x","basis":"per100g","values":{},"densityGramsPerMl":"1"}\n',
        ],
        ['bytes that are not the canonical rendering', '{"name":"x","key":"1","basis":"per100g","values":{}}\n'],
        ['a missing final newline', '{"key":"1","name":"x","basis":"per100g","values":{}}'],
    ])('refuses %s', (_, text) => {
        expect(() => parseSourceExtract(Buffer.from(text, 'utf8'))).toThrow(
            expect.objectContaining({ name: 'SourceExtractFormatError' }),
        );
        expect(isSourceExtractFormatError(captured(() => parseSourceExtract(Buffer.from(text, 'utf8'))))).toBe(true);
    });
});

/**
 * The value a call throws.
 *
 * @param call - The call.
 * @returns What it threw.
 */
function captured(call: () => unknown): unknown {
    try {
        call();
    } catch (error) {
        return error;
    }

    return undefined;
}
