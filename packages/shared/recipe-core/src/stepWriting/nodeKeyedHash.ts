/**
 * THE PRODUCTION KEYED HASH of a shingle: the one place the HMAC-to-int64 step is written.
 *
 * DESIGN PATTERN: **Port adapter.** `wordShingles.ts` takes a {@link KeyedHash} and stays free of crypto; this is the
 * adapter every server consumer injects (the service's wording check, the public-version worker, 020's copy check),
 * so all of them store identical values for identical text. The value is HMAC-SHA256 over the UTF-8 bytes of the
 * NFC shingle, and its first 8 bytes read big-endian as a SIGNED 64-bit integer (the `bigint[]` column type).
 *
 * KEY ENCODING: a string key is used as its UTF-8 bytes, exactly as the keyring secret holds it (a generated
 * alphanumeric string, not base64). A `Uint8Array` key is used as raw bytes. An empty key is refused.
 *
 * SERVER ONLY. This module imports `node:crypto`, which the web and mobile bundles do not have. It is not
 * re-exported from the package barrel, and `nodeKeyedHashServerOnly.test.ts` in repoGuards fails when any app
 * source imports it.
 */
import { createHmac } from 'node:crypto';

import type { KeyedHash } from './wordShingles.js';

/**
 * Build the keyed hash for one key.
 *
 * @param key - The keyring key: a string (UTF-8 bytes) or raw bytes.
 * @returns A {@link KeyedHash}. Pure given the key.
 * @throws {RangeError} when the key is empty.
 */
export function keyedShingleHash(key: string | Uint8Array): KeyedHash {
    if (key.length === 0) {
        throw new RangeError('The fingerprint key must not be empty.');
    }

    return (shingle) => createHmac('sha256', key).update(shingle.normalize('NFC'), 'utf8').digest().readBigInt64BE(0);
}
