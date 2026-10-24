/**
 * The xlsx Adapter (plan U23): one sheet of a published workbook as rows of table cells. Text stays text, and a
 * number stays the exact text the workbook stores, so neither a key's zeros nor a value's digits pass through a float.
 * The workbooks here are written by `write-excel-file`, an independent writer, so the reader is tested against bytes
 * it did not produce.
 */
import { Buffer } from 'node:buffer';

import writeXlsxFile, { type SheetData } from 'write-excel-file/node';
import { describe, expect, it } from 'vitest';

import { withDataDescriptors } from '../__fixtures__/zipFixture.js';
import { numericCell } from '../tableCell.js';
import { isTableFormatError } from '../tableExtract.errors.js';
import { readXlsxSheet } from '../xlsxSheet.js';

/**
 * Write a one-sheet workbook.
 *
 * @param sheet - The sheet's name.
 * @param data - Its rows.
 * @returns The workbook's bytes.
 */
async function workbook(sheet: string, data: SheetData): Promise<Buffer> {
    return writeXlsxFile(data, { sheet }).toBuffer();
}

describe('readXlsxSheet', () => {
    it('reads text as text, a number as its stored text, and an empty cell as null', async () => {
        const bytes = await workbook('Foods', [
            ['Matvare ID', 'Fat (g)', 'Note'],
            ['01.344', 31.7, null],
            ['01001', 0.25, 'Tr'],
        ]);

        await expect(readXlsxSheet(bytes, 'Foods')).resolves.toEqual([
            ['Matvare ID', 'Fat (g)', 'Note'],
            ['01.344', numericCell('31.7'), null],
            ['01001', numericCell('0.25'), 'Tr'],
        ]);
    });

    it('reads a number at the 15 significant digits Excel keeps, so a float tail reads as the figure Excel shows', async () => {
        // 0.1 + 0.2 is stored as 0.30000000000000004, and 1.8 - 1e-15 as 1.799999999999999; Excel shows 0.3 and 1.8.
        const bytes = await workbook('Foods', [[0.1 + 0.2, 1.8 - 1e-15, 144.636, 2.3]]);

        await expect(readXlsxSheet(bytes, 'Foods')).resolves.toEqual([
            [numericCell('0.3'), numericCell('1.8'), numericCell('144.636'), numericCell('2.3')],
        ]);
    });

    // Livsmedelsverket generates its workbook per download, and every zip entry sets general-purpose bit 3, states its
    // sizes in its local header anyway, and follows its data with a data descriptor. A streaming reader that trusts the
    // local header meets the descriptor's signature where it expects the next entry, and refuses a valid workbook.
    it('reads a workbook whose zip entries carry data descriptors, as Livsmedelsverket generates them', async () => {
        const bytes = await withDataDescriptors(await workbook('Blad1', [['Livsmedelsnamn'], ['Nöt talg', 884]]));

        await expect(readXlsxSheet(bytes, 'Blad1')).resolves.toEqual([
            ['Livsmedelsnamn', null],
            ['Nöt talg', numericCell('884')],
        ]);
    });

    it('refuses a sheet the workbook does not have, naming the sheets it does', async () => {
        const bytes = await workbook('Foods', [['x']]);
        let thrown: unknown;

        try {
            await readXlsxSheet(bytes, '1.3 Proximates');
        } catch (error) {
            thrown = error;
        }

        expect(isTableFormatError(thrown)).toBe(true);
        expect(String(thrown)).toContain('Foods');
    });

    it('refuses a cell that is a date or a boolean, which no food table prints', async () => {
        const bytes = await workbook('Foods', [['key', true]]);

        await expect(readXlsxSheet(bytes, 'Foods')).rejects.toThrow(
            expect.objectContaining({ name: 'TableFormatError' }),
        );
    });

    it('refuses bytes that are not a workbook', async () => {
        await expect(readXlsxSheet(Buffer.from('not a workbook'), 'Foods')).rejects.toThrow(
            expect.objectContaining({ name: 'TableFormatError' }),
        );
    });
});
