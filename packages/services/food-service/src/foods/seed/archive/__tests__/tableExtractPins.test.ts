/**
 * A cited table's pins (plan U23, KTD-20): the upstream files its extract was read from, one per role, each with the
 * SHA-256 of the published bytes, and the committed extract with its own SHA-256. People write the file by hand, so
 * the parser is the only thing standing between a typo and a pin that proves nothing.
 */
import { describe, expect, it } from 'vitest';

import { parseTableExtractPins } from '../tableExtractPins.js';
import { isSourcePinsFormatError } from '../usdaSourceArchive.errors.js';

const PINS = {
    upstreams: {
        foods: { upstream: 'alim_2025_11_03.xml', upstreamSha256: 'a'.repeat(64) },
        composition: { upstream: 'compo_2025_11_03.xml', upstreamSha256: 'b'.repeat(64) },
    },
    extract: 'ciqualExtract2025.jsonl',
    extractSha256: 'c'.repeat(64),
};

/**
 * A mirror source's committed snapshot (plan U28, KTD-26), by role: the publisher's file, the SHA-256 of its
 * published bytes, and the committed compressed copy a preview fills its mirror from without calling the publisher.
 */
const SNAPSHOTS = {
    foods: {
        upstream: 'foods.json',
        upstreamSha256: 'd'.repeat(64),
        committed: 'matvaretabellenFoods2026.gz',
    },
};

describe('parseTableExtractPins', () => {
    it('parses one upstream per role and the extract', () => {
        expect(parseTableExtractPins(JSON.stringify(PINS))).toEqual(PINS);
    });

    it("parses a mirror source's committed snapshots, by role, beside the extract", () => {
        expect(parseTableExtractPins(JSON.stringify({ ...PINS, snapshots: SNAPSHOTS }))).toEqual({
            ...PINS,
            snapshots: SNAPSHOTS,
        });
    });

    it.each([
        ['an empty snapshot list, which is left out rather than written', {}],
        ['a snapshot with no committed copy', { foods: { upstream: 'foods.json', upstreamSha256: 'd'.repeat(64) } }],
        [
            'a committed copy that breaks the file-name rule',
            { foods: { ...SNAPSHOTS.foods, committed: 'foods.en.json.gz' } },
        ],
        ['a snapshot pinned in upper case', { foods: { ...SNAPSHOTS.foods, upstreamSha256: 'D'.repeat(64) } }],
        ['a snapshot role that is not a camelCase word', { 'food-list': SNAPSHOTS.foods }],
    ])('refuses %s', (_, snapshots) => {
        let thrown: unknown;

        try {
            parseTableExtractPins(JSON.stringify({ ...PINS, snapshots }));
        } catch (error) {
            thrown = error;
        }

        expect(isSourcePinsFormatError(thrown)).toBe(true);
    });

    it.each([
        ['text that is not JSON', '{'],
        ['no upstream at all', JSON.stringify({ ...PINS, upstreams: {} })],
        [
            'an upstream SHA-256 in upper case',
            JSON.stringify({
                ...PINS,
                upstreams: { table: { upstream: 'cofid.xlsx', upstreamSha256: 'A'.repeat(64) } },
            }),
        ],
        [
            'an upstream named by a path',
            JSON.stringify({
                ...PINS,
                upstreams: { table: { upstream: '../cofid.xlsx', upstreamSha256: 'a'.repeat(64) } },
            }),
        ],
        [
            'a role that is not a camelCase word',
            JSON.stringify({
                ...PINS,
                upstreams: { 'food-names': { upstream: 'x.csv', upstreamSha256: 'a'.repeat(64) } },
            }),
        ],
        ['an extract name that breaks the file-name rule', JSON.stringify({ ...PINS, extract: 'ciqual-2025.jsonl' })],
        ['an extract with no SHA-256', JSON.stringify({ ...PINS, extractSha256: undefined })],
        ['a field the format does not have', JSON.stringify({ ...PINS, edition: '2025' })],
    ])('refuses %s with the named pins error', (_, json) => {
        let thrown: unknown;

        try {
            parseTableExtractPins(json);
        } catch (error) {
            thrown = error;
        }

        expect(isSourcePinsFormatError(thrown)).toBe(true);
    });
});
