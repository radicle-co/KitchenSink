/**
 * A mirror item's version (plan KTD-26): the SHA-256 of the item's RFC 8785 (JCS) canonical form, so the version
 * depends on the item's content and never on how the publisher happened to order or space it. A sync writes an item
 * only when its version changed, so two serialisations of one item must share one version.
 */
import { describe, expect, it } from 'vitest';

import { itemVersion } from '../itemVersion.js';

describe('itemVersion', () => {
    it('is the SHA-256 of the canonical form: keys sorted, no whitespace, strings as JSON', () => {
        // sha256('{"a":1,"b":[true,null,"é"]}')
        expect(itemVersion({ b: [true, null, 'é'], a: 1 })).toBe(
            '9488dd13ca33d3291f5a91a1833dfa164811755ffba538c2b340780f8c31a0cb',
        );
    });

    it('does not depend on the order or spacing the publisher wrote', () => {
        const published = JSON.parse('{ "b" : [ true, null, "\\u00e9" ], "a" : 1.0 }') as unknown;

        expect(itemVersion(published)).toBe(itemVersion({ a: 1, b: [true, null, 'é'] }));
    });

    it('changes when any value changes, however deep', () => {
        // sha256('{"a":1,"b":[true,null,"é"],"c":2}')
        expect(itemVersion({ a: 1, b: [true, null, 'é'], c: 2 })).toBe(
            '2d3f7933a1184b972b929edee4c01e2579617ca1d69eda9192626705041b7387',
        );
        expect(itemVersion({ a: 1, b: [true, false, 'é'] })).not.toBe(itemVersion({ a: 1, b: [true, null, 'é'] }));
    });

    it("matches the mirror's stored form: 64 lower-case hex digits", () => {
        expect(itemVersion({ foodId: '06.178' })).toMatch(/^[0-9a-f]{64}$/u);
    });

    it.each([
        ['undefined, which has no JSON form', undefined],
        ['a lone surrogate, which RFC 8785 refuses', { name: '\ud800' }],
        ['a number JSON cannot hold', { quantity: Number.POSITIVE_INFINITY }],
    ])('refuses %s', (_, value) => {
        expect(() => itemVersion(value)).toThrow();
    });
});
