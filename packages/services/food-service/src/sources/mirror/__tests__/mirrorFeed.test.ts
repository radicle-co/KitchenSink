/**
 * One pull of a mirror source (plan KTD-26): every item the source lists, each under its own key and name with its
 * content version, and one version for the whole pull.
 *
 * The pull's version is derived from its items' versions, never from an HTTP header: Matvaretabellen regenerates
 * `foods.json` (its `Last-Modified` read 2026-10-01 03:25 GMT on a table that changes yearly), and the publisher feed
 * and the committed snapshot must agree on a version whenever they agree on content.
 */
import { describe, expect, it } from 'vitest';

import { isMirrorFeedFormatError } from '../mirrorFeed.errors.js';
import { mirrorPullOf } from '../mirrorFeed.js';
import { itemVersion } from '../itemVersion.js';

const BEANS = { externalKey: '06.178', name: 'Adzuki beans, uncooked', payload: { foodId: '06.178', kcal: 310 } };
const QUARK = { externalKey: '01.036', name: 'Quark, 1 % fat', payload: { foodId: '01.036', kcal: 66 } };

describe('mirrorPullOf', () => {
    it("versions each item by its payload's canonical form", () => {
        const pull = mirrorPullOf([BEANS]);

        expect(pull.items).toEqual([{ ...BEANS, itemVersion: itemVersion(BEANS.payload) }]);
    });

    it('gives the same version to the same items in any order', () => {
        expect(mirrorPullOf([BEANS, QUARK]).sourceVersion).toBe(mirrorPullOf([QUARK, BEANS]).sourceVersion);
    });

    it.each([
        ['an item changes', [BEANS, { ...QUARK, payload: { ...QUARK.payload, kcal: 67 } }]],
        ['an item is added', [BEANS, QUARK, { ...QUARK, externalKey: '01.037' }]],
        ['an item vanishes', [BEANS]],
        ['an item moves to another key', [BEANS, { ...QUARK, externalKey: '01.099' }]],
    ])('gives a new version when %s', (_, items) => {
        expect(mirrorPullOf(items).sourceVersion).not.toBe(mirrorPullOf([BEANS, QUARK]).sourceVersion);
    });

    it('versions an empty pull, so a source that lists nothing is still a pull', () => {
        expect(mirrorPullOf([]).sourceVersion).toMatch(/^[0-9a-f]{64}$/u);
    });

    it.each([
        ['a key held twice', [BEANS, { ...QUARK, externalKey: '06.178' }], /06\.178/u],
        ['an empty key', [{ ...BEANS, externalKey: '' }], /key/u],
        ['a blank name', [{ ...BEANS, name: '  ' }], /name/u],
    ])('refuses %s', (_, items, detail) => {
        let thrown: unknown;

        try {
            mirrorPullOf(items);
        } catch (error) {
            thrown = error;
        }

        expect(isMirrorFeedFormatError(thrown)).toBe(true);
        expect(thrown instanceof Error ? thrown.message : '').toMatch(detail);
    });
});
