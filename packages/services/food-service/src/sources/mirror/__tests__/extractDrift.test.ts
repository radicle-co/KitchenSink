/**
 * Drift between a mirror and the committed extract (plan R60): when a cited item's values in the publisher's current
 * table differ from the values the seed cites, the sync reports the difference and a seed pull request follows. The
 * mirror never rewrites a seeded number itself.
 *
 * Only cited items (keys the extract holds) are compared, only on the tags the source's mapper reads, and values are
 * compared as numbers, so `1.50` and `1.5` are the same value. An item the mapper rejects, and a cited key the
 * source no longer lists, are drift too.
 */
import { describe, expect, it } from 'vitest';

import type { InfoodsTag } from '../../../foods/nutrition/nutrientIdentity.js';
import type { ExtractLine } from '../../../foods/seed/archive/sourceExtract.js';
import { AdapterValidationError } from '../../foodSource.errors.js';
import { extractDrift } from '../extractDrift.js';
import { mirrorPullOf, type MirrorItem } from '../mirrorFeed.js';

const TAGS = ['ENERC_KCAL', 'FAT'] as const;

/** A committed extract line. */
function line(key: string, values: ExtractLine['values']): ExtractLine {
    return { key, name: key, basis: 'per100g', values };
}

/** Mirror items whose payload IS the values the fake mapper reads. */
function items(entries: Record<string, Record<string, string>>): readonly MirrorItem[] {
    return mirrorPullOf(
        Object.entries(entries).map(([key, values]) => ({ externalKey: key, name: key, payload: values })),
    ).items;
}

/** A mapper that reads the payload's text values by tag, and rejects an item whose payload says `reject`. */
function toLine(item: MirrorItem): ExtractLine {
    if (item.payload['reject'] !== undefined) {
        throw new AdapterValidationError('matvaretabellen', item.externalKey, 'Fett', 'is published in mg');
    }

    const values: Partial<Record<InfoodsTag, string>> = {};

    for (const tag of ['ENERC_KCAL', 'ENERC_KJ', 'FAT'] as const) {
        const value = item.payload[tag];

        if (typeof value === 'string') {
            values[tag] = value;
        }
    }

    return line(item.externalKey, values);
}

describe('extractDrift', () => {
    const extract = new Map([
        ['01.036', line('01.036', { ENERC_KCAL: '66', FAT: '1' })],
        ['06.178', line('06.178', { ENERC_KCAL: '310', FAT: '0.5' })],
    ]);

    it('reports nothing when every cited item agrees', () => {
        const pulled = items({ '01.036': { ENERC_KCAL: '66', FAT: '1' }, '06.178': { ENERC_KCAL: '310', FAT: '0.5' } });

        expect(extractDrift(pulled, extract, toLine, TAGS)).toEqual([]);
    });

    it('reports each value that changed, with both sides', () => {
        const pulled = items({ '01.036': { ENERC_KCAL: '67', FAT: '1' }, '06.178': { ENERC_KCAL: '310', FAT: '0.5' } });

        expect(extractDrift(pulled, extract, toLine, TAGS)).toEqual([
            {
                kind: 'values',
                externalKey: '01.036',
                differences: [{ tag: 'ENERC_KCAL', extract: '66', mirror: '67' }],
            },
        ]);
    });

    it('reports a value one side states and the other does not', () => {
        const pulled = items({ '01.036': { ENERC_KCAL: '66' }, '06.178': { ENERC_KCAL: '310', FAT: '0.5' } });

        expect(extractDrift(pulled, extract, toLine, TAGS)).toEqual([
            { kind: 'values', externalKey: '01.036', differences: [{ tag: 'FAT', extract: '1', mirror: undefined }] },
        ]);
    });

    it('compares values as numbers, not as text', () => {
        const pulled = items({
            '01.036': { ENERC_KCAL: '66.0', FAT: '1.000' },
            '06.178': { ENERC_KCAL: '310', FAT: '0.50' },
        });

        expect(extractDrift(pulled, extract, toLine, TAGS)).toEqual([]);
    });

    it("compares only the mapper's tags, so a tag the mirror does not read is no drift", () => {
        const withKj = new Map([['06.178', line('06.178', { ENERC_KCAL: '310', ENERC_KJ: '1312', FAT: '0.5' })]]);

        expect(extractDrift(items({ '06.178': { ENERC_KCAL: '310', FAT: '0.5' } }), withKj, toLine, TAGS)).toEqual([]);
    });

    it('ignores items the extract does not cite', () => {
        const pulled = items({
            '01.036': { ENERC_KCAL: '66', FAT: '1' },
            '06.178': { ENERC_KCAL: '310', FAT: '0.5' },
            '99.999': { ENERC_KCAL: '1' },
        });

        expect(extractDrift(pulled, extract, toLine, TAGS)).toEqual([]);
    });

    it('reports a cited item the mapper rejects, with the reason', () => {
        const pulled = items({ '01.036': { reject: 'yes' }, '06.178': { ENERC_KCAL: '310', FAT: '0.5' } });

        expect(extractDrift(pulled, extract, toLine, TAGS)).toEqual([
            { kind: 'unmappable', externalKey: '01.036', reason: 'Fett: is published in mg' },
        ]);
    });

    it('reports a cited key the source no longer lists', () => {
        expect(extractDrift(items({ '06.178': { ENERC_KCAL: '310', FAT: '0.5' } }), extract, toLine, TAGS)).toEqual([
            { kind: 'absent', externalKey: '01.036' },
        ]);
    });

    it("lets a mapper's unexpected failure through rather than reading it as drift", () => {
        const broken = (): ExtractLine => {
            throw new TypeError('bug');
        };

        expect(() => extractDrift(items({ '01.036': {} }), extract, broken, TAGS)).toThrow(TypeError);
    });
});
