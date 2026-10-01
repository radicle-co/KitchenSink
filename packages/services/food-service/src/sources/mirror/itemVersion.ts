/**
 * A mirror item's version (plan KTD-26): the SHA-256 of the item's RFC 8785 (JSON Canonicalization Scheme) form.
 * The canonical form sorts keys, drops insignificant whitespace and writes numbers and strings one way, so the
 * version depends on what an item says and never on how its publisher serialised it. A sync writes an item only when
 * its version changed.
 *
 * `canonicalize` is the scheme's reference implementation, by one of the RFC's authors.
 *
 * @pattern Value Object — an item's content reduced to one comparable digest
 * @module
 */
import { createHash } from 'node:crypto';

import canonicalize from 'canonicalize';

/**
 * The version of a JSON value. Pure.
 *
 * @param value - A JSON value, as `JSON.parse` returns one.
 * @returns 64 lower-case hex digits.
 * @throws {TypeError} when the value has no JSON form, such as `undefined`.
 * @throws {Error} from `canonicalize` for a lone surrogate or a number JSON cannot hold.
 */
export function itemVersion(value: unknown): string {
    const canonical = canonicalize(value);

    if (canonical === undefined) {
        throw new TypeError('A mirror item must be a JSON value to have a version');
    }

    return createHash('sha256').update(canonical, 'utf8').digest('hex');
}
